// node --test tests/  — brain feed API + sign-in gate, against fixtures/brain-feed (tools/brain/fetch_fixture.py).
// Uses a throwaway session secret and a made-up allowed address, never the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { onRequest as gate } from '../functions/_middleware.js';
import { onRequestGet as brain } from '../functions/api/brain/[file].js';
import { createSessionCookie } from '../functions/_lib/session.js';

const FIX = new URL('../fixtures/brain-feed/', import.meta.url);
const calls = [];
const BRAIN_FEED = {  // fake R2 binding: get() only, and records every method used
  async get(key) { calls.push(['get', key]); try { const b = await readFile(new URL(key, FIX)); return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch { return null; } },
  async put() { calls.push(['put']); throw new Error('write attempted'); },
  async delete() { calls.push(['delete']); throw new Error('write attempted'); },
};
const env = { BRAIN_FEED, SESSION_SECRET: 'test-secret-'.padEnd(48, 'x'), ALLOWED_EMAIL: 'tester@example.invalid' };
const cookie = (await createSessionCookie(env, 'tester@example.invalid')).split(';')[0];

async function hit(path, headers = {}) {
  const url = new URL(path, 'https://collinslab.dev');
  const request = new Request(url, { headers });
  const file = url.pathname.split('/')[3];
  const ctx = { request, env, data: {}, params: { file }, next: () => brain({ request, env, params: { file } }) };
  return gate(ctx);
}

test('signed out: API refused with 401 and the page redirects to sign-in', async () => {
  for (const f of ['meta', 'dashboard', 'graph']) assert.equal((await hit(`/api/brain/${f}`)).status, 401);
  const r = await hit('/brain/');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('Location'), /\/login\/\?next=%2Fbrain%2F/);
});

test('signed in: meta is served and never cached', async () => {
  const r = await hit('/api/brain/meta', { Cookie: cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await r.json()).schema, 1);
});

test('signed in: graph pinned by hash is cached privately, unpinned revalidates, 304 on ETag', async () => {
  const meta = JSON.parse(await readFile(new URL('v1/meta.json', FIX)));
  const sha = meta.files['graph.json'].sha256;
  const body = await readFile(new URL('v1/graph.json', FIX));
  assert.equal(createHash('sha256').update(body).digest('hex'), sha, 'fixture is self-consistent');
  const pinned = await hit(`/api/brain/graph?v=${sha}`, { Cookie: cookie });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.headers.get('ETag'), `"${sha}"`);
  assert.equal(pinned.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  assert.equal((await pinned.json()).nodes.length, meta.graph_counts ? Object.entries(meta.graph_counts).filter(([k]) => k !== 'edges').reduce((a, [, v]) => a + v, 0) : (await pinned.json()).nodes.length);
  const stale = await hit('/api/brain/graph?v=0000', { Cookie: cookie });
  assert.equal(stale.headers.get('Cache-Control'), 'private, no-cache');
  const again = await hit('/api/brain/dashboard', { Cookie: cookie, 'If-None-Match': `"${meta.files['dashboard.json'].sha256}"` });
  assert.equal(again.status, 304);
});

test('unknown file is 404 and the site never writes to the bucket', async () => {
  assert.equal((await hit('/api/brain/secrets', { Cookie: cookie })).status, 404);
  assert.ok(calls.every(([m]) => m === 'get'), `only get() used: ${JSON.stringify(calls.filter(([m]) => m !== 'get'))}`);
});

test('the gate keeps /brain/ and /api/brain/ out of the public prefixes', async () => {
  const src = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
  const lists = src.match(/PUBLIC_(EXACT|PREFIX)\s*=\s*[^;]+;/g).join(' ');
  assert.doesNotMatch(lists, /brain/);
});

test('fixture carries the 2026-11-11 feed additions the pages use', async () => {
  const meta = JSON.parse(await readFile(new URL('v1/meta.json', FIX)));
  const dash = JSON.parse(await readFile(new URL('v1/dashboard.json', FIX)));
  const graph = JSON.parse(await readFile(new URL('v1/graph.json', FIX)));
  assert.ok(meta.graph_generated && meta.dashboard_generated);
  assert.ok(dash.checks.filter((c) => c.level !== 'green').every((c) => c.since));
  assert.ok(graph.nodes.filter((d) => d.type === 'document' || d.type === 'repo').every((d) => d.project));
  assert.ok(graph.edges.some((e) => e.rel === 'committed'));
});

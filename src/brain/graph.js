// /brain/graph/: 3D force graph of graph.json (contract: ~/brain/docs/FEED.md, schema 1).
// Colour by node type, size by degree. Sub-agent sessions hidden by default. Filters for
// type, project, host and date range; label search; click a node for its side panel.
// Kept light for ~4k nodes / 8k edges on a phone: low-poly spheres, plain line links,
// capped pixel ratio, a short simulation, and node objects reused across filter changes
// so positions persist instead of re-settling from scratch.
import ForceGraph3D from '3d-force-graph';
import { loadMeta, loadFile, ago, n } from './feed.js';
import { el } from '../projects/common.js';

const TYPES = {  // fixed order = validated categorical slots (brain.css header)
  session: { label: 'Sessions', color: '#3987e5' },
  project: { label: 'Projects', color: '#d95926' },
  document: { label: 'Documents', color: '#199e70' },
  repo: { label: 'Repos', color: '#c98500' },
};
const DIM = '#2a3133';
const REL_OUT = { in: 'in project', read: 'read', wrote: 'wrote', edited: 'edited' };
const REL_IN = { in: 'contains', read: 'read by', wrote: 'written by', edited: 'edited by' };
const phone = matchMedia('(max-width: 760px)').matches;
const $ = (id) => document.getElementById(id);

const state = { types: new Set(Object.keys(TYPES)), subagents: false, project: '', host: '', from: '', to: '', selected: null };
let all = [], byId = new Map(), adj = new Map(), links = [], graph, neighbourIds = new Set();

const dateOf = (d) => (d.date || d.last_active || '').slice(0, 10);

function visibleNodes() {
  return all.filter((d) => {
    if (!state.types.has(d.type)) return false;
    if (d.type === 'session' && d.subagent && !state.subagents) return false;
    if (state.host && d.host && d.host !== state.host) return false;
    if (state.host && !d.host && d.type !== 'project') return false;
    if (state.project && (d.type === 'project' ? d.label !== state.project : d.project !== state.project && !(adj.get(d.id) || []).some(([o]) => o === `p:${state.project}`))) return false;
    const day = dateOf(d);
    if (day && d.type !== 'project' && ((state.from && day < state.from) || (state.to && day > state.to))) return false;
    return true;
  });
}

function apply() {
  const nodes = visibleNodes();
  const keep = new Set(nodes.map((d) => d.id));
  const ls = links.filter((l) => keep.has(l.source.id ?? l.source) && keep.has(l.target.id ?? l.target));
  graph.graphData({ nodes, links: ls });
  $('count').textContent = `${n(nodes.length)} nodes · ${n(ls.length)} links`;
  for (const [t, cfg] of Object.entries(TYPES)) {
    const c = document.querySelector(`[data-type-count="${t}"]`);
    if (c) c.textContent = n(nodes.filter((d) => d.type === t).length);
  }
  if (state.selected && !keep.has(state.selected.id)) select(null);
}

function color(d) {
  if (state.selected && d !== state.selected && !neighbourIds.has(d.id)) return DIM;
  return TYPES[d.type]?.color || '#888';
}

function select(d, fly = false) {
  state.selected = d;
  neighbourIds = new Set(d ? (adj.get(d.id) || []).map(([o]) => o) : []);
  graph.nodeColor(color).linkColor(linkColor);
  const panel = $('detail');
  if (!d) { panel.hidden = true; return; }
  if (fly && d.x != null) {
    const radius = Math.cbrt(graph.nodeVal()(d)) * graph.nodeRelSize();
    const dist = 70 + radius * 7, r = 1 + dist / Math.hypot(d.x || 1, d.y || 1, d.z || 1);
    graph.cameraPosition({ x: d.x * r, y: d.y * r, z: d.z * r }, d, 900);
  }
  const nb = (adj.get(d.id) || []).map(([o, rel, dir]) => [byId.get(o), rel, dir]).filter(([o]) => o)
    .sort((a, b) => (b[0].degree || 0) - (a[0].degree || 0));
  const where = d.path || d.cwd;
  panel.replaceChildren(...[
    el('button', { className: 'close btn ghost', type: 'button', textContent: '✕', ariaLabel: 'Close', onclick: () => select(null) }),
    el('div', { className: 'small' }, el('span', { className: 'type-dot', style: `background:${TYPES[d.type]?.color}` }), ` ${TYPES[d.type]?.label.replace(/s$/, '') || d.type}${d.subagent ? ' · sub-agent' : ''}${d.manifest ? ' · location only' : ''}`),
    el('h2', { textContent: d.label }),
    d.summary ? el('p', { textContent: d.summary }) : null,
    el('dl', { className: 'kv' }, ...[
      ['Date', d.date ? `${d.date.slice(0, 10)} (${ago(d.date)})` : d.last_active ? `last active ${ago(d.last_active)}` : null],
      ['Project', d.project || null],
      ['Host', d.host || null],
      [d.path ? 'Path' : 'Folder', where || null],
      ['Links', n(d.degree)],
      d.type === 'project' ? ['Holds', `${n(d.sessions)} sessions · ${n(d.documents)} documents · ${n(d.repos)} repos${d.files_in_folder != null ? ` · ${n(d.files_in_folder)} files in folder` : ''}`] : [null, null],
      d.type === 'repo' && d.months_of_history != null ? ['History', `${n(d.months_of_history)} months`] : [null, null],
    ].filter(([k, v]) => k && v).flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
    d.project && d.type !== 'project' ? el('button', { className: 'btn ghost small', type: 'button', textContent: `Show only ${d.project}`, onclick: () => { state.project = d.project; $('project').value = d.project; apply(); } }) : null,
    nb.length ? el('h3', { textContent: `Linked · ${nb.length}` }) : null,
    nb.length ? el('ul', { className: 'nb' }, ...nb.slice(0, 60).map(([o, rel, dir]) => el('li', {},
      el('button', { type: 'button', onclick: () => select(o, true) },
        el('span', { className: 'type-dot', style: `background:${TYPES[o.type]?.color}` }),
        el('span', { className: 'small muted', textContent: ` ${(dir === 'out' ? REL_OUT : REL_IN)[rel] || rel} ` }), o.label)))) : null,
    nb.length > 60 ? el('p', { className: 'small muted', textContent: `and ${nb.length - 60} more` }) : null,
  ].filter(Boolean));
  panel.hidden = false;
}

// three.js ignores alpha in link colours, so links share one opacity and dim by colour.
function linkColor(l) {
  if (!state.selected) return '#56666a';
  const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
  return s === state.selected.id || t === state.selected.id ? '#f0efec' : '#1c2426';
}

function buildControls(projects, hosts, minDay, maxDay) {
  $('types').replaceChildren(...Object.entries(TYPES).map(([t, cfg]) => {
    const box = el('input', { type: 'checkbox', checked: true });
    box.onchange = () => { box.checked ? state.types.add(t) : state.types.delete(t); apply(); };
    const cnt = el('span', { className: 'small muted' });
    cnt.setAttribute('data-type-count', t);
    return el('label', { className: 'check' }, box, el('span', { className: 'type-dot', style: `background:${cfg.color}` }), ` ${cfg.label} `, cnt);
  }));
  const fill = (sel, items, allLabel) => sel.replaceChildren(el('option', { value: '', textContent: allLabel }), ...items.map(([v, c]) => el('option', { value: v, textContent: `${v} (${n(c)})` })));
  fill($('project'), projects, 'All projects');
  fill($('host'), hosts, 'All hosts');
  for (const id of ['from', 'to']) { $(id).min = minDay; $(id).max = maxDay; }
  $('project').onchange = (e) => { state.project = e.target.value; apply(); };
  $('host').onchange = (e) => { state.host = e.target.value; apply(); };
  $('from').onchange = (e) => { state.from = e.target.value; apply(); };
  $('to').onchange = (e) => { state.to = e.target.value; apply(); };
  $('subagents').onchange = (e) => { state.subagents = e.target.checked; apply(); };
  $('reset').onclick = () => {
    Object.assign(state, { types: new Set(Object.keys(TYPES)), subagents: false, project: '', host: '', from: '', to: '' });
    document.querySelectorAll('#types input').forEach((b) => { b.checked = true; });
    for (const id of ['project', 'host', 'from', 'to']) $(id).value = '';
    $('subagents').checked = false;
    apply();
  };
  const toggle = $('toggle-filters');
  toggle.onclick = () => { const open = $('filters').hidden; $('filters').hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
  if (!phone) { $('filters').hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
  $('q').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const hits = q.length < 2 ? [] : all.filter((d) => d.label.toLowerCase().includes(q)).sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 12);
    $('hits').replaceChildren(...hits.map((d) => el('li', {}, el('button', { type: 'button', onclick: () => {
      // make sure the hit is visible before selecting it
      if (!state.types.has(d.type)) { state.types.add(d.type); document.querySelectorAll('#types input')[Object.keys(TYPES).indexOf(d.type)].checked = true; }
      if (d.subagent && !state.subagents) { state.subagents = true; $('subagents').checked = true; }
      if (!visibleNodes().includes(d)) $('reset').onclick();
      apply();
      setTimeout(() => select(d, true), 50);
      if (phone) { $('filters').hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    } }, el('span', { className: 'type-dot', style: `background:${TYPES[d.type]?.color}` }), ` ${d.label}`))));
  };
}

async function main() {
  const meta = await loadMeta();
  const g = await loadFile('graph', meta);
  all = (g.nodes || []).filter((d) => TYPES[d.type]).map((d) => ({ ...d, degree: Number(d.degree) || 0, subagent: d.subagent === true }));
  byId = new Map(all.map((d) => [d.id, d]));
  for (const e of g.edges || []) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    links.push({ source: e.source, target: e.target, rel: e.rel });
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push([e.target, e.rel, 'out']);
    adj.get(e.target).push([e.source, e.rel, 'in']);
  }
  const count = (key) => [...all.reduce((m, d) => (d[key] ? m.set(d[key], (m.get(d[key]) || 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]);
  const days = all.map(dateOf).filter(Boolean).sort();
  buildControls(count('project'), count('host'), days[0], days.at(-1));
  $('sub-n').textContent = `(${n(all.filter((d) => d.subagent).length)})`;

  graph = ForceGraph3D({ controlType: 'orbit', rendererConfig: { antialias: !phone, powerPreference: 'high-performance', alpha: false } })($('graph'))
    .backgroundColor('#0b0f10')
    .showNavInfo(false)
    .nodeId('id')
    .nodeLabel((d) => `<div class="g-tip"><b>${escapeHtml(d.label)}</b><br><span>${TYPES[d.type].label.replace(/s$/, '')}${d.project ? ' · ' + escapeHtml(d.project) : ''}</span></div>`)
    .nodeVal((d) => 1 + (d.type === 'project' ? d.degree * 0.6 : d.degree))
    .nodeRelSize(phone ? 2.4 : 2.8)
    .nodeResolution(phone ? 5 : 8)
    .nodeOpacity(0.92)
    .nodeColor(color)
    .linkColor(linkColor)
    .linkWidth(0)
    .linkOpacity(phone ? 0.35 : 0.45)
    .enableNodeDrag(!phone)
    .warmupTicks(phone ? 40 : 20)
    .cooldownTicks(phone ? 80 : 160)
    .d3AlphaDecay(0.035)
    .onNodeClick((d) => select(d, true))
    .onBackgroundClick(() => select(null));
  graph.renderer().setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 2));
  graph.d3Force('charge').strength(-18).distanceMax(260);
  graph.d3Force('link').distance((l) => (l.rel === 'in' ? 26 : 16));
  const fit = () => graph.width(innerWidth).height(innerHeight - $('graph').getBoundingClientRect().top);
  addEventListener('resize', fit);
  fit();
  apply();
  graph.onEngineStop(() => { if (!state.selected && !main.fitted) { main.fitted = true; graph.zoomToFit(600, 30, (d) => d.degree > 0); } });
  $('status').textContent = `Graph published ${ago(g.generated)}. Click a node for details.`;
  setTimeout(() => { $('status').hidden = true; }, 6000);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

main().catch((e) => { $('status').textContent = `Could not load the graph: ${e.message}`; });

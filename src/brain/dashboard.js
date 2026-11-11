// /brain/ dashboard: health, holdings, 120-day activity, projects, collectors, backup, enrichment,
// admin loop and stale sweep, from dashboard.json (contract: ~/brain/docs/FEED.md, schema 1).
// Email and calendar appear only as counts. Unknown fields are ignored.
import { loadMeta, loadFile, ago, LEVEL, n } from './feed.js';
import { el } from '../projects/common.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
const COUNT_ONLY = new Set(['email', 'event', 'calendar']);  // kinds shown as counts only
const GROUP_LABEL = { sessions: 'Sessions', turns: 'Turns', documents: 'Documents', git: 'Git commits', emails: 'Emails', events: 'Calendar events' };

const status = (level) => el('span', { className: `lvl lvl-${level}`, textContent: `${LEVEL[level]?.icon || '?'} ${LEVEL[level]?.label || level}` });
const card = (title, ...kids) => el('section', { className: 'b-card' }, el('h2', { textContent: title }), ...kids);
const kv = (pairs) => el('dl', { className: 'kv' }, ...pairs.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
const prettyCheck = (c) => c.replace(/^host:/, 'Collector · ').replace(/^source:/, 'Source · ').replace(/^backup-check$/, 'Backup verify').replace(/^\w/, (x) => x.toUpperCase());

// ---- activity chart: one axis, two series (happened vs ingested), crosshair tooltip, table view
function activityChart(act, group) {
  const dates = act.dates || [];
  const a = act.happened?.[group] || [], b = act.ingested?.[group] || [];
  const W = 720, H = 220, L = 40, R = 76, T = 12, B = 26;
  const max = Math.max(1, ...a, ...b);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (i / Math.max(1, dates.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const grid = [];
  for (let v = 0; v <= top; v += step) {
    grid.push(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v ? 'grid' : 'axis' }), svg('text', { x: L - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, n(v)));
  }
  const months = [];
  dates.forEach((d, i) => { if (d.endsWith('-01')) months.push(svg('text', { x: x(i), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, new Date(d + 'T00:00:00Z').toLocaleDateString([], { month: 'short', timeZone: 'UTC' }))); });
  // End labels, pushed apart when the two lines finish close together.
  let ya = y(a.at(-1) ?? 0) + 4, yb = y(b.at(-1) ?? 0) + 4;
  if (Math.abs(ya - yb) < 13) { const mid = (ya + yb) / 2, up = ya <= yb ? -1 : 1; ya = mid + up * 6.5; yb = mid - up * 6.5; }
  const endLabel = (yy, cls, name) => svg('text', { x: W - R + 6, y: yy, class: `end ${cls}` }, name);
  const cross = svg('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  const dotA = svg('circle', { r: 4, class: 'dot s-happened', visibility: 'hidden' });
  const dotB = svg('circle', { r: 4, class: 'dot s-ingested', visibility: 'hidden' });
  const hit = svg('rect', { x: L, y: T, width: W - L - R, height: H - T - B, class: 'hit' });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'activity', role: 'img', 'aria-label': `${GROUP_LABEL[group]} per day over ${dates.length} days, happened versus ingested` },
    ...grid, ...months,
    svg('path', { d: path(a), class: 'line s-happened' }), svg('path', { d: path(b), class: 'line s-ingested' }),
    endLabel(ya, 's-happened', 'happened'), endLabel(yb, 's-ingested', 'ingested'), cross, dotA, dotB, hit);
  const tip = el('div', { className: 'tip', hidden: true });
  const move = (ev) => {
    const r = chart.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - L) / (W - L - R)) * (dates.length - 1))));
    for (const [e, k] of [[cross, 'x'], [dotA, 'a'], [dotB, 'b']]) e.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    dotA.setAttribute('cx', x(i)); dotA.setAttribute('cy', y(a[i] ?? 0));
    dotB.setAttribute('cx', x(i)); dotB.setAttribute('cy', y(b[i] ?? 0));
    tip.hidden = false;
    tip.replaceChildren(el('b', { textContent: new Date(dates[i] + 'T00:00:00Z').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }),
      el('div', {}, el('span', { className: 'sw s-happened' }), `happened ${n(a[i])}`), el('div', {}, el('span', { className: 'sw s-ingested' }), `ingested ${n(b[i])}`));
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(r.width - 150, Math.max(0, left + 10))}px`;
  };
  const leave = () => { tip.hidden = true; for (const e of [cross, dotA, dotB]) e.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  const sum = (v) => v.reduce((s, x) => s + x, 0);
  const table = el('details', { className: 'table-view' }, el('summary', { className: 'small', textContent: 'Table view' }),
    el('div', { className: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { textContent: 'Date' }), el('th', { textContent: 'Happened' }), el('th', { textContent: 'Ingested' }))),
      el('tbody', {}, ...dates.map((d, i) => el('tr', {}, el('td', { textContent: d }), el('td', { className: 'num', textContent: n(a[i]) }), el('td', { className: 'num', textContent: n(b[i]) }))).reverse()))));
  return el('div', {},
    el('div', { className: 'legend small' }, el('span', {}, el('span', { className: 'sw s-happened' }), `Happened (${n(sum(a))})`), el('span', {}, el('span', { className: 'sw s-ingested' }), `Ingested (${n(sum(b))})`)),
    el('div', { className: 'chart-wrap' }, chart, tip), table);
}

function niceStep(max) {
  const raw = max / 4, pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || pow * 10;
}

function bar(value, max) {
  return el('span', { className: 'bar' }, el('span', { style: `width:${max ? Math.max(2, (100 * value) / max) : 0}%` }));
}

function render(d, meta) {
  const totals = d.totals || {};
  const src = [...(totals.by_source || [])].sort((p, q) => q.n - p.n);
  const maxN = Math.max(1, ...src.map((s) => s.n || 0));
  const checks = [...(d.checks || [])].sort((p, q) => ['red', 'amber', 'green'].indexOf(p.level) - ['red', 'amber', 'green'].indexOf(q.level));
  const bad = checks.filter((c) => c.level !== 'green');
  const projects = d.projects || [];
  const maxP = Math.max(1, ...projects.map((p) => p.sessions_30d || 0));
  const enr = d.enrichment || {};
  const enrPct = enr.enriched != null ? Math.round((100 * enr.enriched) / Math.max(1, enr.enriched + (enr.waiting || 0))) : null;
  const groups = Object.keys(d.activity?.happened || {}).filter((g) => GROUP_LABEL[g]);
  let group = groups.includes('sessions') ? 'sessions' : groups[0];
  const chartBox = el('div', {});
  const chips = el('div', { className: 'chips', role: 'tablist' });
  const drawChart = () => {
    chips.replaceChildren(...groups.map((g) => { const b = el('button', { type: 'button', className: `chip-btn${g === group ? ' on' : ''}`, textContent: GROUP_LABEL[g] }); b.setAttribute('aria-selected', String(g === group)); b.onclick = () => { group = g; drawChart(); }; return b; }));
    chartBox.replaceChildren(activityChart(d.activity, group));
  };
  if (groups.length) drawChart();
  const backup = d.backup || {};
  const admin = d.admin || {};
  const stale = d.stale_sweep || {};
  const gc = meta?.graph_counts || {};

  document.getElementById('dash').replaceChildren(
    el('section', { className: `hero lvl-bg-${d.overall}` },
      el('div', {}, el('div', { className: 'small muted', textContent: 'Overall health' }), el('div', { className: 'big' }, status(d.overall))),
      el('div', { className: 'small muted', textContent: `Dashboard ${ago(meta?.dashboard_generated || d.generated)} · graph changed ${ago(meta?.graph_generated)}${bad.length ? ` · ${bad.length} check${bad.length > 1 ? 's' : ''} need attention` : ' · all checks pass'}` }),
      el('div', { className: 'tiles' },
        tile(n(totals.items), 'items held'), tile(n(totals.links), 'links'), tile(n(d.upcoming_events_7d), 'events next 7 days'),
        tile(n(Object.entries(gc).filter(([k]) => k !== 'edges').reduce((s, [, v]) => s + v, 0)), 'graph nodes', '/brain/graph/'))),
    card('Health checks', el('ul', { className: 'checks' }, ...checks.map((c) => el('li', {}, status(c.level), el('div', {}, el('div', { className: 'name', textContent: prettyCheck(c.check) }), el('div', { className: 'small muted', textContent: c.detail }), c.since && c.level !== 'green' ? el('div', { className: 'small since', textContent: `${LEVEL[c.level]?.label || c.level} since ${ago(c.since)}` }) : null))))),
    groups.length ? card('Activity, last 120 days', el('p', { className: 'small muted', textContent: 'Per day, by when it happened and by when the brain stored it.' }), chips, chartBox) : null,
    card('What the brain holds', el('table', { className: 'src holdings' }, el('thead', {}, el('tr', {}, ...['Source', 'Kind', 'Items', '', 'MB'].map((h) => el('th', { textContent: h })))),
      el('tbody', {}, ...src.map((s) => el('tr', {}, el('td', { textContent: s.source }), el('td', { className: 'muted', textContent: s.kind }), el('td', { className: 'num', textContent: n(s.n) }), el('td', { className: 'barcell' }, bar(s.n, maxN)), el('td', { className: 'num muted', textContent: COUNT_ONLY.has(s.kind) || s.mb == null ? '' : n(Math.round(s.mb)) })))))),
    card('Most active projects', el('ul', { className: 'projects' }, ...projects.map((p) => el('li', {},
      el('div', { className: 'row' }, el('span', { className: 'name', textContent: p.project }), el('span', { className: 'small muted', textContent: `${n(p.sessions_30d)} sessions in 30 days · ${n(p.sessions_total)} total · ${ago(p.last_active)}` })),
      bar(p.sessions_30d || 0, maxP))))),
    el('div', { className: 'pair' },
      card('Collectors', el('ul', { className: 'hosts' }, ...(d.hosts || []).map((h) => el('li', {}, el('b', { textContent: h.host }), el('span', { className: 'small muted', textContent: ` checked in ${ago(h.last_checkin)} · ${n(h.records)} records · ${n(Math.round((h.bytes || 0) / 1024))} KB${h.skipped ? ` · ${n(h.skipped)} skipped` : ''}` }))))),
      card('Backup', kv([['Last snapshot', ago(backup.last_snapshot)], ['Last verify', `${ago(backup.last_check)}${backup.last_check_ok === false ? ' · FAILED' : backup.last_check_ok ? ' · OK' : ''}`]]))),
    el('div', { className: 'pair' },
      card('Enrichment (Haiku summaries)', enrPct != null ? el('div', { className: 'progress' }, el('span', { style: `width:${enrPct}%` })) : null,
        kv([['Enriched', n(enr.enriched)], ['Last 24 h', n(enr.last_24h)], ['Waiting', n(enr.waiting)], ['Done', enrPct != null ? `${enrPct}%` : '—']])),
      card('Stale sweep', kv([['Demoted, last 7 days', n(stale.demoted_7d)], ['Demoted, all time', n(stale.demoted_total)]]))),
    card('Admin loop', el('div', { className: 'queue small' }, ...Object.entries(admin.queue || {}).map(([k, v]) => el('span', { className: 'badge', textContent: `${k} ${v}` }))),
      el('ol', { className: 'actions' }, ...(admin.recent_actions || []).slice(0, 12).map((a) => el('li', {},
        el('div', { className: 'small muted', textContent: `${ago(a.ts)} · ${a.actor} · ${a.action}` }), el('div', { textContent: a.detail }))))),
    (d.runs_24h || []).length ? card('Connector runs, last 24 h', el('table', { className: 'src' }, el('thead', {}, el('tr', {}, ...['Source', 'Runs', 'OK', 'Last'].map((h) => el('th', { textContent: h })))),
      el('tbody', {}, ...d.runs_24h.map((r) => el('tr', {}, el('td', { textContent: r.source }), el('td', { className: 'num', textContent: n(r.runs) }), el('td', { className: `num${r.ok < r.runs ? ' warn' : ''}`, textContent: n(r.ok) }), el('td', { className: 'muted', textContent: ago(r.last) })))))) : null,
  );
}

function tile(value, label, href) {
  const kids = [el('div', { className: 'v', textContent: value }), el('div', { className: 'k small muted', textContent: label })];
  return href ? el('a', { className: 'tile', href }, ...kids) : el('div', { className: 'tile' }, ...kids);
}

async function load() {
  const meta = await loadMeta();
  render(await loadFile('dashboard', meta), meta);
}
load().catch((e) => { document.getElementById('dash').replaceChildren(el('p', { className: 'error', textContent: `Could not load the brain feed: ${e.message}` })); });
setInterval(() => load().catch(() => {}), 5 * 60_000);

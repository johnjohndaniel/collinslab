// Shared pieces for the manuscripts pages: section statuses, readiness score, section bar.
import { el } from '../projects/common.js';

export const SECTION = {
  missing: { label: 'Missing', score: 0 },
  outline: { label: 'Outline', score: 0.25 },
  drafted: { label: 'Drafted', score: 0.55 },
  revised: { label: 'Revised', score: 0.8 },
  final: { label: 'Final', score: 1 },
};
export const STAGES = ['submission-ready', 'full draft', 'draft', 'outline'];

// Share of the way to finished, from the per-section statuses (equal weight per section).
export function readiness(m) {
  const s = m.sections || [];
  if (!s.length) return null;
  return Math.round((100 * s.reduce((a, x) => a + (SECTION[x.status]?.score ?? 0), 0)) / s.length);
}

// One segment per section, width by the square root of its words so short sections stay visible.
export function sectionBar(m, { big = false } = {}) {
  const segs = (m.sections || []).map((s) => el('span', {
    className: `seg st-${s.status}`,
    style: `flex-grow:${(Math.sqrt(s.words || 0) + 6).toFixed(1)}`,
    title: `${s.heading} · ${SECTION[s.status]?.label || s.status}${s.words ? ` · ${s.words.toLocaleString()} words` : ''}${s.note ? ` · ${s.note}` : ''}`,
  }));
  return el('div', { className: `section-bar${big ? ' big' : ''}`, role: 'img', ariaLabel: 'Section status bar' }, ...segs);
}

export const stagePill = (stage) => el('span', { className: `pill stage-${(stage || 'unknown').replace(/\s+/g, '-')}`, textContent: stage || 'unjudged' });

export const legend = () => Object.entries(SECTION).map(([k, v]) =>
  el('span', { className: 'key' }, el('span', { className: `swatch st-${k}` }), v.label));

export const hours = (h) => (h == null ? '—' : `~${h} h`);

export function citationCount(m) {
  const v = Object.values(m.citations || {}).filter((n) => typeof n === 'number');
  return v.length ? Math.max(...v) : null;
}

// Brain feed loader. meta.json is always fetched fresh; dashboard.json and graph.json are
// requested with ?v=<sha256 from meta>, which the API marks private + immutable, so the
// browser reuses them until the brain publishes a new hash.
export async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { location.href = `/login/?next=${encodeURIComponent(location.pathname)}`; throw new Error('signed out'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export const loadMeta = () => fetchJSON('/api/brain/meta', { cache: 'no-store' });

export function loadFile(name, meta) {
  const sha = meta?.files?.[`${name}.json`]?.sha256 || '';
  return fetchJSON(`/api/brain/${name}?v=${sha}`);
}

export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `${Math.round(m)} min ago`;
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(d)} days ago`;
}

export const LEVEL = {
  green: { label: 'OK', icon: '●' },
  amber: { label: 'Warning', icon: '▲' },
  red: { label: 'Failing', icon: '✕' },
};

export const n = (x) => (x == null ? '—' : Number(x).toLocaleString());

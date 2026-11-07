export const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
};

export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `${Math.round(m)} min ago`;
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(d)} days ago`;
}

export const STATUS = {
  running: { label: 'Running now', short: 'running' },
  recent: { label: 'Active this week', short: 'recent' },
  idle: { label: 'Quiet lately', short: 'idle' },
  dormant: { label: 'Dormant', short: 'dormant' },
};

export const pill = (status) => el('span', { className: `pill pill-${status}`, textContent: STATUS[status]?.short || status });

export async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401) { location.href = `/login/?next=${encodeURIComponent(location.pathname)}`; throw new Error('signed out'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export function syncedLabel(projects) {
  const t = projects.map((p) => p.synced_at).filter(Boolean).sort().at(-1);
  return t ? `synced ${ago(t)}` : '';
}

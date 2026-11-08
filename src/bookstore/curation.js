// Curation: what this visitor sees. A handful of books per display, chosen from the sections
// they asked for, nudged by what they pick up, read, keep and put back. All stored locally.
import { hash } from './books.js';

const KEY = 'collinslab.books.prefs';
const DEFAULT_SECTIONS = ['fiction', 'science', 'philosophy'];

export const MOODS = [
  // optional "moods" that map onto sections, for people who don't think in shelf labels
  { key: 'mood-short', label: 'Something short', test: (b) => (b.pages || 300) < 230 },
  { key: 'mood-new', label: 'Only recent books', test: (b) => b.modern },
  { key: 'mood-classic', label: 'Only classics', test: (b) => !b.modern },
];

export class Curator {
  constructor(classics, modern) {
    this.sections = classics.sections;                        // [{key,label}]
    this.labels = Object.fromEntries(this.sections.map((s) => [s.key, s.label]));
    this.books = [
      ...classics.books.map((b) => ({ ...b, modern: false })),
      ...(modern?.books || []).map((b) => ({ ...b, modern: true })),
    ];
    this.byId = new Map(this.books.map((b) => [b.id, b]));
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
    this.prefs = { sections: [], moods: [], affinity: {}, seen: {}, kept: [], ...saved };
  }

  save() { localStorage.setItem(KEY, JSON.stringify(this.prefs)); }
  get hasChosen() { return this.prefs.sections.length > 0; }

  choose(sections, moods = []) {
    this.prefs.sections = sections.slice(0, 3);
    this.prefs.moods = moods;
    for (const s of this.prefs.sections) this.prefs.affinity[s] = Math.max(this.prefs.affinity[s] || 0, 2);
    this.save();
  }

  /** Behavioural signals. kind: pick | linger | read | keep | putback-quick */
  signal(book, kind, amount = 1) {
    const w = { pick: 0.5, linger: 0.7, read: 0.4, keep: 2.5, 'putback-quick': -0.4 }[kind] ?? 0;
    const a = this.prefs.affinity;
    a[book.section] = Math.max(-2, Math.min(12, (a[book.section] || 0) + w * amount));
    if (kind === 'pick') this.prefs.seen[book.id] = Date.now();
    this.save();
  }

  keep(book) { if (!this.prefs.kept.includes(book.id)) this.prefs.kept.push(book.id); this.signal(book, 'keep'); }
  unkeep(id) { this.prefs.kept = this.prefs.kept.filter((k) => k !== id); this.save(); }
  get kept() { return this.prefs.kept.map((id) => this.byId.get(id)).filter(Boolean); }

  #score(b, salt) {
    const day = new Date().toISOString().slice(0, 10); // a fresh arrangement each day
    const r = (hash(`${b.id}|${day}|${salt}`) % 10000) / 10000;
    const aff = this.prefs.affinity[b.section] || 0;
    const seen = this.prefs.seen[b.id] ? Math.min(1, (Date.now() - this.prefs.seen[b.id]) / 6.048e8) : 1; // recently seen books rest a week
    return r + 0.12 * aff + 0.35 * seen;
  }

  /** Lay out the store for this visitor. */
  arrange() {
    const chosen = (this.prefs.sections.length ? this.prefs.sections : DEFAULT_SECTIONS).slice(0, 3);
    const moodTests = MOODS.filter((m) => this.prefs.moods.includes(m.key)).map((m) => m.test);
    const ok = (b) => !this.prefs.kept.includes(b.id) && moodTests.every((t) => t(b));
    const used = new Set();
    const take = (pool, n, salt) => {
      const picks = pool.filter((b) => ok(b) && !used.has(b.id)).sort((a, b) => this.#score(b, salt) - this.#score(a, salt)).slice(0, n);
      picks.forEach((b) => used.add(b.id));
      return picks;
    };
    const inSection = (s) => this.books.filter((b) => b.section === s);

    // Front table: a few from each chosen section, mixing old and new.
    const front = [];
    chosen.forEach((s) => front.push(...take(inSection(s), Math.ceil(9 / chosen.length), 'front')));
    // New & notable: recent books, chosen sections first.
    const recent = this.books.filter((b) => b.modern);
    const newTable = [...take(recent.filter((b) => chosen.includes(b.section)), 6, 'new'), ...take(recent, 3, 'new2')];
    // Bays: one per chosen section, plus staff picks from elsewhere, weighted by affinity.
    const bays = chosen.map((s) => ({ key: s, label: this.labels[s], books: take(inSection(s), 21, 'bay') }));
    const others = this.books.filter((b) => !chosen.includes(b.section));
    bays.push({ key: 'staff', label: 'Staff picks', books: take(others, 21, 'staff') });
    return { chosen, front: front.slice(0, 9), newTable, bays };
  }
}

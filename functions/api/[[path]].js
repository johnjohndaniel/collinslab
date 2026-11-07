// Kanban board API. The middleware has already checked the session.
//   GET    /api/board            columns + cards
//   POST   /api/cards            { column_id, title, description?, label?, position? }
//   PATCH  /api/cards/:id        any of { title, description, label, column_id, position }
//   DELETE /api/cards/:id
//   POST   /api/columns          { name }  (appended on the right)
//   PATCH  /api/columns/:id      { name }
//   DELETE /api/columns/:id      only when empty
//   GET    /api/export           full JSON dump (backup)

const LABELS = new Set(['', 'idea', 'build', 'research', 'bug', 'urgent']);
const MAX_TITLE = 200;
const MAX_DESC = 10000;
const MAX_COLUMN = 60;

const bad = (msg, status = 400) => Response.json({ error: msg }, { status });

async function body(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new Error('expected JSON');
  return request.json();
}

function clean(input, { partial }) {
  const out = {};
  if ('title' in input || !partial) {
    const t = String(input.title ?? '').trim();
    if (!t) throw new Error('title is required');
    if (t.length > MAX_TITLE) throw new Error(`title longer than ${MAX_TITLE} characters`);
    out.title = t;
  }
  if ('description' in input) {
    const d = String(input.description ?? '');
    if (d.length > MAX_DESC) throw new Error(`description longer than ${MAX_DESC} characters`);
    out.description = d;
  }
  if ('label' in input) {
    if (!LABELS.has(input.label)) throw new Error('unknown label');
    out.label = input.label;
  }
  if ('column_id' in input || !partial) {
    const c = Number(input.column_id);
    if (!Number.isInteger(c)) throw new Error('column_id must be an integer');
    out.column_id = c;
  }
  if ('position' in input && input.position !== undefined) {
    const p = Number(input.position);
    if (!Number.isFinite(p)) throw new Error('position must be a number');
    out.position = p;
  }
  return out;
}

function columnName(raw) {
  const n = String(raw ?? '').trim();
  if (!n) throw new Error('column name is required');
  if (n.length > MAX_COLUMN) throw new Error(`column name longer than ${MAX_COLUMN} characters`);
  return n;
}

async function board(db) {
  const [columns, cards] = await db.batch([
    db.prepare('SELECT id, name, position FROM columns ORDER BY position'),
    db.prepare('SELECT * FROM cards ORDER BY column_id, position'),
  ]);
  return { columns: columns.results, cards: cards.results };
}

export async function onRequest({ request, env, params }) {
  const db = env.DB;
  if (!db) return bad('database not configured', 500);
  const path = params.path || [];
  const method = request.method;

  try {
    if (path[0] === 'board' && path.length === 1 && method === 'GET') {
      return Response.json(await board(db));
    }

    if (path[0] === 'export' && path.length === 1 && method === 'GET') {
      const data = await board(db);
      const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '');
      return new Response(JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="collinslab-board-${stamp}.json"`,
        },
      });
    }

    if (path[0] === 'cards' && path.length === 1 && method === 'POST') {
      const c = clean(await body(request), { partial: false });
      if (c.position === undefined) {
        const row = await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM cards WHERE column_id = ?').bind(c.column_id).first();
        c.position = row.p;
      }
      const card = await db.prepare(
        `INSERT INTO cards (column_id, title, description, label, position)
         VALUES (?, ?, ?, ?, ?) RETURNING *`,
      ).bind(c.column_id, c.title, c.description ?? '', c.label ?? '', c.position).first();
      return Response.json(card, { status: 201 });
    }

    if (path[0] === 'cards' && path.length === 2) {
      const id = Number(path[1]);
      if (!Number.isInteger(id)) return bad('bad card id');

      if (method === 'PATCH') {
        const c = clean(await body(request), { partial: true });
        const keys = Object.keys(c);
        if (!keys.length) return bad('nothing to update');
        const card = await db.prepare(
          `UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now')
           WHERE id = ? RETURNING *`,
        ).bind(...keys.map((k) => c[k]), id).first();
        return card ? Response.json(card) : bad('card not found', 404);
      }

      if (method === 'DELETE') {
        const r = await db.prepare('DELETE FROM cards WHERE id = ?').bind(id).run();
        return r.meta.changes ? new Response(null, { status: 204 }) : bad('card not found', 404);
      }
    }

    if (path[0] === 'columns' && path.length === 1 && method === 'POST') {
      const name = columnName((await body(request)).name);
      const col = await db.prepare(
        `INSERT INTO columns (name, position)
         VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM columns)) RETURNING *`,
      ).bind(name).first();
      return Response.json(col, { status: 201 });
    }

    if (path[0] === 'columns' && path.length === 2) {
      const id = Number(path[1]);
      if (!Number.isInteger(id)) return bad('bad column id');

      if (method === 'PATCH') {
        const name = columnName((await body(request)).name);
        const col = await db.prepare('UPDATE columns SET name = ? WHERE id = ? RETURNING *').bind(name, id).first();
        return col ? Response.json(col) : bad('column not found', 404);
      }

      if (method === 'DELETE') {
        const { n } = await db.prepare('SELECT COUNT(*) AS n FROM cards WHERE column_id = ?').bind(id).first();
        if (n) return bad(`Move or delete its ${n} card${n === 1 ? '' : 's'} first.`, 409);
        const r = await db.prepare('DELETE FROM columns WHERE id = ?').bind(id).run();
        return r.meta.changes ? new Response(null, { status: 204 }) : bad('column not found', 404);
      }
    }

    return bad('not found', 404);
  } catch (e) {
    if (/FOREIGN KEY/i.test(e.message)) return bad('no such column');
    return bad(e.message);
  }
}

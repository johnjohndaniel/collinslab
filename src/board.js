// Kanban board: render columns/cards from /api/board, drag to move, click to edit.
const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const dialog = document.getElementById('editor');
const form = document.getElementById('editor-form');

let state = { columns: [], cards: [] };
let editing = null; // card being edited, or { column_id } for a new card

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};

function flash(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
  if (!isError) setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, 1500);
}

async function api(method, path, data) {
  const res = await fetch(path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  if (res.status === 401) { location.href = '/login/?next=/board/'; throw new Error('signed out'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function load() {
  state = await api('GET', '/api/board');
  render();
}

const cardsIn = (colId) => state.cards.filter((c) => c.column_id === colId).sort((a, b) => a.position - b.position);

function render() {
  boardEl.replaceChildren(...state.columns.map((col) => {
    const cards = cardsIn(col.id);
    const list = el('ol', { className: 'cards-list' }, ...cards.map(cardEl));
    list.dataset.column = col.id;
    list.addEventListener('dragover', onDragOver);
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) clearDropMarkers(); });
    list.addEventListener('drop', onDrop);

    const input = el('input', { placeholder: '+ Add a card', maxLength: 200, className: 'add-input', ariaLabel: `Add a card to ${col.name}` });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const title = input.value.trim();
      input.value = '';
      try {
        const card = await api('POST', '/api/cards', { column_id: col.id, title });
        state.cards.push(card);
        render();
        boardEl.querySelector(`[data-column="${col.id}"]`).parentElement.querySelector('.add-input').focus();
        flash('Saved');
      } catch (err) { flash(err.message, true); input.value = title; }
    });

    return el('section', { className: 'column' },
      el('header', {}, el('h3', { textContent: col.name }), el('span', { className: 'count', textContent: cards.length })),
      list, input);
  }));
}

function cardEl(card) {
  const li = el('li', { className: 'card-item', draggable: true, tabIndex: 0 },
    card.label ? el('span', { className: `label label-${card.label}`, textContent: card.label }) : null,
    el('div', { className: 'card-title', textContent: card.title }),
    card.description ? el('div', { className: 'card-desc', textContent: card.description }) : null);
  li.dataset.id = card.id;
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(card.id));
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  li.addEventListener('dragend', () => { li.classList.remove('dragging'); clearDropMarkers(); });
  li.addEventListener('click', () => openEditor(card));
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openEditor(card); });
  return li;
}

// Index in the target list where the dragged card would land.
function dropIndex(list, y) {
  const items = [...list.querySelectorAll('.card-item:not(.dragging)')];
  const i = items.findIndex((it) => { const r = it.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return i === -1 ? items.length : i;
}

function clearDropMarkers() { boardEl.querySelectorAll('.drop-marker').forEach((m) => m.remove()); }

function onDragOver(e) {
  e.preventDefault();
  const list = e.currentTarget;
  const items = [...list.querySelectorAll('.card-item:not(.dragging)')];
  const i = dropIndex(list, e.clientY);
  clearDropMarkers();
  const marker = el('li', { className: 'drop-marker' });
  if (i < items.length) list.insertBefore(marker, items[i]); else list.append(marker);
}

async function onDrop(e) {
  e.preventDefault();
  const list = e.currentTarget;
  const id = Number(e.dataTransfer.getData('text/plain'));
  const card = state.cards.find((c) => c.id === id);
  clearDropMarkers();
  if (!card) return;
  const columnId = Number(list.dataset.column);
  const others = cardsIn(columnId).filter((c) => c.id !== id);
  const i = dropIndex(list, e.clientY);
  const before = others[i - 1], after = others[i];
  const position = before && after ? (before.position + after.position) / 2
    : before ? before.position + 1 : after ? after.position - 1 : 1;
  if (card.column_id === columnId && card.position === position) return;

  const prev = { column_id: card.column_id, position: card.position };
  Object.assign(card, { column_id: columnId, position });
  render();
  try {
    Object.assign(card, await api('PATCH', `/api/cards/${id}`, { column_id: columnId, position }));
    flash('Saved');
  } catch (err) {
    Object.assign(card, prev); render(); flash(err.message, true);
  }
}

function openEditor(card) {
  editing = card;
  dialog.returnValue = '';
  form.column_id.replaceChildren(...state.columns.map((c) => el('option', { value: c.id, textContent: c.name })));
  form.title.value = card.title;
  form.description.value = card.description;
  form.label.value = card.label;
  form.column_id.value = card.column_id;
  document.getElementById('editor-meta').textContent =
    `Created ${card.created_at} UTC · updated ${card.updated_at} UTC`;
  dialog.showModal();
  form.title.focus();
}

dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'save' || !editing) return;
  const card = editing;
  const patch = {
    title: form.title.value.trim(),
    description: form.description.value,
    label: form.label.value,
    column_id: Number(form.column_id.value),
  };
  if (patch.column_id !== card.column_id) {
    const last = cardsIn(patch.column_id).at(-1);
    patch.position = last ? last.position + 1 : 1;
  }
  try {
    Object.assign(card, await api('PATCH', `/api/cards/${card.id}`, patch));
    render(); flash('Saved');
  } catch (err) { flash(err.message, true); }
});

document.getElementById('delete').addEventListener('click', async () => {
  const card = editing;
  if (!card || !confirm(`Delete "${card.title}"?`)) return;
  dialog.close('cancel');
  try {
    await api('DELETE', `/api/cards/${card.id}`);
    state.cards = state.cards.filter((c) => c.id !== card.id);
    render(); flash('Deleted');
  } catch (err) { flash(err.message, true); }
});

load().catch((err) => flash(err.message, true));

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

    const del = el('button', { className: 'col-delete', type: 'button', textContent: '×', title: `Delete column "${col.name}"`, ariaLabel: `Delete column ${col.name}` });
    del.addEventListener('click', () => deleteColumn(col));

    return el('section', { className: 'column' },
      el('header', {}, columnTitle(col), el('span', { className: 'count', textContent: cards.length }), del),
      list, input);
  }), addColumnSlot());
}

// Click a column title to rename it; Enter saves, Escape cancels.
function columnTitle(col) {
  const h = el('h3', { textContent: col.name, title: 'Click to rename', tabIndex: 0 });
  const edit = () => {
    const input = el('input', { value: col.name, maxLength: 60, className: 'col-rename', ariaLabel: 'Column name' });
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!save || !name || name === col.name) { render(); return; }
      try {
        Object.assign(col, await api('PATCH', `/api/columns/${col.id}`, { name }));
        flash('Saved');
      } catch (err) { flash(err.message, true); }
      render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    h.replaceWith(input);
    input.focus(); input.select();
  };
  h.addEventListener('click', edit);
  h.addEventListener('keydown', (e) => { if (e.key === 'Enter') edit(); });
  return h;
}

async function deleteColumn(col) {
  if (cardsIn(col.id).length) { flash(`Move or delete the cards in "${col.name}" first.`, true); return; }
  if (!confirm(`Delete the empty column "${col.name}"?`)) return;
  try {
    await api('DELETE', `/api/columns/${col.id}`);
    state.columns = state.columns.filter((c) => c.id !== col.id);
    render(); flash('Deleted');
  } catch (err) { flash(err.message, true); }
}

// The "+ Add column" slot that always sits to the right of the last column.
function addColumnSlot() {
  const input = el('input', { placeholder: '+ Add column', maxLength: 60, className: 'add-input add-column-input', ariaLabel: 'New column name' });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const name = input.value.trim();
    input.value = '';
    try {
      state.columns.push(await api('POST', '/api/columns', { name }));
      render();
      boardEl.querySelector('.add-column-input').focus();
      boardEl.scrollTo({ left: boardEl.scrollWidth, behavior: 'smooth' });
      flash('Saved');
    } catch (err) { flash(err.message, true); input.value = name; }
  });
  return el('section', { className: 'column add-column' }, input);
}

// ---- Horizontal scrolling -------------------------------------------------
// A vertical wheel over the board scrolls sideways, unless the pointer is over
// a column that can itself still scroll vertically in that direction.
boardEl.addEventListener('wheel', (e) => {
  if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // pinch-zoom / trackpad sideways
  const list = e.target.closest?.('.cards-list');
  if (list) {
    const canScroll = e.deltaY > 0 ? list.scrollTop + list.clientHeight < list.scrollHeight - 1 : list.scrollTop > 0;
    if (canScroll) return;
  }
  if (boardEl.scrollWidth <= boardEl.clientWidth) return;
  e.preventDefault();
  boardEl.scrollLeft += e.deltaY;
}, { passive: false });

// Drag the empty background to pan.
let pan = null;
boardEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.card-item, input, button, h3, .col-rename')) return;
  pan = { x: e.clientX, left: boardEl.scrollLeft, id: e.pointerId };
});
window.addEventListener('pointermove', (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  if (Math.abs(e.clientX - pan.x) > 3) boardEl.classList.add('panning');
  boardEl.scrollLeft = pan.left - (e.clientX - pan.x);
});
window.addEventListener('pointerup', () => { pan = null; boardEl.classList.remove('panning'); });

// While dragging a card near the left/right edge, scroll the board along.
let edgeScroll = 0;
boardEl.addEventListener('dragover', (e) => {
  const r = boardEl.getBoundingClientRect(), zone = 80;
  edgeScroll = e.clientX < r.left + zone ? -1 : e.clientX > r.right - zone ? 1 : 0;
});
document.addEventListener('dragend', () => { edgeScroll = 0; });
(function tick() {
  if (edgeScroll) boardEl.scrollLeft += edgeScroll * 14;
  requestAnimationFrame(tick);
})();

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

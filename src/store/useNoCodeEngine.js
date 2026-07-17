/**
 * useNoCodeEngine — the editor's single source of truth.
 * Owns the blueprint AST, selection, mode, undo history and every
 * persistence/deploy action. All structural mutations go through commit()
 * so they are undoable; property edits mutate reactively in place.
 *
 * GRID LAYOUT MODEL: each component carries explicit { row, col, colSpan }.
 * Callers never juggle row-shifting themselves — every placement helper below
 * funnels through reflowPage(), which derives final row/col purely from
 * (a) each component's *current* row value (which may be transiently
 * fractional, e.g. 1.5, to mean "a new row between 1 and 2") and (b) their
 * position in the page.components array (which decides left-to-right order
 * *within* a row). This is the single source of truth for placement — drag,
 * keyboard nudge, duplicate and paste all resolve to the same few primitives,
 * so there is exactly one code path to get right instead of one per gesture.
 */
import { reactive, computed } from 'vue';
import { Blueprint, Expression } from '../engine.js';
import { api, packBlueprint, isGasHost } from '../rpc/adapter.js';
import { REGISTRY } from '../ui/registry.js';
import { employeeDashboardTemplate } from '../templates/employee-dashboard.js';

const UNDO_LIMIT = 50;
const LAST_APP_KEY = 'ncgas.editor.lastAppId';

const state = reactive({
  blueprint: null,
  currentPageId: null,
  selectedId: null,          // selected component id (null => page/app inspector)
  mode: 'design',            // 'design' | 'preview'
  previewRoles: ['Admin'],   // simulated roles in preview
  identity: { email: '…', roles: [] },
  isGasHost,
  apps: [],
  dirty: false,
  busy: null,                // 'loading' | 'saving' | 'deploying' | null
  toast: null,               // { type, message }
  validation: null,          // { ok, errors } from last validate
  deployResult: null,
  undoStack: [],
  redoStack: [],
  clipboard: null,           // last copied component (Ctrl+C / Ctrl+V)
  previewNonce: 0            // bump to rebuild the preview runtime store
});

// ------------------------------------------------------------------ helpers --

function toast(type, message) {
  state.toast = { type, message: String(message) };
  if (type !== 'error') setTimeout(() => { if (state.toast?.message === String(message)) state.toast = null; }, 3500);
}

function snapshot() {
  state.undoStack.push(JSON.stringify(state.blueprint));
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}

/** Structural mutation wrapper: undoable + marks dirty. */
function commit(fn) {
  snapshot();
  fn();
  state.dirty = true;
  state.previewNonce++;
}

function currentPage() {
  return state.blueprint?.pages?.[state.currentPageId] || null;
}

function findComponent(id) {
  for (const page of Object.values(state.blueprint?.pages || {})) {
    const idx = page.components.findIndex((c) => c.id === id);
    if (idx !== -1) return { page, idx, comp: page.components[idx] };
  }
  return null;
}

function allComponentIds() {
  const ids = new Set();
  for (const page of Object.values(state.blueprint?.pages || {})) {
    page.components.forEach((c) => ids.add(c.id));
  }
  return ids;
}

function uniqueComponentId(type) {
  const base = 'comp_' + type.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const ids = allComponentIds();
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(base + '_' + i)) i++;
  return base + '_' + i;
}

// ============================================================ grid layout ==

/**
 * Buckets page.components by their current (possibly fractional) row value,
 * sorts buckets numerically, then packs each bucket left-to-right in array
 * order — wrapping into a freshly-inserted row whenever colSpan overflows 12 —
 * and finally renumbers everything to clean contiguous integers starting at 1.
 */
function reflowPage(page) {
  const byRow = new Map();
  page.components.forEach((c) => {
    const r = c.layoutGrid?.row ?? 1;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(c);
  });
  const orderedKeys = [...byRow.keys()].sort((a, b) => a - b);
  let rowNum = 1;
  orderedKeys.forEach((key) => {
    let col = 1;
    let row = rowNum;
    byRow.get(key).forEach((comp) => {
      const span = Math.max(1, Math.min(12, comp.layoutGrid?.colSpan || 6));
      if (col + span - 1 > 12) { row += 1; col = 1; }
      comp.layoutGrid = { row, col, colSpan: span };
      col += span;
    });
    rowNum = row + 1;
  });
}

function pageMaxRow(page) {
  return page.components.reduce((m, c) => Math.max(m, c.layoutGrid?.row || 1), 0);
}

/** comp must already be OUT of page.components. Appends it to the end of `row`. */
function placeAtEndOfRow(page, comp, row) {
  comp.layoutGrid = { row, col: 1, colSpan: comp.layoutGrid?.colSpan || 6 };
  page.components.push(comp);
  reflowPage(page);
}

/** comp must already be OUT of page.components. Inserts a fresh row immediately before `beforeRow`. */
function placeInNewRowBefore(page, comp, beforeRow) {
  comp.layoutGrid = { row: beforeRow - 0.5, col: 1, colSpan: comp.layoutGrid?.colSpan || 6 };
  page.components.push(comp);
  reflowPage(page);
}

/** comp must already be OUT of page.components. Inserts a fresh row after the current last row. */
function placeInNewRowAtEnd(page, comp) {
  comp.layoutGrid = { row: pageMaxRow(page) + 0.5, col: 1, colSpan: comp.layoutGrid?.colSpan || 6 };
  page.components.push(comp);
  reflowPage(page);
}

/** Default placement for a brand-new component: packs into the current last row, wraps if full. */
function placeDefault(page, comp, colSpan) {
  comp.layoutGrid = { row: pageMaxRow(page) || 1, col: 1, colSpan };
  page.components.push(comp);
  reflowPage(page);
}

/** Dispatches a drop-target descriptor ({mode:'row'|'newRowBefore'|'newRowEnd', row}) to the right primitive. */
function placeAtTarget(page, comp, target) {
  if (!target) return placeDefault(page, comp, comp.layoutGrid?.colSpan || 6);
  if (target.mode === 'row') return placeAtEndOfRow(page, comp, target.row);
  if (target.mode === 'newRowBefore') return placeInNewRowBefore(page, comp, target.row);
  return placeInNewRowAtEnd(page, comp);
}

// ------------------------------------------------------------------ actions --

async function init() {
  state.busy = 'loading';
  try {
    state.identity = await api('getIdentity');
    state.apps = await api('listApps');
    const last = localStorage.getItem(LAST_APP_KEY);
    if (last && state.apps.some((a) => a.appId === last)) {
      await openApp(last);
    } else if (state.apps.length) {
      await openApp(state.apps[0].appId);
    } else {
      newAppFromTemplate();
      toast('info', 'Selamat datang! Template "Employee Dashboard" dimuat sebagai contoh.');
    }
  } catch (e) {
    toast('error', 'Init gagal: ' + e.message);
    if (!state.blueprint) newAppFromTemplate();
  } finally {
    state.busy = null;
  }
}

function loadBlueprintIntoEditor(bp) {
  state.blueprint = bp;
  state.currentPageId = bp.meta.globalSettings.homePage || Object.keys(bp.pages)[0];
  state.selectedId = null;
  state.undoStack = [];
  state.redoStack = [];
  state.dirty = false;
  state.validation = null;
  state.deployResult = null;
  state.previewNonce++;
}

function newAppFromTemplate() {
  loadBlueprintIntoEditor(employeeDashboardTemplate(state.identity.email));
  state.dirty = true;
}

function newBlankApp() {
  const id = 'ncgas_app_' + Math.random().toString(36).slice(2, 8);
  loadBlueprintIntoEditor(Blueprint.createEmptyBlueprint(id, 'Untitled App'));
  state.dirty = true;
}

async function openApp(appId) {
  state.busy = 'loading';
  try {
    const bp = await api('loadApp', { appId });
    Blueprint.assertValid(bp);
    loadBlueprintIntoEditor(bp);
    localStorage.setItem(LAST_APP_KEY, appId);
  } catch (e) {
    toast('error', `Gagal membuka ${appId}: ${e.message}`);
  } finally {
    state.busy = null;
  }
}

async function save() {
  if (!state.blueprint) return;
  const check = validate();
  if (!check.ok) {
    toast('error', `Blueprint invalid (${check.errors.length} error) — lihat panel validasi.`);
    return;
  }
  state.busy = 'saving';
  try {
    state.blueprint.meta.lastModified = new Date().toISOString();
    const packed = await packBlueprint(state.blueprint);
    await api('saveApp', { blueprint: state.blueprint, packed });
    state.dirty = false;
    state.apps = await api('listApps');
    localStorage.setItem(LAST_APP_KEY, state.blueprint.appId);
    toast('success', 'Tersimpan ke Drive (sharded).');
  } catch (e) {
    toast('error', 'Save gagal: ' + e.message);
  } finally {
    state.busy = null;
  }
}

function validate() {
  state.validation = Blueprint.validateBlueprint(state.blueprint, { expression: Expression });
  return state.validation;
}

async function deploy() {
  const check = validate();
  if (!check.ok) {
    toast('error', 'Perbaiki error validasi sebelum deploy.');
    return;
  }
  await save();
  if (state.dirty) return; // save failed
  state.busy = 'deploying';
  state.deployResult = null;
  try {
    state.deployResult = await api('compileAndDeploy', { appId: state.blueprint.appId });
    state.blueprint.deploy = { ...state.blueprint.deploy, ...state.deployResult };
    toast('success', 'Deploy selesai.');
  } catch (e) {
    toast('error', 'Deploy gagal: ' + e.message);
  } finally {
    state.busy = null;
  }
}

// ------------------------------------------------------------ page actions --
// NCGAS -> ALL PAGES -> Page: pages are a keyed object, but key insertion
// order is the display order (guaranteed by spec for string keys) — reorder
// rebuilds the object in the new order rather than sorting anything at read time.

function addPage(title) {
  commit(() => {
    const page = Blueprint.createEmptyPage(title || 'Halaman Baru');
    const id = Blueprint.uid('pg');
    state.blueprint.pages[id] = page;
    state.currentPageId = id;
    state.selectedId = null;
  });
}

function removePage(pageId) {
  const ids = Object.keys(state.blueprint.pages);
  if (ids.length <= 1) { toast('error', 'Aplikasi minimal punya satu halaman.'); return; }
  commit(() => {
    delete state.blueprint.pages[pageId];
    if (state.blueprint.meta.globalSettings.homePage === pageId) {
      state.blueprint.meta.globalSettings.homePage = Object.keys(state.blueprint.pages)[0];
    }
    if (state.currentPageId === pageId) {
      state.currentPageId = Object.keys(state.blueprint.pages)[0];
      state.selectedId = null;
    }
  });
}

function duplicatePage(pageId) {
  const src = state.blueprint.pages[pageId];
  if (!src) return;
  commit(() => {
    const clone = JSON.parse(JSON.stringify(src));
    clone.settings.title = clone.settings.title + ' (copy)';
    let route = clone.settings.route + '-copy';
    let n = 2;
    while (Object.values(state.blueprint.pages).some((p) => p.settings.route === route)) {
      route = clone.settings.route + '-copy' + (n++);
    }
    clone.settings.route = route;
    const newPageId = Blueprint.uid('pg');
    state.blueprint.pages[newPageId] = clone; // attach first so uniqueComponentId sees live siblings
    clone.components.forEach((c) => { c.id = uniqueComponentId(c.type); });
    state.currentPageId = newPageId;
    state.selectedId = null;
  });
  toast('info', 'Halaman diduplikasi. Referensi expression ke komponen asal TIDAK di-remap otomatis.');
}

function renamePage(pageId, title) {
  const page = state.blueprint.pages[pageId];
  if (!page || !title.trim()) return;
  page.settings.title = title.trim();
  state.dirty = true;
}

/** dir: -1 (move up/left in the page list) or +1 (move down/right). */
function reorderPage(pageId, dir) {
  const ids = Object.keys(state.blueprint.pages);
  const i = ids.indexOf(pageId);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  commit(() => {
    const rebuilt = {};
    ids.forEach((id) => { rebuilt[id] = state.blueprint.pages[id]; });
    state.blueprint.pages = rebuilt;
  });
}

function selectPage(pageId) {
  state.currentPageId = pageId;
  state.selectedId = null;
}

// -------------------------------------------------------------- menu actions --
// bp.menu is an ordered tree, one level deep (groups hold page/link/divider
// children, groups cannot nest). Structural ops (add/remove/reorder/move) go
// through commit(); label/icon/pageId/url/allowedRoles edits mutate directly
// from MenuManager.vue, same convention as page settings elsewhere.

function ensureMenu() {
  if (!Array.isArray(state.blueprint.menu)) state.blueprint.menu = [];
  return state.blueprint.menu;
}

/** { list, idx } for the item's containing array — top-level menu or a specific group's children. */
function findMenuContainer(id) {
  const menu = ensureMenu();
  let idx = menu.findIndex((m) => m.id === id);
  if (idx !== -1) return { list: menu, idx };
  for (const item of menu) {
    if (item.type === 'group' && Array.isArray(item.children)) {
      idx = item.children.findIndex((c) => c.id === id);
      if (idx !== -1) return { list: item.children, idx };
    }
  }
  return null;
}

function addMenuItem(type, opts = {}) {
  commit(() => {
    const menu = ensureMenu();
    const item = { id: Blueprint.uid('mi'), type, allowedRoles: [], ...opts };
    if (type === 'group' && !item.children) item.children = [];
    if (!item.label && type !== 'divider') item.label = type === 'page' ? 'Halaman' : type === 'link' ? 'Tautan' : 'Grup';
    menu.push(item);
  });
}

function addMenuChildItem(groupId, type, opts = {}) {
  commit(() => {
    const group = ensureMenu().find((m) => m.id === groupId);
    if (!group) return;
    if (!Array.isArray(group.children)) group.children = [];
    const item = { id: Blueprint.uid('mi'), type, allowedRoles: [], ...opts };
    if (!item.label && type !== 'divider') item.label = type === 'page' ? 'Halaman' : 'Tautan';
    group.children.push(item);
  });
}

function removeMenuItem(id) {
  const found = findMenuContainer(id);
  if (!found) return;
  commit(() => { found.list.splice(found.idx, 1); });
}

function reorderMenuItem(id, dir) {
  const found = findMenuContainer(id);
  if (!found) return;
  const to = found.idx + dir;
  if (to < 0 || to >= found.list.length) return;
  commit(() => {
    const [item] = found.list.splice(found.idx, 1);
    found.list.splice(to, 0, item);
  });
}

// ------------------------------------------------------- component actions --

/** target: null (default flow-append) | {mode:'row'|'newRowBefore'|'newRowEnd', row} */
function addComponent(type, target = null) {
  const def = REGISTRY[type];
  if (!def) { toast('error', `Tipe komponen tidak dikenal: ${type}`); return; }
  const page = currentPage();
  if (!page) return;
  commit(() => {
    const comp = {
      id: uniqueComponentId(type),
      type,
      layoutGrid: { row: 1, col: 1, colSpan: def.defaultColSpan || 6 },
      properties: JSON.parse(JSON.stringify(def.defaults.properties)),
      services: {},
      rules: {}
    };
    placeAtTarget(page, comp, target);
    state.selectedId = comp.id;
  });
}

function removeComponent(id) {
  const found = findComponent(id);
  if (!found) return;
  commit(() => {
    found.page.components.splice(found.idx, 1);
    reflowPage(found.page); // compacts row numbers if one just emptied out
    if (state.selectedId === id) state.selectedId = null;
  });
}

function duplicateComponent(id) {
  const found = findComponent(id);
  if (!found) return;
  commit(() => {
    const clone = JSON.parse(JSON.stringify(found.comp));
    clone.id = uniqueComponentId(found.comp.type);
    const idx = found.page.components.indexOf(found.comp);
    found.page.components.splice(idx + 1, 0, clone); // lands right after original within the same row
    reflowPage(found.page);
    state.selectedId = clone.id;
  });
}

/** target: {mode:'row'|'newRowBefore'|'newRowEnd', row} — used by canvas drag-and-drop. */
function moveComponentToTarget(id, target) {
  const found = findComponent(id);
  if (!found) return;
  commit(() => {
    const { page, comp } = found;
    const idx = page.components.indexOf(comp);
    page.components.splice(idx, 1);
    placeAtTarget(page, comp, target);
    state.selectedId = comp.id;
  });
}

/** dir -1 = merge into the end of the previous row, +1 = merge into the end of the next row (or a fresh one). */
function nudgeRow(id, dir) {
  const found = findComponent(id);
  if (!found) return;
  const { page, comp } = found;
  const row = comp.layoutGrid.row;
  if (dir < 0 && row <= 1) return; // already topmost
  commit(() => {
    const idx = page.components.indexOf(comp);
    page.components.splice(idx, 1);
    if (dir < 0) {
      placeAtEndOfRow(page, comp, row - 1);
    } else {
      const last = pageMaxRow(page);
      if (row > last) placeInNewRowAtEnd(page, comp); // was alone in the last row -> stays put
      else placeAtEndOfRow(page, comp, row + 1);
    }
    state.selectedId = comp.id;
  });
}

/** dir -1 = swap with the previous same-row sibling, +1 = swap with the next one. */
function nudgeCol(id, dir) {
  const found = findComponent(id);
  if (!found) return;
  const { page, comp } = found;
  const rowMates = page.components.filter((c) => c.layoutGrid.row === comp.layoutGrid.row);
  const pos = rowMates.indexOf(comp);
  const swapWith = rowMates[pos + dir];
  if (!swapWith) return; // already at that edge of the row
  commit(() => {
    const i1 = page.components.indexOf(comp);
    const i2 = page.components.indexOf(swapWith);
    [page.components[i1], page.components[i2]] = [page.components[i2], page.components[i1]];
    reflowPage(page);
  });
}

function setColSpan(id, colSpan) {
  const found = findComponent(id);
  if (!found) return;
  const span = Math.max(1, Math.min(12, Math.round(Number(colSpan)) || 1));
  commit(() => {
    found.comp.layoutGrid.colSpan = span;
    reflowPage(found.page);
  });
}

function renameComponent(id, nextId) {
  if (!/^comp_[a-z0-9_]+$/.test(nextId)) { toast('error', 'ID harus berpola comp_[a-z0-9_]+'); return false; }
  if (nextId !== id && allComponentIds().has(nextId)) { toast('error', `ID ${nextId} sudah dipakai.`); return false; }
  const found = findComponent(id);
  if (!found) return false;
  commit(() => {
    found.comp.id = nextId;
    if (state.selectedId === id) state.selectedId = nextId;
  });
  toast('info', `Referensi expression ke ${id} TIDAK di-rename otomatis — periksa rules/services.`);
  return true;
}

// ------------------------------------------------------------ copy / paste --

function copyComponent(id) {
  const found = findComponent(id ?? state.selectedId);
  if (!found) { toast('error', 'Pilih komponen dulu untuk disalin.'); return; }
  state.clipboard = JSON.parse(JSON.stringify(found.comp));
  toast('info', `${found.comp.id} disalin (Ctrl+V untuk tempel).`);
}

function pasteComponent() {
  if (!state.clipboard) { toast('error', 'Clipboard kosong — salin komponen dulu (Ctrl+C).'); return; }
  const page = currentPage();
  if (!page) return;
  commit(() => {
    const clone = JSON.parse(JSON.stringify(state.clipboard));
    clone.id = uniqueComponentId(clone.type);
    placeDefault(page, clone, clone.layoutGrid?.colSpan || 6);
    state.selectedId = clone.id;
  });
  toast('success', `${state.clipboard.type} ditempel di akhir halaman.`);
}

// -------------------------------------------------------------- undo / redo --

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify(state.blueprint));
  const prev = JSON.parse(state.undoStack.pop());
  state.blueprint = prev;
  if (!prev.pages[state.currentPageId]) state.currentPageId = Object.keys(prev.pages)[0];
  if (state.selectedId && !findComponent(state.selectedId)) state.selectedId = null;
  state.dirty = true;
  state.previewNonce++;
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify(state.blueprint));
  const next = JSON.parse(state.redoStack.pop());
  state.blueprint = next;
  if (!next.pages[state.currentPageId]) state.currentPageId = Object.keys(next.pages)[0];
  if (state.selectedId && !findComponent(state.selectedId)) state.selectedId = null;
  state.dirty = true;
  state.previewNonce++;
}

// ---------------------------------------------------------- import / export --

function exportJson() {
  const blob = new Blob([JSON.stringify(state.blueprint, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.blueprint.appId}.blueprint.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson(file) {
  try {
    const text = await file.text();
    const bp = JSON.parse(text);
    Blueprint.assertValid(bp);
    loadBlueprintIntoEditor(bp);
    state.dirty = true;
    toast('success', `Blueprint ${bp.appId} diimpor.`);
  } catch (e) {
    toast('error', 'Import gagal: ' + e.message);
  }
}

// ------------------------------------------------------------------- export --

const selectedComponent = computed(() => (state.selectedId ? findComponent(state.selectedId)?.comp || null : null));
const pageList = computed(() =>
  Object.entries(state.blueprint?.pages || {}).map(([id, p]) => ({
    id, title: p.settings.title, route: p.settings.route, count: p.components.length
  }))
);

export function useNoCodeEngine() {
  return {
    state,
    selectedComponent,
    pageList,
    init,
    toast,
    commit,
    newAppFromTemplate,
    newBlankApp,
    openApp,
    save,
    validate,
    deploy,
    addPage,
    removePage,
    duplicatePage,
    renamePage,
    reorderPage,
    selectPage,
    addMenuItem,
    addMenuChildItem,
    removeMenuItem,
    reorderMenuItem,
    addComponent,
    removeComponent,
    duplicateComponent,
    moveComponentToTarget,
    nudgeRow,
    nudgeCol,
    setColSpan,
    renameComponent,
    copyComponent,
    pasteComponent,
    undo,
    redo,
    exportJson,
    importJson
  };
}

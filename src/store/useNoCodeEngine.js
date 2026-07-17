/**
 * useNoCodeEngine — the editor's single source of truth.
 * Owns the blueprint AST, selection, mode, undo history and every
 * persistence/deploy action. All structural mutations go through commit()
 * so they are undoable; property edits mutate reactively in place.
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

function addPage() {
  commit(() => {
    const page = Blueprint.createEmptyPage('Page Baru');
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

function selectPage(pageId) {
  state.currentPageId = pageId;
  state.selectedId = null;
}

// ------------------------------------------------------- component actions --

function addComponent(type, index = null) {
  const def = REGISTRY[type];
  if (!def) { toast('error', `Tipe komponen tidak dikenal: ${type}`); return; }
  const page = currentPage();
  if (!page) return;
  commit(() => {
    const comp = {
      id: uniqueComponentId(type),
      type,
      layoutGrid: { ...def.defaults.layoutGrid },
      properties: JSON.parse(JSON.stringify(def.defaults.properties)),
      services: {},
      rules: {}
    };
    const at = index === null ? page.components.length : Math.max(0, Math.min(index, page.components.length));
    page.components.splice(at, 0, comp);
    state.selectedId = comp.id;
  });
}

function removeComponent(id) {
  const found = findComponent(id);
  if (!found) return;
  commit(() => {
    found.page.components.splice(found.idx, 1);
    if (state.selectedId === id) state.selectedId = null;
  });
}

function duplicateComponent(id) {
  const found = findComponent(id);
  if (!found) return;
  commit(() => {
    const clone = JSON.parse(JSON.stringify(found.comp));
    clone.id = uniqueComponentId(found.comp.type);
    found.page.components.splice(found.idx + 1, 0, clone);
    state.selectedId = clone.id;
  });
}

function moveComponent(id, delta) {
  const found = findComponent(id);
  if (!found) return;
  const to = found.idx + delta;
  if (to < 0 || to >= found.page.components.length) return;
  commit(() => {
    const [comp] = found.page.components.splice(found.idx, 1);
    found.page.components.splice(to, 0, comp);
  });
}

function moveComponentToIndex(id, index) {
  const found = findComponent(id);
  if (!found) return;
  commit(() => {
    const [comp] = found.page.components.splice(found.idx, 1);
    const at = Math.max(0, Math.min(index > found.idx ? index - 1 : index, found.page.components.length));
    found.page.components.splice(at, 0, comp);
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
  Object.entries(state.blueprint?.pages || {}).map(([id, p]) => ({ id, title: p.settings.title, route: p.settings.route }))
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
    selectPage,
    addComponent,
    removeComponent,
    duplicateComponent,
    moveComponent,
    moveComponentToIndex,
    renameComponent,
    undo,
    redo,
    exportJson,
    importJson
  };
}

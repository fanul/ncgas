<script setup>
/**
 * Design canvas. Renders the current page through the SAME runtime renderer
 * that compiled apps use (design hooks add selection/ghosting), so what you
 * see here is what deploys. Handles palette drops + reorder drops.
 */
import { computed, ref, shallowRef, watch, h } from 'vue';
import { Runtime } from '../engine.js';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const { state } = engine;
const dropIndex = ref(null); // insertion indicator position

/**
 * Design-mode runtime context. Built inside a watch callback — NOT a computed —
 * because Runtime.createStore both reads the blueprint deeply and writes into a
 * fresh reactive store; doing that inside a tracked computed makes every render
 * invalidate it again (infinite re-render). The watch re-runs only on explicit
 * triggers: structure edits (previewNonce), page switch, app switch.
 */
const designCtx = shallowRef(null);
watch(
  () => [state.previewNonce, state.currentPageId, state.blueprint],
  () => {
    const bp = state.blueprint;
    if (!bp) { designCtx.value = null; return; }
    const store = Runtime.createStore(bp, { email: state.identity.email || 'designer@local', roles: [...state.previewRoles] });
    store.currentPageId = state.currentPageId;
    designCtx.value = {
      blueprint: bp,
      store,
      rpc: async () => { throw new Error('no rpc in design mode'); },
      mode: 'design',
      design: {
        get selectedId() { return state.selectedId; },
        onSelect: (id) => { state.selectedId = id; }
      }
    };
  },
  { immediate: true }
);

const page = computed(() => state.blueprint?.pages?.[state.currentPageId]);

const PageVNodes = {
  setup() {
    return () => {
      const ctx = designCtx.value;
      const p = page.value;
      if (!ctx || !p) return h('div');
      const cols = p.layout?.config?.columns || 12;
      const comps = p.components || [];
      const children = comps.map((comp, i) =>
        h('div', {
          key: comp.id,
          class: 'ed-cellwrap' + (dropIndex.value === i ? ' is-drop-target' : ''),
          'data-cell-index': i,
          style: cellSpan(comp, cols)
        }, [Runtime.renderComponent(ctx, comp, cols)])
      );
      // trailing full-width strip = "drop at end" target indicator
      children.push(h('div', {
        class: 'ed-dropend' + (dropIndex.value === comps.length ? ' is-drop-target' : ''),
        key: 'drop-end'
      }));
      return h('div', {
        class: 'nc-page ed-grid',
        style: {
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          rowGap: '6px',
          columnGap: p.layout?.config?.colGap || '16px',
          maxWidth: p.layout?.config?.maxWidth || '1080px'
        }
      }, children);
    };
  }
};

function cellSpan(comp, cols) {
  const span = comp.layoutGrid?.md || comp.layoutGrid?.xs || cols;
  return { gridColumn: `span ${Math.min(span, cols)}` };
}

// ------------------------------------------------------------------- DnD ----

function computeDropIndex(e) {
  const cells = [...e.currentTarget.querySelectorAll('[data-cell-index]')];
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      return Number(cell.dataset.cellIndex);
    }
  }
  return page.value?.components.length ?? 0;
}

function onDragOver(e) {
  const types = e.dataTransfer.types;
  if (types.includes('ncgas/component-type') || types.includes('ncgas/move-id')) {
    e.preventDefault();
    dropIndex.value = computeDropIndex(e);
  }
}

function onDrop(e) {
  e.preventDefault();
  const at = dropIndex.value ?? page.value.components.length;
  dropIndex.value = null;
  const newType = e.dataTransfer.getData('ncgas/component-type');
  const moveId = e.dataTransfer.getData('ncgas/move-id');
  if (newType) engine.addComponent(newType, at);
  else if (moveId) engine.moveComponentToIndex(moveId, at);
}

// drag-to-reorder: initiated from the selected cell's tag via mousedown+drag
function onCellDragStart(e) {
  const cell = e.target.closest('[data-comp-id]');
  if (!cell) return;
  e.dataTransfer.setData('ncgas/move-id', cell.dataset.compId);
  e.dataTransfer.effectAllowed = 'move';
}
</script>

<template>
  <section
    class="ed-canvas"
    @click="state.selectedId = null"
    @dragover="onDragOver"
    @dragleave="dropIndex = null"
    @drop="onDrop"
    @dragstart="onCellDragStart"
  >
    <div class="ed-canvas-head">
      <span class="ed-canvas-route">{{ page?.settings.route }}</span>
      <span class="ed-canvas-note">mode desain — komponen dapat diklik & di-drag</span>
    </div>
    <div v-if="page && !page.components.length" class="ed-canvas-empty">
      Halaman kosong. Drag komponen dari panel kiri ke sini.
    </div>
    <component :is="PageVNodes" />
  </section>
</template>

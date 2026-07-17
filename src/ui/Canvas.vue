<script setup>
/**
 * Design canvas — explicit row/col grid editor.
 *
 * Rendering flows through Runtime.renderComponent (same fn compiled apps use)
 * wrapped in a tiny functional component, so canvas === production output;
 * everything else here (row bands, drop zones, per-cell toolbar) is editor
 * chrome layered around it.
 *
 * Drag-and-drop uses per-zone handlers bound fresh on every render (via v-for
 * over the current `rows` computed) instead of one canvas-wide handler doing
 * stale bounding-rect math — that was the root cause of "drag only works
 * once": index math computed against DOM nodes that had already changed by
 * the time the next dragover fired. Each zone here always knows its own
 * target from the current render pass, and dropTarget is unconditionally
 * cleared in a finally block plus on dragend/dragleave-from-canvas, so no
 * gesture can leave stale state behind for the next one.
 */
import { computed, ref, shallowRef, watch, h } from 'vue';
import { Runtime } from '../engine.js';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const { state } = engine;

/** Functional wrapper: embeds Runtime.renderComponent's vnode inside the template tree. */
function RuntimeCell(props) {
  return Runtime.renderComponent(props.ctx, props.comp);
}
RuntimeCell.props = ['ctx', 'comp'];

/**
 * Design-mode runtime context, rebuilt in a watch (NOT a computed) — see
 * Preview.vue for why: Runtime.createStore writes into fresh reactive state,
 * which would make a tracked computed invalidate itself every render.
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
const rows = computed(() => (page.value ? Runtime.groupByRow(page.value.components) : []));

function cellStyle(comp) {
  const { col, colSpan } = comp.layoutGrid;
  return { gridColumn: `${col} / span ${colSpan}` };
}

// ------------------------------------------------------------------- DnD ----

const dropTarget = ref(null); // { mode: 'row'|'newRowBefore'|'newRowEnd', row? }

function sameTarget(a, b) {
  if (!a || !b) return a === b;
  return a.mode === b.mode && a.row === b.row;
}
function isActive(target) {
  return sameTarget(dropTarget.value, target);
}
function onZoneDragOver(target) {
  dropTarget.value = target;
}
function onCanvasDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) dropTarget.value = null;
}
function onDragEnd() {
  dropTarget.value = null;
}

function onZoneDrop(target, e) {
  try {
    const newType = e.dataTransfer.getData('ncgas/component-type');
    const moveId = e.dataTransfer.getData('ncgas/move-id');
    if (newType) engine.addComponent(newType, target);
    else if (moveId) engine.moveComponentToTarget(moveId, target);
  } finally {
    dropTarget.value = null;
  }
}

function onCellDragStart(e, compId) {
  e.dataTransfer.setData('ncgas/move-id', compId);
  e.dataTransfer.effectAllowed = 'move';
}
</script>

<template>
  <section class="ed-canvas" @click="state.selectedId = null" @dragleave="onCanvasDragLeave" @dragend="onDragEnd">
    <div class="ed-canvas-head">
      <span class="ed-canvas-route">{{ page?.settings.route }}</span>
      <span class="ed-canvas-note">mode desain — drag, atau pakai tombol ⠿ ⧉ × dan panah ▲▼◀▶</span>
    </div>

    <div v-if="page && !page.components.length" class="ed-canvas-empty">
      Halaman kosong. Drag komponen dari panel kiri ke sini, atau klik salah satu di palet.
    </div>

    <div v-if="page" class="ed-rows">
      <template v-for="rowGroup in rows" :key="'row-' + rowGroup.row">
        <div
          class="ed-rowgap"
          :class="{ 'is-drop-target': isActive({ mode: 'newRowBefore', row: rowGroup.row }) }"
          @dragover.prevent="onZoneDragOver({ mode: 'newRowBefore', row: rowGroup.row })"
          @drop.prevent="onZoneDrop({ mode: 'newRowBefore', row: rowGroup.row }, $event)"
        ><span class="ed-rowgap-hint">baris baru di sini</span></div>

        <div
          class="ed-rowband"
          :class="{ 'is-drop-target': isActive({ mode: 'row', row: rowGroup.row }) }"
          @dragover.prevent="onZoneDragOver({ mode: 'row', row: rowGroup.row })"
          @drop.prevent="onZoneDrop({ mode: 'row', row: rowGroup.row }, $event)"
        >
          <div class="ed-rowlabel">Baris {{ rowGroup.row }}</div>
          <div class="ed-rowgrid">
            <div
              v-for="comp in rowGroup.items" :key="comp.id"
              class="ed-cellwrap"
              :class="{ 'is-selected': state.selectedId === comp.id }"
              :style="cellStyle(comp)"
              @click.stop="state.selectedId = comp.id"
            >
              <div class="ed-celltoolbar">
                <button class="ed-celltool" draggable="true" title="geser (drag)"
                        @click.stop @dragstart="onCellDragStart($event, comp.id)">⠿</button>
                <button class="ed-celltool" title="geser kiri" @click.stop="engine.nudgeCol(comp.id, -1)">◀</button>
                <button class="ed-celltool" title="pindah ke baris atas" @click.stop="engine.nudgeRow(comp.id, -1)">▲</button>
                <button class="ed-celltool" title="pindah ke baris bawah" @click.stop="engine.nudgeRow(comp.id, 1)">▼</button>
                <button class="ed-celltool" title="geser kanan" @click.stop="engine.nudgeCol(comp.id, 1)">▶</button>
                <button class="ed-celltool" title="duplikat" @click.stop="engine.duplicateComponent(comp.id)">⧉</button>
                <button class="ed-celltool is-danger" title="hapus" @click.stop="engine.removeComponent(comp.id)">×</button>
              </div>
              <RuntimeCell v-if="designCtx" :ctx="designCtx" :comp="comp" />
            </div>
          </div>
        </div>
      </template>

      <div
        class="ed-rowgap ed-rowgap-end"
        :class="{ 'is-drop-target': isActive({ mode: 'newRowEnd' }) }"
        @dragover.prevent="onZoneDragOver({ mode: 'newRowEnd' })"
        @drop.prevent="onZoneDrop({ mode: 'newRowEnd' }, $event)"
      ><span class="ed-rowgap-hint">+ tambah baris di akhir (drop di sini)</span></div>
    </div>
  </section>
</template>

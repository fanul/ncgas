<script setup>
/**
 * Flow View, app level: every page is a node; edges are auto-derived
 * NAVIGATE bindings (button/etc events whose service action is 'NAVIGATE').
 * Double-click a node to drill into that page's component/service graph.
 * Dragging repositions a node; position is cosmetic (stored on page._flow).
 */
import { computed, ref } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import { deriveAppGraph, NODE_W } from './flowGraph.js';

const engine = useNoCodeEngine();
const { state } = engine;

const graph = computed(() => deriveAppGraph(state.blueprint));
const surfaceEl = ref(null);

const SURFACE_W = 2600;
const SURFACE_H = 1400;
const HEADER_H = 40;

function nodeById(id) {
  return graph.value.nodes.find((n) => n.id === id);
}

function edgePath(edge) {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  if (!from || !to) return '';
  const leftToRight = to.pos.x >= from.pos.x;
  const x1 = leftToRight ? from.pos.x + NODE_W : from.pos.x;
  const y1 = from.pos.y + HEADER_H / 2;
  const x2 = leftToRight ? to.pos.x : to.pos.x + NODE_W;
  const y2 = to.pos.y + HEADER_H / 2;
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + (leftToRight ? dx : -dx)} ${y1}, ${x2 - (leftToRight ? dx : -dx)} ${y2}, ${x2} ${y2}`;
}

// -------------------------------------------------------------- node drag --
const dragging = ref(null); // { id, offsetX, offsetY }

function localPoint(e) {
  const rect = surfaceEl.value.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startDrag(e, node) {
  if (e.button !== 0) return;
  const p = localPoint(e);
  dragging.value = { id: node.id, offsetX: p.x - node.pos.x, offsetY: p.y - node.pos.y, moved: false };
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag);
}

function onDrag(e) {
  if (!dragging.value) return;
  const p = localPoint(e);
  const node = nodeById(dragging.value.id);
  if (!node) return;
  dragging.value.moved = true;
  node.pos = { x: Math.max(0, p.x - dragging.value.offsetX), y: Math.max(0, p.y - dragging.value.offsetY) };
}

function endDrag() {
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', endDrag);
  if (dragging.value) {
    const node = nodeById(dragging.value.id);
    if (node && dragging.value.moved) engine.setPageFlowPos(node.id, node.pos);
  }
  dragging.value = null;
}

function openPage(node) {
  engine.enterPageFlow(node.id);
}
</script>

<template>
  <div class="flow-canvas">
    <div ref="surfaceEl" class="flow-surface" :style="{ width: SURFACE_W + 'px', height: SURFACE_H + 'px' }">
      <svg class="flow-edges" :width="SURFACE_W" :height="SURFACE_H">
        <path v-for="e in graph.edges" :key="e.id" :d="edgePath(e)" class="flow-edge is-navigate" marker-end="url(#flow-arrow)" />
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" class="flow-arrowhead" />
          </marker>
        </defs>
      </svg>

      <div
        v-for="node in graph.nodes" :key="node.id"
        class="flow-node flow-node-page" :class="{ 'is-current': node.id === state.currentPageId }"
        :style="{ left: node.pos.x + 'px', top: node.pos.y + 'px', width: NODE_W + 'px' }"
        @mousedown="startDrag($event, node)"
        @dblclick="openPage(node)"
      >
        <div class="flow-node-head">
          <span class="flow-node-icon">▤</span>
          <span class="flow-node-title">{{ node.title }}</span>
          <span v-if="node.isHome" class="flow-badge" title="Halaman utama">🏠</span>
        </div>
        <div class="flow-node-sub">{{ node.route }} · {{ node.componentCount }} komponen</div>
      </div>

      <div v-if="!graph.nodes.length" class="flow-empty">Belum ada halaman.</div>
    </div>
    <div class="flow-hint">Klik ganda halaman untuk membuka node komponen/service-nya. Seret untuk mengatur posisi.</div>
  </div>
</template>

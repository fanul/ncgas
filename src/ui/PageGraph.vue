<script setup>
/**
 * Flow View, page level (the "true KNIME style" surface): components and
 * services are nodes; the user DRAGS a wire between ports to create a
 * binding instead of picking from an Inspector dropdown. Two port kinds are
 * wireable: an event output -> a service's input (writes
 * comp.services[event] = {action: serviceId}), and a value output -> a
 * FORM_SELECT's dependsOn input (writes comp.properties.dependsOn).
 * Every other relationship (master-detail, rollup, upload/pdf service) is
 * still auto-derived and drawn as an edge, just not yet drag-creatable —
 * edit those via the node's inline config body instead.
 *
 * Node configuration is INLINE (expand a node to show its property fields
 * right on the canvas) rather than a side panel — CRUD_TABLE reuses the
 * existing CrudWizard.vue verbatim since it's already a self-contained
 * :comp-driven component.
 */
import { computed, reactive, ref } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import { REGISTRY } from './registry.js';
import { FIELD_KINDS, FieldJson } from './fields.js';
import CrudWizard from './CrudWizard.vue';
import {
  derivePageGraph, portPoint, portsCompatible,
  NODE_W, HEADER_H, PORT_ROW_H
} from './flowGraph.js';

const engine = useNoCodeEngine();
const { state } = engine;

const bp = computed(() => state.blueprint);
const page = computed(() => state.blueprint.pages[state.currentPageId]);
const graph = computed(() => derivePageGraph(state.blueprint, state.currentPageId));
const surfaceEl = ref(null);

const SURFACE_W = 3000;
const SURFACE_H = 1800;

const expanded = reactive({});
function toggleExpand(id) { expanded[id] = !expanded[id]; }

function compById(id) {
  return page.value.components.find((c) => c.id === id);
}
function allNodesById() {
  const map = new Map();
  graph.value.componentNodes.forEach((n) => map.set(n.id, n));
  graph.value.serviceNodes.forEach((n) => map.set(n.id, n));
  return map;
}

// ------------------------------------------------------------------ edges --
function edgePath(edge) {
  const nodes = allNodesById();
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return '';
  let p1, p2;
  if (edge.fromPortId) {
    const idx = from.ports.outputs.findIndex((p) => p.id === edge.fromPortId);
    p1 = portPoint(from, 'out', Math.max(0, idx));
  } else {
    p1 = { x: from.pos.x + NODE_W, y: from.pos.y + HEADER_H / 2 };
  }
  if (edge.toPortId) {
    const idx = to.ports.inputs.findIndex((p) => p.id === edge.toPortId);
    p2 = portPoint(to, 'in', Math.max(0, idx));
  } else {
    p2 = { x: to.pos.x, y: to.pos.y + HEADER_H / 2 };
  }
  const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
  return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
}

function removeEdge(edge) {
  if (!edge.removable) { engine.toast('info', `Relasi "${edge.label}" diatur lewat konfigurasi node, bukan drag-wire.`); return; }
  if (edge.kind === 'event') engine.unwireEvent(edge.onRemove.compId, edge.onRemove.event);
  else if (edge.kind === 'dependsOn') engine.unwireDependsOn(edge.onRemove.compId);
}

// -------------------------------------------------------------- node drag --
const dragging = ref(null);

function localPoint(e) {
  const rect = surfaceEl.value.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startNodeDrag(e, node, isService) {
  e.stopPropagation(); // must not bubble to .flow-surface's mousedown-to-deselect handler
  if (e.button !== 0) return;
  if (!isService) state.selectedId = node.id;
  const p = localPoint(e);
  dragging.value = { id: node.id, isService, offsetX: p.x - node.pos.x, offsetY: p.y - node.pos.y, moved: false };
  window.addEventListener('mousemove', onNodeDrag);
  window.addEventListener('mouseup', endNodeDrag);
}
function onNodeDrag(e) {
  if (!dragging.value) return;
  const p = localPoint(e);
  const node = allNodesById().get(dragging.value.id);
  if (!node) return;
  dragging.value.moved = true;
  node.pos = { x: Math.max(0, p.x - dragging.value.offsetX), y: Math.max(0, p.y - dragging.value.offsetY) };
}
function endNodeDrag() {
  window.removeEventListener('mousemove', onNodeDrag);
  window.removeEventListener('mouseup', endNodeDrag);
  if (dragging.value && dragging.value.moved) {
    const node = allNodesById().get(dragging.value.id);
    if (node) {
      if (dragging.value.isService) engine.setServiceFlowPos(state.currentPageId, node.id, node.pos);
      else engine.setComponentFlowPos(node.id, node.pos);
    }
  }
  dragging.value = null;
}

// -------------------------------------------------------------- wire drag --
const connecting = ref(null); // { fromId, fromPortId, fromKind, event, x1, y1, x2, y2 }

function startWire(e, node, portKind, portId, event) {
  e.stopPropagation();
  const idx = node.ports.outputs.findIndex((p) => p.id === portId);
  const p1 = portPoint(node, 'out', Math.max(0, idx));
  connecting.value = { fromId: node.id, fromPortId: portId, fromKind: portKind, event, x1: p1.x, y1: p1.y, x2: p1.x, y2: p1.y };
  window.addEventListener('mousemove', onWireMove);
  window.addEventListener('mouseup', onWireEnd);
}
function onWireMove(e) {
  if (!connecting.value) return;
  const p = localPoint(e);
  connecting.value.x2 = p.x;
  connecting.value.y2 = p.y;
}
function onWireEnd(e) {
  window.removeEventListener('mousemove', onWireMove);
  window.removeEventListener('mouseup', onWireEnd);
  if (!connecting.value) return;
  const target = e.target.closest?.('[data-port-kind]');
  if (target) {
    const targetKind = target.dataset.portKind;
    const targetOwner = target.dataset.portOwner;
    if (portsCompatible(connecting.value.fromKind, targetKind)) {
      if (connecting.value.fromKind === 'event' && targetKind === 'service-in') {
        engine.wireEventToService(connecting.value.fromId, connecting.value.event, targetOwner);
      } else if (connecting.value.fromKind === 'value' && targetKind === 'dependsOn') {
        engine.wireDependsOn(targetOwner, connecting.value.fromId);
      }
    } else {
      engine.toast('error', 'Port tidak cocok — event hanya bisa ke service, value hanya bisa ke dependsOn.');
    }
  }
  connecting.value = null;
}

function wirePath() {
  const c = connecting.value;
  if (!c) return '';
  const dx = Math.max(40, Math.abs(c.x2 - c.x1) / 2);
  return `M ${c.x1} ${c.y1} C ${c.x1 + dx} ${c.y1}, ${c.x2 - dx} ${c.y2}, ${c.x2} ${c.y2}`;
}

// ------------------------------------------------------------ field edits --
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (target[keys[i]] == null || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
    target = target[keys[i]];
  }
  if (value === '' || value === undefined) delete target[keys[keys.length - 1]];
  else target[keys[keys.length - 1]] = value;
  state.dirty = true;
  state.previewNonce++;
}

function serviceFieldsModel(sid) {
  return bp.value.sharedServices[sid];
}
function setServiceFields(sid, value) {
  const svc = bp.value.sharedServices[sid];
  Object.keys(svc).forEach((k) => delete svc[k]);
  Object.assign(svc, value);
  state.dirty = true;
}
</script>

<template>
  <div class="flow-canvas">
    <div class="flow-breadcrumb">
      <button class="ed-btn ed-btn-ghost" @click="engine.exitPageFlow()">← Semua Halaman</button>
      <span class="flow-breadcrumb-sep">/</span>
      <span class="flow-breadcrumb-title">{{ page.settings.title }}</span>
    </div>

    <div ref="surfaceEl" class="flow-surface" :style="{ width: SURFACE_W + 'px', height: SURFACE_H + 'px' }" @mousedown="state.selectedId = null">
      <svg class="flow-edges" :width="SURFACE_W" :height="SURFACE_H">
        <defs>
          <marker id="flow-arrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" class="flow-arrowhead" />
          </marker>
        </defs>
        <g v-for="e in graph.edges" :key="e.id">
          <path :d="edgePath(e)" class="flow-edge" :class="'is-' + e.kind" marker-end="url(#flow-arrow2)" />
          <path :d="edgePath(e)" class="flow-edge-hit" :class="{ 'is-removable': e.removable }" @click.stop="removeEdge(e)">
            <title>{{ e.label }}{{ e.removable ? ' (klik untuk putus)' : '' }}</title>
          </path>
        </g>
        <path v-if="connecting" :d="wirePath()" class="flow-edge is-ghost" />
      </svg>

      <!-- component nodes -->
      <div
        v-for="node in graph.componentNodes" :key="node.id"
        class="flow-node flow-node-component" :class="{ 'is-selected': node.id === state.selectedId }"
        :style="{ left: node.pos.x + 'px', top: node.pos.y + 'px', width: NODE_W + 'px' }"
      >
        <div class="flow-node-head" @mousedown="startNodeDrag($event, node, false)">
          <span class="flow-node-icon">{{ node.icon }}</span>
          <span class="flow-node-title ed-mono">{{ node.id }}</span>
          <span class="flow-node-actions">
            <button class="flow-node-btn" title="konfigurasi" @click.stop="toggleExpand(node.id)">{{ expanded[node.id] ? '▾' : '⚙' }}</button>
            <button class="flow-node-btn" title="duplikat" @click.stop="engine.duplicateComponent(node.id)">⧉</button>
            <button class="flow-node-btn is-danger" title="hapus" @click.stop="engine.removeComponent(node.id)">✕</button>
          </span>
        </div>
        <div class="flow-node-type">{{ node.label }}</div>

        <div class="flow-portzone" :style="{ height: (node.ports.rows * PORT_ROW_H) + 'px' }">
          <div v-for="(row, i) in node.ports.rows" :key="i" class="flow-portrow">
            <div v-if="node.ports.inputs[i]" class="flow-port flow-port-in"
                 :data-port-kind="node.ports.inputs[i].kind" :data-port-owner="node.id">
              <span class="flow-port-dot"></span><span class="flow-port-label">{{ node.ports.inputs[i].kind }}</span>
            </div>
            <span v-else></span>
            <div v-if="node.ports.outputs[i]" class="flow-port flow-port-out"
                 @mousedown="startWire($event, node, node.ports.outputs[i].kind, node.ports.outputs[i].id, node.ports.outputs[i].event)">
              <span class="flow-port-label">{{ node.ports.outputs[i].event || node.ports.outputs[i].kind }}</span><span class="flow-port-dot"></span>
            </div>
          </div>
        </div>

        <div v-if="expanded[node.id]" class="flow-node-body" :class="{ 'is-wide': node.type === 'CRUD_TABLE' }" @mousedown.stop>
          <CrudWizard v-if="REGISTRY[node.type]?.custom === 'crud'" :comp="compById(node.id)" />
          <template v-else>
            <div v-for="field in (REGISTRY[node.type]?.fields || [])" :key="field.path" class="ed-field">
              <label class="ed-field-label">{{ field.label }}</label>
              <component
                :is="FIELD_KINDS[field.kind]"
                :model-value="getPath(compById(node.id), field.path)"
                :options="field.options"
                @update:model-value="setPath(compById(node.id), field.path, $event)"
              />
            </div>
            <div v-if="!(REGISTRY[node.type]?.fields || []).length" class="ed-hint">Tidak ada properti untuk tipe ini.</div>
          </template>
        </div>
      </div>

      <!-- service nodes -->
      <div
        v-for="node in graph.serviceNodes" :key="node.id"
        class="flow-node flow-node-service" :class="{ 'is-unused': !node.used }"
        :style="{ left: node.pos.x + 'px', top: node.pos.y + 'px', width: NODE_W + 'px' }"
      >
        <div class="flow-node-head" @mousedown="startNodeDrag($event, node, true)">
          <span class="flow-node-icon">⚙</span>
          <span class="flow-node-title ed-mono">{{ node.id }}</span>
          <span class="flow-node-actions">
            <button class="flow-node-btn" title="konfigurasi" @click.stop="toggleExpand(node.id)">{{ expanded[node.id] ? '▾' : '⚙' }}</button>
          </span>
        </div>
        <div class="flow-node-type">{{ node.type }}</div>
        <div class="flow-portzone" :style="{ height: PORT_ROW_H + 'px' }">
          <div class="flow-portrow">
            <div class="flow-port flow-port-in" data-port-kind="service-in" :data-port-owner="node.id">
              <span class="flow-port-dot"></span><span class="flow-port-label">in</span>
            </div>
            <span></span>
          </div>
        </div>
        <div v-if="expanded[node.id]" class="flow-node-body" @mousedown.stop>
          <div class="ed-field">
            <label class="ed-field-label">Definisi (JSON)</label>
            <FieldJson :model-value="serviceFieldsModel(node.id)" :rows="8" @update:model-value="setServiceFields(node.id, $event)" />
          </div>
        </div>
      </div>

      <div v-if="!graph.componentNodes.length" class="flow-empty">Halaman ini belum punya komponen — tambahkan lewat Design View.</div>
    </div>
    <div class="flow-hint">Seret dari bulatan ⚪ event/value ke node service atau ke input dependsOn untuk menyambungkan. Klik garis untuk memutus (relasi otomatis seperti master-detail/rollup diedit lewat ⚙).</div>
  </div>
</template>

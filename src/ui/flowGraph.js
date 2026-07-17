/**
 * Pure derivation of node/edge graphs from the blueprint — no Vue, no DOM.
 * The KNIME-style Flow View never stores connections separately: every edge
 * is read straight off the same fields the WYSIWYG/Inspector path already
 * writes (services[event].action, properties.dependsOn, properties.relatedTo,
 * column.rollup, properties.uploadService/pdfExportService). Dragging a wire
 * in the UI just calls the same engine setters Inspector.vue's dropdowns do —
 * this module only computes what to DRAW, never owns state.
 *
 * Node geometry is fully deterministic (row-index based, not measured via
 * getBoundingClientRect) so port positions, edges and the live drag-ghost
 * line can all be computed from plain blueprint + a stored/auto {x,y} —
 * no DOM measurement, no reflow timing to get wrong.
 */
import { REGISTRY } from './registry.js';

const VALUE_TYPES = new Set([
  'FORM_INPUT_TEXT', 'FORM_INPUT_NUMBER', 'FORM_INPUT_DATE',
  'FORM_SELECT', 'FORM_CHECKBOX', 'FORM_IMAGE_UPLOAD'
]);

export const NODE_W = 240;
export const HEADER_H = 36;
export const PORT_ROW_H = 22;
export const AUTO_COLS = 4;
export const AUTO_ROW_H = 170;
export const AUTO_COL_W = NODE_W + 50;

export function autoPos(index, cols = AUTO_COLS) {
  return { x: 30 + (index % cols) * AUTO_COL_W, y: 30 + Math.floor(index / cols) * AUTO_ROW_H };
}

/** Port layout for a component node: which rows exist on the left (input) and right (output) side. */
export function componentPorts(comp) {
  const def = REGISTRY[comp.type] || {};
  const outputs = [...(def.events || []).map((e) => ({ kind: 'event', event: e, id: `${comp.id}::event::${e}` }))];
  if (VALUE_TYPES.has(comp.type)) outputs.push({ kind: 'value', id: `${comp.id}::value` });
  const inputs = [];
  if (comp.type === 'FORM_SELECT') inputs.push({ kind: 'dependsOn', id: `${comp.id}::dependsOn` });
  return { inputs, outputs, rows: Math.max(inputs.length, outputs.length, 1) };
}

export function componentNodeHeight(comp) {
  return HEADER_H + componentPorts(comp).rows * PORT_ROW_H + 10;
}

export function servicePorts() {
  return { inputs: [{ kind: 'service-in', id: null }], outputs: [], rows: 1 };
}

/** Two port kinds are wireable by dragging: event-out -> service-in, value-out -> dependsOn-in. */
export function portsCompatible(sourceKind, targetKind) {
  return (sourceKind === 'event' && targetKind === 'service-in') ||
         (sourceKind === 'value' && targetKind === 'dependsOn');
}

// ---------------------------------------------------------------- app graph --

export function deriveAppGraph(bp) {
  const pageIds = Object.keys(bp.pages || {});
  const nodes = pageIds.map((id, i) => {
    const page = bp.pages[id];
    return {
      id,
      title: page.settings.title,
      route: page.settings.route,
      isHome: bp.meta.globalSettings.homePage === id,
      componentCount: page.components.length,
      pos: page._flow || autoPos(i)
    };
  });
  const edges = [];
  pageIds.forEach((pageId) => {
    (bp.pages[pageId].components || []).forEach((c) => {
      Object.entries(c.services || {}).forEach(([event, binding]) => {
        if (binding && binding.action === 'NAVIGATE' && binding.to && bp.pages[binding.to]) {
          edges.push({
            id: `nav_${pageId}_${c.id}_${event}`,
            from: pageId, to: binding.to,
            label: `${c.id}.${event}`, kind: 'navigate'
          });
        }
      });
    });
  });
  return { nodes, edges };
}

// --------------------------------------------------------------- page graph --

export function derivePageGraph(bp, pageId) {
  const page = bp.pages[pageId];
  if (!page) return { componentNodes: [], serviceNodes: [], edges: [] };
  const comps = page.components || [];

  const componentNodes = comps.map((c, i) => ({
    id: c.id,
    type: c.type,
    label: REGISTRY[c.type]?.label || c.type,
    icon: REGISTRY[c.type]?.icon || '?',
    pos: c._flow || autoPos(i),
    height: componentNodeHeight(c),
    ports: componentPorts(c)
  }));

  const referencedServiceIds = new Set();
  const edges = [];

  comps.forEach((c) => {
    Object.entries(c.services || {}).forEach(([event, binding]) => {
      if (!binding || !binding.action || binding.action === 'NAVIGATE') return;
      if (bp.sharedServices?.[binding.action]) {
        referencedServiceIds.add(binding.action);
        edges.push({
          id: `evt_${c.id}_${event}`, from: c.id, to: binding.action,
          fromPortId: `${c.id}::event::${event}`, toPortId: `${binding.action}::in`,
          kind: 'event', label: event, removable: true,
          onRemove: { compId: c.id, event }
        });
      }
    });
    if (c.properties?.dependsOn) {
      edges.push({
        id: `dep_${c.id}`, from: c.properties.dependsOn, to: c.id,
        fromPortId: `${c.properties.dependsOn}::value`, toPortId: `${c.id}::dependsOn`,
        kind: 'dependsOn', label: 'dependsOn', removable: true,
        onRemove: { compId: c.id }
      });
    }
    if (c.properties?.relatedTo?.parentComponentId) {
      edges.push({
        id: `rel_${c.id}`, from: c.properties.relatedTo.parentComponentId, to: c.id,
        kind: 'relatedTo', label: 'master-detail', removable: false
      });
    }
    if (c.properties?.uploadService && bp.sharedServices?.[c.properties.uploadService]) {
      referencedServiceIds.add(c.properties.uploadService);
      edges.push({
        id: `upl_${c.id}`, from: c.id, to: c.properties.uploadService,
        fromPortId: `${c.id}::value`, toPortId: `${c.properties.uploadService}::in`,
        kind: 'service', label: 'upload', removable: false
      });
    }
    if (c.properties?.pdfExportService && bp.sharedServices?.[c.properties.pdfExportService]) {
      referencedServiceIds.add(c.properties.pdfExportService);
      edges.push({
        id: `pdf_${c.id}`, from: c.id, to: c.properties.pdfExportService,
        kind: 'service', label: 'pdf', removable: false
      });
    }
    (c.properties?.columns || []).forEach((col) => {
      if (col.type === 'rollup' && col.rollup?.fromComponentId) {
        edges.push({
          id: `roll_${c.id}_${col.key}`, from: col.rollup.fromComponentId, to: c.id,
          kind: 'rollup', label: `rollup:${col.key}`, removable: false
        });
      }
    });
  });

  // All app services are shown (not just referenced ones) — a service that's
  // momentarily unwired must still have a node to drag a new wire onto, or
  // the graph becomes a dead end the instant the last reference is removed.
  const serviceIds = Object.keys(bp.sharedServices || {});
  const serviceNodes = serviceIds.map((sid, i) => ({
    id: sid,
    type: bp.sharedServices[sid]?.type || '?',
    used: referencedServiceIds.has(sid),
    pos: page._flowServices?.[sid] || {
      x: 30 + i * AUTO_COL_W,
      y: 30 + Math.ceil(componentNodes.length / AUTO_COLS) * AUTO_ROW_H + 140
    },
    height: HEADER_H + PORT_ROW_H + 10,
    ports: servicePorts()
  }));

  return { componentNodes, serviceNodes, edges };
}

/** Canvas-local port coordinate, purely from node geometry — no DOM reads. */
export function portPoint(node, side, rowIndex) {
  const x = side === 'in' ? node.pos.x : node.pos.x + NODE_W;
  const y = node.pos.y + HEADER_H + rowIndex * PORT_ROW_H + PORT_ROW_H / 2;
  return { x, y };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared/expression-engine.js';
import '../shared/blueprint-utils.js';
import { deriveAppGraph, derivePageGraph, portsCompatible } from '../src/ui/flowGraph.js';

const B = globalThis.NCGASBlueprint;

function twoPageBlueprint() {
  const bp = B.createEmptyBlueprint('ncgas_flow_demo', 'Flow Demo');
  const homeId = Object.keys(bp.pages)[0];
  const secondId = 'pg_second';
  bp.pages[secondId] = B.createEmptyPage('Kedua', '/kedua');

  bp.sharedServices.srv_save = { type: 'GAS_RPC', functionName: 'saveThing', allowedRoles: [] };
  bp.sharedServices.srv_upload = { type: 'DRIVE_UPLOAD', folderName: 'photos', allowedRoles: [] };

  bp.pages[homeId].components.push({
    id: 'comp_btn_go', type: 'BUTTON', layoutGrid: { row: 1, col: 1, colSpan: 3 },
    properties: { label: 'Lanjut', variant: 'primary' },
    services: { onClick: { action: 'NAVIGATE', to: secondId } }, rules: {}
  });
  bp.pages[homeId].components.push({
    id: 'comp_btn_save', type: 'BUTTON', layoutGrid: { row: 1, col: 4, colSpan: 3 },
    properties: { label: 'Simpan', variant: 'primary' },
    services: { onClick: { action: 'srv_save', inputs: {} } }, rules: {}
  });
  bp.pages[homeId].components.push({
    id: 'comp_province', type: 'FORM_SELECT', layoutGrid: { row: 2, col: 1, colSpan: 6 },
    properties: { label: 'Provinsi', options: [{ label: 'Jabar', value: 'jabar' }] }, services: {}, rules: {}
  });
  bp.pages[homeId].components.push({
    id: 'comp_city', type: 'FORM_SELECT', layoutGrid: { row: 2, col: 7, colSpan: 6 },
    properties: { label: 'Kota', options: [], dependsOn: 'comp_province' }, services: {}, rules: {}
  });
  bp.pages[homeId].components.push({
    id: 'comp_photo', type: 'FORM_IMAGE_UPLOAD', layoutGrid: { row: 3, col: 1, colSpan: 6 },
    properties: { label: 'Foto', uploadService: 'srv_upload', maxSizeMB: 5 }, services: {}, rules: {}
  });
  return { bp, homeId, secondId };
}

test('deriveAppGraph: one node per page, edges only from NAVIGATE bindings', () => {
  const { bp, homeId, secondId } = twoPageBlueprint();
  const graph = deriveAppGraph(bp);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].from, homeId);
  assert.equal(graph.edges[0].to, secondId);
  assert.equal(graph.edges[0].kind, 'navigate');
});

test('deriveAppGraph: marks the home page node', () => {
  const { bp, homeId } = twoPageBlueprint();
  const graph = deriveAppGraph(bp);
  const home = graph.nodes.find((n) => n.id === homeId);
  assert.equal(home.isHome, true);
});

test('derivePageGraph: shows every app service as a node (not just referenced ones), so an unwired service can still be dragged onto', () => {
  const { bp, homeId } = twoPageBlueprint();
  const graph = derivePageGraph(bp, homeId);
  const serviceIds = graph.serviceNodes.map((s) => s.id).sort();
  assert.deepEqual(serviceIds, ['srv_save', 'srv_upload']); // both referenced already, both present

  // now remove the only reference to srv_upload — its node must NOT disappear
  bp.pages[homeId].components.find((c) => c.id === 'comp_photo').properties.uploadService = '';
  const graph2 = derivePageGraph(bp, homeId);
  const nodesById = Object.fromEntries(graph2.serviceNodes.map((s) => [s.id, s]));
  assert.ok(nodesById.srv_upload, 'unreferenced service must still render as a node to remain a drag target');
  assert.equal(nodesById.srv_upload.used, false);
  assert.equal(nodesById.srv_save.used, true);
});

test('derivePageGraph: event->service, dependsOn and upload edges are all derived', () => {
  const { bp, homeId } = twoPageBlueprint();
  const graph = derivePageGraph(bp, homeId);
  const byKind = (k) => graph.edges.filter((e) => e.kind === k);

  assert.equal(byKind('event').length, 1);
  assert.equal(byKind('event')[0].from, 'comp_btn_save');
  assert.equal(byKind('event')[0].to, 'srv_save');
  assert.equal(byKind('event')[0].removable, true);

  assert.equal(byKind('dependsOn').length, 1);
  assert.equal(byKind('dependsOn')[0].from, 'comp_province');
  assert.equal(byKind('dependsOn')[0].to, 'comp_city');
  assert.equal(byKind('dependsOn')[0].removable, true);

  assert.equal(byKind('service').length, 1);
  assert.equal(byKind('service')[0].from, 'comp_photo');
  assert.equal(byKind('service')[0].to, 'srv_upload');
  assert.equal(byKind('service')[0].removable, false);

  // NAVIGATE bindings are app-level edges only, not drawn inside the page graph
  assert.equal(byKind('navigate').length, 0);
});

test('derivePageGraph: master-detail and rollup relationships are derived and non-removable', () => {
  const bp = B.createEmptyBlueprint('ncgas_flow_demo2', 'Flow Demo 2');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_projects', type: 'CRUD_TABLE', layoutGrid: { row: 1, col: 1, colSpan: 12 },
    properties: { title: 'Proyek', dataSource: 'sheet', columns: [], filters: [] }, services: {}, rules: {}
  });
  bp.pages[pageId].components.push({
    id: 'comp_tasks', type: 'CRUD_TABLE', layoutGrid: { row: 2, col: 1, colSpan: 12 },
    properties: {
      title: 'Tugas', dataSource: 'sheet',
      relatedTo: { parentComponentId: 'comp_projects', parentKeyColumn: 'id', childForeignKeyColumn: 'projectId' },
      columns: [{ key: 'status', label: 'Status', type: 'rollup', rollup: { fromComponentId: 'comp_tasks_child', mode: 'allEqual', matchValue: 'done' } }],
      filters: []
    },
    services: {}, rules: {}
  });
  const graph = derivePageGraph(bp, pageId);
  const rel = graph.edges.find((e) => e.kind === 'relatedTo');
  const roll = graph.edges.find((e) => e.kind === 'rollup');
  assert.ok(rel && rel.from === 'comp_projects' && rel.to === 'comp_tasks' && rel.removable === false);
  assert.ok(roll && roll.to === 'comp_tasks' && roll.removable === false);
});

test('portsCompatible only allows event->service-in and value->dependsOn', () => {
  assert.equal(portsCompatible('event', 'service-in'), true);
  assert.equal(portsCompatible('value', 'dependsOn'), true);
  assert.equal(portsCompatible('event', 'dependsOn'), false);
  assert.equal(portsCompatible('value', 'service-in'), false);
});

test('blueprints with cosmetic _flow positions on pages/components still validate', () => {
  const { bp } = twoPageBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId]._flow = { x: 30, y: 30 };
  bp.pages[pageId]._flowServices = { srv_save: { x: 300, y: 30 } };
  bp.pages[pageId].components[0]._flow = { x: 30, y: 30 };
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

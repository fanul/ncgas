import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared/expression-engine.js'; // registers globalThis.NCGASExpression for rule validation
import '../shared/blueprint-utils.js';

const B = globalThis.NCGASBlueprint;

function sampleBlueprint() {
  const bp = B.createEmptyBlueprint('ncgas_demo', 'Demo App');
  const pageId = Object.keys(bp.pages)[0];
  bp.sharedServices.srv_fetch_profile = {
    type: 'GAS_RPC',
    functionName: 'getUserProfileData',
    cachePolicy: 'LOCAL_STORAGE_5M',
    allowedRoles: ['Admin', 'HR_Manager']
  };
  bp.sharedRules.rule_is_adult = { expression: 'state.userAge >= 18', errorMessage: 'Minimal 18 tahun.' };
  bp.pages[pageId].components.push({
    id: 'comp_input_salary',
    type: 'FORM_INPUT_NUMBER',
    layoutGrid: { row: 1, col: 1, colSpan: 6 },
    properties: { label: 'Base Salary', defaultValue: 0 },
    services: { onBlur: { action: 'srv_fetch_profile', inputs: { salary: 'comp_input_salary.value' } } },
    rules: {
      validation: [{ trigger: 'onChange', condition: 'self.value > 0', errorMessage: 'Harus > 0' }],
      visibility: { condition: "user.role === 'Admin' || user.role === 'HR_Manager'" }
    }
  });
  return bp;
}

test('createEmptyBlueprint produces a valid blueprint', () => {
  const res = B.validateBlueprint(B.createEmptyBlueprint('my_app_01'));
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('full sample blueprint validates', () => {
  const res = B.validateBlueprint(sampleBlueprint());
  assert.deepEqual(res.errors, []);
});

test('broken service reference is caught', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components[0].services.onBlur.action = 'srv_ghost';
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: service `srv_ghost`/);
});

test('invalid rule expression is caught at validation time', () => {
  const bp = sampleBlueprint();
  bp.sharedRules.rule_bad = { expression: 'state.userAge >=' };
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Invalid expression/);
});

test('duplicate component ids across pages are caught', () => {
  const bp = sampleBlueprint();
  const p2 = B.createEmptyPage('Second', '/second');
  p2.components.push({ id: 'comp_input_salary', type: 'TEXT', properties: {} });
  bp.pages.pg_second = p2;
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Duplicate component id/);
});

test('duplicate routes are caught', () => {
  const bp = sampleBlueprint();
  const homeId = Object.keys(bp.pages)[0];
  const p2 = B.createEmptyPage('Clone', bp.pages[homeId].settings.route);
  bp.pages.pg_clone = p2;
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Duplicate route/);
});

test('layoutGrid col+colSpan overflowing the 12-col grid is caught', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components[0].layoutGrid = { row: 1, col: 8, colSpan: 6 };
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /overflows the 12-column grid/);
});

test('missing layoutGrid is required, not optional', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  delete bp.pages[pageId].components[0].layoutGrid;
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /layoutGrid \{row,col,colSpan\} is required/);
});

// ------------------------------------------------------------- CRUD_TABLE --

function crudBlueprintWithMasterDetail() {
  const bp = B.createEmptyBlueprint('ncgas_crud_demo', 'CRUD Demo');
  const pageId = Object.keys(bp.pages)[0];
  bp.sharedServices = {
    srv_proyek_read: { type: 'SHEET_READ', spreadsheetId: 'sid', sheet: 'Proyek', allowedRoles: [] },
    srv_proyek_create: { type: 'SHEET_APPEND', spreadsheetId: 'sid', sheet: 'Proyek', keyColumn: 'id', allowedRoles: [] },
    srv_proyek_update: { type: 'SHEET_UPDATE', spreadsheetId: 'sid', sheet: 'Proyek', keyColumn: 'id', allowedRoles: [] },
    srv_proyek_delete: { type: 'SHEET_DELETE', spreadsheetId: 'sid', sheet: 'Proyek', keyColumn: 'id', allowedRoles: [] },
    srv_tugas_read: { type: 'SHEET_READ', spreadsheetId: 'sid', sheet: 'Tugas', allowedRoles: [] },
    srv_tugas_create: { type: 'SHEET_APPEND', spreadsheetId: 'sid', sheet: 'Tugas', keyColumn: 'id', allowedRoles: [] },
    srv_tugas_update: { type: 'SHEET_UPDATE', spreadsheetId: 'sid', sheet: 'Tugas', keyColumn: 'id', allowedRoles: [] },
    srv_tugas_delete: { type: 'SHEET_DELETE', spreadsheetId: 'sid', sheet: 'Tugas', keyColumn: 'id', allowedRoles: [] }
  };
  bp.pages[pageId].components.push(
    {
      id: 'comp_crud_proyek', type: 'CRUD_TABLE', layoutGrid: { row: 1, col: 1, colSpan: 12 },
      properties: {
        dataSource: 'sheet', keyColumn: 'id',
        serviceRead: 'srv_proyek_read', serviceCreate: 'srv_proyek_create', serviceUpdate: 'srv_proyek_update', serviceDelete: 'srv_proyek_delete',
        columns: [{ key: 'id', type: 'text' }, { key: 'nama', type: 'text' }]
      }
    },
    {
      id: 'comp_crud_tugas', type: 'CRUD_TABLE', layoutGrid: { row: 2, col: 1, colSpan: 12 },
      properties: {
        dataSource: 'sheet', keyColumn: 'id',
        serviceRead: 'srv_tugas_read', serviceCreate: 'srv_tugas_create', serviceUpdate: 'srv_tugas_update', serviceDelete: 'srv_tugas_delete',
        columns: [{ key: 'id', type: 'text' }, { key: 'proyek_id', type: 'text' }],
        relatedTo: { parentComponentId: 'comp_crud_proyek', parentKeyColumn: 'id', childForeignKeyColumn: 'proyek_id' }
      }
    }
  );
  return bp;
}

test('CRUD_TABLE master-detail blueprint validates', () => {
  const res = B.validateBlueprint(crudBlueprintWithMasterDetail());
  assert.deepEqual(res.errors, []);
});

// -------------------------------------------------------------- rollup --

test('CRUD_TABLE rollup column validates when fully configured', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  const parent = bp.pages[pageId].components.find((c) => c.id === 'comp_crud_proyek');
  parent.properties.columns.push({
    key: 'status_tugas', label: 'Status', type: 'rollup',
    rollup: { fromComponentId: 'comp_crud_tugas', matchColumn: 'proyek_id', statusColumn: 'selesai', doneValue: 'Ya', doneColor: 'ok', pendingColor: 'warn' }
  });
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('CRUD_TABLE rollup column requires its sub-fields', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  const parent = bp.pages[pageId].components.find((c) => c.id === 'comp_crud_proyek');
  parent.properties.columns.push({ key: 'status_tugas', type: 'rollup' }); // no rollup config object at all
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /rollup needs fromComponentId, matchColumn, statusColumn and doneValue/);
});

test('CRUD_TABLE rollup fromComponentId broken reference is caught', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  const parent = bp.pages[pageId].components.find((c) => c.id === 'comp_crud_proyek');
  parent.properties.columns.push({
    key: 'status_tugas', type: 'rollup',
    rollup: { fromComponentId: 'comp_does_not_exist', matchColumn: 'proyek_id', statusColumn: 'selesai', doneValue: 'Ya' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: parent component `comp_does_not_exist`/);
});

test('CRUD_TABLE rollup rejects an invalid badge color', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  const parent = bp.pages[pageId].components.find((c) => c.id === 'comp_crud_proyek');
  parent.properties.columns.push({
    key: 'status_tugas', type: 'rollup',
    rollup: { fromComponentId: 'comp_crud_tugas', matchColumn: 'proyek_id', statusColumn: 'selesai', doneValue: 'Ya', doneColor: 'purple' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /doneColor must be one of: ok, warn, err, dim/);
});

test('CRUD_TABLE relatedTo can reference a parent defined earlier in component order regardless of page walk order', () => {
  // parent (comp_crud_proyek) appears before the child in the array — forward-reference
  // resolution must still work even though validation walks components top-to-bottom.
  const bp = crudBlueprintWithMasterDetail();
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, true);
});

test('CRUD_TABLE relatedTo pointing at a non-existent parent is caught', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  const child = bp.pages[pageId].components.find((c) => c.id === 'comp_crud_tugas');
  child.properties.relatedTo.parentComponentId = 'comp_does_not_exist';
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: parent component `comp_does_not_exist`/);
});

test('CRUD_TABLE cannot be related to itself', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  const child = bp.pages[pageId].components.find((c) => c.id === 'comp_crud_tugas');
  child.properties.relatedTo.parentComponentId = 'comp_crud_tugas';
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /cannot be related to itself/);
});

test('CRUD_TABLE sheet mode requires keyColumn and at least one column', () => {
  const bp = B.createEmptyBlueprint('ncgas_crud_min', 'Min');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_crud_bare', type: 'CRUD_TABLE', layoutGrid: { row: 1, col: 1, colSpan: 12 },
    properties: { dataSource: 'sheet', columns: [] }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  const msg = JSON.stringify(res.errors);
  assert.match(msg, /keyColumn is required/);
  assert.match(msg, /At least one column is required/);
});

test('CRUD_TABLE local dataSource requires localKey but not keyColumn/services', () => {
  const bp = B.createEmptyBlueprint('ncgas_crud_local', 'Local');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_cart', type: 'CRUD_TABLE', layoutGrid: { row: 1, col: 1, colSpan: 12 },
    properties: { dataSource: 'local', columns: [{ key: 'nama', type: 'text' }, { key: 'qty', type: 'number' }] }
  });
  const missingKey = B.validateBlueprint(bp);
  assert.equal(missingKey.ok, false);
  assert.match(JSON.stringify(missingKey.errors), /localKey \(the state\.\* key holding the array\) is required/);

  bp.pages[pageId].components[0].properties.localKey = 'cart';
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('CRUD_TABLE computed column requires a valueExpression', () => {
  const bp = B.createEmptyBlueprint('ncgas_crud_computed', 'Computed');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_cart', type: 'CRUD_TABLE', layoutGrid: { row: 1, col: 1, colSpan: 12 },
    properties: {
      dataSource: 'local', localKey: 'cart',
      columns: [
        { key: 'qty', type: 'number' }, { key: 'harga', type: 'number' },
        { key: 'subtotal', type: 'computed' }
      ]
    }
  });
  const missing = B.validateBlueprint(bp);
  assert.equal(missing.ok, false);
  assert.match(JSON.stringify(missing.errors), /columns\[2\]\.valueExpression.*Expression must be a non-empty string/);

  bp.pages[pageId].components[0].properties.columns[2].valueExpression = 'row.qty * row.harga';
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('CRUD_TABLE broken service reference is caught', () => {
  const bp = crudBlueprintWithMasterDetail();
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.find((c) => c.id === 'comp_crud_proyek').properties.serviceDelete = 'srv_ghost';
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: service `srv_ghost`/);
});

test('SHEET_UPDATE and SHEET_DELETE require keyColumn', () => {
  const bp = B.createEmptyBlueprint('ncgas_svc_min', 'Min');
  bp.sharedServices.srv_bad_update = { type: 'SHEET_UPDATE', spreadsheetId: 'sid', sheet: 'X' };
  bp.sharedServices.srv_bad_delete = { type: 'SHEET_DELETE', spreadsheetId: 'sid', sheet: 'X' };
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  const msg = JSON.stringify(res.errors);
  assert.match(msg, /srv_bad_update[\s\S]*requires keyColumn/);
  assert.match(msg, /srv_bad_delete[\s\S]*requires keyColumn/);
});

// ---------------------------------------------------------------- menu --

test('empty/absent menu is valid (runtime synthesizes a default from pages)', () => {
  const bp = B.createEmptyBlueprint('ncgas_menu_empty', 'Empty Menu');
  assert.deepEqual(B.validateBlueprint(bp).errors, []);
  delete bp.menu;
  assert.deepEqual(B.validateBlueprint(bp).errors, []);
});

test('a well-formed menu with a group validates', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.menu = [
    { id: 'mi_home', type: 'page', label: 'Beranda', pageId, allowedRoles: [] },
    { id: 'mi_divider1', type: 'divider' },
    { id: 'mi_data', type: 'group', label: 'Data', children: [
      { id: 'mi_help', type: 'link', label: 'Bantuan', url: 'https://example.com/help' }
    ] }
  ];
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('menu page item with a broken pageId reference is caught', () => {
  const bp = sampleBlueprint();
  bp.menu = [{ id: 'mi_ghost', type: 'page', pageId: 'pg_does_not_exist' }];
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: page `pg_does_not_exist`/);
});

test('menu link item requires a url', () => {
  const bp = sampleBlueprint();
  bp.menu = [{ id: 'mi_link', type: 'link', label: 'No URL' }];
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /link items require a url/);
});

test('nested groups are rejected', () => {
  const bp = sampleBlueprint();
  bp.menu = [{ id: 'mi_outer', type: 'group', children: [{ id: 'mi_inner', type: 'group', children: [] }] }];
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /groups cannot be nested/);
});

test('duplicate menu item ids (even across nesting levels) are caught', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.menu = [
    { id: 'mi_dup', type: 'page', pageId },
    { id: 'mi_group', type: 'group', children: [{ id: 'mi_dup', type: 'link', url: 'https://example.com' }] }
  ];
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Duplicate menu item id `mi_dup`/);
});

test('menu allowedRoles rejects an undeclared role', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.menu = [{ id: 'mi_home', type: 'page', pageId, allowedRoles: ['Superuser'] }];
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Unknown role `Superuser`/);
});

// ---------------------------------------------------------- FORM_IMAGE_UPLOAD --

test('FORM_IMAGE_UPLOAD with a valid DRIVE_UPLOAD reference validates', () => {
  const bp = B.createEmptyBlueprint('ncgas_img_ok', 'Img');
  const pageId = Object.keys(bp.pages)[0];
  bp.sharedServices.srv_upload = { type: 'DRIVE_UPLOAD', allowedRoles: [], maxSizeMB: 5 };
  bp.pages[pageId].components.push({
    id: 'comp_photo', type: 'FORM_IMAGE_UPLOAD', layoutGrid: { row: 1, col: 1, colSpan: 6 },
    properties: { label: 'Foto', uploadService: 'srv_upload' }
  });
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('FORM_IMAGE_UPLOAD requires uploadService', () => {
  const bp = B.createEmptyBlueprint('ncgas_img_min', 'Img');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_photo', type: 'FORM_IMAGE_UPLOAD', layoutGrid: { row: 1, col: 1, colSpan: 6 }, properties: {}
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /uploadService is required/);
});

test('FORM_IMAGE_UPLOAD uploadService must reference a DRIVE_UPLOAD service, not any service', () => {
  const bp = B.createEmptyBlueprint('ncgas_img_wrong_type', 'Img');
  const pageId = Object.keys(bp.pages)[0];
  bp.sharedServices.srv_email = { type: 'EMAIL_SEND', allowedRoles: [] };
  bp.pages[pageId].components.push({
    id: 'comp_photo', type: 'FORM_IMAGE_UPLOAD', layoutGrid: { row: 1, col: 1, colSpan: 6 },
    properties: { uploadService: 'srv_email' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /must reference a DRIVE_UPLOAD service/);
});

test('CRUD_TABLE image column with uploadService is validated the same way', () => {
  const bp = B.createEmptyBlueprint('ncgas_img_crud', 'Img');
  const pageId = Object.keys(bp.pages)[0];
  bp.sharedServices.srv_upload = { type: 'DRIVE_UPLOAD', allowedRoles: [] };
  bp.pages[pageId].components.push({
    id: 'comp_products', type: 'CRUD_TABLE', layoutGrid: { row: 1, col: 1, colSpan: 12 },
    properties: {
      dataSource: 'local', localKey: 'products',
      columns: [{ key: 'foto', type: 'image', uploadService: 'srv_ghost' }]
    }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: service `srv_ghost`/);
});

// -------------------------------------------------------------------- CHART --

test('CHART with a valid type and expressions validates', () => {
  const bp = B.createEmptyBlueprint('ncgas_chart_ok', 'Chart');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_chart', type: 'CHART', layoutGrid: { row: 1, col: 1, colSpan: 6 },
    properties: {
      chartType: 'bar',
      labelsExpression: "pluck(groupBySum(state.cart, 'product', 'total'), 'key')",
      valuesExpression: "pluck(groupBySum(state.cart, 'product', 'total'), 'total')"
    }
  });
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('CHART rejects an unknown chartType', () => {
  const bp = B.createEmptyBlueprint('ncgas_chart_bad_type', 'Chart');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_chart', type: 'CHART', layoutGrid: { row: 1, col: 1, colSpan: 6 },
    properties: { chartType: 'scatter3d', labelsExpression: '[]', valuesExpression: '[]' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /chartType must be one of: bar, line, pie, doughnut/);
});

test('CHART requires labels/values expressions', () => {
  const bp = B.createEmptyBlueprint('ncgas_chart_min', 'Chart');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_chart', type: 'CHART', layoutGrid: { row: 1, col: 1, colSpan: 6 }, properties: { chartType: 'pie' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  const msg = JSON.stringify(res.errors);
  assert.match(msg, /labelsExpression/);
  assert.match(msg, /valuesExpression/);
});

// -------------------------------------------------------------- PRINT_BUTTON --

test('PRINT_BUTTON with a valid template and items expression validates', () => {
  const bp = B.createEmptyBlueprint('ncgas_print_ok', 'Print');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_print', type: 'PRINT_BUTTON', layoutGrid: { row: 1, col: 1, colSpan: 3 },
    properties: {
      label: 'Cetak', title: 'Struk',
      htmlTemplate: '<p>{{user.email}}</p>{{items_table}}<p>{{formatIDR(sum(pluck(state.cart, \'harga\')))}}</p>',
      itemsExpression: 'state.cart'
    }
  });
  const res = B.validateBlueprint(bp);
  assert.deepEqual(res.errors, []);
});

test('PRINT_BUTTON requires htmlTemplate', () => {
  const bp = B.createEmptyBlueprint('ncgas_print_min', 'Print');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_print', type: 'PRINT_BUTTON', layoutGrid: { row: 1, col: 1, colSpan: 3 }, properties: {}
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /htmlTemplate is required/);
});

test('PRINT_BUTTON catches an invalid expression inside a {{token}}', () => {
  const bp = B.createEmptyBlueprint('ncgas_print_bad_token', 'Print');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_print', type: 'PRINT_BUTTON', layoutGrid: { row: 1, col: 1, colSpan: 3 },
    properties: { htmlTemplate: '<p>{{user.role ===}}</p>' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Invalid expression/);
});

test('PRINT_BUTTON pdfExportService broken reference is caught', () => {
  const bp = B.createEmptyBlueprint('ncgas_print_pdf', 'Print');
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components.push({
    id: 'comp_print', type: 'PRINT_BUTTON', layoutGrid: { row: 1, col: 1, colSpan: 3 },
    properties: { htmlTemplate: '<p>ok</p>', pdfExportService: 'srv_ghost' }
  });
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: service `srv_ghost`/);
});

test('shard round-trip preserves the blueprint', () => {
  const bp = sampleBlueprint();
  const shards = B.splitIntoShards(bp);
  assert.deepEqual(shards.manifest.pageIds, Object.keys(bp.pages));
  assert.ok(shards.globals.sharedServices.srv_fetch_profile);
  const merged = B.mergeShards(shards.manifest, shards.globals, shards.pages);
  assert.deepEqual(merged, JSON.parse(JSON.stringify(bp)));
});

test('mergeShards throws explicitly on a missing page shard', () => {
  const bp = sampleBlueprint();
  const shards = B.splitIntoShards(bp);
  const partial = {};
  assert.throws(
    () => B.mergeShards(shards.manifest, shards.globals, partial),
    /SHARD_ERROR.*Missing page shard/
  );
});

test('assertValid throws with every error listed', () => {
  const bp = sampleBlueprint();
  bp.appId = 'BAD ID!';
  bp.meta.name = '';
  assert.throws(() => B.assertValid(bp), /BLUEPRINT_INVALID[\s\S]*appId[\s\S]*meta\.name/);
});

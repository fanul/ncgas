/**
 * Builder RPC adapter.
 *
 * Production: the editor is hosted as a GAS web app -> google.script.run
 * calls `builderApi(action, payloadJson)` in gas/builder/Api.js.
 * Local dev:  a mock Drive backed by localStorage, same contract.
 *
 * Contract (both sides): every call resolves the `data` of an envelope
 *   { ok: true, data } | { ok: false, error: { code, message, details? } }
 * and rejects with NCGASApiError on ok:false.
 */

export class NCGASApiError extends Error {
  constructor(code, message, details) {
    super(`[${code}] ${message}`);
    this.name = 'NCGASApiError';
    this.code = code;
    this.details = details;
  }
}

export const isGasHost =
  typeof google !== 'undefined' && !!(google.script && google.script.run);

// ------------------------------------------------------------- compression --

/** gzip+base64 large payloads before shipping to GAS (Utilities.ungzip on server). */
async function gzipBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function packBlueprint(blueprint) {
  const json = JSON.stringify(blueprint);
  if (typeof CompressionStream !== 'undefined' && json.length > 32 * 1024) {
    return { encoding: 'gzip-base64', data: await gzipBase64(json) };
  }
  return { encoding: 'json', data: json };
}

// --------------------------------------------------------------- GAS bridge --

function gasCall(action, payload) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((envelope) => {
        let parsed = envelope;
        if (typeof envelope === 'string') {
          try { parsed = JSON.parse(envelope); }
          catch (e) { return reject(new NCGASApiError('BAD_ENVELOPE', 'Server returned unparseable response')); }
        }
        if (parsed && parsed.ok) return resolve(parsed.data);
        const err = (parsed && parsed.error) || {};
        reject(new NCGASApiError(err.code || 'SERVER_ERROR', err.message || 'Unknown server error', err.details));
      })
      .withFailureHandler((err) => {
        reject(new NCGASApiError('TRANSPORT', (err && err.message) || 'google.script.run failed'));
      })
      .builderApi(action, JSON.stringify(payload || {}));
  });
}

// --------------------------------------------------------------- local mock --

const MOCK_KEY = 'ncgas.mockdrive.v1';
const MOCK_USER = { email: 'dev@local.test', roles: ['Admin'] };

function mockDrive() {
  try { return JSON.parse(localStorage.getItem(MOCK_KEY)) || { apps: {} }; }
  catch (e) { return { apps: {} }; }
}
function mockDriveSave(db) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(db));
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------- mock sheet store --
// Backs SHEET_READ/APPEND/UPDATE/DELETE in local dev with a real (if fake),
// persistent CRUD loop — add/edit/delete actually stick — so the whole
// filter->read->add->edit->delete flow (and master-detail) is fully testable
// without a real Google Sheet. Keyed by spreadsheetId::sheet, independent of
// any one service definition, so read/create/update/delete on the "same
// sheet" always see each other's writes.

const MOCK_SHEETS_KEY = 'ncgas.mocksheets.v1';

function mockSheetsDb() {
  try { return JSON.parse(localStorage.getItem(MOCK_SHEETS_KEY)) || { tables: {} }; }
  catch (e) { return { tables: {} }; }
}
function mockSheetsSave(db) {
  localStorage.setItem(MOCK_SHEETS_KEY, JSON.stringify(db));
}
function sheetTableKey(service) {
  return `${service.spreadsheetId || 'local'}::${service.sheet || 'Sheet1'}`;
}
function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

function mockSheetRead(service) {
  const db = mockSheetsDb();
  const key = sheetTableKey(service);
  if (!db.tables[key]) {
    db.tables[key] = { rows: Array.isArray(service.mockResult) ? service.mockResult : [] };
    mockSheetsSave(db);
  }
  return db.tables[key].rows;
}

function mockSheetAppend(service, inputs) {
  const db = mockSheetsDb();
  const key = sheetTableKey(service);
  if (!db.tables[key]) db.tables[key] = { rows: Array.isArray(service.mockResult) ? service.mockResult : [] };
  const record = { ...inputs };
  if (service.keyColumn && !record[service.keyColumn]) record[service.keyColumn] = shortId();
  if (service.dataBoundary && service.dataBoundary.ownerColumn) record[service.dataBoundary.ownerColumn] = MOCK_USER.email;
  db.tables[key].rows.push(record);
  mockSheetsSave(db);
  return { appended: 1, key: record[service.keyColumn] };
}

function mockSheetUpdate(service, inputs) {
  const db = mockSheetsDb();
  const key = sheetTableKey(service);
  const table = db.tables[key];
  if (!table) throw new NCGASApiError('NOT_FOUND', `Baris dengan ${service.keyColumn} = ${inputs.key} tidak ditemukan.`);
  const row = table.rows.find((r) => String(r[service.keyColumn]) === String(inputs.key));
  if (!row) throw new NCGASApiError('NOT_FOUND', `Baris dengan ${service.keyColumn} = ${inputs.key} tidak ditemukan.`);
  const record = (inputs.record && typeof inputs.record === 'object') ? inputs.record : {};
  Object.keys(record).forEach((k) => {
    if (k === service.keyColumn) return; // identity column never changes via update
    if (service.dataBoundary && k === service.dataBoundary.ownerColumn) return; // ownership never changes via update
    row[k] = record[k];
  });
  mockSheetsSave(db);
  return { updated: 1 };
}

function mockSheetDelete(service, inputs) {
  const db = mockSheetsDb();
  const key = sheetTableKey(service);
  const table = db.tables[key];
  if (!table) throw new NCGASApiError('NOT_FOUND', `Baris dengan ${service.keyColumn} = ${inputs.key} tidak ditemukan.`);
  const before = table.rows.length;
  table.rows = table.rows.filter((r) => String(r[service.keyColumn]) !== String(inputs.key));
  if (table.rows.length === before) throw new NCGASApiError('NOT_FOUND', `Baris dengan ${service.keyColumn} = ${inputs.key} tidak ditemukan.`);
  mockSheetsSave(db);
  return { deleted: 1 };
}

const mockHandlers = {
  async getIdentity() {
    return { ...MOCK_USER, host: 'local-mock' };
  },

  async listApps() {
    const db = mockDrive();
    return Object.values(db.apps)
      .map((bp) => ({
        appId: bp.appId,
        name: bp.meta.name,
        updatedAt: bp.meta.lastModified,
        pages: Object.keys(bp.pages).length,
        url: bp.deploy && bp.deploy.url
      }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  async saveApp({ blueprint }) {
    const db = mockDrive();
    db.apps[blueprint.appId] = blueprint;
    mockDriveSave(db);
    return { savedAt: new Date().toISOString(), shards: Object.keys(blueprint.pages).length + 2 };
  },

  async loadApp({ appId }) {
    const db = mockDrive();
    if (!db.apps[appId]) throw new NCGASApiError('NOT_FOUND', `App \`${appId}\` not found in mock Drive`);
    return db.apps[appId];
  },

  async deleteApp({ appId }) {
    const db = mockDrive();
    delete db.apps[appId];
    mockDriveSave(db);
    return { deleted: appId };
  },

  async compileAndDeploy({ appId }) {
    await delay(900);
    const db = mockDrive();
    const bp = db.apps[appId];
    if (!bp) throw new NCGASApiError('NOT_FOUND', `App \`${appId}\` not saved yet — save before deploying`);
    bp.deploy = {
      ...bp.deploy,
      scriptId: bp.deploy?.scriptId || 'MOCK_SCRIPT_' + appId,
      url: `https://script.google.com/macros/s/MOCK_${appId}/exec`,
      lastDeployedVersion: (bp.deploy?.lastDeployedVersion || 0) + 1
    };
    mockDriveSave(db);
    return {
      ...bp.deploy,
      notes: [
        'LOCAL MOCK deployment — no real GAS project was touched.',
        'Deploy the builder to Apps Script (npm run build:gas + clasp push) for real deployments.'
      ]
    };
  },

  /**
   * Preview-mode service execution. The editor preview NEVER hits real
   * Workspace data: SHEET_* verbs run against the local mock sheet store
   * (below) so CRUD actually persists across reloads; everything else
   * returns the service's configured `mockResult`.
   */
  async runService({ serviceId, inputs, service }) {
    await delay(150 + Math.random() * 150);
    if (!service) {
      return { __mock: true, serviceId, inputs, hint: 'Define mockResult on this service to control preview data.' };
    }
    switch (service.type) {
      case 'SHEET_READ': return mockSheetRead(service);
      case 'SHEET_APPEND': return mockSheetAppend(service, inputs);
      case 'SHEET_UPDATE': return mockSheetUpdate(service, inputs);
      case 'SHEET_DELETE': return mockSheetDelete(service, inputs);
      // No real Drive locally — just hand back the actual uploaded bytes as a data: URL,
      // so builders see their real image working in preview (not a placeholder).
      case 'DRIVE_UPLOAD': return { fileId: 'mock_' + shortId(), url: `data:${inputs.mimeType || 'image/png'};base64,${inputs.base64}` };
      default: return service.mockResult !== undefined ? service.mockResult : { __mock: true, serviceId, inputs };
    }
  },

  /**
   * Local dev has no real spreadsheet to introspect — the wizard falls back
   * to manual header entry in this environment (see CrudWizard.vue).
   */
  async inspectSheet() {
    throw new NCGASApiError('UNSUPPORTED',
      'Deteksi kolom otomatis hanya tersedia saat builder di-hosting di Apps Script. Isi kolom secara manual di bawah.');
  }
};

async function mockCall(action, payload) {
  if (!mockHandlers[action]) {
    throw new NCGASApiError('UNKNOWN_ACTION', `Mock adapter has no handler for \`${action}\``);
  }
  return mockHandlers[action](payload || {});
}

// ------------------------------------------------------------------ facade --

/** api('listApps') / api('saveApp', {...}) — host-agnostic. */
export function api(action, payload) {
  return isGasHost ? gasCall(action, payload) : mockCall(action, payload);
}

/**
 * rpc function handed to the runtime for PREVIEW mode. Resolves the service
 * definition locally so the mock can honor mockResult; on a GAS host the
 * builder still uses mock results in preview (real calls only exist in
 * deployed apps — deliberate safety boundary).
 */
export function makePreviewRpc(getBlueprint) {
  return async (action, payload) => {
    if (action !== 'runService') throw new NCGASApiError('UNSUPPORTED', `Preview rpc only supports runService, got ${action}`);
    const bp = getBlueprint();
    const service = bp.sharedServices[payload.serviceId];
    return mockHandlers.runService({ ...payload, service });
  };
}

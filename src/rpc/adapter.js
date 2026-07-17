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
   * Workspace data: services return their `mockResult` (designed in the
   * service editor) so builders can safely simulate any dataset.
   */
  async runService({ serviceId, inputs, service }) {
    await delay(250);
    if (service && service.mockResult !== undefined) return service.mockResult;
    return {
      __mock: true,
      serviceId,
      inputs,
      hint: 'Define mockResult on this service to control preview data.'
    };
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

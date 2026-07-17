/**
 * NCGAS Builder — RPC surface consumed by src/rpc/adapter.js.
 * One exposed function, string-in/string-out (safest across the
 * google.script.run bridge), envelope contract:
 *   { ok:true, data } | { ok:false, error:{ code, message, details } }
 */

function builderApi(action, payloadJson) {
  var payload;
  try {
    payload = payloadJson ? JSON.parse(payloadJson) : {};
  } catch (e) {
    return fail_('BAD_PAYLOAD', 'Payload is not valid JSON: ' + e.message);
  }

  var identity = Identity_.current();
  if (!identity.email) return fail_('UNAUTHENTICATED', 'No Google Workspace identity in session.');

  var handlers = {
    getIdentity: function () { return identity; },
    listApps: function () { return Storage_.listApps(); },
    loadApp: function () { return Storage_.loadApp(required_(payload, 'appId')); },
    deleteApp: function () { return Storage_.deleteApp(required_(payload, 'appId')); },
    saveApp: function () { return Storage_.saveApp(unpackBlueprint_(payload)); },
    compileAndDeploy: function () { return Compiler_.compileAndDeploy(required_(payload, 'appId')); },
    inspectSheet: function () { return SheetInspect_.inspect(required_(payload, 'spreadsheetId')); }
  };

  if (!handlers[action]) {
    return fail_('UNKNOWN_ACTION', 'builderApi has no action `' + action + '`. Available: ' + Object.keys(handlers).join(', '));
  }

  try {
    return ok_(handlers[action]());
  } catch (e) {
    var code = e.ncCode || 'SERVER_ERROR';
    console.error('[builderApi:' + action + '] ' + code + ': ' + e.message + (e.stack ? '\n' + e.stack : ''));
    return fail_(code, e.message, e.ncDetails);
  }
}

function required_(payload, key) {
  if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
    throw NcError_('MISSING_FIELD', 'Required field `' + key + '` is missing from payload.');
  }
  return payload[key];
}

/**
 * The editor ships blueprints either raw ({blueprint}) or compressed
 * ({packed:{encoding:'gzip-base64', data}}) — mirror of packBlueprint().
 */
function unpackBlueprint_(payload) {
  if (payload.packed && payload.packed.encoding === 'gzip-base64') {
    var gzBlob = Utilities.newBlob(Utilities.base64Decode(payload.packed.data), 'application/x-gzip', 'bp.json.gz');
    var json = Utilities.ungzip(gzBlob).getDataAsString('UTF-8');
    return JSON.parse(json);
  }
  if (payload.packed && payload.packed.encoding === 'json') {
    return JSON.parse(payload.packed.data);
  }
  if (payload.blueprint) return payload.blueprint;
  throw NcError_('MISSING_FIELD', 'saveApp needs `blueprint` or `packed` in payload.');
}

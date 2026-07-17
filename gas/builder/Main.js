/**
 * NCGAS Builder — web app entry.
 * Serves the compiled Vue editor (Index_Builder.html, produced by
 * `npm run build:gas`) and exposes the single RPC entry `builderApi`.
 *
 * Deploy config (appsscript.json): executeAs USER_ACCESSING + access DOMAIN
 * => every builder user works against THEIR OWN Drive and deploys with THEIR
 * OWN OAuth token; the builder owner never becomes a confused deputy.
 */

function doGet() {
  var identity = Identity_.current();
  if (!identity.email) {
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif">403 — NCGAS Builder</h2>' +
      '<p style="font-family:sans-serif">Login dengan akun Google Workspace domain Anda untuk mengakses builder.</p>'
    ).setTitle('NCGAS Builder — Forbidden');
  }
  return HtmlService.createHtmlOutputFromFile('Index_Builder')
    .setTitle('NCGAS Builder')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var Identity_ = {
  current: function () {
    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (e) { /* restricted */ }
    if (!email) {
      try { email = Session.getEffectiveUser().getEmail(); } catch (e) { /* restricted */ }
    }
    return { email: email, roles: email ? ['Admin'] : [], host: 'gas' };
  }
};

/** Envelope helpers shared by Api/Storage/Compiler. */
function ok_(data) { return JSON.stringify({ ok: true, data: data }); }
function fail_(code, message, details) {
  return JSON.stringify({ ok: false, error: { code: code, message: message, details: details || null } });
}

/** Typed error that carries an API error code through to the envelope. */
function NcError_(code, message, details) {
  var e = new Error(message);
  e.ncCode = code;
  e.ncDetails = details;
  return e;
}

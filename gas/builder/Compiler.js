/**
 * NCGAS Compiler — turns a validated blueprint into a deployed GAS web app.
 *
 * Strategy: INTERPRET, DON'T TRANSPILE. Every target project receives the
 * same audited runtime (expression engine + renderer, synced from shared/)
 * plus its blueprint embedded as data. Recompiling an app is therefore a
 * content update, never a code rewrite — and a runtime bugfix reaches every
 * app on its next deploy.
 *
 * Target project files:
 *   appsscript      JSON      manifest (webapp access from blueprint auth)
 *   Code            SERVER_JS runtime server (Tpl_ServerMain + blueprint JSON)
 *   ExpressionEngine SERVER_JS same engine the client uses (server-side rules)
 *   CustomHandlers  SERVER_JS pro-code escape hatch — PRESERVED across deploys
 *   Index           HTML      SPA: css + Vue CDN + engine + runtime + boot
 *
 * REST calls use the *builder user's* OAuth token (ScriptApp.getOAuthToken),
 * so ownership and quotas are per-user. Requires the user to enable the
 * Apps Script API once: https://script.google.com/home/usersettings
 */

var Compiler_ = {
  API: 'https://script.googleapis.com/v1',

  compileAndDeploy: function (appId) {
    var blueprint = Storage_.loadApp(appId); // validates
    var files = this.assembleFiles_(blueprint);
    var deploy = blueprint.deploy || {};
    var notes = [];

    // 1. ensure target project exists
    if (!deploy.scriptId) {
      var created = this.api_('POST', '/projects', { title: 'NCGAS — ' + blueprint.meta.name });
      deploy.scriptId = created.scriptId;
      notes.push('Project GAS baru dibuat: ' + deploy.scriptId);
    }

    // 2. preserve CustomHandlers written by developers in the target editor
    var existing = this.tryGetContent_(deploy.scriptId);
    if (existing === null) {
      // stale pointer (target deleted) -> recreate transparently
      var recreated = this.api_('POST', '/projects', { title: 'NCGAS — ' + blueprint.meta.name });
      notes.push('scriptId lama tidak ditemukan (project dihapus?) — dibuat ulang sebagai ' + recreated.scriptId);
      deploy = { scriptId: recreated.scriptId, deploymentId: null, url: null, lastDeployedVersion: null };
      existing = { files: [] };
    }
    var preserved = (existing.files || []).filter(function (f) { return f.name === 'CustomHandlers'; })[0];
    if (preserved && preserved.source && preserved.source.indexOf('NCGAS_STUB') === -1) {
      files = files.map(function (f) { return f.name === 'CustomHandlers' ? preserved : f; });
      notes.push('CustomHandlers.gs milik developer dipertahankan.');
    }

    // 3. push content, cut a version, point the deployment at it
    this.api_('PUT', '/projects/' + deploy.scriptId + '/content', { files: files });

    var version = this.api_('POST', '/projects/' + deploy.scriptId + '/versions', {
      description: 'NCGAS compile ' + new Date().toISOString() + ' (bp ' + blueprint.meta.version + ')'
    });

    var deploymentConfig = {
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: 'NCGAS ' + blueprint.appId + ' v' + version.versionNumber
    };

    var deployment;
    if (deploy.deploymentId) {
      deployment = this.api_('PUT', '/projects/' + deploy.scriptId + '/deployments/' + deploy.deploymentId,
        { deploymentConfig: deploymentConfig });
    } else {
      deployment = this.api_('POST', '/projects/' + deploy.scriptId + '/deployments', deploymentConfig);
      deploy.deploymentId = deployment.deploymentId;
    }

    // 4. resolve the web app URL
    var final = this.api_('GET', '/projects/' + deploy.scriptId + '/deployments/' + deploy.deploymentId, null);
    var webApp = (final.entryPoints || []).filter(function (ep) { return ep.entryPointType === 'WEB_APP'; })[0];
    deploy.url = webApp && webApp.webApp ? webApp.webApp.url : null;
    deploy.lastDeployedVersion = version.versionNumber;
    deploy.editorUrl = 'https://script.google.com/d/' + deploy.scriptId + '/edit';

    if (!deploy.url) {
      notes.push('URL web app belum tersedia dari API — buka editor target dan cek Deploy > Manage deployments.');
    }
    notes.push('PENTING (sekali per app): buka ' + deploy.editorUrl +
      ' lalu jalankan fungsi `authorizeOnce` untuk menyetujui scope (Sheets/Gmail/Drive). ' +
      'Sebelum itu, pengguna akhir akan melihat error otorisasi.');

    Storage_.updateDeploy(blueprint.appId, deploy);
    return Object.assign({ notes: notes }, deploy);
  },

  // ---------------------------------------------------------- file assembly --

  assembleFiles_: function (blueprint) {
    var bpJson = this.jsForScriptTag_(JSON.stringify(blueprint));
    var expressionSrc = this.raw_('Eng_Expression');
    var runtimeSrc = this.raw_('Eng_Runtime');
    var baseCssSrc = this.raw_('Eng_BaseCss');

    var serverCode = this.raw_('Tpl_ServerMain')
      .replace('"__NCGAS_BLUEPRINT_JSON__"', bpJson);

    var manifest = this.targetManifest_(blueprint);

    var index = this.raw_('Tpl_Index')
      .replace('/*__NCGAS_BASE_CSS__*/', this.extractCss_(baseCssSrc))
      .replace('/*__NCGAS_EXPRESSION_ENGINE__*/', expressionSrc)
      .replace('/*__NCGAS_RUNTIME_CORE__*/', runtimeSrc);

    return [
      { name: 'appsscript', type: 'JSON', source: JSON.stringify(manifest, null, 2) },
      { name: 'Code', type: 'SERVER_JS', source: serverCode },
      { name: 'ExpressionEngine', type: 'SERVER_JS', source: expressionSrc },
      { name: 'CustomHandlers', type: 'SERVER_JS', source: this.customHandlersStub_() },
      { name: 'Index', type: 'HTML', source: index }
    ];
  },

  targetManifest_: function (blueprint) {
    var auth = blueprint.meta.globalSettings.authStrategy;
    return {
      timeZone: 'Asia/Jakarta',
      exceptionLogging: 'STACKDRIVER',
      runtimeVersion: 'V8',
      webapp: {
        access: auth === 'PUBLIC' ? 'ANYONE_ANONYMOUS' : 'DOMAIN',
        executeAs: 'USER_DEPLOYING'
      },
      oauthScopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/script.external_request'
      ]
    };
  },

  customHandlersStub_: function () {
    return [
      '/**',
      ' * NCGAS_STUB — CustomHandlers.gs',
      ' * Pro-code escape hatch for GAS_RPC services. Replace this stub with your',
      ' * own functions; NCGAS preserves this file on every recompile once the',
      ' * NCGAS_STUB marker above is removed.',
      ' *',
      ' * Contract: CustomHandlers.<functionName>(inputs, ctx) -> JSON-serializable',
      ' *   inputs: object resolved from the component service binding',
      ' *   ctx:    { user: { email, roles }, blueprint }',
      ' */',
      'var CustomHandlers = {',
      '  // getUserProfileData: function (inputs, ctx) {',
      '  //   return { email: ctx.user.email, grade: "III/A" };',
      '  // }',
      '};'
    ].join('\n');
  },

  /** Eng_BaseCss.html holds JS defining BASE_CSS; extract the literal CSS for a <style> block. */
  extractCss_: function (baseCssJs) {
    // evaluate-free extraction: run the UMD in a sandbox-less way is not possible
    // here, but the file registers on globalThis when loaded as SERVER_JS.
    // Since Eng_BaseCss ships in this builder project as a server file too,
    // NCGASBaseCss is already defined in this runtime:
    if (typeof NCGASBaseCss !== 'undefined' && NCGASBaseCss.BASE_CSS) return NCGASBaseCss.BASE_CSS;
    throw NcError_('COMPILER_ASSET', 'NCGASBaseCss global missing — run `npm run sync:gas` and push again.');
  },

  raw_: function (name) {
    try {
      return HtmlService.createTemplateFromFile(name).getRawContent();
    } catch (e) {
      throw NcError_('COMPILER_ASSET', 'Template file `' + name + '` is missing from the builder project. ' +
        'Run `npm run build:gas` (or `npm run sync:gas`) locally and `clasp push` again.');
    }
  },

  /** Embed JSON inside JS safely (script-tag close + JS line separators). */
  jsForScriptTag_: function (json) {
    return json
      .replace(/<\//g, '<\\/')
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  },

  // ------------------------------------------------------------- REST layer --

  api_: function (method, path, body) {
    var res = UrlFetchApp.fetch(this.API + path, {
      method: method.toLowerCase(),
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: body === null || body === undefined ? undefined : JSON.stringify(body),
      muteHttpExceptions: true
    });
    var status = res.getResponseCode();
    var text = res.getContentText();
    if (status >= 200 && status < 300) {
      return text ? JSON.parse(text) : {};
    }
    throw this.mapApiError_(status, text, method + ' ' + path);
  },

  /** GET project content; null (not throw) when the project is gone. */
  tryGetContent_: function (scriptId) {
    try {
      return this.api_('GET', '/projects/' + scriptId + '/content', null);
    } catch (e) {
      if (e.ncCode === 'TARGET_NOT_FOUND') return null;
      throw e;
    }
  },

  mapApiError_: function (status, text, op) {
    var apiMessage = '';
    try { apiMessage = JSON.parse(text).error.message; } catch (e) { apiMessage = text.slice(0, 300); }

    if (status === 403 && /Apps Script API/i.test(apiMessage)) {
      return NcError_('API_DISABLED',
        'Google Apps Script API belum diaktifkan untuk akun Anda. Buka ' +
        'https://script.google.com/home/usersettings , aktifkan "Google Apps Script API", tunggu ±1 menit, lalu deploy ulang.',
        { op: op, apiMessage: apiMessage });
    }
    if (status === 401 || status === 403) {
      return NcError_('API_FORBIDDEN',
        'Akses ke Apps Script API ditolak (' + status + '). Pastikan Anda menyetujui scope saat membuka builder, ' +
        'dan kebijakan Workspace domain mengizinkan Apps Script API. Detail: ' + apiMessage,
        { op: op });
    }
    if (status === 404) {
      return NcError_('TARGET_NOT_FOUND', 'Resource tidak ditemukan pada ' + op + ' — project target mungkin sudah dihapus. Detail: ' + apiMessage, { op: op });
    }
    if (status === 429) {
      return NcError_('API_QUOTA', 'Kuota Apps Script API tercapai — coba lagi beberapa menit. Detail: ' + apiMessage, { op: op });
    }
    return NcError_('API_ERROR', 'Apps Script API gagal (' + status + ') pada ' + op + ': ' + apiMessage, { op: op });
  }
};

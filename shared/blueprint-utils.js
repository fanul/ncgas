/**
 * NCGAS Blueprint Utils — schema contract, validation and Drive sharding.
 * Environment-agnostic (browser / GAS / Node), same UMD-lite pattern as the
 * expression engine. Rule-expression validation is delegated to
 * NCGASExpression when a reference is passed in.
 *
 * Blueprint tree hierarchy (the AST contract):
 *   App -> meta/globals -> sharedServices/sharedRules -> pages -> settings/layout -> components -> services/rules
 *
 * Sharding contract (one Drive folder per app):
 *   manifest.json            index: meta, page pointers, deploy state  (plain JSON, written LAST = commit marker)
 *   globals.json[.gz]        sharedServices + sharedRules + rbac
 *   page_<pageId>.json[.gz]  settings + layout + components for one page
 */

(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;

  var COMPONENT_EVENTS = ['onClick', 'onChange', 'onBlur', 'onLoad'];
  var SERVICE_TYPES = ['GAS_RPC', 'SHEET_READ', 'SHEET_APPEND', 'REPORT_EXPORT', 'EMAIL_SEND'];
  var LAYOUT_TYPES = ['GRID'];

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter = (uidCounter + 1) % 46656;
    var rand = Math.floor(Math.random() * 46656).toString(36);
    var count = uidCounter.toString(36);
    return prefix + '_' + ('00' + rand).slice(-3) + ('00' + count).slice(-3);
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // ------------------------------------------------------------- factories --

  function createEmptyBlueprint(appId, name) {
    if (!appId || !/^[a-z0-9_]{3,64}$/.test(appId)) {
      throw new Error('[BLUEPRINT] appId must match [a-z0-9_]{3,64}, got: ' + appId);
    }
    var pageId = uid('pg');
    return {
      schemaVersion: SCHEMA_VERSION,
      appId: appId,
      meta: {
        name: name || appId,
        version: '0.1.0',
        lastModified: new Date().toISOString(),
        globalSettings: {
          theme: 'dark',
          authStrategy: 'GOOGLE_WORKSPACE', // GOOGLE_WORKSPACE (domain) | PUBLIC (anonymous)
          homePage: pageId
        }
      },
      rbac: {
        // email -> [roles]; '*' catches everyone else
        roleMap: { '*': ['Employee'] },
        roles: ['Admin', 'HR_Manager', 'Employee']
      },
      sharedServices: {},
      sharedRules: {},
      pages: (function () {
        var pages = {};
        pages[pageId] = createEmptyPage('Home', '/');
        return pages;
      })(),
      deploy: { scriptId: null, deploymentId: null, url: null, lastDeployedVersion: null }
    };
  }

  function createEmptyPage(title, route) {
    return {
      settings: {
        title: title || 'Untitled Page',
        route: route || '/' + uid('r'),
        requireAuth: true,
        allowedRoles: [] // empty = every authenticated role
      },
      layout: {
        type: 'GRID',
        config: { columns: 12, rowGap: '16px', colGap: '16px', maxWidth: '1080px' }
      },
      components: []
    };
  }

  // ------------------------------------------------------------ validation --

  function Validator(bp, expressionEngine) {
    this.bp = bp;
    this.expr = expressionEngine || null;
    this.errors = [];
  }

  Validator.prototype.fail = function (path, message) {
    this.errors.push({ path: path, message: message });
  };

  Validator.prototype.checkExpr = function (path, expr) {
    if (typeof expr !== 'string' || !expr.trim()) {
      this.fail(path, 'Expression must be a non-empty string');
      return;
    }
    if (this.expr) {
      var res = this.expr.validate(expr);
      if (!res.ok) this.fail(path, 'Invalid expression: ' + res.error);
    }
  };

  Validator.prototype.run = function () {
    var bp = this.bp;
    if (!isPlainObject(bp)) { this.fail('$', 'Blueprint must be an object'); return this.errors; }

    if (!bp.appId || !/^[a-z0-9_]{3,64}$/.test(bp.appId)) this.fail('appId', 'appId must match [a-z0-9_]{3,64}');
    if (!isPlainObject(bp.meta)) this.fail('meta', 'meta object is required');
    else {
      if (!bp.meta.name) this.fail('meta.name', 'App name is required');
      if (!isPlainObject(bp.meta.globalSettings)) this.fail('meta.globalSettings', 'globalSettings object is required');
    }

    if (!isPlainObject(bp.rbac) || !isPlainObject(bp.rbac.roleMap)) {
      this.fail('rbac', 'rbac.roleMap object is required (use {"*": ["Employee"]} as a default)');
    }

    var self = this;

    // shared services
    var services = isPlainObject(bp.sharedServices) ? bp.sharedServices : {};
    Object.keys(services).forEach(function (sid) {
      var svc = services[sid];
      var p = 'sharedServices.' + sid;
      if (!/^srv_[a-z0-9_]+$/.test(sid)) self.fail(p, 'Service ids must match srv_[a-z0-9_]+');
      if (!isPlainObject(svc)) { self.fail(p, 'Service must be an object'); return; }
      if (SERVICE_TYPES.indexOf(svc.type) === -1) {
        self.fail(p + '.type', 'Unknown service type `' + svc.type + '`. Allowed: ' + SERVICE_TYPES.join(', '));
      }
      if (svc.type === 'GAS_RPC' && !svc.functionName) self.fail(p + '.functionName', 'GAS_RPC requires functionName');
      if ((svc.type === 'SHEET_READ' || svc.type === 'SHEET_APPEND') && !svc.spreadsheetId) {
        self.fail(p + '.spreadsheetId', svc.type + ' requires spreadsheetId');
      }
      if (svc.allowedRoles && !Array.isArray(svc.allowedRoles)) self.fail(p + '.allowedRoles', 'allowedRoles must be an array');
      if (svc.rules && Array.isArray(svc.rules.execution)) {
        svc.rules.execution.forEach(function (rule, i) {
          self.checkExpr(p + '.rules.execution[' + i + '].condition', rule.condition);
        });
      }
    });

    // shared rules
    var rules = isPlainObject(bp.sharedRules) ? bp.sharedRules : {};
    Object.keys(rules).forEach(function (rid) {
      var p = 'sharedRules.' + rid;
      if (!/^rule_[a-z0-9_]+$/.test(rid)) self.fail(p, 'Rule ids must match rule_[a-z0-9_]+');
      if (!isPlainObject(rules[rid])) { self.fail(p, 'Rule must be an object'); return; }
      self.checkExpr(p + '.expression', rules[rid].expression);
    });

    // pages
    if (!isPlainObject(bp.pages) || Object.keys(bp.pages).length === 0) {
      this.fail('pages', 'At least one page is required');
      return this.errors;
    }

    var seenRoutes = {};
    var seenComponentIds = {};

    Object.keys(bp.pages).forEach(function (pageId) {
      var page = bp.pages[pageId];
      var p = 'pages.' + pageId;
      if (!isPlainObject(page)) { self.fail(p, 'Page must be an object'); return; }
      if (!isPlainObject(page.settings)) { self.fail(p + '.settings', 'settings object is required'); return; }

      var route = page.settings.route;
      if (!route || !/^\/[a-z0-9\-_/]*$/i.test(route)) self.fail(p + '.settings.route', 'Route must start with / and be url-safe');
      else if (seenRoutes[route]) self.fail(p + '.settings.route', 'Duplicate route `' + route + '` (also used by ' + seenRoutes[route] + ')');
      else seenRoutes[route] = pageId;

      if (!isPlainObject(page.layout) || LAYOUT_TYPES.indexOf(page.layout.type) === -1) {
        self.fail(p + '.layout.type', 'Layout type must be one of: ' + LAYOUT_TYPES.join(', '));
      }

      if (!Array.isArray(page.components)) { self.fail(p + '.components', 'components must be an array'); return; }

      page.components.forEach(function (comp, i) {
        var cp = p + '.components[' + i + ']';
        if (!isPlainObject(comp)) { self.fail(cp, 'Component must be an object'); return; }
        if (!comp.id || !/^comp_[a-z0-9_]+$/.test(comp.id)) {
          self.fail(cp + '.id', 'Component ids must match comp_[a-z0-9_]+ (got `' + comp.id + '`)');
        } else if (seenComponentIds[comp.id]) {
          self.fail(cp + '.id', 'Duplicate component id `' + comp.id + '` (also on page ' + seenComponentIds[comp.id] + ')');
        } else {
          seenComponentIds[comp.id] = pageId;
        }
        if (!comp.type) self.fail(cp + '.type', 'Component type is required');

        if (comp.layoutGrid) {
          ['xs', 'md'].forEach(function (bpKey) {
            var span = comp.layoutGrid[bpKey];
            if (span !== undefined && (typeof span !== 'number' || span < 1 || span > 12)) {
              self.fail(cp + '.layoutGrid.' + bpKey, 'Grid span must be a number 1..12');
            }
          });
        }

        // services: event -> { action, inputs }
        if (comp.services) {
          Object.keys(comp.services).forEach(function (event) {
            var sp = cp + '.services.' + event;
            if (COMPONENT_EVENTS.indexOf(event) === -1) {
              self.fail(sp, 'Unknown event `' + event + '`. Allowed: ' + COMPONENT_EVENTS.join(', '));
            }
            var binding = comp.services[event];
            if (!isPlainObject(binding) || !binding.action) { self.fail(sp, 'Service binding needs an `action`'); return; }
            if (binding.action !== 'NAVIGATE' && !services[binding.action]) {
              self.fail(sp + '.action', 'Broken reference: service `' + binding.action + '` is not defined in sharedServices');
            }
            if (binding.inputs && isPlainObject(binding.inputs)) {
              Object.keys(binding.inputs).forEach(function (key) {
                self.checkExpr(sp + '.inputs.' + key, binding.inputs[key]);
              });
            }
          });
        }

        // rules
        if (comp.rules) {
          if (comp.rules.visibility && comp.rules.visibility.condition !== undefined) {
            self.checkExpr(cp + '.rules.visibility.condition', comp.rules.visibility.condition);
          }
          if (comp.rules.validation) {
            if (!Array.isArray(comp.rules.validation)) self.fail(cp + '.rules.validation', 'validation must be an array');
            else comp.rules.validation.forEach(function (rule, ri) {
              self.checkExpr(cp + '.rules.validation[' + ri + '].condition', rule.condition);
              if (!rule.errorMessage) self.fail(cp + '.rules.validation[' + ri + '].errorMessage', 'errorMessage is required');
            });
          }
        }
      });

      // page-level role refs must exist
      (page.settings.allowedRoles || []).forEach(function (role) {
        if (bp.rbac && Array.isArray(bp.rbac.roles) && bp.rbac.roles.indexOf(role) === -1) {
          self.fail(p + '.settings.allowedRoles', 'Unknown role `' + role + '` (declare it in rbac.roles)');
        }
      });
    });

    var home = bp.meta && bp.meta.globalSettings && bp.meta.globalSettings.homePage;
    if (home && !bp.pages[home]) this.fail('meta.globalSettings.homePage', 'homePage points to missing page `' + home + '`');

    return this.errors;
  };

  /** -> { ok: boolean, errors: [{path, message}] } */
  function validateBlueprint(bp, opts) {
    var engine = (opts && opts.expression) || global.NCGASExpression || null;
    var errors = new Validator(bp, engine).run();
    return { ok: errors.length === 0, errors: errors };
  }

  function assertValid(bp, opts) {
    var res = validateBlueprint(bp, opts);
    if (!res.ok) {
      var lines = res.errors.map(function (e) { return '  - ' + e.path + ': ' + e.message; });
      throw new Error('[BLUEPRINT_INVALID] Blueprint failed validation with ' + res.errors.length + ' error(s):\n' + lines.join('\n'));
    }
    return bp;
  }

  // -------------------------------------------------------------- sharding --

  /** Full blueprint -> { manifest, globals, pages: { [pageId]: shard } } */
  function splitIntoShards(bp) {
    assertValid(bp);
    var pages = {};
    Object.keys(bp.pages).forEach(function (pageId) {
      pages[pageId] = deepClone(bp.pages[pageId]);
    });
    return {
      manifest: {
        schemaVersion: bp.schemaVersion || SCHEMA_VERSION,
        appId: bp.appId,
        meta: deepClone(bp.meta),
        pageIds: Object.keys(bp.pages),
        deploy: deepClone(bp.deploy || {})
      },
      globals: {
        rbac: deepClone(bp.rbac || {}),
        sharedServices: deepClone(bp.sharedServices || {}),
        sharedRules: deepClone(bp.sharedRules || {})
      },
      pages: pages
    };
  }

  /** manifest + globals + page shards -> full blueprint. Throws on any missing shard. */
  function mergeShards(manifest, globals, pageShards) {
    if (!isPlainObject(manifest) || !manifest.appId) throw new Error('[SHARD_ERROR] manifest.json is missing or has no appId');
    if (!isPlainObject(globals)) throw new Error('[SHARD_ERROR] globals.json is missing for app ' + manifest.appId);
    var pages = {};
    (manifest.pageIds || []).forEach(function (pageId) {
      if (!isPlainObject(pageShards) || !isPlainObject(pageShards[pageId])) {
        throw new Error('[SHARD_ERROR] Missing page shard `page_' + pageId + '.json` referenced by manifest of ' + manifest.appId);
      }
      pages[pageId] = pageShards[pageId];
    });
    return {
      schemaVersion: manifest.schemaVersion || SCHEMA_VERSION,
      appId: manifest.appId,
      meta: manifest.meta,
      rbac: globals.rbac || { roleMap: { '*': ['Employee'] }, roles: ['Employee'] },
      sharedServices: globals.sharedServices || {},
      sharedRules: globals.sharedRules || {},
      pages: pages,
      deploy: manifest.deploy || {}
    };
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    COMPONENT_EVENTS: COMPONENT_EVENTS,
    SERVICE_TYPES: SERVICE_TYPES,
    uid: uid,
    deepClone: deepClone,
    createEmptyBlueprint: createEmptyBlueprint,
    createEmptyPage: createEmptyPage,
    validateBlueprint: validateBlueprint,
    assertValid: assertValid,
    splitIntoShards: splitIntoShards,
    mergeShards: mergeShards
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NCGASBlueprint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

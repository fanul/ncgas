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
  var SERVICE_TYPES = ['GAS_RPC', 'SHEET_READ', 'SHEET_APPEND', 'SHEET_UPDATE', 'SHEET_DELETE', 'REPORT_EXPORT', 'EMAIL_SEND', 'PDF_EXPORT', 'DRIVE_UPLOAD'];
  var LAYOUT_TYPES = ['GRID'];
  var CRUD_COLUMN_TYPES = ['text', 'number', 'date', 'select', 'rollup', 'computed', 'image'];
  var CRUD_BADGE_COLORS = ['ok', 'warn', 'err', 'dim'];
  var MENU_ITEM_TYPES = ['page', 'group', 'link', 'divider'];
  var CHART_TYPES = ['bar', 'line', 'pie', 'doughnut'];
  var CRUD_FILTER_TYPES = ['text', 'select'];

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
      menu: [], // ordered nav items {id,type:'page'|'group'|'link'|'divider',...} — empty = auto flat menu from pages
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
      if (svc.type && svc.type.indexOf('SHEET_') === 0 && !svc.spreadsheetId) {
        self.fail(p + '.spreadsheetId', svc.type + ' requires spreadsheetId');
      }
      if ((svc.type === 'SHEET_UPDATE' || svc.type === 'SHEET_DELETE') && !svc.keyColumn) {
        self.fail(p + '.keyColumn', svc.type + ' requires keyColumn (the sheet column that uniquely identifies a row)');
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
    var deferredRelatedToChecks = []; // relatedTo.parentComponentId + rollup.fromComponentId refs — resolved after all pages are walked (target may be defined on a later page)

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

        // Explicit 2D grid placement: row (1-based, any positive int), col (1-12),
        // colSpan (1-12), with col+colSpan-1 clamped inside the 12-col grid.
        // Components sharing a row stack left-to-right by col; rows stack top-to-bottom.
        if (!isPlainObject(comp.layoutGrid)) {
          self.fail(cp + '.layoutGrid', 'layoutGrid {row,col,colSpan} is required');
        } else {
          var lg = comp.layoutGrid;
          if (!Number.isInteger(lg.row) || lg.row < 1) self.fail(cp + '.layoutGrid.row', 'row must be a positive integer');
          if (!Number.isInteger(lg.col) || lg.col < 1 || lg.col > 12) self.fail(cp + '.layoutGrid.col', 'col must be an integer 1..12');
          if (!Number.isInteger(lg.colSpan) || lg.colSpan < 1 || lg.colSpan > 12) self.fail(cp + '.layoutGrid.colSpan', 'colSpan must be an integer 1..12');
          if (Number.isInteger(lg.col) && Number.isInteger(lg.colSpan) && lg.col + lg.colSpan - 1 > 12) {
            self.fail(cp + '.layoutGrid', 'col (' + lg.col + ') + colSpan (' + lg.colSpan + ') overflows the 12-column grid');
          }
        }

        // CRUD_TABLE: filter/read/add/edit/delete grid, optionally sheet-backed and/or master-detail linked
        if (comp.type === 'CRUD_TABLE') {
          var cprops = comp.properties || {};
          var pp = cp + '.properties';
          if (['expression', 'sheet', 'local'].indexOf(cprops.dataSource) === -1) {
            self.fail(pp + '.dataSource', 'dataSource must be "expression", "sheet" or "local"');
          }
          if (cprops.dataSource === 'expression' && !cprops.rowsExpression) {
            self.fail(pp + '.rowsExpression', 'rowsExpression is required when dataSource is "expression"');
          }
          if (cprops.dataSource === 'sheet') {
            if (!cprops.keyColumn) self.fail(pp + '.keyColumn', 'keyColumn is required when dataSource is "sheet"');
            ['serviceRead', 'serviceCreate', 'serviceUpdate', 'serviceDelete'].forEach(function (key) {
              if (cprops[key] && !services[cprops[key]]) {
                self.fail(pp + '.' + key, 'Broken reference: service `' + cprops[key] + '` is not defined in sharedServices');
              }
            });
          }
          if (cprops.dataSource === 'local' && !cprops.localKey) {
            self.fail(pp + '.localKey', 'localKey (the state.* key holding the array) is required when dataSource is "local"');
          }
          if (!Array.isArray(cprops.columns) || !cprops.columns.length) {
            self.fail(pp + '.columns', 'At least one column is required');
          } else {
            var seenColKeys = {};
            cprops.columns.forEach(function (col, ci) {
              var colp = pp + '.columns[' + ci + ']';
              if (!col.key) self.fail(colp + '.key', 'Column key is required');
              else if (seenColKeys[col.key]) self.fail(colp + '.key', 'Duplicate column key `' + col.key + '`');
              else seenColKeys[col.key] = true;
              if (col.type && CRUD_COLUMN_TYPES.indexOf(col.type) === -1) {
                self.fail(colp + '.type', 'Column type must be one of: ' + CRUD_COLUMN_TYPES.join(', '));
              }
              if (col.type === 'rollup') {
                var ru = col.rollup;
                if (!isPlainObject(ru) || !ru.fromComponentId || !ru.matchColumn || !ru.statusColumn || !ru.doneValue) {
                  self.fail(colp + '.rollup', 'rollup needs fromComponentId, matchColumn, statusColumn and doneValue');
                } else {
                  deferredRelatedToChecks.push({ path: colp + '.rollup.fromComponentId', parentComponentId: ru.fromComponentId, childId: comp.id });
                  ['doneColor', 'pendingColor', 'emptyColor'].forEach(function (k) {
                    if (ru[k] && CRUD_BADGE_COLORS.indexOf(ru[k]) === -1) {
                      self.fail(colp + '.rollup.' + k, k + ' must be one of: ' + CRUD_BADGE_COLORS.join(', '));
                    }
                  });
                }
              }
              if (col.type === 'computed') {
                self.checkExpr(colp + '.valueExpression', col.valueExpression);
              }
              if (col.type === 'image' && col.uploadService) {
                if (!services[col.uploadService]) {
                  self.fail(colp + '.uploadService', 'Broken reference: service `' + col.uploadService + '` is not defined in sharedServices');
                } else if (services[col.uploadService].type !== 'DRIVE_UPLOAD') {
                  self.fail(colp + '.uploadService', 'uploadService must reference a DRIVE_UPLOAD service');
                }
              }
            });
          }
          if (cprops.filters) {
            if (!Array.isArray(cprops.filters)) self.fail(pp + '.filters', 'filters must be an array');
            else cprops.filters.forEach(function (f, fi) {
              if (f.type && CRUD_FILTER_TYPES.indexOf(f.type) === -1) {
                self.fail(pp + '.filters[' + fi + '].type', 'Filter type must be one of: ' + CRUD_FILTER_TYPES.join(', '));
              }
            });
          }
          if (cprops.relatedTo) {
            var rel = cprops.relatedTo;
            if (!rel.parentComponentId || !rel.parentKeyColumn || !rel.childForeignKeyColumn) {
              self.fail(pp + '.relatedTo', 'relatedTo needs parentComponentId, parentKeyColumn and childForeignKeyColumn');
            } else {
              deferredRelatedToChecks.push({ path: pp + '.relatedTo.parentComponentId', parentComponentId: rel.parentComponentId, childId: comp.id });
            }
          }
        }

        // CHART: bar/line/pie/doughnut fed by two parallel-array expressions.
        if (comp.type === 'CHART') {
          var chp = comp.properties || {};
          var chpp = cp + '.properties';
          if (CHART_TYPES.indexOf(chp.chartType) === -1) {
            self.fail(chpp + '.chartType', 'chartType must be one of: ' + CHART_TYPES.join(', '));
          }
          self.checkExpr(chpp + '.labelsExpression', chp.labelsExpression);
          self.checkExpr(chpp + '.valuesExpression', chp.valuesExpression);
        }

        // FORM_IMAGE_UPLOAD: uploads to Drive via a DRIVE_UPLOAD service, stores the
        // returned serving URL as this component's value.
        if (comp.type === 'FORM_IMAGE_UPLOAD') {
          var fip = comp.properties || {};
          var fipp = cp + '.properties';
          if (!fip.uploadService) {
            self.fail(fipp + '.uploadService', 'uploadService is required');
          } else if (!services[fip.uploadService]) {
            self.fail(fipp + '.uploadService', 'Broken reference: service `' + fip.uploadService + '` is not defined in sharedServices');
          } else if (services[fip.uploadService].type !== 'DRIVE_UPLOAD') {
            self.fail(fipp + '.uploadService', 'uploadService must reference a DRIVE_UPLOAD service (got `' + services[fip.uploadService].type + '`)');
          }
        }

        // PRINT_BUTTON: opens a print-friendly view rendered from an HTML template whose
        // {{...}} tokens are full expressions (escaped on output) — see runtime-core.js.
        if (comp.type === 'PRINT_BUTTON') {
          var pbp = comp.properties || {};
          var ppp = cp + '.properties';
          if (!pbp.htmlTemplate || typeof pbp.htmlTemplate !== 'string') {
            self.fail(ppp + '.htmlTemplate', 'htmlTemplate is required');
          } else {
            var tokenRe = /\{\{\s*([^}]+?)\s*\}\}/g;
            var tm;
            while ((tm = tokenRe.exec(pbp.htmlTemplate)) !== null) {
              if (tm[1] === 'items_table') continue; // reserved marker, not an expression
              self.checkExpr(ppp + '.htmlTemplate[{{' + tm[1] + '}}]', tm[1]);
            }
          }
          if (pbp.itemsExpression) self.checkExpr(ppp + '.itemsExpression', pbp.itemsExpression);
          if (pbp.pdfExportService && !services[pbp.pdfExportService]) {
            self.fail(ppp + '.pdfExportService', 'Broken reference: service `' + pbp.pdfExportService + '` is not defined in sharedServices');
          }
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

    deferredRelatedToChecks.forEach(function (check) {
      if (!seenComponentIds[check.parentComponentId]) {
        self.fail(check.path, 'Broken reference: parent component `' + check.parentComponentId + '` does not exist (referenced by ' + check.childId + ')');
      } else if (check.parentComponentId === check.childId) {
        self.fail(check.path, 'A CRUD_TABLE cannot be related to itself');
      }
    });

    var home = bp.meta && bp.meta.globalSettings && bp.meta.globalSettings.homePage;
    if (home && !bp.pages[home]) this.fail('meta.globalSettings.homePage', 'homePage points to missing page `' + home + '`');

    // menu: ordered nav tree — empty/absent means the runtime synthesizes a flat menu from bp.pages
    if (bp.menu !== undefined) {
      if (!Array.isArray(bp.menu)) {
        this.fail('menu', 'menu must be an array');
      } else {
        var seenMenuIds = {};
        bp.menu.forEach(function (item, i) {
          self.validateMenuItem(item, 'menu[' + i + ']', seenMenuIds, true);
        });
      }
    }

    return this.errors;
  };

  Validator.prototype.validateMenuItem = function (item, path, seenMenuIds, allowGroup) {
    var self = this;
    if (!isPlainObject(item)) { this.fail(path, 'Menu item must be an object'); return; }
    if (!item.id || !/^mi_[a-z0-9_]+$/.test(item.id)) {
      this.fail(path + '.id', 'Menu item ids must match mi_[a-z0-9_]+');
    } else if (seenMenuIds[item.id]) {
      this.fail(path + '.id', 'Duplicate menu item id `' + item.id + '`');
    } else {
      seenMenuIds[item.id] = true;
    }

    var types = allowGroup ? MENU_ITEM_TYPES : MENU_ITEM_TYPES.filter(function (t) { return t !== 'group'; });
    if (types.indexOf(item.type) === -1) {
      this.fail(path + '.type', 'Menu item type must be one of: ' + types.join(', ') + (allowGroup ? '' : ' (groups cannot be nested)'));
      return;
    }

    if (item.type === 'page') {
      if (!item.pageId || !this.bp.pages[item.pageId]) {
        this.fail(path + '.pageId', 'Broken reference: page `' + item.pageId + '` does not exist');
      }
    } else if (item.type === 'link') {
      if (!item.url || typeof item.url !== 'string') this.fail(path + '.url', 'link items require a url');
    } else if (item.type === 'group') {
      if (!Array.isArray(item.children) || !item.children.length) {
        this.fail(path + '.children', 'group items require at least one child');
      } else {
        item.children.forEach(function (child, ci) {
          self.validateMenuItem(child, path + '.children[' + ci + ']', seenMenuIds, false);
        });
      }
    }

    if (item.type !== 'divider' && item.allowedRoles !== undefined) {
      if (!Array.isArray(item.allowedRoles)) this.fail(path + '.allowedRoles', 'allowedRoles must be an array');
      else item.allowedRoles.forEach(function (role) {
        if (self.bp.rbac && Array.isArray(self.bp.rbac.roles) && self.bp.rbac.roles.indexOf(role) === -1) {
          self.fail(path + '.allowedRoles', 'Unknown role `' + role + '` (declare it in rbac.roles)');
        }
      });
    }
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
        sharedRules: deepClone(bp.sharedRules || {}),
        menu: deepClone(bp.menu || [])
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
      menu: globals.menu || [],
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

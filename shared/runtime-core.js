/**
 * NCGAS Runtime Core — the blueprint interpreter.
 *
 * ONE renderer, THREE consumers:
 *   1. Editor canvas (design mode: selection wrappers, hidden-component ghosting)
 *   2. Editor live preview (mock identity + mock RPC)
 *   3. Compiled GAS web app (CDN Vue global + google.script.run RPC)
 *
 * Vue and the expression engine are dependency-injected so this file has zero
 * imports and runs as a plain script in every environment:
 *   const rt = createNCGASRuntime(Vue, NCGASExpression)
 *
 * Rendering is done with Vue `h()` render functions. All dynamic text goes
 * through vnode string children (auto-escaped) — the runtime never touches
 * innerHTML, so blueprint data cannot inject markup.
 */

(function (global) {
  'use strict';

  function createNCGASRuntime(Vue, Expression) {
    if (!Vue || typeof Vue.h !== 'function') throw new Error('[RUNTIME] createNCGASRuntime requires a Vue 3 module/global');
    if (!Expression || typeof Expression.evaluate !== 'function') throw new Error('[RUNTIME] createNCGASRuntime requires the NCGAS expression engine');

    var h = Vue.h;
    var reactive = Vue.reactive;
    var onMounted = Vue.onMounted;

    // ---------------------------------------------------------------- store --

    function createStore(blueprint, user) {
      var store = reactive({
        comps: {},          // componentId -> { value, error, touched, loading }
        state: {},          // service results and app state
        user: user || { email: '', roles: [] },
        currentPageId: (blueprint.meta.globalSettings || {}).homePage || Object.keys(blueprint.pages)[0],
        notice: null        // { type: 'error'|'info'|'success', message }
      });
      Object.keys(blueprint.pages).forEach(function (pageId) {
        initPageState(store, blueprint, pageId);
      });
      return store;
    }

    function initPageState(store, blueprint, pageId) {
      var page = blueprint.pages[pageId];
      if (!page) return;
      (page.components || []).forEach(function (comp) {
        if (!store.comps[comp.id]) {
          var def = comp.properties ? comp.properties.defaultValue : undefined;
          store.comps[comp.id] = { value: def === undefined ? null : def, error: null, touched: false, loading: false };
        }
      });
    }

    // ------------------------------------------------------------- context --
    // ctx = { blueprint, store, rpc, mode: 'design'|'live', design?: {selectedId, onSelect} }

    function buildScope(ctx, selfComp) {
      var scope = {
        state: ctx.store.state,
        user: ctx.store.user,
        self: selfComp ? ctx.store.comps[selfComp.id] : null,
        env: { mode: ctx.mode, page: ctx.store.currentPageId }
      };
      Object.keys(ctx.store.comps).forEach(function (id) { scope[id] = ctx.store.comps[id]; });
      return scope;
    }

    function evalExpr(ctx, expr, selfComp) {
      return Expression.evaluate(expr, buildScope(ctx, selfComp));
    }

    function evalExprSafe(ctx, expr, selfComp, fallback) {
      try { return evalExpr(ctx, expr, selfComp); }
      catch (e) {
        if (ctx.mode === 'design') console.warn('[NCGAS expr] ' + expr + ' -> ' + e.message);
        return fallback;
      }
    }

    // --------------------------------------------------------------- rules --

    /**
     * Visibility contract: no rule -> visible. Rule errors fail CLOSED in live
     * mode (hidden) and OPEN in design mode (shown, with a console warning) so
     * builders can still select and fix the broken component.
     */
    function isVisible(ctx, comp) {
      var rule = comp.rules && comp.rules.visibility && comp.rules.visibility.condition;
      if (!rule) return true;
      try { return !!evalExpr(ctx, rule, comp); }
      catch (e) {
        if (ctx.mode === 'design') { console.warn('[NCGAS visibility] ' + comp.id + ': ' + e.message); return true; }
        console.error('[NCGAS visibility] ' + comp.id + ' failed closed: ' + e.message);
        return false;
      }
    }

    /** Validation contract: condition describes the VALID state; falsy => errorMessage. */
    function runValidation(ctx, comp, trigger) {
      var rules = (comp.rules && comp.rules.validation) || [];
      var entry = ctx.store.comps[comp.id];
      var firstError = null;
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (trigger && rule.trigger && rule.trigger !== trigger) continue;
        var ok;
        try { ok = !!evalExpr(ctx, rule.condition, comp); }
        catch (e) { ok = false; firstError = firstError || ('Rule error: ' + e.message); }
        if (!ok) { firstError = firstError || rule.errorMessage || 'Invalid value'; break; }
      }
      entry.error = firstError;
      return firstError === null;
    }

    function validatePage(ctx) {
      var page = ctx.blueprint.pages[ctx.store.currentPageId];
      var allOk = true;
      (page.components || []).forEach(function (comp) {
        if (comp.rules && comp.rules.validation && comp.rules.validation.length && isVisible(ctx, comp)) {
          ctx.store.comps[comp.id].touched = true;
          if (!runValidation(ctx, comp, null)) allOk = false;
        }
      });
      return allOk;
    }

    // ------------------------------------------------------------ services --

    var memCache = {};
    function cacheKey(appId, serviceId, inputs) {
      return 'ncgas.cache.' + appId + '.' + serviceId + '.' + JSON.stringify(inputs || {});
    }
    function cacheStore() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('ncgas.cache.__probe', '1');
          localStorage.removeItem('ncgas.cache.__probe');
          return localStorage;
        }
      } catch (e) { /* sandboxed iframe without storage */ }
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(memCache, k) ? memCache[k] : null; },
        setItem: function (k, v) { memCache[k] = v; },
        removeItem: function (k) { delete memCache[k]; }
      };
    }
    function cacheTtlMs(policy) {
      // e.g. LOCAL_STORAGE_5M / LOCAL_STORAGE_30S / LOCAL_STORAGE_2H
      var m = /^LOCAL_STORAGE_(\d+)([SMH])$/.exec(policy || '');
      if (!m) return 0;
      var mult = m[2] === 'S' ? 1000 : m[2] === 'M' ? 60000 : 3600000;
      return parseInt(m[1], 10) * mult;
    }

    function runEvent(ctx, comp, event) {
      var binding = comp.services && comp.services[event];
      if (!binding) return Promise.resolve(null);

      // built-in action: navigation
      if (binding.action === 'NAVIGATE') {
        navigate(ctx, binding.to);
        return Promise.resolve(null);
      }

      var service = ctx.blueprint.sharedServices[binding.action];
      if (!service) {
        setNotice(ctx, 'error', 'Broken reference: service `' + binding.action + '` does not exist');
        return Promise.reject(new Error('SERVICE_NOT_FOUND: ' + binding.action));
      }

      if (binding.validateFirst && !validatePage(ctx)) {
        setNotice(ctx, 'error', 'Periksa kembali isian yang ditandai merah.');
        return Promise.reject(new Error('VALIDATION_FAILED'));
      }

      // resolve declared inputs: every value is an expression evaluated client-side
      var inputs = {};
      var inputDefs = binding.inputs || {};
      try {
        Object.keys(inputDefs).forEach(function (key) {
          inputs[key] = evalExpr(ctx, inputDefs[key], comp);
        });
      } catch (e) {
        setNotice(ctx, 'error', 'Input mapping failed for ' + binding.action + ': ' + e.message);
        return Promise.reject(e);
      }

      var resultKey = binding.resultKey || binding.action;
      var ttl = cacheTtlMs(service.cachePolicy);
      var storeApi = cacheStore();
      var key = cacheKey(ctx.blueprint.appId, binding.action, inputs);

      if (ttl > 0) {
        var raw = storeApi.getItem(key);
        if (raw) {
          try {
            var hit = JSON.parse(raw);
            if (hit.exp > Date.now()) {
              ctx.store.state[resultKey] = hit.data;
              return Promise.resolve(hit.data);
            }
            storeApi.removeItem(key);
          } catch (e) { storeApi.removeItem(key); }
        }
      }

      var entry = ctx.store.comps[comp.id];
      if (entry) entry.loading = true;

      return ctx.rpc('runService', { serviceId: binding.action, inputs: inputs })
        .then(function (data) {
          ctx.store.state[resultKey] = data;
          if (ttl > 0) {
            try { storeApi.setItem(key, JSON.stringify({ exp: Date.now() + ttl, data: data })); } catch (e) { /* quota */ }
          }
          if (binding.successMessage) setNotice(ctx, 'success', binding.successMessage);
          return data;
        })
        .catch(function (err) {
          setNotice(ctx, 'error', (err && err.message) || 'Service call failed: ' + binding.action);
          throw err;
        })
        .then(function (data) { if (entry) entry.loading = false; return data; },
              function (err) { if (entry) entry.loading = false; throw err; });
    }

    function setNotice(ctx, type, message) {
      ctx.store.notice = { type: type, message: String(message) };
    }

    function userCanSeePage(ctx, pageId) {
      var page = ctx.blueprint.pages[pageId];
      if (!page) return false;
      var allowed = page.settings.allowedRoles || [];
      if (!allowed.length) return true;
      var roles = ctx.store.user.roles || [];
      return allowed.some(function (r) { return roles.indexOf(r) !== -1; });
    }

    function navigate(ctx, target) {
      // target may be a pageId or a route
      var pages = ctx.blueprint.pages;
      var pageId = pages[target] ? target : null;
      if (!pageId) {
        Object.keys(pages).forEach(function (pid) {
          if (pages[pid].settings.route === target) pageId = pid;
        });
      }
      if (!pageId) { setNotice(ctx, 'error', 'Navigation target not found: ' + target); return; }
      if (ctx.mode === 'live' && !userCanSeePage(ctx, pageId)) {
        setNotice(ctx, 'error', 'Akses ditolak: Anda tidak memiliki peran untuk halaman ini.');
        return;
      }
      initPageState(ctx.store, ctx.blueprint, pageId);
      ctx.store.currentPageId = pageId;
    }

    // ---------------------------------------------------------- renderers --

    function label(comp) {
      var p = comp.properties || {};
      return p.label ? h('label', { class: 'nc-label', for: comp.id }, p.label) : null;
    }

    function fieldError(ctx, comp) {
      var entry = ctx.store.comps[comp.id];
      return entry && entry.error
        ? h('div', { class: 'nc-error' }, entry.error)
        : null;
    }

    function inputHandlers(ctx, comp, cast) {
      var entry = ctx.store.comps[comp.id];
      return {
        onInput: function (e) {
          entry.value = cast ? cast(e.target.value) : e.target.value;
          entry.touched = true;
          runValidation(ctx, comp, 'onChange');
          runEvent(ctx, comp, 'onChange');
        },
        onBlur: function () {
          runValidation(ctx, comp, 'onBlur');
          runEvent(ctx, comp, 'onBlur');
        }
      };
    }

    function textOf(ctx, comp, fallbackKey) {
      var p = comp.properties || {};
      if (p.textExpression) {
        var v = evalExprSafe(ctx, p.textExpression, comp, '⚠ ' + p.textExpression);
        return v === null || v === undefined ? '' : String(v);
      }
      return String(p[fallbackKey || 'text'] || '');
    }

    var renderers = {
      HEADING: function (ctx, comp) {
        var level = Math.min(4, Math.max(1, (comp.properties || {}).level || 2));
        return h('h' + level, { class: 'nc-heading' }, textOf(ctx, comp));
      },

      TEXT: function (ctx, comp) {
        return h('p', { class: 'nc-text' }, textOf(ctx, comp));
      },

      KPI_CARD: function (ctx, comp) {
        var p = comp.properties || {};
        var value = p.valueExpression ? evalExprSafe(ctx, p.valueExpression, comp, '—') : (p.value || '—');
        return h('div', { class: 'nc-kpi' }, [
          h('div', { class: 'nc-kpi-label' }, String(p.label || '')),
          h('div', { class: 'nc-kpi-value' }, String(value))
        ]);
      },

      DIVIDER: function () { return h('hr', { class: 'nc-divider' }); },

      FORM_INPUT_TEXT: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        return h('div', { class: 'nc-field' }, [
          label(comp),
          h('input', Object.assign({
            id: comp.id, class: 'nc-input', type: 'text',
            value: entry.value === null ? '' : entry.value,
            placeholder: p.placeholder || '', disabled: ctx.mode === 'design'
          }, inputHandlers(ctx, comp, null))),
          fieldError(ctx, comp)
        ]);
      },

      FORM_INPUT_NUMBER: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        return h('div', { class: 'nc-field' }, [
          label(comp),
          h('input', Object.assign({
            id: comp.id, class: 'nc-input', type: 'number',
            value: entry.value === null ? '' : entry.value,
            placeholder: p.placeholder || '', disabled: ctx.mode === 'design'
          }, inputHandlers(ctx, comp, function (v) { return v === '' ? null : Number(v); })),
          ),
          fieldError(ctx, comp)
        ]);
      },

      FORM_INPUT_DATE: function (ctx, comp) {
        var entry = ctx.store.comps[comp.id];
        return h('div', { class: 'nc-field' }, [
          label(comp),
          h('input', Object.assign({
            id: comp.id, class: 'nc-input', type: 'date',
            value: entry.value === null ? '' : entry.value, disabled: ctx.mode === 'design'
          }, inputHandlers(ctx, comp, null))),
          fieldError(ctx, comp)
        ]);
      },

      FORM_SELECT: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        var options = p.optionsExpression
          ? (evalExprSafe(ctx, p.optionsExpression, comp, []) || [])
          : (p.options || []);
        if (!Array.isArray(options)) options = [];
        return h('div', { class: 'nc-field' }, [
          label(comp),
          h('select', Object.assign({
            id: comp.id, class: 'nc-input', disabled: ctx.mode === 'design',
            value: entry.value === null ? '' : entry.value
          }, {
            onChange: function (e) {
              entry.value = e.target.value;
              entry.touched = true;
              runValidation(ctx, comp, 'onChange');
              runEvent(ctx, comp, 'onChange');
            }
          }), [h('option', { value: '', disabled: true }, p.placeholder || 'Pilih...')].concat(
            options.map(function (opt) {
              var val = opt && typeof opt === 'object' ? opt.value : opt;
              var lbl = opt && typeof opt === 'object' ? (opt.label !== undefined ? opt.label : opt.value) : opt;
              return h('option', { value: String(val) }, String(lbl));
            })
          )),
          fieldError(ctx, comp)
        ]);
      },

      FORM_CHECKBOX: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        return h('div', { class: 'nc-field nc-field-inline' }, [
          h('input', {
            id: comp.id, class: 'nc-checkbox', type: 'checkbox',
            checked: !!entry.value, disabled: ctx.mode === 'design',
            onChange: function (e) {
              entry.value = e.target.checked;
              entry.touched = true;
              runValidation(ctx, comp, 'onChange');
              runEvent(ctx, comp, 'onChange');
            }
          }),
          h('label', { class: 'nc-label nc-label-inline', for: comp.id }, String(p.label || '')),
          fieldError(ctx, comp)
        ]);
      },

      BUTTON: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        var variant = p.variant === 'secondary' ? 'nc-btn nc-btn-secondary' : 'nc-btn';
        return h('button', {
          class: variant,
          disabled: ctx.mode === 'design' || (entry && entry.loading),
          onClick: function () { runEvent(ctx, comp, 'onClick'); }
        }, entry && entry.loading ? 'Memproses…' : String(p.label || 'Button'));
      },

      DATA_TABLE: function (ctx, comp) {
        var p = comp.properties || {};
        var rows = p.rowsExpression ? evalExprSafe(ctx, p.rowsExpression, comp, null) : (p.rows || []);
        var broken = rows === null;
        if (!Array.isArray(rows)) rows = [];
        var columns = p.columns && p.columns.length
          ? p.columns
          : (rows[0] ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : []);
        return h('div', { class: 'nc-table-wrap' }, [
          p.title ? h('div', { class: 'nc-table-title' }, String(p.title)) : null,
          h('table', { class: 'nc-table' }, [
            h('thead', h('tr', columns.map(function (c) { return h('th', String(c.label || c.key)); }))),
            h('tbody', rows.length
              ? rows.map(function (row) {
                  return h('tr', columns.map(function (c) {
                    var v = row && typeof row === 'object' ? row[c.key] : undefined;
                    return h('td', v === null || v === undefined ? '' : String(v));
                  }));
                })
              : [h('tr', h('td', { colspan: Math.max(1, columns.length), class: 'nc-table-empty' },
                  broken ? '⚠ rowsExpression error — check console' : (p.emptyText || 'Belum ada data')))])
          ])
        ]);
      }
    };

    var KNOWN_TYPES = Object.keys(renderers);

    // --------------------------------------------------- component wrapper --

    function gridStyle(comp, columns) {
      var span = (comp.layoutGrid && (comp.layoutGrid.md || comp.layoutGrid.xs)) || columns || 12;
      return { gridColumn: 'span ' + Math.min(span, columns || 12) };
    }

    /**
     * Renders one component including its grid cell. In design mode the cell
     * gets selection affordances and hidden components render "ghosted" instead
     * of disappearing (so builders can still click and fix them).
     */
    function renderComponent(ctx, comp, pageColumns) {
      var visible = isVisible(ctx, comp);
      if (!visible && ctx.mode !== 'design') return null;

      var renderer = renderers[comp.type];
      var body = renderer
        ? renderer(ctx, comp)
        : h('div', { class: 'nc-unknown' }, 'Unknown component type `' + String(comp.type) + '`. Known: ' + KNOWN_TYPES.join(', '));

      var design = ctx.design;
      var cellProps = {
        class: ['nc-cell',
          design ? 'nc-cell-design' : '',
          design && design.selectedId === comp.id ? 'nc-cell-selected' : '',
          design && !visible ? 'nc-cell-ghost' : ''
        ].filter(Boolean).join(' '),
        style: gridStyle(comp, pageColumns),
        'data-comp-id': comp.id
      };
      if (design) {
        cellProps.onClick = function (e) { e.stopPropagation(); design.onSelect(comp.id); };
      }

      var children = [body];
      if (design) {
        children.unshift(h('div', { class: 'nc-cell-tag' },
          comp.id + (visible ? '' : '  · hidden by rule')));
      }
      return h('div', cellProps, children);
    }

    // ------------------------------------------------------------ RuntimePage --

    var RuntimePage = {
      name: 'NcRuntimePage',
      props: { ctx: { type: Object, required: true } },
      setup: function (props) {
        onMounted(function () {
          firePageLoad(props.ctx);
        });
        return function () {
          var ctx = props.ctx;
          var page = ctx.blueprint.pages[ctx.store.currentPageId];
          if (!page) return h('div', { class: 'nc-unknown' }, 'Page not found: ' + ctx.store.currentPageId);
          var cols = (page.layout && page.layout.config && page.layout.config.columns) || 12;
          var cfg = (page.layout && page.layout.config) || {};
          return h('div', {
            class: 'nc-page',
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(' + cols + ', 1fr)',
              rowGap: cfg.rowGap || '16px',
              columnGap: cfg.colGap || '16px',
              maxWidth: cfg.maxWidth || '1080px'
            }
          }, (page.components || []).map(function (comp) {
            return renderComponent(ctx, comp, cols);
          }));
        };
      }
    };

    function firePageLoad(ctx) {
      var page = ctx.blueprint.pages[ctx.store.currentPageId];
      if (!page) return;
      (page.components || []).forEach(function (comp) {
        if (comp.services && comp.services.onLoad && ctx.mode !== 'design') {
          runEvent(ctx, comp, 'onLoad');
        }
      });
    }

    // ------------------------------------------------------------ RuntimeApp --
    // Full standalone app shell (used by compiled apps): topbar with page nav,
    // notice banner, current page.

    var RuntimeApp = {
      name: 'NcRuntimeApp',
      props: { ctx: { type: Object, required: true } },
      setup: function (props) {
        return function () {
          var ctx = props.ctx;
          var bp = ctx.blueprint;
          var pageIds = Object.keys(bp.pages).filter(function (pid) { return userCanSeePage(ctx, pid); });
          var notice = ctx.store.notice;
          return h('div', { class: 'nc-app nc-theme-' + ((bp.meta.globalSettings || {}).theme || 'dark') }, [
            h('header', { class: 'nc-topbar' }, [
              h('div', { class: 'nc-topbar-title' }, String(bp.meta.name || bp.appId)),
              h('nav', { class: 'nc-topbar-nav' }, pageIds.map(function (pid) {
                return h('button', {
                  class: 'nc-nav-link' + (pid === ctx.store.currentPageId ? ' nc-nav-active' : ''),
                  onClick: function () { navigate(ctx, pid); firePageLoad(ctx); }
                }, String(bp.pages[pid].settings.title));
              })),
              h('div', { class: 'nc-topbar-user' }, ctx.store.user.email || 'anonymous')
            ]),
            notice ? h('div', { class: 'nc-notice nc-notice-' + notice.type, onClick: function () { ctx.store.notice = null; } },
              [String(notice.message), h('span', { class: 'nc-notice-x' }, ' ✕')]) : null,
            h('main', { class: 'nc-main' }, h(RuntimePage, { ctx: ctx, key: ctx.store.currentPageId }))
          ]);
        };
      }
    };

    /** Boot a standalone runtime app (compiled apps call this). */
    function mountApp(options) {
      var blueprint = options.blueprint;
      var store = createStore(blueprint, options.user);
      var ctx = { blueprint: blueprint, store: store, rpc: options.rpc, mode: 'live', design: null };
      var app = Vue.createApp({ render: function () { return h(RuntimeApp, { ctx: ctx }); } });
      app.mount(options.mount || '#app');
      return { app: app, ctx: ctx };
    }

    return {
      createStore: createStore,
      initPageState: initPageState,
      buildScope: buildScope,
      evalExpr: evalExpr,
      evalExprSafe: evalExprSafe,
      isVisible: isVisible,
      runValidation: runValidation,
      validatePage: validatePage,
      runEvent: runEvent,
      navigate: navigate,
      userCanSeePage: userCanSeePage,
      renderComponent: renderComponent,
      firePageLoad: firePageLoad,
      RuntimePage: RuntimePage,
      RuntimeApp: RuntimeApp,
      mountApp: mountApp,
      KNOWN_TYPES: KNOWN_TYPES
    };
  }

  var api = { createNCGASRuntime: createNCGASRuntime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NCGASRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

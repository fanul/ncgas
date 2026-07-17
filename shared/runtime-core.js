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
 * through vnode string children (auto-escaped). The one deliberate exception
 * is PRINT_BUTTON's receipt view: its `htmlTemplate` is builder-authored (same
 * trust level as EMAIL_SEND's HTML template, already shipped server-side) and
 * every `{{expression}}` token inside it is evaluated then HTML-escaped before
 * substitution — so end-user/state DATA can never inject markup, only the
 * static tag structure the builder wrote at design time can. See
 * interpolateTemplate() / buildItemsTableHtml().
 */

(function (global) {
  'use strict';

  function createNCGASRuntime(Vue, Expression) {
    if (!Vue || typeof Vue.h !== 'function') throw new Error('[RUNTIME] createNCGASRuntime requires a Vue 3 module/global');
    if (!Expression || typeof Expression.evaluate !== 'function') throw new Error('[RUNTIME] createNCGASRuntime requires the NCGAS expression engine');

    var h = Vue.h;
    var reactive = Vue.reactive;
    var onMounted = Vue.onMounted;
    var onUnmounted = Vue.onUnmounted;
    var ref = Vue.ref;
    var watch = Vue.watch;

    // ---------------------------------------------------------------- store --

    function createStore(blueprint, user) {
      var store = reactive({
        comps: {},          // componentId -> { value, error, touched, loading }
        state: {},          // service results and app state
        user: user || { email: '', roles: [] },
        currentPageId: (blueprint.meta.globalSettings || {}).homePage || Object.keys(blueprint.pages)[0],
        notice: null,       // { type: 'error'|'info'|'success', message }
        menuExpanded: {}    // sidebar UI state: groupId -> bool
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
          store.comps[comp.id] = {
            value: def === undefined ? null : def, error: null, touched: false, loading: false,
            // CRUD_TABLE-only fields — harmless on every other component type:
            rows: [], filters: {}, search: '', modal: null, confirmDeleteId: null, selectedRowKey: null,
            // FORM_SELECT (searchable variant) only:
            searchQuery: '', dropdownOpen: false,
            // PRINT_BUTTON only:
            printOpen: false, printHtml: ''
          };
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

    /** Like evalExprSafe, but also exposes `row` in scope — for computed table/CRUD_TABLE columns. */
    function evalExprWithRowSafe(ctx, expr, selfComp, row, fallback) {
      try {
        var scope = buildScope(ctx, selfComp);
        scope.row = row;
        return Expression.evaluate(expr, scope);
      } catch (e) {
        if (ctx.mode === 'design') console.warn('[NCGAS expr] ' + expr + ' -> ' + e.message);
        return fallback;
      }
    }

    function shortLocalId() {
      return 'l' + Math.random().toString(36).slice(2, 10);
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * PRINT_BUTTON templating: every {{...}} is a full expression, evaluated
     * against the normal component scope and HTML-escaped — except the
     * literal marker {{items_table}}, which substitutes pre-built, already-
     * escaped table markup from extraTokens (see buildItemsTableHtml).
     */
    function interpolateTemplate(ctx, template, comp, extraTokens) {
      return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (_, inner) {
        if (extraTokens && Object.prototype.hasOwnProperty.call(extraTokens, inner)) return extraTokens[inner];
        var val = evalExprSafe(ctx, inner, comp, '');
        return escapeHtml(val === null || val === undefined ? '' : String(val));
      });
    }

    /** Renders properties.itemsExpression as an escaped HTML <table>, for the {{items_table}} marker. */
    function buildItemsTableHtml(ctx, comp, p) {
      if (!p.itemsExpression) return '';
      var rows = evalExprSafe(ctx, p.itemsExpression, comp, []);
      if (!Array.isArray(rows)) rows = [];
      var columns = (p.itemColumns && p.itemColumns.length)
        ? p.itemColumns
        : (rows[0] ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : []);
      var head = columns.map(function (c) { return '<th>' + escapeHtml(c.label || c.key) + '</th>'; }).join('');
      var body = rows.map(function (row) {
        return '<tr>' + columns.map(function (c) {
          var v = row ? row[c.key] : '';
          return '<td>' + escapeHtml(v === null || v === undefined ? '' : String(v)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      if (!rows.length) return '<p class="nc-print-empty">Tidak ada item.</p>';
      return '<table class="nc-print-items"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    }

    function openPrint(ctx, comp) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];
      var itemsHtml = buildItemsTableHtml(ctx, comp, p);
      entry.printHtml = interpolateTemplate(ctx, p.htmlTemplate, comp, { items_table: itemsHtml });
      entry.printOpen = true;
    }

    function closePrint(ctx, comp) {
      ctx.store.comps[comp.id].printOpen = false;
    }

    function savePrintAsPdf(ctx, comp) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];
      if (!p.pdfExportService) { setNotice(ctx, 'error', 'Layanan PDF belum diatur untuk tombol ini.'); return Promise.resolve(); }
      return ctx.rpc('runService', { serviceId: p.pdfExportService, inputs: { html: entry.printHtml, fileName: p.title || comp.id } })
        .then(function (result) {
          setNotice(ctx, 'success', 'PDF tersimpan' + (result && result.url ? ': ' + result.url : '.'));
          return result;
        })
        .catch(function (err) {
          setNotice(ctx, 'error', (err && err.message) || 'Gagal menyimpan PDF.');
        });
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

    // -------------------------------------------------------- CRUD_TABLE --
    // Filter -> read -> add/edit/delete, optionally sheet-backed and/or
    // master-detail linked. See runtime-core CRUD_TABLE renderer below for
    // how these primitives compose into the actual UI.

    function distinctValues(rows, key) {
      var seen = {};
      var out = [];
      (rows || []).forEach(function (row) {
        var v = row ? row[key] : undefined;
        if (v === undefined || v === null || v === '') return;
        var s = String(v);
        if (!seen[s]) { seen[s] = true; out.push(s); }
      });
      return out.sort();
    }

    /**
     * Rollup column: derives a colored status badge for `row` by aggregating
     * another CRUD_TABLE's already-loaded rows — e.g. a Proyek row turns green
     * "Selesai" once every one of its Tugas children has selesai === 'Ya'.
     * Purely a read of trusted runtime state, not a user expression, so this
     * needs no expression-engine involvement. Requires the child component to
     * have been visited/loaded at least once (usually: present on the same
     * page) — falls back to the "empty" badge, never throws, if it hasn't.
     */
    function computeRollup(ctx, comp, col, row) {
      var ru = col.rollup || {};
      var childEntry = ctx.store.comps[ru.fromComponentId];
      var childRows = (childEntry && childEntry.rows) || [];
      var keyValue = row[crudKeyColumn(comp)];
      var matches = childRows.filter(function (cr) {
        return cr && String(cr[ru.matchColumn]) === String(keyValue);
      });
      if (!matches.length) return { label: ru.emptyLabel || '—', color: ru.emptyColor || 'dim' };
      var allDone = matches.every(function (cr) { return String(cr[ru.statusColumn]) === String(ru.doneValue); });
      return allDone
        ? { label: ru.doneLabel || 'Selesai', color: ru.doneColor || 'ok' }
        : { label: ru.pendingLabel || 'Berjalan', color: ru.pendingColor || 'warn' };
    }

    /** Loads (or reloads) a sheet-backed CRUD_TABLE's rows from its read service. */
    function loadCrudRows(ctx, comp) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];
      if (p.dataSource !== 'sheet' || !p.serviceRead) return Promise.resolve();
      entry.loading = true;
      return ctx.rpc('runService', { serviceId: p.serviceRead, inputs: {} })
        .then(function (data) {
          entry.rows = Array.isArray(data) ? data : [];
          entry.loading = false;
        })
        .catch(function (err) {
          entry.loading = false;
          setNotice(ctx, 'error', (err && err.message) || ('Gagal memuat data untuk ' + comp.id));
        });
    }

    /** The value of the parent CRUD_TABLE's currently-selected row key, or undefined if none/not linked. */
    function parentSelectedKey(ctx, comp) {
      var rel = comp.properties && comp.properties.relatedTo;
      if (!rel) return undefined;
      var parentEntry = ctx.store.comps[rel.parentComponentId];
      return parentEntry ? parentEntry.selectedRowKey : undefined;
    }

    /** Applies master-detail scoping, per-column filters, and free-text search. Never mutates `rows`. */
    function applyCrudFilters(ctx, comp, rows) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];
      var out = rows;

      if (p.relatedTo) {
        var parentKey = parentSelectedKey(ctx, comp);
        if (parentKey === undefined || parentKey === null || parentKey === '') return { rows: [], needsParent: true };
        out = out.filter(function (row) { return row && String(row[p.relatedTo.childForeignKeyColumn]) === String(parentKey); });
      }

      (p.filters || []).forEach(function (f) {
        var val = entry.filters[f.key];
        if (val === undefined || val === null || val === '') return;
        out = out.filter(function (row) {
          var cell = row ? row[f.key] : undefined;
          if (f.type === 'select') return String(cell) === String(val);
          return String(cell === undefined || cell === null ? '' : cell).toLowerCase().indexOf(String(val).toLowerCase()) !== -1;
        });
      });

      if (p.searchable && entry.search) {
        var needle = entry.search.toLowerCase();
        out = out.filter(function (row) {
          return (p.columns || []).some(function (c) {
            var cell = row ? row[c.key] : undefined;
            return String(cell === undefined || cell === null ? '' : cell).toLowerCase().indexOf(needle) !== -1;
          });
        });
      }

      return { rows: out, needsParent: false };
    }

    /** local mode's row identity is always the auto-stamped _localId, regardless of properties.keyColumn. */
    function crudKeyColumn(comp) {
      return comp.properties.dataSource === 'local' ? '_localId' : comp.properties.keyColumn;
    }

    /** local mode's backing array lives at ctx.store.state[localKey], created lazily on first write. */
    function localCrudArray(ctx, comp) {
      var key = comp.properties.localKey;
      if (!Array.isArray(ctx.store.state[key])) ctx.store.state[key] = [];
      return ctx.store.state[key];
    }

    function openCrudAdd(ctx, comp) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];
      var record = {};
      (p.columns || []).forEach(function (c) {
        if (c.type === 'rollup' || c.type === 'computed') return; // derived at display time, never a real field
        record[c.key] = c.defaultValue !== undefined ? c.defaultValue : '';
      });
      if (p.relatedTo) record[p.relatedTo.childForeignKeyColumn] = parentSelectedKey(ctx, comp);
      entry.modal = { mode: 'add', record: record, errors: {}, saving: false, uploading: false };
    }

    function openCrudEdit(ctx, comp, row) {
      ctx.store.comps[comp.id].modal = { mode: 'edit', record: Object.assign({}, row), errors: {}, saving: false, uploading: false };
    }

    function closeCrudModal(ctx, comp) {
      ctx.store.comps[comp.id].modal = null;
    }

    function validateCrudRecord(comp, record) {
      var errors = {};
      ((comp.properties || {}).columns || []).forEach(function (c) {
        if (c.type === 'rollup' || c.type === 'computed') return;
        if (c.required && (record[c.key] === '' || record[c.key] === null || record[c.key] === undefined)) {
          errors[c.key] = (c.label || c.key) + ' wajib diisi';
        }
      });
      return errors;
    }

    function saveCrudRecord(ctx, comp) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];
      var modal = entry.modal;
      if (!modal) return Promise.resolve();
      var errors = validateCrudRecord(comp, modal.record);
      if (Object.keys(errors).length) { modal.errors = errors; return Promise.resolve(); }

      var isEdit = modal.mode === 'edit';

      if (p.dataSource === 'local') {
        var arr = localCrudArray(ctx, comp);
        if (isEdit) {
          var existing = arr.find(function (r) { return r._localId === modal.record._localId; });
          if (existing) Object.assign(existing, modal.record);
        } else {
          arr.push(Object.assign({}, modal.record, { _localId: shortLocalId() }));
        }
        entry.modal = null;
        setNotice(ctx, 'success', isEdit ? 'Data diperbarui.' : 'Data ditambahkan.');
        return Promise.resolve();
      }

      var serviceId = isEdit ? p.serviceUpdate : p.serviceCreate;
      if (!serviceId) {
        modal.errors = { _form: 'Service ' + (isEdit ? 'update' : 'create') + ' belum diatur untuk tabel ini.' };
        return Promise.resolve();
      }

      modal.saving = true;
      // SHEET_APPEND (create) takes the record fields flat, matching its existing contract
      // (used by non-CRUD forms too); SHEET_UPDATE is new and needs {key, record} to locate the row.
      var inputs = isEdit ? { key: modal.record[p.keyColumn], record: modal.record } : modal.record;
      return ctx.rpc('runService', { serviceId: serviceId, inputs: inputs })
        .then(function () {
          modal.saving = false;
          entry.modal = null;
          setNotice(ctx, 'success', isEdit ? 'Data diperbarui.' : 'Data ditambahkan.');
          return loadCrudRows(ctx, comp);
        })
        .catch(function (err) {
          modal.saving = false;
          modal.errors = { _form: (err && err.message) || 'Gagal menyimpan data.' };
        });
    }

    function requestCrudDelete(ctx, comp, keyValue) {
      ctx.store.comps[comp.id].confirmDeleteId = keyValue;
    }
    function cancelCrudDelete(ctx, comp) {
      ctx.store.comps[comp.id].confirmDeleteId = null;
    }
    function confirmCrudDelete(ctx, comp, keyValue) {
      var p = comp.properties || {};
      var entry = ctx.store.comps[comp.id];

      if (p.dataSource === 'local') {
        var arr = localCrudArray(ctx, comp);
        var idx = arr.findIndex(function (r) { return r._localId === keyValue; });
        if (idx !== -1) arr.splice(idx, 1);
        entry.confirmDeleteId = null;
        if (entry.selectedRowKey === keyValue) entry.selectedRowKey = null;
        setNotice(ctx, 'success', 'Data dihapus.');
        return Promise.resolve();
      }

      if (!p.serviceDelete) { setNotice(ctx, 'error', 'Service delete belum diatur untuk tabel ini.'); return Promise.resolve(); }
      entry.loading = true;
      return ctx.rpc('runService', { serviceId: p.serviceDelete, inputs: { key: keyValue } })
        .then(function () {
          entry.confirmDeleteId = null;
          if (entry.selectedRowKey === keyValue) entry.selectedRowKey = null;
          setNotice(ctx, 'success', 'Data dihapus.');
          return loadCrudRows(ctx, comp);
        })
        .catch(function (err) {
          entry.loading = false;
          entry.confirmDeleteId = null;
          setNotice(ctx, 'error', (err && err.message) || 'Gagal menghapus data.');
        });
    }

    function selectCrudRow(ctx, comp, keyValue) {
      var entry = ctx.store.comps[comp.id];
      entry.selectedRowKey = entry.selectedRowKey === keyValue ? null : keyValue;
    }

    /** Modal overlay for add/edit — fields auto-generated from properties.columns. */
    function renderCrudModal(ctx, comp, entry) {
      var p = comp.properties || {};
      var modal = entry.modal;
      var formCols = (p.columns || []).filter(function (c) { return c.showInForm !== false && c.type !== 'rollup' && c.type !== 'computed'; });

      var fields = formCols.map(function (c) {
        var isFk = p.relatedTo && c.key === p.relatedTo.childForeignKeyColumn;
        var disabled = c.editable === false || isFk;
        var value = modal.record[c.key];
        var inputEl;
        if (c.type === 'select') {
          var opts = c.options || [];
          inputEl = h('select', {
            class: 'ed-input', disabled: disabled,
            value: value === null || value === undefined ? '' : value,
            onChange: function (e) { modal.record[c.key] = e.target.value; }
          }, [h('option', { value: '' }, 'Pilih...')].concat(opts.map(function (o) {
            var v2 = o && typeof o === 'object' ? o.value : o;
            var l2 = o && typeof o === 'object' ? (o.label !== undefined ? o.label : o.value) : o;
            return h('option', { value: String(v2) }, String(l2));
          })));
        } else if (c.type === 'image' && c.uploadService) {
          inputEl = h('div', { class: 'nc-image-upload' }, [
            value
              ? h('img', { class: 'nc-image-preview', src: String(value), alt: '' })
              : h('div', { class: 'nc-image-placeholder' }, modal.uploading ? 'Mengunggah…' : 'Belum ada gambar'),
            imagePickButton(value ? 'Ganti Gambar' : 'Pilih Gambar', disabled || modal.uploading, function (file) {
              uploadImageFile(ctx, file, c.uploadService, c.maxSizeMB,
                function (loading) { modal.uploading = loading; },
                function (url) { modal.record[c.key] = url; },
                function (message) { setNotice(ctx, 'error', message); }
              );
            })
          ]);
        } else {
          inputEl = h('input', {
            class: 'ed-input',
            type: c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text',
            disabled: disabled,
            value: value === null || value === undefined ? '' : value,
            onInput: function (e) {
              modal.record[c.key] = c.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
            }
          });
        }
        return h('div', { class: 'nc-crud-field' }, [
          h('label', { class: 'nc-label' }, String(c.label || c.key) + (c.required ? ' *' : '')),
          inputEl,
          modal.errors[c.key] ? h('div', { class: 'nc-error' }, modal.errors[c.key]) : null
        ]);
      });

      return h('div', { class: 'nc-modal-backdrop', onClick: function () { closeCrudModal(ctx, comp); } }, [
        h('div', { class: 'nc-modal-panel', onClick: function (e) { e.stopPropagation(); } }, [
          h('div', { class: 'nc-modal-head' }, [
            h('span', {}, modal.mode === 'edit' ? 'Ubah Data' : 'Tambah Data'),
            h('button', { class: 'nc-celltool', onClick: function () { closeCrudModal(ctx, comp); } }, '×')
          ]),
          modal.errors._form ? h('div', { class: 'nc-error nc-modal-error' }, modal.errors._form) : null,
          h('div', { class: 'nc-modal-body' }, fields),
          h('div', { class: 'nc-modal-foot' }, [
            h('button', { class: 'nc-btn nc-btn-secondary', onClick: function () { closeCrudModal(ctx, comp); } }, 'Batal'),
            h('button', { class: 'nc-btn', disabled: modal.saving || modal.uploading, onClick: function () { saveCrudRecord(ctx, comp); } },
              modal.saving ? 'Menyimpan…' : 'Simpan')
          ])
        ])
      ]);
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

    /** Normalizes FORM_SELECT's option source (static list or optionsExpression) into [{value,label}]. */
    function resolveSelectOptions(ctx, comp) {
      var p = comp.properties || {};
      var options = p.optionsExpression
        ? (evalExprSafe(ctx, p.optionsExpression, comp, []) || [])
        : (p.options || []);
      if (!Array.isArray(options)) options = [];
      return options.map(function (opt) {
        var val = opt !== null && typeof opt === 'object' ? opt.value : opt;
        var lbl = opt !== null && typeof opt === 'object' ? (opt.label !== undefined ? opt.label : opt.value) : opt;
        return { value: val, label: lbl };
      });
    }

    /**
     * Cascading dropdowns: any component on the current page whose
     * properties.dependsOn === comp.id gets its value cleared when comp's
     * value changes, since a previously-picked option may no longer be valid
     * (e.g. a City picked under the old Province). Cascades through chains.
     */
    function resetDependents(ctx, comp) {
      var page = ctx.blueprint.pages[ctx.store.currentPageId];
      if (!page) return;
      (page.components || []).forEach(function (other) {
        if (other.id === comp.id || !other.properties || other.properties.dependsOn !== comp.id) return;
        var otherEntry = ctx.store.comps[other.id];
        if (otherEntry && otherEntry.value !== null) {
          otherEntry.value = null;
          otherEntry.touched = false;
          otherEntry.error = null;
          otherEntry.searchQuery = '';
          resetDependents(ctx, other);
        }
      });
    }

    var CHART_PALETTE = [
      '#4f7cff', '#7a5cff', '#2fbf71', '#e8b33f', '#e5534b',
      '#3fb8e8', '#c76fe0', '#f08c3c', '#5fd99a', '#ff8a84'
    ];

    /**
     * CHART — needs an imperative <canvas> lifecycle (create/update/destroy),
     * which the rest of this file's plain h()-returning functions don't do,
     * so this is a real Vue component (mounted/unmounted/watch) rather than a
     * renderer-map entry. Assumes a global `Chart` (Chart.js, loaded via CDN
     * in both the editor shell and compiled apps) — renders a friendly
     * fallback message if it isn't present instead of throwing.
     */
    var NcChartWidget = {
      name: 'NcChartWidget',
      props: { ctx: { type: Object, required: true }, comp: { type: Object, required: true } },
      setup: function (props) {
        var canvasRef = ref(null);
        var chartInstance = null;
        var chartLib = typeof global.Chart !== 'undefined' ? global.Chart : null;

        function computeData() {
          var p = props.comp.properties || {};
          var labels = evalExprSafe(props.ctx, p.labelsExpression, props.comp, []);
          var values = evalExprSafe(props.ctx, p.valuesExpression, props.comp, []);
          if (!Array.isArray(labels)) labels = [];
          if (!Array.isArray(values)) values = [];
          return { labels: labels, values: values };
        }

        function render() {
          if (!chartLib || !canvasRef.value) return;
          var p = props.comp.properties || {};
          var d = computeData();
          var colors = d.values.map(function (_, i) { return CHART_PALETTE[i % CHART_PALETTE.length]; });
          if (chartInstance) {
            chartInstance.config.type = p.chartType || 'bar';
            chartInstance.data.labels = d.labels;
            chartInstance.data.datasets[0].data = d.values;
            chartInstance.data.datasets[0].backgroundColor = colors;
            chartInstance.update();
            return;
          }
          chartInstance = new chartLib(canvasRef.value, {
            type: p.chartType || 'bar',
            data: { labels: d.labels, datasets: [{ label: p.title || '', data: d.values, backgroundColor: colors }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: p.chartType === 'pie' || p.chartType === 'doughnut' } } }
          });
        }

        onMounted(render);
        onUnmounted(function () { if (chartInstance) chartInstance.destroy(); });
        // Re-render whenever the underlying data actually changes. computeData() reads
        // reactive state, so this watch source re-tracks those dependencies each run.
        watch(function () { var d = computeData(); return JSON.stringify(d) + (props.comp.properties || {}).chartType; }, render);

        return function () {
          var p = props.comp.properties || {};
          return h('div', { class: 'nc-chart-wrap' }, [
            p.title ? h('div', { class: 'nc-table-title' }, String(p.title)) : null,
            chartLib
              ? h('div', { class: 'nc-chart-canvas-wrap' }, h('canvas', { ref: canvasRef }))
              : h('div', { class: 'nc-unknown' }, 'Chart.js tidak termuat — periksa koneksi jaringan.')
          ]);
        };
      }
    };

    /**
     * Reads `file` as base64 and uploads it via a DRIVE_UPLOAD service, then
     * calls onSuccess(url)/onError(message). Shared by FORM_IMAGE_UPLOAD and
     * CRUD_TABLE's 'image' column editor so both get the same size check +
     * upload flow, just writing the resulting URL into a different target.
     */
    function uploadImageFile(ctx, file, uploadServiceId, maxSizeMB, onLoadingChange, onSuccess, onError) {
      var maxMB = maxSizeMB || 5;
      if (!uploadServiceId) { onError('Layanan upload belum diatur.'); return; }
      if (file.size > maxMB * 1024 * 1024) { onError('Ukuran file melebihi ' + maxMB + 'MB.'); return; }
      onLoadingChange(true);
      var reader = new FileReader();
      reader.onload = function () {
        var base64 = String(reader.result).split(',')[1] || '';
        ctx.rpc('runService', { serviceId: uploadServiceId, inputs: { filename: file.name, mimeType: file.type, base64: base64 } })
          .then(function (result) {
            onLoadingChange(false);
            onSuccess(result && result.url ? result.url : null);
          })
          .catch(function (err) {
            onLoadingChange(false);
            onError((err && err.message) || 'Gagal mengunggah gambar.');
          });
      };
      reader.onerror = function () { onLoadingChange(false); onError('Gagal membaca file.'); };
      reader.readAsDataURL(file);
    }

    /** A hidden file input wrapped in a styled label — clicking the label natively opens the file picker. */
    function imagePickButton(labelText, disabled, onFile) {
      return h('label', { class: 'nc-image-pick' + (disabled ? ' is-disabled' : '') }, [
        labelText,
        h('input', {
          type: 'file', accept: 'image/*', class: 'nc-image-file-input', disabled: disabled,
          onChange: function (e) {
            var file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) onFile(file);
          }
        })
      ]);
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
        var options = resolveSelectOptions(ctx, comp);
        var design = ctx.mode === 'design';

        function commitValue(newValue) {
          entry.value = newValue;
          entry.touched = true;
          runValidation(ctx, comp, 'onChange');
          runEvent(ctx, comp, 'onChange');
          resetDependents(ctx, comp);
        }

        if (!p.searchable) {
          return h('div', { class: 'nc-field' }, [
            label(comp),
            h('select', {
              id: comp.id, class: 'nc-input', disabled: design,
              value: entry.value === null ? '' : entry.value,
              onChange: function (e) { commitValue(e.target.value); }
            }, [h('option', { value: '', disabled: true }, p.placeholder || 'Pilih...')].concat(
              options.map(function (o) { return h('option', { value: String(o.value) }, String(o.label)); })
            )),
            fieldError(ctx, comp)
          ]);
        }

        // searchable combobox: type-to-filter, click-to-pick
        var selected = options.find(function (o) { return String(o.value) === String(entry.value); });
        var query = entry.dropdownOpen ? (entry.searchQuery || '') : (selected ? String(selected.label) : '');
        var needle = (entry.searchQuery || '').toLowerCase();
        var filtered = entry.dropdownOpen
          ? options.filter(function (o) { return String(o.label).toLowerCase().indexOf(needle) !== -1; })
          : options;

        function pick(opt) { commitValue(opt.value); entry.dropdownOpen = false; entry.searchQuery = ''; }
        function clearValue(e) { e.preventDefault(); commitValue(null); entry.searchQuery = ''; }

        return h('div', { class: 'nc-field nc-combobox' }, [
          label(comp),
          h('div', { class: 'nc-combobox-box' }, [
            h('input', {
              id: comp.id, class: 'nc-input', type: 'text', disabled: design,
              placeholder: p.placeholder || 'Cari...',
              value: query,
              onFocus: function () { entry.dropdownOpen = true; entry.searchQuery = ''; },
              onInput: function (e) { entry.searchQuery = e.target.value; entry.dropdownOpen = true; },
              onBlur: function () { setTimeout(function () { entry.dropdownOpen = false; }, 150); },
              onKeydown: function (e) {
                if (e.key === 'Escape') entry.dropdownOpen = false;
                else if (e.key === 'Enter' && filtered.length) { e.preventDefault(); pick(filtered[0]); }
              }
            }),
            selected ? h('button', { class: 'nc-combobox-clear', type: 'button', tabindex: '-1', onMousedown: clearValue }, '×') : null
          ]),
          entry.dropdownOpen ? h('div', { class: 'nc-combobox-list' },
            filtered.length
              ? filtered.map(function (o) {
                  return h('div', {
                    class: 'nc-combobox-option' + (String(o.value) === String(entry.value) ? ' is-selected' : ''),
                    onMousedown: function (e) { e.preventDefault(); pick(o); }
                  }, String(o.label));
                })
              : [h('div', { class: 'nc-combobox-empty' }, 'Tidak ada hasil')]
          ) : null,
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

      FORM_IMAGE_UPLOAD: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        var design = ctx.mode === 'design';

        function onFile(file) {
          uploadImageFile(ctx, file, p.uploadService, p.maxSizeMB,
            function (loading) { entry.loading = loading; },
            function (url) {
              entry.value = url;
              entry.touched = true;
              runValidation(ctx, comp, 'onChange');
              runEvent(ctx, comp, 'onChange');
            },
            function (message) { setNotice(ctx, 'error', message); }
          );
        }

        return h('div', { class: 'nc-field' }, [
          label(comp),
          h('div', { class: 'nc-image-upload' }, [
            entry.value
              ? h('img', { class: 'nc-image-preview', src: entry.value, alt: '' })
              : h('div', { class: 'nc-image-placeholder' }, entry.loading ? 'Mengunggah…' : 'Belum ada gambar'),
            h('div', { class: 'nc-image-actions' }, [
              imagePickButton(entry.value ? 'Ganti Gambar' : 'Pilih Gambar', design || entry.loading, onFile),
              entry.value ? h('button', {
                class: 'nc-btn nc-btn-secondary', type: 'button', disabled: design,
                onClick: function () {
                  entry.value = null;
                  entry.touched = true;
                  runValidation(ctx, comp, 'onChange');
                  runEvent(ctx, comp, 'onChange');
                }
              }, 'Hapus') : null
            ])
          ]),
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

      CHART: function (ctx, comp) {
        return h(NcChartWidget, { ctx: ctx, comp: comp });
      },

      PRINT_BUTTON: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        var design = ctx.mode === 'design';

        var trigger = h('button', {
          class: 'nc-btn',
          disabled: design,
          onClick: function () { openPrint(ctx, comp); }
        }, String(p.label || '🖨 Cetak'));

        if (!entry.printOpen) return h('div', {}, [trigger]);

        var overlay = h('div', { class: 'nc-modal-backdrop', onClick: function () { closePrint(ctx, comp); } }, [
          h('div', { class: 'nc-modal-panel nc-print-panel', onClick: function (e) { e.stopPropagation(); } }, [
            h('div', { class: 'nc-modal-head' }, [
              h('span', {}, String(p.title || 'Cetak')),
              h('button', { class: 'nc-celltool', onClick: function () { closePrint(ctx, comp); } }, '×')
            ]),
            h('div', { class: 'nc-print-area', innerHTML: entry.printHtml }),
            h('div', { class: 'nc-modal-foot' }, [
              p.pdfExportService ? h('button', { class: 'nc-btn nc-btn-secondary', onClick: function () { savePrintAsPdf(ctx, comp); } }, '💾 Simpan PDF') : null,
              h('button', { class: 'nc-btn nc-btn-secondary', onClick: function () { closePrint(ctx, comp); } }, 'Tutup'),
              h('button', { class: 'nc-btn', onClick: function () { global.print(); } }, '🖨 Cetak')
            ])
          ])
        ]);
        return h('div', {}, [trigger, overlay]);
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
                    if (c.type === 'computed') {
                      var computedVal = evalExprWithRowSafe(ctx, c.valueExpression, comp, row, '⚠');
                      return h('td', computedVal === null || computedVal === undefined ? '' : String(computedVal));
                    }
                    var v = row && typeof row === 'object' ? row[c.key] : undefined;
                    if (c.type === 'image') {
                      return h('td', v ? h('img', { class: 'nc-table-image', src: String(v), alt: '' }) : '');
                    }
                    return h('td', v === null || v === undefined ? '' : String(v));
                  }));
                })
              : [h('tr', h('td', { colspan: Math.max(1, columns.length), class: 'nc-table-empty' },
                  broken ? '⚠ rowsExpression error — check console' : (p.emptyText || 'Belum ada data')))])
          ])
        ]);
      },

      CRUD_TABLE: function (ctx, comp) {
        var p = comp.properties || {};
        var entry = ctx.store.comps[comp.id];
        var design = ctx.mode === 'design';
        var crudEnabled = p.dataSource === 'sheet' || p.dataSource === 'local';

        var rawRows;
        if (p.dataSource === 'expression') {
          rawRows = p.rowsExpression ? evalExprSafe(ctx, p.rowsExpression, comp, []) : [];
          if (!Array.isArray(rawRows)) rawRows = [];
        } else if (p.dataSource === 'local') {
          rawRows = ctx.store.state[p.localKey] || []; // read-only here; localCrudArray() lazily creates it on first write
        } else {
          rawRows = entry.rows || [];
        }

        var scoped = applyCrudFilters(ctx, comp, rawRows);
        var rows = scoped.rows;
        var columns = p.columns || [];
        var showActions = crudEnabled && (p.allowEdit !== false || p.allowDelete !== false);

        var toolbar = [];
        if (p.searchable) {
          toolbar.push(h('input', {
            class: 'nc-crud-search', type: 'text', placeholder: 'Cari...', disabled: design,
            value: entry.search || '',
            onInput: function (e) { entry.search = e.target.value; }
          }));
        }
        (p.filters || []).forEach(function (f) {
          if (f.type === 'select') {
            var opts = f.options && f.options.length ? f.options : distinctValues(rawRows, f.key);
            toolbar.push(h('select', {
              class: 'nc-crud-filter', disabled: design, value: entry.filters[f.key] || '',
              onChange: function (e) { entry.filters = Object.assign({}, entry.filters); entry.filters[f.key] = e.target.value; }
            }, [h('option', { value: '' }, f.label || f.key)].concat(opts.map(function (o) {
              return h('option', { value: String(o) }, String(o));
            }))));
          } else {
            toolbar.push(h('input', {
              class: 'nc-crud-filter', type: 'text', placeholder: f.label || f.key, disabled: design,
              value: entry.filters[f.key] || '',
              onInput: function (e) { entry.filters = Object.assign({}, entry.filters); entry.filters[f.key] = e.target.value; }
            }));
          }
        });
        if (crudEnabled && p.allowAdd !== false) {
          toolbar.push(h('button', {
            class: 'nc-btn nc-crud-add',
            disabled: design || (p.relatedTo && scoped.needsParent),
            onClick: function () { openCrudAdd(ctx, comp); }
          }, '+ Tambah'));
        }

        var headerCells = columns.map(function (c) { return h('th', String(c.label || c.key)); });
        if (showActions) headerCells.push(h('th', { class: 'nc-crud-actions-head' }, ''));

        var bodyRows;
        if (!rows.length) {
          var emptyMsg = scoped.needsParent
            ? 'Pilih baris pada tabel induk untuk melihat detailnya.'
            : (p.emptyText || 'Belum ada data');
          bodyRows = [h('tr', h('td', { colspan: Math.max(1, columns.length + (showActions ? 1 : 0)), class: 'nc-table-empty' }, emptyMsg))];
        } else {
          bodyRows = rows.map(function (row) {
            var keyVal = row[crudKeyColumn(comp)];
            var cells = columns.map(function (c) {
              if (c.type === 'rollup') {
                var badge = computeRollup(ctx, comp, c, row);
                return h('td', h('span', { class: 'nc-badge nc-badge-' + badge.color }, badge.label));
              }
              if (c.type === 'computed') {
                var computedVal = evalExprWithRowSafe(ctx, c.valueExpression, comp, row, '⚠');
                return h('td', computedVal === null || computedVal === undefined ? '' : String(computedVal));
              }
              var v = row[c.key];
              if (c.type === 'image') {
                return h('td', v ? h('img', { class: 'nc-table-image', src: String(v), alt: '' }) : '');
              }
              return h('td', v === null || v === undefined ? '' : String(v));
            });
            var actionCell = null;
            if (showActions) {
              if (entry.confirmDeleteId === keyVal) {
                actionCell = h('td', { class: 'nc-crud-actions' }, [
                  h('span', { class: 'nc-crud-confirm-text' }, 'Yakin?'),
                  h('button', { class: 'nc-celltool is-danger', disabled: design, onClick: function (e) { e.stopPropagation(); confirmCrudDelete(ctx, comp, keyVal); } }, 'Ya'),
                  h('button', { class: 'nc-celltool', disabled: design, onClick: function (e) { e.stopPropagation(); cancelCrudDelete(ctx, comp); } }, 'Batal')
                ]);
              } else {
                var btns = [];
                if (p.allowEdit !== false) btns.push(h('button', { class: 'nc-celltool', title: 'ubah', disabled: design, onClick: function (e) { e.stopPropagation(); openCrudEdit(ctx, comp, row); } }, '✎'));
                if (p.allowDelete !== false) btns.push(h('button', { class: 'nc-celltool is-danger', title: 'hapus', disabled: design, onClick: function (e) { e.stopPropagation(); requestCrudDelete(ctx, comp, keyVal); } }, '×'));
                actionCell = h('td', { class: 'nc-crud-actions' }, btns);
              }
            }
            return h('tr', {
              class: 'nc-crud-row' + (entry.selectedRowKey === keyVal ? ' nc-crud-row-selected' : ''),
              onClick: function () { if (!design) selectCrudRow(ctx, comp, keyVal); }
            }, cells.concat(actionCell ? [actionCell] : []));
          });
        }

        var tableEl = h('div', { class: 'nc-table-wrap nc-crud-table' }, [
          p.title ? h('div', { class: 'nc-table-title' }, String(p.title)) : null,
          toolbar.length ? h('div', { class: 'nc-crud-toolbar' }, toolbar) : null,
          h('table', { class: 'nc-table' }, [h('thead', h('tr', headerCells)), h('tbody', bodyRows)])
        ]);

        return h('div', { class: 'nc-crud-wrap' }, [tableEl, entry.modal ? renderCrudModal(ctx, comp, entry) : null]);
      }
    };

    var KNOWN_TYPES = Object.keys(renderers);

    // --------------------------------------------------- component wrapper --

function gridStyle(comp) {
      var lg = comp.layoutGrid || { col: 1, colSpan: 12 };
      var col = Math.max(1, Math.min(12, lg.col || 1));
      var span = Math.max(1, Math.min(12 - col + 1, lg.colSpan || 12));
      return { gridColumn: col + ' / span ' + span };
    }

    /**
     * Groups a page's components into ordered row bands: [{ row, items }, ...]
     * sorted by row ascending, each row's items sorted by col ascending.
     * Shared by RuntimePage (render) and the editor Canvas (same grouping so
     * design-time and live rendering can never disagree about row placement).
     */
    function groupByRow(components) {
      var byRow = {};
      (components || []).forEach(function (comp) {
        var row = (comp.layoutGrid && comp.layoutGrid.row) || 1;
        (byRow[row] = byRow[row] || []).push(comp);
      });
      return Object.keys(byRow)
        .map(Number)
        .sort(function (a, b) { return a - b; })
        .map(function (row) {
          return {
            row: row,
            items: byRow[row].slice().sort(function (a, b) {
              return ((a.layoutGrid && a.layoutGrid.col) || 1) - ((b.layoutGrid && b.layoutGrid.col) || 1);
            })
          };
        });
    }

    /**
     * Renders one component including its grid cell. In design mode the cell
     * gets selection affordances and hidden components render "ghosted" instead
     * of disappearing (so builders can still click and fix them).
     */
    function renderComponent(ctx, comp) {
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
        style: gridStyle(comp),
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

    /** Renders one row band: a 12-col grid holding that row's components, in design or live mode. */
    function renderRow(ctx, rowGroup, cfg, extraRowProps) {
      return h('div', Object.assign({
        class: 'nc-row',
        key: 'row-' + rowGroup.row,
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          columnGap: (cfg && cfg.colGap) || '16px'
        }
      }, extraRowProps || {}), rowGroup.items.map(function (comp) { return renderComponent(ctx, comp); }));
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
          var cfg = (page.layout && page.layout.config) || {};
          var rows = groupByRow(page.components || []);
          return h('div', {
            class: 'nc-page',
            style: {
              display: 'flex',
              flexDirection: 'column',
              rowGap: cfg.rowGap || '16px',
              maxWidth: cfg.maxWidth || '1080px'
            }
          }, rows.map(function (rowGroup) { return renderRow(ctx, rowGroup, cfg); }));
        };
      }
    };

    function firePageLoad(ctx) {
      var page = ctx.blueprint.pages[ctx.store.currentPageId];
      if (!page) return;
      (page.components || []).forEach(function (comp) {
        if (ctx.mode === 'design') return;
        if (comp.type === 'CRUD_TABLE' && comp.properties && comp.properties.dataSource === 'sheet') {
          loadCrudRows(ctx, comp);
        }
        if (comp.services && comp.services.onLoad) {
          runEvent(ctx, comp, 'onLoad');
        }
      });
    }

    // ---------------------------------------------------------------- menu --
    // NCGAS -> ALL PAGES + groups/links/dividers -> sidebar. bp.menu is the
    // ordered nav tree the builder configures (Menu Manager); when it's empty
    // (never configured, or an older blueprint) the runtime synthesizes a
    // flat one from bp.pages so nothing regresses.

    function resolveMenu(bp) {
      if (Array.isArray(bp.menu) && bp.menu.length) return bp.menu;
      return Object.keys(bp.pages).map(function (pageId) {
        return {
          id: 'auto_' + pageId, type: 'page', label: bp.pages[pageId].settings.title,
          pageId: pageId, allowedRoles: bp.pages[pageId].settings.allowedRoles || []
        };
      });
    }

    function menuItemVisible(ctx, item) {
      if (item.type === 'divider') return true;
      var allowed = item.allowedRoles || [];
      if (!allowed.length) return true;
      var roles = ctx.store.user.roles || [];
      return allowed.some(function (r) { return roles.indexOf(r) !== -1; });
    }

    function renderMenuItem(ctx, item) {
      if (!menuItemVisible(ctx, item)) return null;

      if (item.type === 'divider') return h('hr', { class: 'nc-menu-divider', key: item.id });

      if (item.type === 'group') {
        var expanded = !!ctx.store.menuExpanded[item.id];
        var children = (item.children || []).filter(function (c) { return menuItemVisible(ctx, c); });
        if (!children.length) return null;
        return h('div', { class: 'nc-menu-group', key: item.id }, [
          h('button', {
            class: 'nc-menu-link nc-menu-group-toggle',
            onClick: function () { ctx.store.menuExpanded[item.id] = !expanded; }
          }, [
            item.icon ? h('span', { class: 'nc-menu-icon' }, item.icon) : null,
            h('span', { class: 'nc-menu-label' }, item.label || ''),
            h('span', { class: 'nc-menu-caret' }, expanded ? '▾' : '▸')
          ]),
          expanded ? h('div', { class: 'nc-menu-children' }, children.map(function (c) { return renderMenuItem(ctx, c); })) : null
        ]);
      }

      var isActive = item.type === 'page' && item.pageId === ctx.store.currentPageId;
      return h('button', {
        class: 'nc-menu-link' + (isActive ? ' nc-menu-active' : ''),
        key: item.id,
        onClick: function () {
          if (item.type === 'page') { navigate(ctx, item.pageId); firePageLoad(ctx); }
          else if (item.type === 'link') { global.open(item.url, '_blank', 'noopener'); }
        }
      }, [
        item.icon ? h('span', { class: 'nc-menu-icon' }, item.icon) : null,
        h('span', { class: 'nc-menu-label' }, item.label || '')
      ]);
    }

    // ------------------------------------------------------------ RuntimeApp --
    // Full standalone app shell (used by compiled apps): slim top header +
    // left sidebar menu + current page.

    var RuntimeApp = {
      name: 'NcRuntimeApp',
      props: { ctx: { type: Object, required: true } },
      setup: function (props) {
        return function () {
          var ctx = props.ctx;
          var bp = ctx.blueprint;
          var menu = resolveMenu(bp);
          var notice = ctx.store.notice;
          return h('div', { class: 'nc-app nc-theme-' + ((bp.meta.globalSettings || {}).theme || 'dark') }, [
            h('header', { class: 'nc-topbar' }, [
              h('div', { class: 'nc-topbar-title' }, String(bp.meta.name || bp.appId)),
              h('div', { class: 'nc-topbar-user' }, ctx.store.user.email || 'anonymous')
            ]),
            h('div', { class: 'nc-shell' }, [
              h('nav', { class: 'nc-sidebar' }, menu.map(function (item) { return renderMenuItem(ctx, item); })),
              h('div', { class: 'nc-shell-main' }, [
                notice ? h('div', { class: 'nc-notice nc-notice-' + notice.type, onClick: function () { ctx.store.notice = null; } },
                  [String(notice.message), h('span', { class: 'nc-notice-x' }, ' ✕')]) : null,
                h('main', { class: 'nc-main' }, h(RuntimePage, { ctx: ctx, key: ctx.store.currentPageId }))
              ])
            ])
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
      resolveMenu: resolveMenu,
      menuItemVisible: menuItemVisible,
      renderComponent: renderComponent,
      renderRow: renderRow,
      groupByRow: groupByRow,
      gridStyle: gridStyle,
      firePageLoad: firePageLoad,
      loadCrudRows: loadCrudRows,
      openCrudAdd: openCrudAdd,
      openCrudEdit: openCrudEdit,
      closeCrudModal: closeCrudModal,
      saveCrudRecord: saveCrudRecord,
      requestCrudDelete: requestCrudDelete,
      cancelCrudDelete: cancelCrudDelete,
      confirmCrudDelete: confirmCrudDelete,
      selectCrudRow: selectCrudRow,
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

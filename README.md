# NCGAS — No-Code Google Apps Script Framework

Build internal Google Workspace apps visually (like Bubble), store the design as a
sharded/gzipped JSON blueprint in Google Drive, and deploy it as a real Google Apps
Script web app with one click.

```
┌────────────────────┐   save (sharded+gzip)   ┌──────────────────────┐
│  Vue 3 Builder     │ ──────────────────────► │  Google Drive        │
│  (this repo, also  │ ◄────────────────────── │  NCGAS_Apps/<appId>/ │
│  hosted on GAS)    │         load            │   manifest.json      │
└─────────┬──────────┘                         │   globals.json.gz    │
          │ compileAndDeploy                   │   page_*.json.gz     │
          ▼                                    └──────────────────────┘
┌────────────────────┐   Apps Script REST API  ┌──────────────────────┐
│  Compiler.gs       │ ──────────────────────► │  Target GAS project  │
│  (interpret, don't │  create/updateContent/  │  Code.gs (runtime    │
│  transpile)        │  version/deploy         │  server) + Index.html│
└────────────────────┘                         │  = live web app URL  │
                                               └──────────────────────┘
```

## Architecture decisions (and why)

1. **Interpret, don't transpile.** Deployed apps embed a generic, audited runtime
   (`shared/runtime-core.js`) plus the blueprint **as data**. Recompiling = content
   update. A runtime bugfix reaches every app on its next deploy. No generated
   spaghetti to debug.
2. **One expression engine everywhere.** `shared/expression-engine.js` (tokenizer →
   Pratt parser → interpreter, **no `eval`/`new Function` ever**) runs identically in
   the editor, in deployed SPAs, and inside the GAS server for row-level rules. A rule
   cannot mean two different things in two places.
3. **The builder is itself a GAS web app.** `npm run build:gas` bundles the editor into
   one `Index_Builder.html`. Hosted on GAS: no CORS, no extra infra, `google.script.run`
   RPC, per-user Drive storage, per-user OAuth for deployments (`executeAs: USER_ACCESSING`).
   Locally it runs against a mock Drive (localStorage) with the same API contract.
4. **Design-mode = production renderer.** The canvas renders through the exact runtime
   that ships to users (with selection affordances layered on). WYSIWYG is structural,
   not approximate.
5. **Explicit row/col grid, one reflow function.** Every component carries `layoutGrid
   {row, col, colSpan}`. Drag, keyboard nudge (arrow keys / ▲▼◀▶ buttons), duplicate and
   paste all resolve through a handful of placement primitives in
   `useNoCodeEngine.js` that funnel into a single `reflowPage()` — it derives final
   row/col purely from each component's row value (transiently fractional, e.g. `1.5`,
   to mean "insert a row between 1 and 2") and its position in the page's component
   array. One code path to get right, instead of one per gesture.
6. **Two editing surfaces over one blueprint, not two blueprints.** Flow View (node
   graph) and Design View (WYSIWYG grid) both read/write the exact same `layoutGrid`,
   `services`, `properties` fields — a wire dragged in Flow View and a dropdown picked
   in Inspector produce byte-identical JSON. Node `{x,y}` canvas positions are the only
   Flow-View-only data (`comp._flow`, `page._flow`, `page._flowServices`), and they're
   cosmetic — deleting them just re-triggers auto-layout, nothing breaks.

## Blueprint contract (AST)

`App → meta/globals → rbac → sharedServices/sharedRules → pages → settings/layout → components → services/rules`

```jsonc
{
  "schemaVersion": 1,
  "appId": "ncgas_employee_demo",
  "meta": { "name": "...", "version": "0.1.0", "lastModified": "...",
            "globalSettings": { "theme": "dark", "authStrategy": "GOOGLE_WORKSPACE", "homePage": "pg_x" } },
  "rbac": { "roles": ["Admin","HR_Manager","Employee"],
            "roleMap": { "someone@corp.id": ["Admin"], "*": ["Employee"] } },
  "sharedServices": {
    "srv_fetch_employees": {
      "type": "SHEET_READ",                    // GAS_RPC | SHEET_READ | SHEET_APPEND | REPORT_EXPORT | EMAIL_SEND
      "spreadsheetId": "...", "sheet": "Employees",
      "cachePolicy": "LOCAL_STORAGE_5M",       // client cache TTL: _30S / _5M / _2H ...
      "allowedRoles": ["Admin","HR_Manager"],  // server-enforced 403 wall (empty = all authenticated)
      "dataBoundary": { "ownerColumn": "owner_email", "bypassRoles": ["Admin"] },
      "rules": { "execution": [{ "condition": "payload.amount > 0", "errorMessage": "..." }] },
      "mockResult": [ { "name": "..." } ]      // what the editor PREVIEW returns (never real data)
    }
  },
  "sharedRules": { "rule_is_adult": { "expression": "state.userAge >= 18", "errorMessage": "..." } },
  "pages": {
    "pg_dashboard": {
      "settings": { "title": "Dashboard", "route": "/dashboard", "requireAuth": true, "allowedRoles": [] },
      "layout": { "type": "GRID", "config": { "columns": 12, "rowGap": "16px", "colGap": "16px" } },
      "components": [{
        "id": "comp_input_salary", "type": "FORM_INPUT_NUMBER",
        "layoutGrid": { "row": 1, "col": 1, "colSpan": 6 },
        "properties": { "label": "Base Salary", "defaultValue": 0 },
        "services": { "onBlur": { "action": "srv_fetch_employees", "resultKey": "employees",
                                   "validateFirst": false, "inputs": { "salary": "comp_input_salary.value" } } },
        "rules": {
          "validation": [{ "trigger": "onChange", "condition": "self.value > 0", "errorMessage": "..." }],
          "visibility": { "condition": "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')" }
        }
      }]
    }
  },
  "deploy": { "scriptId": null, "deploymentId": null, "url": null }
}
```

Component types: `HEADING TEXT KPI_CARD CHART DIVIDER FORM_INPUT_TEXT FORM_INPUT_NUMBER
FORM_INPUT_DATE FORM_SELECT FORM_IMAGE_UPLOAD FORM_CHECKBOX BUTTON PRINT_BUTTON
DATA_TABLE CRUD_TABLE`.

## CRUD_TABLE — filter → read → add → edit → delete

`DATA_TABLE` is display-only (an expression that renders as a table). `CRUD_TABLE` is
the full admin-grid pattern: search + per-column filters, a "+ Tambah" button opening a
modal form auto-generated from `properties.columns`, and ✎/🗑 row actions (delete asks
"Yakin?" inline, no browser popup). Drop one in the builder, set *Sumber Data: Google
Sheet*, and the wizard walks you through the rest.

**Data source.** `properties.dataSource` is `'sheet'` (the CRUD path) or `'expression'`
(same read-only behavior as `DATA_TABLE`, kept for computed/derived tables). In sheet
mode, `properties.keyColumn` names the column that uniquely identifies a row, and
`serviceRead/Create/Update/Delete` point at four `sharedServices` entries — one each of
`SHEET_READ`, `SHEET_APPEND`, `SHEET_UPDATE`, `SHEET_DELETE` — that the Inspector's
**⚡ Buat Layanan CRUD** button generates for you from the spreadsheetId/sheet/keyColumn
you configured. `SHEET_UPDATE`/`SHEET_DELETE` locate the row by `keyColumn`, enforce the
same `dataBoundary` ownership check as every other sheet service (fail-closed), and never
let the identity or ownership column itself change via update.

**Discovering columns.** Hosted on Apps Script, **🔌 Tes Koneksi** opens the spreadsheet
as *your own* identity (`spreadsheets.readonly`, `executeAs: USER_ACCESSING` — never a
shared service account) and reads real header rows, so you pick columns from what's
actually in the sheet. Local dev has no real spreadsheet to probe, so the wizard falls
back to typing header names manually — same resulting schema either way.

**Master-detail ("add detail" pattern).** Any `CRUD_TABLE` can declare
`properties.relatedTo = {parentComponentId, parentKeyColumn, childForeignKeyColumn}`.
Clicking a row on the parent table sets its `selectedRowKey`; every related child table
(anywhere in the app — runtime state persists across page navigation) automatically
scopes its rows to that key and pre-fills the foreign key on new "detail" records as a
locked field. This is the Orders → Order Items / Proyek → Tugas pattern — see the
"Manajemen Data" page in the Employee Dashboard template for a working example.

**Local dev CRUD.** Preview mode never touches real Workspace data (same rule as every
other service), but `SHEET_READ/APPEND/UPDATE/DELETE` in local dev run against a real,
persistent fake sheet store in `localStorage` (`src/rpc/adapter.js`) — add/edit/delete
actually stick across reloads, so the whole flow (and master-detail) is genuinely
testable before you ever touch a real Google Sheet.

**Rollup columns (computed status from child data).** A column can be
`type: 'rollup'` instead of text/number/date/select:
`{fromComponentId, matchColumn, statusColumn, doneValue, doneLabel, doneColor, pendingLabel, pendingColor, emptyLabel, emptyColor}`
(colors: `ok`/`warn`/`err`/`dim`). The runtime looks at another `CRUD_TABLE`'s
already-loaded rows, matches them to the current row, and renders a colored badge — green
once every matching child's status equals `doneValue`, amber otherwise, gray if there are
none yet. Purely a read of trusted runtime state (not a user expression), configured via
the Inspector's column type picker. The child table needs to have been loaded at least
once — normally just "present on the same page" — or the badge falls back to "empty".

## Building POS-style apps (cart, receipts, dashboards, product photos)

The "Kasir POS" page in the Employee Dashboard template exercises all four of these
together, end to end. See it for a working reference.

**Live sums / cart.** `CRUD_TABLE` supports a third `dataSource: 'local'` — rows live in
`state.{localKey}` (a plain array, e.g. `state.cart`) instead of a Sheet, so add/edit/delete
never leave the browser. Each row gets an internal `_localId` (not a real column) as its
identity, so `keyColumn` doesn't need to be configured for local tables. Combine with a
`type: 'computed'` column (`valueExpression` evaluated per-row, with `row` in scope —
`row.qty * row.harga`) for a live subtotal, and the `sumProduct(rows, keyA, keyB)` builtin
for the grand total: `formatIDR(sumProduct(state.cart, 'qty', 'harga'))`. `computed`
columns are never sent to a backend and never shown in the add/edit form.

**Print → receipts.** `PRINT_BUTTON` opens a print-friendly modal rendered from
`properties.htmlTemplate`. Every `{{...}}` is a *full expression* (not just a dotted key
path) — evaluated with the normal component scope and HTML-escaped before substitution,
same trust model as `EMAIL_SEND`'s template (builder-authored structure, escaped data —
see the security note atop `shared/runtime-core.js`). `{{items_table}}` is a reserved
marker that substitutes an itemized `<table>` built from `properties.itemsExpression`
(an array) and `properties.itemColumns`. The "🖨 Cetak" button calls `window.print()`
scoped to just that receipt via CSS (`@media print` + a "hide everything else" rule) — no
popup window needed. An optional `pdfExportService` (a `PDF_EXPORT` service) adds a
"💾 Simpan PDF" button that converts the rendered HTML to a PDF in Drive
(`Utilities.newBlob(html,'text/html').getAs('application/pdf')` — basic fidelity, fine for
receipts/simple reports, not pixel-perfect layouts).

**Dashboards.** `CHART` (bar/line/pie/doughnut, backed by Chart.js loaded from CDN in both
the editor and compiled apps) takes two parallel-array expressions —
`labelsExpression`/`valuesExpression` — so it composes with everything else instead of
needing its own query builder: `pluck(groupBySum(state.sales, 'kategori', 'total'), 'key')`
/ `pluck(groupBySum(state.sales, 'kategori', 'total'), 'total')`. `groupBySum(rows,
groupKey, valueKey)` and `groupByCount(rows, groupKey)` are native, non-lambda aggregation
builtins (same security posture as `whereEquals`). A "dashboard" is just a page combining
`CHART` + `KPI_CARD` + `CRUD_TABLE` filters — no separate dashboard-builder mode.

**Product photos (Drive upload).** `FORM_IMAGE_UPLOAD` (and `CRUD_TABLE` columns with
`type: 'image'`) upload a file (base64 over `google.script.run`, since GAS can't do
multipart uploads) via a `DRIVE_UPLOAD` service. Uploaded files are **not** made public —
they stay owner-private in Drive, and are served back through the deployed app's own
`doGet` (`?action=ncgas_image&fileId=...`, in `Tpl_ServerMain.html`/`NcServeImage_`), which
re-checks identity on every request exactly like every other route. This means access is
governed by the app's own auth, not by Drive sharing settings. Local dev has no real Drive
to write to, so the mock adapter hands back the actual uploaded bytes as a `data:` URL —
you see your real image working in preview, not a placeholder.
⚠️ *The `doGet` image-serving route is GAS-runtime-only behavior that can't be executed in
this local/Node environment — verify it once on a real deployment before relying on it.*

## Flow View — KNIME-style node editor

The builder opens in **Flow View** by default (toggle: Flow / Desain / Preview in the
topbar). It's a node-graph editing surface layered over the same blueprint Design View
edits, at two zoom levels:

- **App level** — every page is a draggable node; edges are auto-derived from
  `NAVIGATE` service bindings anywhere in the app (a button/etc. whose `onClick` action
  is `NAVIGATE` draws an edge from its page to the target page). Double-click a page
  node to drill into it.
- **Page level** — every component and every app service is a node. Edges are derived
  from the existing binding fields — `services[event].action`, `properties.dependsOn`,
  `properties.relatedTo`, column `rollup`, `uploadService`/`pdfExportService` — so
  everything already wired via Inspector shows up immediately as a graph, no migration
  needed. Two relationship kinds are **drag-to-wire**: drag a component's event port
  (small circle, e.g. `onClick`) onto a service node to bind it
  (`comp.services[event] = {action: serviceId}`), or drag a `FORM_SELECT`/input's
  `value` port onto another `FORM_SELECT`'s `dependsOn` port to cascade it. Click a wire
  to remove it. Every app service always renders as a node on every page (dimmed if
  unused there) so it stays a valid drop target even after its last reference is
  removed — a service node never has to "already be wired" to be wireable.
- **Inline node config** — click a node's ⚙ to expand its property fields right on the
  canvas (same field components Inspector uses). `CRUD_TABLE` nodes embed the full
  `CrudWizard.vue` inline rather than a slimmed-down version, since its data-source/
  columns/master-detail config doesn't compress well into a summary view.

Design View is unchanged — it's the exact same `Canvas.vue`/`Palette.vue`/`Inspector.vue`
WYSIWYG grid editor from before, reachable via the mode toggle, for laying out how a page
actually *looks* (row/col placement) as opposed to how its pieces are *wired*.

Not yet drag-wireable (edit via a node's inline config or Inspector instead): master-detail
(`relatedTo`), rollup columns, `uploadService`, `pdfExportService`, and `NAVIGATE` targets —
these still render as graph edges, just aren't created by dragging yet.

## Menu management (sidebar navigation)

Deployed apps use a slim top header + left sidebar shell (`RuntimeApp` in
`shared/runtime-core.js`), not a flat topbar. `bp.menu` is an ordered nav tree — empty or
absent (the default for every existing/older blueprint) means the sidebar auto-lists every
page, so this is purely opt-in.

Item types: `page` (navigates, `pageId` must exist), `group` (an expand/collapse section
holding `page`/`link`/`divider` children — **one level of nesting only**, groups cannot
contain groups), `link` (opens `url` in a new tab), `divider` (visual separator). Every
type except `divider` accepts an `allowedRoles` array, checked the same way as
`page.settings.allowedRoles`. Configure it from the Palette's **Menu** tab
(`MenuManager.vue`) — add/reorder/remove at the top level or inside a group; label, icon
(any emoji), page/url and roles are edited inline.

## Expression language (safe subset)

Scope roots: `state` (service results), `user` (`email`, `roles`), `self` (this
component's `{value,error,touched,loading}`), any `comp_*` id, `env`. On the server,
service rules see `payload`, `user`, `env`.

Operators: `+ - * / %`, `== != === !==` (**`==` is strict**), `< <= > >=`, `&& || ?? !`,
ternary `?:`, `[index]`, `.member`, array literals `[1,2,3]`, object literals `{a:1,b:2}`.
Functions: `abs round floor ceil min max sum avg count pluck whereEquals groupBySum
groupByCount sumProduct len lower upper trim concat includes startsWith endsWith split
join number string boolean coalesce iif isEmpty formatNumber formatIDR now today`.

Hard security walls: method calls rejected at parse time, `__proto__`/`constructor`/
`prototype` access rejected (as member access **and** as an object-literal key), no
assignment/statements/lambdas, bounded length/depth/steps. Visibility rules **fail
closed** in deployed apps (error ⇒ hidden), fail open in the canvas so you can click and
fix them.

**Dependent dropdowns.** `whereEquals(rows, key, value)` is a declarative, native-code
filter — the language still has no lambdas, so predicates can't be user-authored, but a
fixed equality check over a native function is safe. Combined with `pluck` and object/array
literals, a `FORM_SELECT`'s `optionsExpression` can filter a reference list by another
component's value: `pluck(whereEquals(state.kota, 'provinsi_id', comp_provinsi.value), 'nama')`.
Set `properties.dependsOn` to the other component's id and its value auto-clears whenever
that component changes (cascades through chains, current-page only). Set
`properties.searchable` for a type-to-filter combobox instead of a native `<select>`.

## Security model

| Layer | Mechanism |
|---|---|
| Page access | `doGet` strips pages whose `allowedRoles` don't match the caller **server-side**; `rbac.roleMap` never leaves the server |
| Service access | every `rpcApi` call re-resolves identity (`Session.getActiveUser()`), re-checks `allowedRoles` → `403 FORBIDDEN` envelope |
| Row-level data | `dataBoundary.ownerColumn`: reads filtered to caller's email (fail-closed if the column is missing), writes force-stamp it; `SHEET_UPDATE`/`SHEET_DELETE` re-check ownership on the located row before touching it |
| Server rules | `rules.execution` evaluated by the same no-eval engine against `payload`/`user` |
| Templates | email/print `{{tokens}}` are evaluated expressions, HTML-escaped on output; blueprint JSON `</script>`-escaped; the runtime touches innerHTML in exactly one place (PRINT_BUTTON's receipt view) under that same escaped-token discipline — see `shared/runtime-core.js` header |
| Uploaded files | `DRIVE_UPLOAD` never makes files public — they stay owner-private in Drive and are only readable through the app's own `doGet` image route, which re-checks identity like every other request |
| Preview | editor preview only ever sees `mockResult` data (or, for uploads, the real file as a local `data:` URL) — never live Workspace data |

## Getting started (local)

```bash
npm install
npm test        # unit tests: expression engine + blueprint/sharding + CRUD_TABLE validation
npm run dev     # editor at http://localhost:5173 (mock Drive + mock sheets in localStorage)
```

The editor seeds an **Employee Dashboard** template: switch to *Preview*, toggle the
simulated roles (Admin / HR_Manager / Employee) and watch RBAC visibility, run the mock
service, trip the validation rules. **Manajemen Data** is a working `CRUD_TABLE` demo — a
flat Karyawan grid (filter/search/add/edit/delete) plus a Proyek → Tugas master-detail
pair with a rollup status badge. **Formulir Alamat** demos cascading + searchable
dropdowns. **Kasir POS** ties everything together — a Sheet-backed product catalog with
photo uploads, an in-memory cart with a live computed total, a printable receipt, and a
sales-by-category dashboard chart.

## Deploying the builder to Apps Script

1. `npm install -g @google/clasp && clasp login`
2. `clasp create --type webapp --title "NCGAS Builder" --rootDir gas/builder`
   (or copy `.clasp.json.example` → `gas/builder/.clasp.json` with an existing scriptId)
3. `npm run build:gas` — bundles the editor to a single file + syncs `shared/` into
   `gas/builder/` (generated files are gitignored; regenerate anytime)
4. `cd gas/builder && clasp push`
5. In the Apps Script editor: **Deploy → New deployment → Web app**
   (execute as: *user accessing*, access: *your domain*). Open the URL — that's your builder.
6. Each builder user must enable the **Google Apps Script API** once at
   <https://script.google.com/home/usersettings> (the Deploy button tells them if not).

## Deploying an app you designed

Click **🚀 Deploy** in the builder. The compiler:
creates/reuses the target project → pushes `appsscript.json`, `Code.gs`,
`ExpressionEngine.gs`, `CustomHandlers.gs` (preserved across recompiles once you edit
it), assembled `Index.html` → cuts a version → creates/updates the deployment →
returns the web app URL and saves it into the blueprint manifest.

**Once per app:** open the target project's editor (link shown after deploy) and run
`authorizeOnce` to consent to Sheets/Gmail/Drive scopes. This is a Google platform
requirement — the REST API cannot consent on your behalf.

## Repo map

```
shared/                 THE product core — env-agnostic, zero-dependency
  expression-engine.js  safe evaluator (browser + GAS + Node)
  blueprint-utils.js    schema, validation, shard split/merge
  runtime-core.js       blueprint interpreter (Vue injected)
  base-css.js           nc-* stylesheet shared editor ⇄ deployed apps
src/                    Vue 3 + Vite visual builder
  store/useNoCodeEngine.js   blueprint state, undo, save/deploy actions
  rpc/adapter.js        google.script.run ⇄ localStorage mock seam (+ mock sheet store)
  ui/                   Palette / Canvas / Inspector / Preview / registry / CrudWizard / MenuManager
gas/builder/            Apps Script backend (push with clasp)
  Main.js Api.js        web entry + RPC envelope surface
  Storage.js            Drive sharding + Utilities.gzip
  Compiler.js           Apps Script REST API orchestrator
  SheetInspect.js        reads real sheet headers for the CRUD wizard (user's own OAuth)
  Tpl_ServerMain.html   target app's server runtime (RBAC/boundary/CRUD verbs/report/email)
  Tpl_Index.html        target app's SPA skeleton
scripts/sync-gas.mjs    materializes shared/ into gas/builder/
tests/                  node --test suites
```

## Known constraints & roadmap

- Deployed apps load Vue from jsDelivr; offline domains should mirror the file and
  change the URL in `Tpl_Index.html` before compiling.
- Grid placement is desktop-only for now (no separate mobile breakpoint span —
  responsive collapsing is roadmap).
- Component id rename does not rewrite expressions that reference the old id (the
  editor warns; blueprint validation catches dangling service refs but not ids inside
  expressions — roadmap: reference tracker).
- Property edits are not in the undo stack (structural add/move/delete/duplicate are).
- `CRUD_TABLE` filtering/search runs client-side over the loaded rows (bounded by
  `SHEET_READ`'s existing `maxRows`, default 2000) — fine for typical admin datasets,
  not built for huge sheets. Server-side filter push-down and pagination are roadmap.
- Master-detail selection (`selectedRowKey`) is single-level: a child can't itself be a
  parent of a third level in the current UI (the data model would allow it, chaining
  `relatedTo`, but the wizard doesn't surface deeper nesting yet).
- Rollup columns require the source child `CRUD_TABLE` to have loaded its rows at least
  once (normally: present on the same page) — falls back to the "empty" badge otherwise,
  never throws, but won't reflect data it hasn't seen.
- `dependsOn` cascading only looks at components on the *current page*; cross-page
  dependent dropdowns aren't supported yet.
- Menu groups are one level deep by design (matches the sidebar's actual rendering) —
  nested groups are rejected by validation, not silently flattened.
- `dataSource: 'local'` (cart-style CRUD_TABLE) has no state and no seed data — it always
  starts empty and resets on page reload. There's no `defaultRows`/seeding mechanism yet
  for a small in-memory catalog that isn't backed by a Sheet.
- A `CRUD_TABLE`'s own add/edit modal can't show a *dynamic* dropdown sourced from another
  table's live rows (e.g. "pick a product" inside the cart's add form) — `select` column
  options are a static list. Workaround used in the POS demo: the cashier reads the price
  from the visible Produk table and types it into the cart form.
- `PDF_EXPORT` uses GAS's basic HTML→PDF blob conversion, not a full rendering engine —
  fine for receipts/simple reports, not pixel-perfect layouts.
- The `doGet` image-serving route (`NcServeImage_`) is GAS-runtime-only behavior with no
  local/Node equivalent — every other piece of the image-upload feature was verified live
  in the browser (upload → preview → save → table thumbnail), but that one route needs
  verification against a real deployment.
- Roadmap: repeating list/container components, blueprint version migrations,
  richer report designer, bulk row actions (multi-select delete/export) on CRUD_TABLE,
  server-side filter push-down for very large sheets, dynamic options in CRUD modals.

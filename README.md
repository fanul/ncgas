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
        "layoutGrid": { "xs": 12, "md": 6 },
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

Component types: `HEADING TEXT KPI_CARD DIVIDER FORM_INPUT_TEXT FORM_INPUT_NUMBER
FORM_INPUT_DATE FORM_SELECT FORM_CHECKBOX BUTTON DATA_TABLE`.

## Expression language (safe subset)

Scope roots: `state` (service results), `user` (`email`, `roles`), `self` (this
component's `{value,error,touched,loading}`), any `comp_*` id, `env`. On the server,
service rules see `payload`, `user`, `env`.

Operators: `+ - * / %`, `== != === !==` (**`==` is strict**), `< <= > >=`, `&& || ?? !`,
ternary `?:`, `[index]`, `.member`, array literals. Functions: `abs round floor ceil
min max sum avg count pluck len lower upper trim concat includes startsWith endsWith
split join number string boolean coalesce iif isEmpty formatNumber formatIDR now today`.

Hard security walls: method calls rejected at parse time, `__proto__`/`constructor`/
`prototype` access rejected, no assignment/statements/lambdas, bounded length/depth/steps.
Visibility rules **fail closed** in deployed apps (error ⇒ hidden), fail open in the
canvas so you can click and fix them.

## Security model

| Layer | Mechanism |
|---|---|
| Page access | `doGet` strips pages whose `allowedRoles` don't match the caller **server-side**; `rbac.roleMap` never leaves the server |
| Service access | every `rpcApi` call re-resolves identity (`Session.getActiveUser()`), re-checks `allowedRoles` → `403 FORBIDDEN` envelope |
| Row-level data | `dataBoundary.ownerColumn`: reads filtered to caller's email (fail-closed if the column is missing), writes force-stamp it |
| Server rules | `rules.execution` evaluated by the same no-eval engine against `payload`/`user` |
| Templates | email `{{tokens}}` HTML-escaped; blueprint JSON `</script>`-escaped; renderer never uses innerHTML |
| Preview | editor preview only ever sees `mockResult` data — never live Workspace data |

## Getting started (local)

```bash
npm install
npm test        # 26 unit tests: expression engine + blueprint/sharding
npm run dev     # editor at http://localhost:5173 (mock Drive in localStorage)
```

The editor seeds an **Employee Dashboard** template: switch to *Preview*, toggle the
simulated roles (Admin / HR_Manager / Employee) and watch RBAC visibility, run the
mock service, trip the validation rules.

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
  rpc/adapter.js        google.script.run ⇄ localStorage mock seam
  ui/                   Palette / Canvas / Inspector / Preview / registry
gas/builder/            Apps Script backend (push with clasp)
  Main.js Api.js        web entry + RPC envelope surface
  Storage.js            Drive sharding + Utilities.gzip
  Compiler.js           Apps Script REST API orchestrator
  Tpl_ServerMain.html   target app's server runtime (RBAC/boundary/report/email)
  Tpl_Index.html        target app's SPA skeleton
scripts/sync-gas.mjs    materializes shared/ into gas/builder/
tests/                  node --test suites
```

## Known constraints & roadmap

- Deployed apps load Vue from jsDelivr; offline domains should mirror the file and
  change the URL in `Tpl_Index.html` before compiling.
- `xs` grid spans are stored but the runtime currently applies `md` (responsive
  breakpoints = roadmap).
- Component id rename does not rewrite expressions that reference the old id (the
  editor warns; blueprint validation catches dangling service refs but not ids inside
  expressions — roadmap: reference tracker).
- Property edits are not in the undo stack (structural add/move/delete/duplicate are).
- Roadmap: SHEET_UPDATE/DELETE services, repeating list/container components,
  blueprint version migrations, per-page onLoad workflows, richer report designer.

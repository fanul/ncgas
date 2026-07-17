/**
 * NCGAS Base Stylesheet — exported as a JS string so the same CSS can be
 * (a) injected by the editor and (b) embedded verbatim by Compiler.gs into
 * every compiled app's Index.html. Class prefix: nc-
 */
(function (global) {
  'use strict';

  var BASE_CSS = [
    ':root{',
    '  --nc-bg:#0f1117;--nc-panel:#171a23;--nc-panel-2:#1e2230;--nc-border:#2a2f3f;',
    '  --nc-text:#e6e9f2;--nc-text-dim:#9aa3b8;--nc-accent:#4f7cff;--nc-accent-2:#7a5cff;',
    '  --nc-ok:#2fbf71;--nc-warn:#e8b33f;--nc-err:#e5534b;--nc-radius:10px;',
    '  --nc-font:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    '}',
    '.nc-theme-light{',
    '  --nc-bg:#f4f6fb;--nc-panel:#ffffff;--nc-panel-2:#eef1f8;--nc-border:#d8deea;',
    '  --nc-text:#1c2233;--nc-text-dim:#5d6780;',
    '}',
    '.nc-app{min-height:100vh;background:var(--nc-bg);color:var(--nc-text);font-family:var(--nc-font);font-size:14px;}',
    '.nc-topbar{display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--nc-panel);border-bottom:1px solid var(--nc-border);}',
    '.nc-topbar-title{font-weight:700;font-size:15px;}',
    '.nc-topbar-nav{display:flex;gap:4px;flex:1;flex-wrap:wrap;}',
    '.nc-nav-link{background:none;border:none;color:var(--nc-text-dim);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit;}',
    '.nc-nav-link:hover{background:var(--nc-panel-2);color:var(--nc-text);}',
    '.nc-nav-active{background:var(--nc-panel-2);color:var(--nc-accent);font-weight:600;}',
    '.nc-topbar-user{color:var(--nc-text-dim);font-size:12px;}',
    '.nc-main{padding:24px;display:flex;justify-content:center;}',
    '.nc-page{width:100%;}',
    '.nc-cell{min-width:0;}',
    '.nc-heading{margin:0 0 4px;font-weight:700;}',
    '.nc-text{margin:0;color:var(--nc-text-dim);line-height:1.55;}',
    '.nc-divider{border:none;border-top:1px solid var(--nc-border);margin:8px 0;grid-column:1/-1;}',
    '.nc-field{display:flex;flex-direction:column;gap:6px;}',
    '.nc-field-inline{flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.nc-label{font-size:12px;font-weight:600;color:var(--nc-text-dim);letter-spacing:.02em;}',
    '.nc-label-inline{font-size:13px;}',
    '.nc-input{background:var(--nc-panel-2);border:1px solid var(--nc-border);color:var(--nc-text);border-radius:8px;padding:9px 12px;font:inherit;width:100%;box-sizing:border-box;outline:none;}',
    '.nc-input:focus{border-color:var(--nc-accent);}',
    '.nc-input:disabled{opacity:.65;}',
    '.nc-checkbox{width:16px;height:16px;accent-color:var(--nc-accent);}',
    '.nc-error{color:var(--nc-err);font-size:12px;}',
    '.nc-btn{background:linear-gradient(135deg,var(--nc-accent),var(--nc-accent-2));color:#fff;border:none;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;justify-self:start;}',
    '.nc-btn:hover{filter:brightness(1.1);}',
    '.nc-btn:disabled{opacity:.55;cursor:not-allowed;}',
    '.nc-btn-secondary{background:var(--nc-panel-2);color:var(--nc-text);border:1px solid var(--nc-border);}',
    '.nc-kpi{background:var(--nc-panel);border:1px solid var(--nc-border);border-radius:var(--nc-radius);padding:16px;}',
    '.nc-kpi-label{font-size:12px;color:var(--nc-text-dim);margin-bottom:6px;}',
    '.nc-kpi-value{font-size:24px;font-weight:700;}',
    '.nc-table-wrap{background:var(--nc-panel);border:1px solid var(--nc-border);border-radius:var(--nc-radius);overflow:auto;}',
    '.nc-table-title{padding:12px 14px;font-weight:600;border-bottom:1px solid var(--nc-border);}',
    '.nc-table{width:100%;border-collapse:collapse;font-size:13px;}',
    '.nc-table th{text-align:left;padding:10px 14px;color:var(--nc-text-dim);font-weight:600;border-bottom:1px solid var(--nc-border);white-space:nowrap;}',
    '.nc-table td{padding:10px 14px;border-bottom:1px solid var(--nc-border);}',
    '.nc-table tbody tr:last-child td{border-bottom:none;}',
    '.nc-table tbody tr:hover{background:var(--nc-panel-2);}',
    '.nc-table-empty{color:var(--nc-text-dim);text-align:center;}',
    '.nc-notice{padding:10px 20px;font-size:13px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;}',
    '.nc-notice-error{background:rgba(229,83,75,.15);color:#ff8a84;border-bottom:1px solid rgba(229,83,75,.3);}',
    '.nc-notice-success{background:rgba(47,191,113,.12);color:#5fd99a;border-bottom:1px solid rgba(47,191,113,.3);}',
    '.nc-notice-info{background:rgba(79,124,255,.12);color:#8fb0ff;border-bottom:1px solid rgba(79,124,255,.3);}',
    '.nc-notice-x{opacity:.7;}',
    '.nc-unknown{background:rgba(229,83,75,.1);border:1px dashed var(--nc-err);color:var(--nc-err);padding:12px;border-radius:8px;font-size:12px;}',
    // design-mode affordances (editor canvas only)
    '.nc-cell-design{position:relative;border:1px dashed transparent;border-radius:8px;padding:22px 8px 8px;cursor:pointer;transition:border-color .12s;}',
    '.nc-cell-design:hover{border-color:var(--nc-border);}',
    '.nc-cell-selected{border-color:var(--nc-accent)!important;background:rgba(79,124,255,.06);}',
    '.nc-cell-ghost{opacity:.45;}',
    '.nc-cell-tag{position:absolute;top:3px;left:8px;font-size:10px;color:var(--nc-text-dim);letter-spacing:.03em;user-select:none;}',
    '.nc-cell-design .nc-btn,.nc-cell-design .nc-input,.nc-cell-design .nc-checkbox{pointer-events:none;}'
  ].join('\n');

  var api = { BASE_CSS: BASE_CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NCGASBaseCss = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

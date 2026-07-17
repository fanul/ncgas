/**
 * Bridges the environment-agnostic shared core into the Vite/ESM world.
 * The shared files register themselves on globalThis (UMD-lite); this module
 * imports them for their side effects and re-exports typed handles.
 */
import * as Vue from 'vue';
import '../shared/expression-engine.js';
import '../shared/blueprint-utils.js';
import '../shared/base-css.js';
import '../shared/runtime-core.js';

export const Expression = globalThis.NCGASExpression;
export const Blueprint = globalThis.NCGASBlueprint;
export const BASE_CSS = globalThis.NCGASBaseCss.BASE_CSS;

/** Single runtime instance shared by canvas (design) and preview (live). */
export const Runtime = globalThis.NCGASRuntime.createNCGASRuntime(Vue, Expression);

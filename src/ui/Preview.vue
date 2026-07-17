<script setup>
/**
 * Live preview = the EXACT compiled-app runtime (RuntimeApp) with a simulated
 * identity. Services resolve their mockResult — real Workspace data is never
 * touched from the editor. Switching roles rebuilds the runtime store so RBAC
 * visibility can be exercised per role.
 */
import { computed, shallowRef, watch, h } from 'vue';
import { Runtime } from '../engine.js';
import { makePreviewRpc } from '../rpc/adapter.js';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const { state } = engine;

// Built in a watch, not a computed — createStore writes into a fresh reactive
// store, which must stay untracked or every render invalidates it (see Canvas).
const previewCtx = shallowRef(null);
watch(
  () => [state.previewNonce, state.blueprint, state.previewRoles.join('|')],
  () => {
    const bp = state.blueprint;
    if (!bp) { previewCtx.value = null; return; }
    const user = { email: state.identity.email || 'preview@local', roles: [...state.previewRoles] };
    const store = Runtime.createStore(bp, user);
    store.currentPageId = state.currentPageId in bp.pages ? state.currentPageId : bp.meta.globalSettings.homePage;
    previewCtx.value = { blueprint: bp, store, rpc: makePreviewRpc(() => bp), mode: 'live', design: null };
  },
  { immediate: true }
);

const PreviewApp = {
  setup: () => () =>
    previewCtx.value
      ? h(Runtime.RuntimeApp, { ctx: previewCtx.value, key: state.previewNonce })
      : h('div')
};

const roles = computed(() => state.blueprint?.rbac?.roles || []);

function toggleRole(role) {
  const i = state.previewRoles.indexOf(role);
  if (i === -1) state.previewRoles.push(role);
  else if (state.previewRoles.length > 1) state.previewRoles.splice(i, 1);
  state.previewNonce++;
}
</script>

<template>
  <section class="ed-preview">
    <div class="ed-preview-bar">
      <span class="ed-preview-tag">PREVIEW · data mock, bukan data asli</span>
      <span class="ed-dim">Simulasikan role:</span>
      <button
        v-for="role in roles"
        :key="role"
        class="ed-chip"
        :class="{ 'is-on': state.previewRoles.includes(role) }"
        @click="toggleRole(role)"
      >{{ role }}</button>
    </div>
    <div class="ed-preview-frame">
      <component :is="PreviewApp" />
    </div>
  </section>
</template>

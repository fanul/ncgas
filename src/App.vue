<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import Topbar from './ui/Topbar.vue';
import Palette from './ui/Palette.vue';
import Canvas from './ui/Canvas.vue';
import Inspector from './ui/Inspector.vue';
import Preview from './ui/Preview.vue';
import FlowView from './ui/FlowView.vue';
import { useNoCodeEngine } from './store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const { state } = engine;

function onKeydown(e) {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (ctrl && key === 's') {
    e.preventDefault();
    engine.save();
  } else if (ctrl && key === 'z' && !inField) {
    e.preventDefault();
    e.shiftKey ? engine.redo() : engine.undo();
  } else if (inField) {
    return; // everything below only applies when not typing in a field
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
    e.preventDefault();
    engine.removeComponent(state.selectedId);
  } else if (ctrl && key === 'c' && state.selectedId) {
    e.preventDefault();
    engine.copyComponent(state.selectedId);
  } else if (ctrl && key === 'v') {
    e.preventDefault();
    engine.pasteComponent();
  } else if (ctrl && key === 'd' && state.selectedId) {
    e.preventDefault();
    engine.duplicateComponent(state.selectedId);
  } else if (e.key === 'Escape') {
    state.selectedId = null;
  } else if (state.selectedId && e.key.startsWith('Arrow')) {
    e.preventDefault();
    if (e.key === 'ArrowUp') engine.nudgeRow(state.selectedId, -1);
    else if (e.key === 'ArrowDown') engine.nudgeRow(state.selectedId, 1);
    else if (e.key === 'ArrowLeft') engine.nudgeCol(state.selectedId, -1);
    else if (e.key === 'ArrowRight') engine.nudgeCol(state.selectedId, 1);
  }
}

onMounted(() => {
  engine.init();
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="ed-root nc-app">
    <Topbar />
    <div v-if="state.toast" class="ed-toast" :class="'is-' + state.toast.type" @click="state.toast = null">
      {{ state.toast.message }} <span class="ed-dim">✕</span>
    </div>
    <div v-if="state.deployResult" class="ed-deploybar">
      <template v-if="state.deployResult.url">
        ✅ Terdeploy v{{ state.deployResult.lastDeployedVersion }} →
        <a :href="state.deployResult.url" target="_blank" rel="noopener">{{ state.deployResult.url }}</a>
      </template>
      <span v-for="(note, i) in state.deployResult.notes || []" :key="i" class="ed-deploynote">{{ note }}</span>
      <button class="ed-btn-icon" @click="state.deployResult = null">✕</button>
    </div>

    <main v-if="state.blueprint" class="ed-body" :class="{ 'is-preview': state.mode === 'preview', 'is-flow': state.mode === 'flow' }">
      <template v-if="state.mode === 'design'">
        <Palette />
        <Canvas />
        <Inspector />
      </template>
      <FlowView v-else-if="state.mode === 'flow'" />
      <Preview v-else />
    </main>
    <div v-else class="ed-loading">Memuat workspace…</div>

    <footer class="ed-statusbar">
      <span>{{ state.isGasHost ? 'GAS host · Drive storage' : 'Local dev · mock Drive (localStorage)' }}</span>
      <span>{{ state.identity.email }}</span>
      <span v-if="state.blueprint" class="ed-mono">{{ state.blueprint.appId }}</span>
    </footer>
  </div>
</template>

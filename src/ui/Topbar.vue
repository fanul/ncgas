<script setup>
import { ref } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const { state } = engine;
const fileInput = ref(null);
const showApps = ref(false);

function onImportFile(e) {
  const file = e.target.files?.[0];
  if (file) engine.importJson(file);
  e.target.value = '';
}
function runValidate() {
  const res = engine.validate();
  if (res.ok) engine.toast('success', 'Blueprint valid ✓');
  else engine.toast('error', `${res.errors.length} error validasi — lihat panel kanan (klik area kosong canvas).`);
}
</script>

<template>
  <header class="ed-topbar">
    <div class="ed-brand">NCGAS<span class="ed-brand-sub">builder</span></div>

    <div class="ed-appmenu">
      <button class="ed-btn ed-btn-ghost" @click="showApps = !showApps">
        {{ state.blueprint?.meta.name || '…' }} ▾
      </button>
      <div v-if="showApps" class="ed-dropdown" @mouseleave="showApps = false">
        <button v-for="app in state.apps" :key="app.appId" class="ed-dropdown-item"
                @click="engine.openApp(app.appId); showApps = false">
          {{ app.name }} <span class="ed-dim">({{ app.pages }} hal)</span>
        </button>
        <hr />
        <button class="ed-dropdown-item" @click="engine.newBlankApp(); showApps = false">+ Aplikasi kosong</button>
        <button class="ed-dropdown-item" @click="engine.newAppFromTemplate(); showApps = false">+ Dari template Employee Dashboard</button>
        <button class="ed-dropdown-item" @click="engine.exportJson(); showApps = false">⇩ Export blueprint JSON</button>
        <button class="ed-dropdown-item" @click="fileInput.click(); showApps = false">⇧ Import blueprint JSON</button>
      </div>
      <input ref="fileInput" type="file" accept=".json" style="display:none" @change="onImportFile" />
    </div>

    <nav class="ed-pagetabs">
      <button
        v-for="p in engine.pageList.value" :key="p.id"
        class="ed-pagetab" :class="{ 'is-active': p.id === state.currentPageId }"
        @click="engine.selectPage(p.id)"
      >{{ p.title }}</button>
      <button class="ed-pagetab ed-pagetab-add" title="tambah halaman" @click="engine.addPage()">+</button>
    </nav>

    <div class="ed-topbar-actions">
      <span v-if="state.dirty" class="ed-dirty" title="perubahan belum disimpan">●</span>
      <button class="ed-btn ed-btn-ghost" :disabled="!state.undoStack.length" title="Ctrl+Z" @click="engine.undo()">↩</button>
      <button class="ed-btn ed-btn-ghost" :disabled="!state.redoStack.length" title="Ctrl+Shift+Z" @click="engine.redo()">↪</button>
      <button class="ed-btn ed-btn-ghost" @click="runValidate">Validasi</button>
      <div class="ed-modeswitch">
        <button class="ed-modebtn" :class="{ 'is-active': state.mode === 'flow' }" title="Flow — node halaman/komponen/service" @click="state.mode = 'flow'">🔀 Flow</button>
        <button class="ed-modebtn" :class="{ 'is-active': state.mode === 'design' }" title="Design — kanvas WYSIWYG" @click="state.mode = 'design'">✎ Desain</button>
        <button class="ed-modebtn" :class="{ 'is-active': state.mode === 'preview' }" title="Preview — jalankan aplikasi" @click="state.mode = 'preview'; state.previewNonce++">▶ Preview</button>
      </div>
      <button class="ed-btn" :disabled="state.busy !== null" @click="engine.save()">
        {{ state.busy === 'saving' ? 'Menyimpan…' : 'Simpan' }}
      </button>
      <button class="ed-btn ed-btn-deploy" :disabled="state.busy !== null" @click="engine.deploy()">
        {{ state.busy === 'deploying' ? 'Deploying…' : '🚀 Deploy' }}
      </button>
    </div>
  </header>
</template>

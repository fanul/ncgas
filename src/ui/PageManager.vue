<script setup>
/**
 * Page Manager — the "ALL PAGES" level of NCGAS -> ALL pages -> Page -> layout
 * -> component. Full page CRUD (add/rename/reorder/duplicate/delete) lives
 * here; the Topbar tabs remain for quick switching between already-open pages.
 */
import { ref } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const { state } = engine;
const newTitle = ref('');
const renamingId = ref(null);
const renameDraft = ref('');

function submitNewPage() {
  engine.addPage(newTitle.value.trim() || undefined);
  newTitle.value = '';
}
function startRename(page) {
  renamingId.value = page.id;
  renameDraft.value = page.title;
}
function commitRename() {
  if (renamingId.value) engine.renamePage(renamingId.value, renameDraft.value);
  renamingId.value = null;
}
function confirmDelete(page) {
  if (state.blueprint.pages && Object.keys(state.blueprint.pages).length <= 1) {
    engine.toast('error', 'Aplikasi minimal punya satu halaman.');
    return;
  }
  engine.removePage(page.id);
}
</script>

<template>
  <div class="ed-pagemgr">
    <div class="ed-panel-title">Semua Halaman</div>
    <p class="ed-hint">{{ engine.pageList.value.length }} halaman dalam aplikasi ini. Urutan di sini = urutan navigasi.</p>

    <div
      v-for="(page, i) in engine.pageList.value" :key="page.id"
      class="ed-pagerow"
      :class="{ 'is-active': page.id === state.currentPageId }"
      @click="engine.selectPage(page.id)"
    >
      <div class="ed-pagerow-order">
        <button class="ed-btn-icon" title="naik" :disabled="i === 0" @click.stop="engine.reorderPage(page.id, -1)">↑</button>
        <button class="ed-btn-icon" title="turun" :disabled="i === engine.pageList.value.length - 1"
                @click.stop="engine.reorderPage(page.id, 1)">↓</button>
      </div>

      <div class="ed-pagerow-main">
        <input
          v-if="renamingId === page.id"
          class="ed-input ed-mono" v-model="renameDraft" autofocus
          @click.stop @keydown.enter="commitRename" @keydown.escape="renamingId = null" @blur="commitRename"
        />
        <div v-else class="ed-pagerow-title" @dblclick.stop="startRename(page)">{{ page.title }}</div>
        <div class="ed-pagerow-meta">
          <span class="ed-mono">{{ page.route }}</span> · {{ page.count }} komponen
        </div>
      </div>

      <div class="ed-pagerow-actions">
        <button class="ed-btn-icon" title="ganti nama" @click.stop="startRename(page)">✎</button>
        <button class="ed-btn-icon" title="duplikat halaman" @click.stop="engine.duplicatePage(page.id)">⧉</button>
        <button class="ed-btn-icon is-danger" title="hapus halaman" @click.stop="confirmDelete(page)">🗑</button>
      </div>
    </div>

    <div class="ed-pagerow-new">
      <input
        class="ed-input" v-model="newTitle" placeholder="Nama halaman baru…"
        @keydown.enter="submitNewPage"
      />
      <button class="ed-btn ed-btn-ghost" @click="submitNewPage">+ Tambah</button>
    </div>
  </div>
</template>

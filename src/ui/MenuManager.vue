<script setup>
/**
 * Menu Manager — configures bp.menu, the sidebar navigation tree shown in
 * deployed apps (and in Preview). Empty menu = the runtime falls back to a
 * flat list of pages automatically, so this panel is purely additive: you
 * only need it once you want groups, external links, dividers, or per-item
 * role restrictions beyond a page's own allowedRoles.
 *
 * One level of nesting only (groups hold page/link/divider children; groups
 * cannot contain groups) — matches the sidebar's actual rendering.
 */
import { computed } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import { FieldText, FieldJson } from './fields.js';

const engine = useNoCodeEngine();
const { state } = engine;
const bp = computed(() => state.blueprint);
const menu = computed(() => bp.value?.menu || []);

function touch() { state.dirty = true; state.previewNonce++; }

function pageOptions() {
  return engine.pageList.value.map((p) => ({ label: p.title + ' (' + p.route + ')', value: p.id }));
}

function iconOf(item) { return item.icon ?? ''; }
function setIcon(item, v) { item.icon = v; touch(); }
function setLabel(item, v) { item.label = v; touch(); }
</script>

<template>
  <div class="ed-menumgr">
    <div class="ed-panel-title">Menu Navigasi (Sidebar)</div>
    <p class="ed-hint">
      Kosong = sidebar otomatis menampilkan semua halaman. Isi di sini untuk mengatur urutan,
      mengelompokkan ke dalam grup, menambah tautan eksternal, atau membatasi akses per item.
    </p>

    <div v-if="!menu.length" class="ed-hint-ok" style="color:var(--nc-text-dim)">
      Menggunakan menu otomatis dari daftar halaman. Tambah item di bawah untuk menyesuaikan.
    </div>

    <div v-for="(item, i) in menu" :key="item.id" class="ed-menuitem">
      <div class="ed-menuitem-head">
        <div class="ed-menuitem-order">
          <button class="ed-btn-icon" title="naik" :disabled="i === 0" @click="engine.reorderMenuItem(item.id, -1)">↑</button>
          <button class="ed-btn-icon" title="turun" :disabled="i === menu.length - 1" @click="engine.reorderMenuItem(item.id, 1)">↓</button>
        </div>
        <span class="ed-menuitem-type">{{ item.type }}</span>
        <button class="ed-btn-icon is-danger" title="hapus" @click="engine.removeMenuItem(item.id)">🗑</button>
      </div>

      <template v-if="item.type !== 'divider'">
        <div class="ed-row2">
          <div class="ed-field">
            <label class="ed-field-label">Ikon (emoji, opsional)</label>
            <FieldText :model-value="iconOf(item)" placeholder="🏠" @update:model-value="setIcon(item, $event)" />
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Label</label>
            <FieldText :model-value="item.label" @update:model-value="setLabel(item, $event)" />
          </div>
        </div>

        <div class="ed-field" v-if="item.type === 'page'">
          <label class="ed-field-label">Halaman</label>
          <select class="ed-input" :value="item.pageId" @change="item.pageId = $event.target.value; touch()">
            <option value="" disabled>Pilih halaman…</option>
            <option v-for="opt in pageOptions()" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div class="ed-field" v-if="item.type === 'link'">
          <label class="ed-field-label">URL</label>
          <FieldText :model-value="item.url" placeholder="https://…" @update:model-value="item.url = $event; touch()" />
        </div>
        <div class="ed-field" v-if="item.type !== 'group'">
          <label class="ed-field-label">Roles yang boleh lihat (kosong = semua)</label>
          <FieldJson :model-value="item.allowedRoles" :rows="1" @update:model-value="item.allowedRoles = Array.isArray($event) ? $event : []; touch()" />
        </div>
      </template>

      <div v-if="item.type === 'group'" class="ed-menuitem-children">
        <div v-for="(child, ci) in (item.children || [])" :key="child.id" class="ed-menuitem ed-menuitem-nested">
          <div class="ed-menuitem-head">
            <div class="ed-menuitem-order">
              <button class="ed-btn-icon" title="naik" :disabled="ci === 0" @click="engine.reorderMenuItem(child.id, -1)">↑</button>
              <button class="ed-btn-icon" title="turun" :disabled="ci === item.children.length - 1" @click="engine.reorderMenuItem(child.id, 1)">↓</button>
            </div>
            <span class="ed-menuitem-type">{{ child.type }}</span>
            <button class="ed-btn-icon is-danger" title="hapus" @click="engine.removeMenuItem(child.id)">🗑</button>
          </div>
          <template v-if="child.type !== 'divider'">
            <div class="ed-row2">
              <div class="ed-field">
                <label class="ed-field-label">Ikon</label>
                <FieldText :model-value="iconOf(child)" placeholder="📄" @update:model-value="setIcon(child, $event)" />
              </div>
              <div class="ed-field">
                <label class="ed-field-label">Label</label>
                <FieldText :model-value="child.label" @update:model-value="setLabel(child, $event)" />
              </div>
            </div>
            <div class="ed-field" v-if="child.type === 'page'">
              <label class="ed-field-label">Halaman</label>
              <select class="ed-input" :value="child.pageId" @change="child.pageId = $event.target.value; touch()">
                <option value="" disabled>Pilih halaman…</option>
                <option v-for="opt in pageOptions()" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
            <div class="ed-field" v-if="child.type === 'link'">
              <label class="ed-field-label">URL</label>
              <FieldText :model-value="child.url" placeholder="https://…" @update:model-value="child.url = $event; touch()" />
            </div>
          </template>
        </div>
        <div class="ed-menuitem-addrow">
          <button class="ed-btn ed-btn-ghost" @click="engine.addMenuChildItem(item.id, 'page')">+ Halaman</button>
          <button class="ed-btn ed-btn-ghost" @click="engine.addMenuChildItem(item.id, 'link')">+ Tautan</button>
          <button class="ed-btn ed-btn-ghost" @click="engine.addMenuChildItem(item.id, 'divider')">+ Pemisah</button>
        </div>
      </div>
    </div>

    <div class="ed-menuitem-addrow" style="margin-top:10px">
      <button class="ed-btn ed-btn-ghost" @click="engine.addMenuItem('page')">+ Halaman</button>
      <button class="ed-btn ed-btn-ghost" @click="engine.addMenuItem('group')">+ Grup</button>
      <button class="ed-btn ed-btn-ghost" @click="engine.addMenuItem('link')">+ Tautan</button>
      <button class="ed-btn ed-btn-ghost" @click="engine.addMenuItem('divider')">+ Pemisah</button>
    </div>
  </div>
</template>

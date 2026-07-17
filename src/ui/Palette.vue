<script setup>
import { ref } from 'vue';
import { paletteByCategory } from './registry.js';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import PageManager from './PageManager.vue';
import MenuManager from './MenuManager.vue';

const engine = useNoCodeEngine();
const groups = paletteByCategory();
const tab = ref('components'); // 'components' | 'pages' | 'menu'

function onDragStart(e, type) {
  e.dataTransfer.setData('ncgas/component-type', type);
  e.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <aside class="ed-palette">
    <div class="ed-palette-tabs">
      <button class="ed-palette-tab" :class="{ 'is-active': tab === 'components' }" @click="tab = 'components'">Komponen</button>
      <button class="ed-palette-tab" :class="{ 'is-active': tab === 'pages' }" @click="tab = 'pages'">Halaman</button>
      <button class="ed-palette-tab" :class="{ 'is-active': tab === 'menu' }" @click="tab = 'menu'">Menu</button>
    </div>

    <template v-if="tab === 'components'">
      <p class="ed-hint">Drag ke canvas, atau klik untuk menambahkan di halaman ini.</p>
      <div v-for="group in groups" :key="group.category" class="ed-palette-group">
        <div class="ed-palette-cat">{{ group.category }}</div>
        <button
          v-for="item in group.items"
          :key="item.type"
          class="ed-palette-item"
          draggable="true"
          :title="item.type"
          @dragstart="onDragStart($event, item.type)"
          @click="engine.addComponent(item.type)"
        >
          <span class="ed-palette-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </template>

    <PageManager v-else-if="tab === 'pages'" />
    <MenuManager v-else />
  </aside>
</template>

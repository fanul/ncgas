<script setup>
import { paletteByCategory } from './registry.js';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';

const engine = useNoCodeEngine();
const groups = paletteByCategory();

function onDragStart(e, type) {
  e.dataTransfer.setData('ncgas/component-type', type);
  e.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <aside class="ed-palette">
    <div class="ed-panel-title">Komponen</div>
    <p class="ed-hint">Drag ke canvas, atau klik untuk menambahkan di akhir halaman.</p>
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
  </aside>
</template>

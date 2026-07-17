<script setup>
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import AppGraph from './AppGraph.vue';
import PageGraph from './PageGraph.vue';

const engine = useNoCodeEngine();
const { state } = engine;
</script>

<template>
  <div class="ed-flow">
    <PageGraph v-if="state.flowDrilledIn" />
    <AppGraph v-else />
  </div>
</template>

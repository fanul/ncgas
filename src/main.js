import { createApp } from 'vue';
import App from './App.vue';
import { BASE_CSS } from './engine.js';
import './style.css';

// Inject the shared component stylesheet (the same string Compiler.gs embeds
// into every deployed app) so canvas/preview render exactly like production.
const tag = document.createElement('style');
tag.id = 'ncgas-base-css';
tag.textContent = BASE_CSS;
document.head.appendChild(tag);

createApp(App).mount('#app');

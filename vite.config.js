import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode gas` inlines everything into one Index.html so the editor itself can
// be hosted as a Google Apps Script web app (HtmlService serves single files).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [vue(), ...(mode === 'gas' ? [viteSingleFile()] : [])],
  build: {
    target: 'es2018',
    outDir: mode === 'gas' ? 'dist-gas' : 'dist'
  }
}));

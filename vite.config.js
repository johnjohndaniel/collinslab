import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Every experiment is its own page: add a folder under experiments/ and list it here.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        specimen: resolve(import.meta.dirname, 'experiments/specimen/index.html'),
      },
    },
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Every experiment is its own page: add a folder under experiments/ and list it here.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        specimen: resolve(import.meta.dirname, 'experiments/specimen/index.html'),
        login: resolve(import.meta.dirname, 'login/index.html'),
        board: resolve(import.meta.dirname, 'board/index.html'),
        projects: resolve(import.meta.dirname, 'projects/index.html'),
        project: resolve(import.meta.dirname, 'projects/view/index.html'),
        chats: resolve(import.meta.dirname, 'chats/index.html'),
        manuscripts: resolve(import.meta.dirname, 'manuscripts/index.html'),
        manuscript: resolve(import.meta.dirname, 'manuscripts/view/index.html'),
        brain: resolve(import.meta.dirname, 'brain/index.html'),
        brainGraph: resolve(import.meta.dirname, 'brain/graph/index.html'),
        bookstore: resolve(import.meta.dirname, 'bookstore/index.html'),
        readingframe: resolve(import.meta.dirname, 'readingframe/index.html'),
        readingframePrivacy: resolve(import.meta.dirname, 'readingframe/privacy/index.html'),
      },
    },
  },
});

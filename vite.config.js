import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page setup. Each city has its own HTML entry; the landing page is
// the default `/`.
export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        nyc: resolve(__dirname, 'nyc.html'),
        sf: resolve(__dirname, 'sf.html'),
      },
    },
  },
});

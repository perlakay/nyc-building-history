import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

// Multi-page setup. Each city has its own HTML entry; the landing page is
// the default `/`.
export default defineConfig({
  plugins: [{
    name: 'omit-unreleased-city-data',
    closeBundle() {
      rmSync(resolve(__dirname, 'dist/data/dc'), { recursive: true, force: true });
    },
  }],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        nyc: resolve(__dirname, 'nyc.html'),
        sf: resolve(__dirname, 'sf.html'),
        london: resolve(__dirname, 'london.html'),
      },
    },
  },
});

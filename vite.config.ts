import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Caminhos relativos: o site funciona no GitHub Pages (/learnfast/) e em qualquer outra pasta.
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        leitor: resolve(__dirname, 'leitor.html'),
        licencas: resolve(__dirname, 'licencas.html'),
        ajuda: resolve(__dirname, 'ajuda.html'),
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});

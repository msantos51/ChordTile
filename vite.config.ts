import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Caminhos relativos: o site funciona no GitHub Pages (/ChordTile/) e em qualquer outra pasta.
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        player: resolve(__dirname, 'player.html'),
        licenses: resolve(__dirname, 'licenses.html'),
        help: resolve(__dirname, 'help.html'),
        account: resolve(__dirname, 'account.html'),
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});

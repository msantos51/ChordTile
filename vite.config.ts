import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const PAGES = ['player', 'licenses', 'help', 'account'];

/**
 * Endereços sem ".html" (/player, /account…), como o GitHub Pages os serve: o servidor local
 * (npm run dev e npm run preview) passa a responder a /account com account.html.
 */
function cleanUrls(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [path, query] = (req.url ?? '').split(/(?=[?#])/);
    const page = path.replace(/^\//, '');
    if (PAGES.includes(page)) req.url = '/' + page + '.html' + (query ?? '');
    next();
  };
  return {
    name: 'clean-urls',
    configureServer: server => { server.middlewares.use(rewrite); },
    configurePreviewServer: server => { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  // Caminhos relativos para os ficheiros (assets), e ligações entre páginas sem ".html" (/player, /account…).
  base: './',
  plugins: [cleanUrls()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...Object.fromEntries(PAGES.map(p => [p, resolve(__dirname, p + '.html')])),
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});

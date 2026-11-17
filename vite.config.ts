import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv, type Connect, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const PAGES = ['licenses', 'help', 'account', 'contact', 'open-guitar-pro-files'];

/** Páginas antigas que só reencaminham (em public/): /player passou a ser a página inicial. */
const REDIRECTS = ['player', 'leitor', 'learn', 'ajuda', 'licencas'];

/**
 * Endereços sem ".html" (/account, /help…), como o GitHub Pages os serve: o servidor local
 * (npm run dev e npm run preview) passa a responder a /account com account.html.
 */
function cleanUrls(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [path, query] = (req.url ?? '').split(/(?=[?#])/);
    const page = path.replace(/^\//, '');
    if (PAGES.includes(page) || REDIRECTS.includes(page)) req.url = '/' + page + '.html' + (query ?? '');
    next();
  };
  return {
    name: 'clean-urls',
    configureServer: server => { server.middlewares.use(rewrite); },
    configurePreviewServer: server => { server.middlewares.use(rewrite); },
  };
}

/**
 * Política de segurança do conteúdo (CSP). O GitHub Pages não deixa definir cabeçalhos HTTP, por isso vai numa
 * <meta http-equiv> em cada página publicada (só na build: o servidor de desenvolvimento do Vite precisa de
 * scripts inline e de websockets que a política bloquearia).
 * - Scripts: só os do próprio site, mais os scripts inline exatos de cada página (pelo hash SHA-256).
 * - Pedidos: o próprio site e o projeto Supabase. Os pagamentos da Stripe são links normais (não pedidos).
 * - Workers: o alphaTab cria-os a partir de um blob:. Estilos inline: atributos style= e os do alphaTab.
 */
export function cspFor(html: string, supabaseUrl: string): string {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    // Blocos de dados (JSON-LD) não são executados e a CSP não se lhes aplica
    .filter(([, attrs]) => !/type\s*=\s*["']?application\/(ld\+)?json/i.test(attrs))
    .map(([, , code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...hashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    ['connect-src', "'self'", supabase].filter(Boolean).join(' '),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function contentSecurityPolicy(): Plugin {
  let outDir = 'dist', supabaseUrl = '';
  return {
    name: 'content-security-policy',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
      supabaseUrl = loadEnv(cfg.mode, cfg.envDir || cfg.root, 'VITE_').VITE_SUPABASE_URL ?? '';
    },
    // No fim, para apanhar também as páginas copiadas de public/ (redirecionamentos e 404)
    closeBundle() {
      for (const f of readdirSync(outDir).filter(n => n.endsWith('.html'))) {
        const path = join(outDir, f), html = readFileSync(path, 'utf8');
        if (html.includes('Content-Security-Policy')) continue;
        const meta = `<meta http-equiv="Content-Security-Policy" content="${cspFor(html, supabaseUrl)}">`;
        writeFileSync(path, html.replace(/(<meta charset[^>]*>)/i, `$1\n${meta}`));
      }
    },
  };
}

export default defineConfig({
  // Caminhos relativos para os ficheiros (assets), e ligações entre páginas sem ".html" (/account, /help…).
  base: './',
  plugins: [cleanUrls(), contentSecurityPolicy()],
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

// Converte as fontes Roboto do site (WOFF, via Fontsource) em TTF para public/vendor/fonts:
// o jsPDF só aceita TTF, e assim o PDF usa a mesma letra que o site.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public/vendor/fonts');
mkdirSync(out, { recursive: true });

/** WOFF 1.0 → sfnt (TTF): descomprime cada tabela e volta a montar o diretório. */
function woffToTtf(woff) {
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (v.getUint32(0) !== 0x774f4646) throw new Error('not a WOFF file');
  const flavor = v.getUint32(4), n = v.getUint16(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const tag = v.getUint32(e), off = v.getUint32(e + 4), comp = v.getUint32(e + 8), orig = v.getUint32(e + 12), sum = v.getUint32(e + 16);
    const raw = woff.subarray(off, off + comp);
    tables.push({ tag, sum, data: comp < orig ? inflateSync(raw) : raw });
  }
  let size = 12 + 16 * n;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const buf = new Uint8Array(size), o = new DataView(buf.buffer);
  let es = 0; while (1 << (es + 1) <= n) es++;
  o.setUint32(0, flavor); o.setUint16(4, n); o.setUint16(6, 16 << es); o.setUint16(8, es); o.setUint16(10, n * 16 - (16 << es));
  let pos = 12 + 16 * n;
  tables.forEach((t, i) => {
    const e = 12 + i * 16;
    o.setUint32(e, t.tag); o.setUint32(e + 4, t.sum); o.setUint32(e + 8, pos); o.setUint32(e + 12, t.data.length);
    buf.set(t.data, pos); pos += (t.data.length + 3) & ~3;
  });
  return buf;
}

const fonts = [
  ['@fontsource/roboto/files/roboto-latin-400-normal.woff', 'Roboto-Regular.ttf'],
  ['@fontsource/roboto/files/roboto-latin-500-normal.woff', 'Roboto-Medium.ttf'],
  ['@fontsource/roboto/files/roboto-latin-700-normal.woff', 'Roboto-Bold.ttf'],
  ['@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff', 'RobotoMono-Regular.ttf'],
  ['@fontsource/roboto-mono/files/roboto-mono-latin-500-normal.woff', 'RobotoMono-Medium.ttf'],
];
for (const [src, name] of fonts) writeFileSync(join(out, name), woffToTtf(readFileSync(require.resolve(src))));
cpLicense();
function cpLicense() {
  const lic = join(dirname(require.resolve('@fontsource/roboto/package.json')), 'LICENSE');
  try { writeFileSync(join(out, 'LICENSE'), readFileSync(lic)); } catch { /* sem licença no pacote */ }
}
console.log(`Fontes do PDF em ${out}`);

import type { jsPDF as JsPDF } from 'jspdf';

/** Cores das notas (iguais às do site), por classe de nota: 0 = Dó … 11 = Si. */
export const NOTE_HEX = ['#fda19e', '#f9a782', '#efaf6f', '#deb866', '#ccc069', '#a6cc80', '#81d39f', '#5cd5c7', '#71c9fa', '#b0b6ff', '#d3aaf3', '#f4a0c8'];

/**
 * `note`: texto pessoal do compasso, escrito em pequeno por baixo do acorde.
 * `repeatStart` / `repeats`: sinais de repetição, como no site ("‖: 5" e ":‖ ×2").
 */
export interface PdfBar { n: number; text: string; pcs: number[]; note?: string; repeatStart?: boolean; repeats?: number }
export interface PdfSection { name: string; range: string; bars: PdfBar[] }
export interface PdfChart {
  title: string;
  meta: string;
  sections: PdfSection[];
  perRow: number;
  colors: boolean;
  /** Tema do site no momento da exportação: o PDF fica com as mesmas cores (escuro por defeito). */
  theme?: 'dark' | 'light';
  /** Nomes das 12 notas para a legenda (Dó = 0), com as mesmas opções de notação do site. */
  noteKey?: string[];
  /** Plano Free: texto em diagonal em cada página (o Premium exporta sem marca de água). */
  watermark?: string;
}
/** Fontes TTF (em base64) para o PDF ter a mesma letra do site; sem elas usa Helvetica. */
export interface PdfFonts { regular: string; medium: string; bold: string; mono: string; monoMedium: string }

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
/** Igual ao color-mix() do CSS: `amount` de `a` e o resto de `b`. */
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount))) as Rgb;
const WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0];
const NOTE_INK: Rgb = [18, 18, 18];
const ACCENT: Rgb = rgb('#d0122f');

/** Paleta do site (src/styles.css), com as transparências já misturadas com o fundo. */
const PALETTES = {
  dark: { bg: rgb('#1f2024'), panel: rgb('#2a2b31'), line: mix(WHITE, rgb('#2a2b31'), 0.14), sep: mix(WHITE, rgb('#1f2024'), 0.14),
    strong: WHITE, soft: rgb('#bfc0c6') },
  light: { bg: rgb('#f4f2f0'), panel: WHITE, line: rgb('#e4e1dc'), sep: rgb('#e4e1dc'), strong: rgb('#121212'), soft: rgb('#66625c') },
};

/** Medidas do site em px, convertidas em mm: o esquema ocupa a largura da página como a coluna do site (~520 px). */
const PX = 180 / 520;
const pt = (px: number) => px * PX * 72 / 25.4;

/** Desenha o esquema num A4 vertical (a música inteira numa folha), com o aspeto do site: fundo do tema, legenda das notas, secções e quadrados. */
export function buildPdf(JsPdf: typeof JsPDF, chart: PdfChart, fonts?: PdfFonts): JsPDF {
  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const P = PALETTES[chart.theme ?? 'dark'];
  const W = 210, H = 297, M = 15, contentW = W - 2 * M, bottom = H - M - 6;

  // Letra: Roboto (como no site) quando as fontes vêm carregadas
  let SANS = 'helvetica', MONO = 'courier';
  const has = { medium: false };
  if (fonts) {
    const add = (file: string, data: string, family: string, style: string) => { doc.addFileToVFS(file, data); doc.addFont(file, family, style); };
    add('Roboto-Regular.ttf', fonts.regular, 'Roboto', 'normal');
    add('Roboto-Medium.ttf', fonts.medium, 'Roboto', 'medium');
    add('Roboto-Bold.ttf', fonts.bold, 'Roboto', 'bold');
    add('RobotoMono-Regular.ttf', fonts.mono, 'RobotoMono', 'normal');
    add('RobotoMono-Medium.ttf', fonts.monoMedium, 'RobotoMono', 'medium');
    SANS = 'Roboto'; MONO = 'RobotoMono'; has.medium = true;
  }
  const font = (family: string, style: 'normal' | 'medium' | 'bold', px: number, color: Rgb) => {
    doc.setFont(family, style === 'medium' && !has.medium ? (family === SANS ? 'bold' : 'normal') : style);
    doc.setFontSize(pt(px)); doc.setTextColor(...color);
  };
  /** Altura de maiúscula (para centrar texto na vertical), em mm. */
  const cap = (px: number) => px * PX * 0.71;

  const paintPage = () => { doc.setFillColor(...P.bg); doc.rect(0, 0, W, H, 'F'); };
  const clipRound = (x: number, y: number, w: number, h: number, r: number) => {
    doc.saveGraphicsState();
    doc.roundedRect(x, y, w, h, r, r, null as unknown as string); doc.clip(); doc.discardPath();
  };

  paintPage();
  let y = M;

  // Marca: tile vermelho com o C recortado + "ChordTile" (como na barra de topo do site)
  const logo = (x: number, y0: number, s: number) => {
    const u = s / 224, X = (v: number) => x + (v - 16) * u, Y = (v: number) => y0 + (v - 16) * u;
    doc.setFillColor(...ACCENT); doc.roundedRect(X(16), Y(16), 224 * u, 224 * u, 60 * u, 60 * u, 'F');
    doc.setFillColor(...P.bg); doc.roundedRect(X(65), Y(61), 134 * u, 134 * u, 43 * u, 43 * u, 'F');
    doc.setFillColor(...ACCENT); doc.roundedRect(X(95), Y(91), 74 * u, 74 * u, 13 * u, 13 * u, 'F');
    doc.rect(X(150), Y(104), 52 * u, 48 * u, 'F');
  };
  const logoS = 24 * PX;
  logo(M, y, logoS);
  font(SANS, 'medium', 19, P.strong);
  doc.text('ChordTile', M + logoS + 8 * PX, y + logoS / 2 + cap(19) / 2);
  y += logoS + 22 * PX;

  // Título e dados da música
  font(SANS, 'bold', 30, P.strong);
  const titleLines = doc.splitTextToSize(chart.title, contentW) as string[];
  titleLines.slice(0, 2).forEach((l, k) => doc.text(l, M, y + cap(30) + k * 36 * PX));
  y += cap(30) + (Math.min(2, titleLines.length) - 1) * 36 * PX + 14 * PX;
  font(SANS, 'normal', 13, P.soft);
  doc.text(chart.meta, M, y + cap(13), { maxWidth: contentW });
  y += cap(13) + 18 * PX;
  doc.setDrawColor(...P.sep); doc.setLineWidth(0.25); doc.line(M, y, W - M, y);
  y += 20 * PX;

  // "CHART" e a legenda das cores das notas
  const label = (text: string, x: number, yy: number, px: number, color: Rgb, spacing: number, family = MONO, style: 'normal' | 'medium' | 'bold' = 'medium') => {
    font(family, style, px, color);
    doc.text(text, x, yy, { charSpace: px * spacing * PX });
    return doc.getTextWidth(text) + text.length * px * spacing * PX;
  };
  label('CHART', M, y + cap(11), 11, P.soft, 0.08);
  y += 11 * PX + 12 * PX;
  if (chart.colors && chart.noteKey?.length === 12) {
    const kw = 26 * PX, kh = 20 * PX, kg = 3 * PX;
    chart.noteKey.forEach((name, pc) => {
      const x = M + pc * (kw + kg), c = rgb(NOTE_HEX[pc]);
      clipRound(x, y, kw, kh, 5 * PX);
      doc.setFillColor(...c); doc.rect(x, y, kw, kh, 'F');
      doc.setFillColor(...mix(c, BLACK, 0.72)); doc.rect(x, y + kh - 2 * PX, kw, 2 * PX, 'F');
      doc.restoreGraphicsState();
      font(MONO, 'medium', 10, NOTE_INK);
      doc.text(name, x + kw / 2, y + kh / 2 + cap(10) / 2 - PX, { align: 'center' });
    });
    y += kh + 24 * PX;
  }

  const newPage = () => { doc.addPage(); paintPage(); y = M; };

  // A música inteira numa só folha: escolhem-se as colunas e a escala (k) dos quadrados para caberem no espaço que sobra.
  const { per, k } = fitLayout(chart, bottom - y, contentW, (text, px) => { font(SANS, 'medium', px, P.soft); return doc.getTextWidth(text); });
  const u = PX * k;
  const gap = 4 * u;
  const tileW = (contentW - gap * (per - 1)) / per;
  const R = Math.min(10 * u, tileW / 4);
  const kcap = (px: number) => cap(px * k);
  const kfont = (family: string, style: 'normal' | 'medium' | 'bold', px: number, color: Rgb) => font(family, style, px * k, color);

  /** "‖" desenhado com dois traços (as fontes Roboto não têm este sinal). Devolve o x a seguir. */
  const dbl = (x: number, base: number, px: number, color: Rgb) => {
    const h = kcap(px) * 1.25, w = 0.09 * px * u;
    doc.setFillColor(...color);
    doc.rect(x + 0.6 * px * u * 0.18, base - h + kcap(px) * 0.1, w, h, 'F');
    doc.rect(x + 0.6 * px * u * 0.18 + 2.2 * w, base - h + kcap(px) * 0.1, w, h, 'F');
    return x + 0.6 * px * u * 0.7;
  };
  /** Linhas do texto pessoal de um compasso (até 2), na largura do quadrado. */
  const noteLines = (note: string) => {
    kfont(SANS, 'medium', 10.5, P.soft);
    const all = doc.splitTextToSize(note, tileW - 12 * u) as string[], lines = all.slice(0, 2);
    if (all.length > 2) lines[1] = lines[1].replace(/\s*\S?$/, '…');
    return lines;
  };

  /** Um quadrado do esquema, como .bar no site. */
  const tile = (bar: PdfBar, x: number, ty: number, th: number) => {
    const c1 = chart.colors && bar.pcs.length ? rgb(NOTE_HEX[bar.pcs[0]]) : null;
    const c2 = c1 && bar.pcs.length === 2 && bar.pcs[1] !== bar.pcs[0] ? rgb(NOTE_HEX[bar.pcs[1]]) : null;
    clipRound(x, ty, tileW, th, R);
    if (!c1) {
      doc.setFillColor(...P.panel); doc.rect(x, ty, tileW, th, 'F');
    } else if (c2) {
      // Dois acordes: metade e metade, com a cor cheia
      doc.setFillColor(...c1); doc.rect(x, ty, tileW / 2, th, 'F');
      doc.setFillColor(...c2); doc.rect(x + tileW / 2, ty, tileW / 2 + 0.1, th, 'F');
    } else {
      // Gradiente vertical: um pouco mais claro em cima, a cor cheia em baixo
      const top = mix(c1, WHITE, 0.82), steps = 24, sh = th / steps;
      for (let j = 0; j < steps; j++) {
        doc.setFillColor(...mix(c1, top, j / (steps - 1)));
        doc.rect(x, ty + j * sh, tileW, sh + 0.05, 'F');
      }
    }
    if (c1) { doc.setFillColor(...mix(c1, BLACK, 0.72)); doc.rect(x, ty + th - 3 * u, tileW, 3 * u, 'F'); }
    doc.restoreGraphicsState();
    if (!c1) { doc.setDrawColor(...P.line); doc.setLineWidth(1 * u); doc.roundedRect(x + u / 2, ty + u / 2, tileW - u, th - u, R, R, 'S'); }

    const back = c1 ?? P.panel;
    const numInk = c1 ? mix(NOTE_INK, back, 0.6) : P.soft;
    kfont(MONO, 'normal', 9, numInk);
    let nx = x + 6 * u;
    const ny = ty + 4 * u + kcap(9);
    if (bar.repeatStart) { nx = dbl(nx, ny, 9, numInk); doc.text(':', nx, ny); nx += doc.getTextWidth(': '); }
    doc.text(String(bar.n), nx, ny);

    // O acorde numa só linha: se não couber na largura do quadrado, a letra encolhe
    let chordPx = per > 6 ? 15 : 17;
    kfont(SANS, 'bold', chordPx, c1 ? NOTE_INK : P.strong);
    const room = tileW - 8 * u, tw = doc.getTextWidth(bar.text);
    if (tw > room) { chordPx *= Math.max(0.5, room / tw); kfont(SANS, 'bold', chordPx, c1 ? NOTE_INK : P.strong); }
    const chordY = bar.note ? ty + 10 * u + kcap(chordPx) : ty + th / 2 + kcap(chordPx) / 2;
    doc.text(bar.text, x + tileW / 2, chordY, { align: 'center' });
    if (bar.note) {
      const lines = noteLines(bar.note);
      kfont(SANS, 'medium', 10.5, c1 ? mix(NOTE_INK, back, 0.78) : P.soft);
      lines.forEach((l, j) => doc.text(l, x + tileW / 2, chordY + 8 * u + kcap(10.5) + j * 13 * u, { align: 'center' }));
    }
    if (bar.repeats) {
      const ink = c1 ? NOTE_INK : P.strong, t = ' ×' + bar.repeats;
      kfont(MONO, 'medium', 9, ink);
      const colon = doc.getTextWidth(':');
      const bw = colon + 4 * u + doc.getTextWidth(t) + 8 * u, bh = 13 * u, bx = x + tileW - 5 * u - bw, by = ty + th - 4 * u - bh;
      // Fundo do sinal como --rep-bg (branco a 12% no escuro, preto a 8% no claro)
      const light = chart.theme === 'light';
      doc.setFillColor(...mix(light ? NOTE_INK : WHITE, back, light ? 0.08 : 0.12)); doc.roundedRect(bx, by, bw, bh, 3 * u, 3 * u, 'F');
      const ry = by + bh / 2 + kcap(9) / 2;
      doc.text(':', bx + 4 * u, ry);
      doc.text(t, dbl(bx + 4 * u + colon, ry, 9, ink), ry);
    }
  };

  const headH = 20 * u;
  // Como no site, a linha cresce com o texto pessoal (até 2 linhas)
  const rowH = (row: PdfBar[]) => {
    const lines = Math.max(0, ...row.map(b => (b.note ? noteLines(b.note).length : 0)));
    return (lines ? 44 + lines * 13 : 44) * u;
  };
  chart.sections.forEach((sec, si) => {
    if (si > 0) y += 18 * u;
    const firstRow = sec.bars.slice(0, per);
    // O nome da secção nunca fica sozinho no fim de uma página.
    if (y + headH + rowH(firstRow) > bottom) newPage();
    const hy = y + kcap(12);
    const w = label(sec.name.toUpperCase(), M, hy, 12 * k, P.strong, 0.1, SANS, 'bold');
    const meta = sec.range + (sec.bars.length ? ' · ' + sec.bars.length + ' bar' + (sec.bars.length === 1 ? '' : 's') : '');
    if (sec.range) { kfont(MONO, 'normal', 11, P.soft); doc.text(meta, M + w + 10 * u, hy); }
    y += headH;

    for (let r = 0; r < sec.bars.length; r += per) {
      const row = sec.bars.slice(r, r + per), th = rowH(row);
      if (y + th > bottom) newPage();
      row.forEach((bar, j) => tile(bar, M + j * (tileW + gap), y, th));
      y += th + gap;
    }
    y -= gap;
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (chart.watermark) {
      // Semitransparente, para não tapar os acordes
      doc.saveGraphicsState();
      const GState = (doc as unknown as { GState: new (o: { opacity: number }) => Parameters<JsPDF['setGState']>[0] }).GState;
      doc.setGState(new GState({ opacity: 0.1 }));
      font(SANS, 'bold', 125, P.strong);
      doc.text(chart.watermark, W / 2, H / 2, { align: 'center', angle: 35 });
      doc.restoreGraphicsState();
    }
    font(MONO, 'normal', 10, P.soft);
    doc.text(chart.watermark ? 'Made with ChordTile (Free)' : 'ChordTile', M, H - M + 2);
    doc.text(p + ' / ' + pages, W - M, H - M + 2, { align: 'right' });
  }
  return doc;
}

/**
 * Colunas e escala dos quadrados para a música inteira caber em `avail` mm de altura (uma folha A4).
 * Experimenta múltiplos das colunas do site (até 16) e fica com a que deixa os quadrados maiores;
 * com espaço de sobra fica no tamanho normal (k = 1) e nas colunas do site.
 * `noteWidth(text, px)`: largura do texto pessoal numa dada letra, para contar as linhas que ocupa.
 */
export function fitLayout(chart: Pick<PdfChart, 'sections' | 'perRow'>, avail: number, contentW: number,
  noteWidth?: (text: string, px: number) => number): { per: number; k: number } {
  const base = Math.max(1, chart.perRow);
  const height = (per: number, k: number) => {
    const u = PX * k, gap = 4 * u, tileW = (contentW - gap * (per - 1)) / per;
    let h = 0;
    chart.sections.forEach((sec, si) => {
      if (si > 0) h += 18 * u;
      h += 20 * u;
      for (let r = 0; r < sec.bars.length; r += per) {
        const lines = Math.max(0, ...sec.bars.slice(r, r + per).map(b => {
          if (!b.note || !noteWidth) return b.note ? 1 : 0;
          return Math.min(2, Math.ceil(noteWidth(b.note, 10.5 * k) / Math.max(1, tileW - 12 * u)));
        }));
        h += (lines ? 44 + lines * 13 : 44) * u + gap;
      }
      if (sec.bars.length) h -= gap;
    });
    return h;
  };
  const scaleFor = (per: number) => {
    let k = 1;
    // A altura é quase proporcional a k (só o texto pessoal muda de linhas): poucas aproximações chegam
    for (let i = 0; i < 4; i++) { const h = height(per, k); if (h <= avail) break; k *= avail / h; }
    return Math.max(0.2, Math.min(1, k));
  };
  const options: number[] = [];
  for (let per = base; per <= Math.max(base, 16); per += base) options.push(per);
  let best = { per: base, k: scaleFor(base) };
  if (best.k >= 1) return best;
  for (const per of options.slice(1)) {
    const k = scaleFor(per);
    if (k > best.k + 0.01) best = { per, k };
    if (k >= 1) break;
  }
  return best;
}

/** Nome de ficheiro seguro a partir do título da música. */
export function pdfFileName(title: string): string {
  const base = title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'song';
  return base + '-chart.pdf';
}

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
let fontsP: Promise<PdfFonts | undefined> | null = null;
/** Carrega as fontes Roboto em TTF (geradas por scripts/pdf-fonts.mjs). Se falhar, o PDF sai em Helvetica. */
function loadFonts(base: string): Promise<PdfFonts | undefined> {
  const get = (f: string) => fetch(base + 'vendor/fonts/' + f).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }).then(toBase64);
  fontsP ??= Promise.all(['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf', 'RobotoMono-Regular.ttf', 'RobotoMono-Medium.ttf'].map(get))
    .then(([regular, medium, bold, mono, monoMedium]) => ({ regular, medium, bold, mono, monoMedium }))
    .catch(() => { fontsP = null; return undefined; });
  return fontsP;
}

/** Carrega o jsPDF só quando é preciso (não pesa no arranque do site) e descarrega o PDF. */
export async function exportPdf(chart: PdfChart, base = './'): Promise<void> {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFonts(base)]);
  buildPdf(jsPDF, chart, fonts).save(pdfFileName(chart.title));
}

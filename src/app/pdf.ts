import type { jsPDF as JsPDF } from 'jspdf';

/** Cores das notas (iguais às do site), por classe de nota: 0 = Dó … 11 = Si. */
export const NOTE_HEX = ['#ff4d4d', '#ff6d3a', '#ff9a2e', '#ffbe1f', '#f2d40a', '#9bd13b', '#3ccf6e', '#1cc2b0', '#3b9cff', '#7c5cff', '#c056f0', '#ff5fa8'];

export interface PdfBar { n: number; text: string; pcs: number[] }
export interface PdfSection { name: string; range: string; bars: PdfBar[] }
export interface PdfChart {
  title: string;
  meta: string;
  sections: PdfSection[];
  perRow: number;
  colors: boolean;
  /** Plano Free: texto em diagonal em cada página (o Premium exporta sem marca de água). */
  watermark?: string;
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
/** Mistura a cor com branco (para imprimir bem e gastar pouca tinta). */
const tint = (c: Rgb, amount: number): Rgb => c.map(v => Math.round(255 - (255 - v) * amount)) as Rgb;

const INK: Rgb = [20, 21, 26];
const SOFT: Rgb = [110, 115, 128];
const LINE: Rgb = [222, 224, 230];

/** Desenha o esquema num A4 vertical: título, secções e quadrados com a cor da nota. */
export function buildPdf(JsPdf: typeof JsPDF, chart: PdfChart): JsPDF {
  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210, H = 297, M = 15, contentW = W - 2 * M, bottom = H - M - 8;
  const gap = 1.6, tileH = 11;
  const per = Math.max(1, chart.perRow);
  const tileW = (contentW - gap * (per - 1)) / per;

  let y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...INK);
  doc.text(chart.title, M, y + 7, { maxWidth: contentW });
  y += 12;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...SOFT);
  doc.text(chart.meta, M, y + 2, { maxWidth: contentW });
  y += 6;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
  y += 7;

  const newPage = () => { doc.addPage(); y = M; };

  for (const sec of chart.sections) {
    // O nome da secção nunca fica sozinho no fim de uma página.
    if (y + 7 + tileH > bottom) newPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text(sec.name, M, y + 3.5);
    const nameW = doc.getTextWidth(sec.name);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SOFT);
    doc.text(sec.range, M + nameW + 3, y + 3.5);
    y += 6;

    for (let r = 0; r < sec.bars.length; r += per) {
      if (y + tileH > bottom) newPage();
      sec.bars.slice(r, r + per).forEach((bar, j) => {
        const x = M + j * (tileW + gap);
        const cols = chart.colors ? bar.pcs.map(pc => rgb(NOTE_HEX[pc])) : [];
        if (cols.length === 2) {
          doc.setFillColor(...tint(cols[0], 0.32)); doc.rect(x, y, tileW / 2, tileH, 'F');
          doc.setFillColor(...tint(cols[1], 0.32)); doc.rect(x + tileW / 2, y, tileW / 2, tileH, 'F');
        } else {
          doc.setFillColor(...(cols[0] ? tint(cols[0], 0.32) : ([246, 247, 249] as Rgb)));
          doc.rect(x, y, tileW, tileH, 'F');
        }
        if (cols[0]) { doc.setFillColor(...cols[0]); doc.rect(x, y + tileH - 1, tileW, 1, 'F'); }
        else { doc.setDrawColor(...LINE); doc.rect(x, y, tileW, tileH, 'S'); }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...SOFT);
        doc.text(String(bar.n), x + 1.2, y + 2.6);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(per > 6 ? 10 : 12.5); doc.setTextColor(...INK);
        doc.text(bar.text, x + tileW / 2, y + tileH / 2 + 1.6, { align: 'center', maxWidth: tileW - 2 });
      });
      y += tileH + gap;
    }
    y += 5;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SOFT);
    doc.text(chart.watermark ? 'Made with ChordTile (Free)' : 'ChordTile', M, H - M + 2);
    if (chart.watermark) {
      // Semitransparente, para não tapar os acordes
      doc.saveGraphicsState();
      const GState = (doc as unknown as { GState: new (o: { opacity: number }) => Parameters<JsPDF['setGState']>[0] }).GState;
      doc.setGState(new GState({ opacity: 0.1 }));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(44); doc.setTextColor(...INK);
      doc.text(chart.watermark, W / 2, H / 2, { align: 'center', angle: 35 });
      doc.restoreGraphicsState();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SOFT);
    }
    doc.text(p + ' / ' + pages, W - M, H - M + 2, { align: 'right' });
  }
  return doc;
}

/** Nome de ficheiro seguro a partir do título da música. */
export function pdfFileName(title: string): string {
  const base = title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'song';
  return base + '-chart.pdf';
}

/** Carrega o jsPDF só quando é preciso (não pesa no arranque do site) e descarrega o PDF. */
export async function exportPdf(chart: PdfChart): Promise<void> {
  const { jsPDF } = await import('jspdf');
  buildPdf(jsPDF, chart).save(pdfFileName(chart.title));
}

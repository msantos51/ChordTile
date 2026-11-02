// Tutorial para quem abre o site pela primeira vez: alguns passos, cada um a destacar uma parte do ecrã.

export interface TourStep {
  title: string;
  text: string;
  /** Elementos a destacar, por ordem de preferência (usa o primeiro que estiver visível). */
  targets?: string[];
}

export const TOUR_KEY = 'mapa:tour-visto';

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to Mapa de Compassos',
    text: 'Load a Guitar Pro file and see the song split into sections and bars, with the chord of each bar in a colour. Then practise it part by part, with the tab following along. Here’s the tour in 1 minute.',
  },
  {
    title: 'Load your song',
    text: 'Guitar Pro (.gp3, .gp4, .gp5, .gpx, .gp) and MusicXML files work. You can also drag the file onto the page. The file is only read in your browser.',
    targets: ['label.btn.primary[for="fileInput"]'],
  },
  {
    title: 'Your songs are saved',
    text: 'Every song you load is kept in “My songs”, in this browser, with your edits. Next time the last one opens straight away.',
    targets: ['#libraryBtn'],
  },
  {
    title: 'Pick your instrument',
    text: 'The chord of each bar is detected from the instrument you pick. If the song has a bass, it starts with that.',
    targets: ['.top-actions .track-pick'],
  },
  {
    title: 'The song chart',
    text: 'Each square is a bar, coloured by its note (C red, D orange, E yellow…). Tap a bar to jump there; “Practise” loops the section. If a chord isn’t right, you can fix it.',
    targets: ['#chart .section', '#chart'],
  },
  {
    title: 'The tab follows along',
    text: 'Click a bar in the tab and choose “Expand” to see it large, with the count (1 & 2 & 3 & 4 &) underneath, or “Loop” to repeat it.',
    targets: ['.tabpanel', '#vTab'],
  },
  {
    title: 'The player',
    text: 'Play, previous and next bar, speed, loop, metronome, count-in and “play along” (mutes your instrument) or “solo” (you hear only your instrument). On a computer, Space plays and pauses.',
    targets: ['#dock'],
  },
  {
    title: 'All set!',
    text: 'You can replay this tour or read the full guide in “How it works”, under the “?” icon at the top.',
    targets: ['#helpBtn'],
  },
];

export function tourSeen(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return true; }
}
export function markTourSeen(): void {
  try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* sem armazenamento */ }
}

/** Primeiro destino visível no ecrã (ou null para um passo centrado). */
export function visibleTarget(step: TourStep, doc: Document = document): HTMLElement | null {
  for (const sel of step.targets ?? []) {
    const el = doc.querySelector<HTMLElement>(sel);
    if (el && el.offsetParent !== null && el.getClientRects().length) return el;
  }
  return null;
}

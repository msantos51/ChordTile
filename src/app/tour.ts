import { store } from './user-store';
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
    title: 'Welcome to ChordTile',
    text: 'Load a Guitar Pro file and see the song split into sections and bars, with the chord of each bar in a colour. Then practise it part by part, with the tab following along. Here’s the tour in 1 minute.',
  },
  {
    title: 'Load your song',
    text: 'Guitar Pro (.gp3, .gp4, .gp5, .gpx, .gp) and MusicXML files work. You can also drag the file onto the page. The file is opened right here in your browser.',
    targets: ['label.load-btn[for="fileInput"]'],
  },
  {
    title: 'Your songs are saved',
    text: 'Every song you load is kept in “My songs”, in your account, with your edits: on any device you sign in to, the last one opens straight away.',
    targets: ['#libraryBtn'],
  },
  {
    title: 'Pick your instrument',
    text: 'The chord of each bar is detected from the instrument you pick. If the song has a bass, it starts with that.',
    targets: ['#trackTabs:not([hidden])', '#tabKind'],
  },
  {
    title: 'The song chart',
    text: 'Each square is a bar, coloured by its note (C red, D orange, E yellow…). Tap a bar to jump there (the tab scrolls to it); “Practise” loops the section. Double-click a bar, or use “Add note”, to write your own note under the chord.',
    targets: ['#chart .section', '#chart', '#vChart'],
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
    text: 'You can replay this tour or read the full guide in “How it works”: under the “?” at the top, or in Settings on your phone.',
    targets: ['#helpBtn', '#settingsBtn'],
  },
];

/** Já viu o tutorial? (guardado na conta; sem conta o tutorial não abre sozinho) */
export function tourSeen(): boolean { return store.get(TOUR_KEY) === '1' || store.get(TOUR_KEY) === 1; }
export function markTourSeen(): void { store.set(TOUR_KEY, '1'); }

/** Primeiro destino visível no ecrã (ou null para um passo centrado). */
export function visibleTarget(step: TourStep, doc: Document = document): HTMLElement | null {
  for (const sel of step.targets ?? []) {
    const el = doc.querySelector<HTMLElement>(sel);
    if (el && el.offsetParent !== null && el.getClientRects().length) return el;
  }
  return null;
}

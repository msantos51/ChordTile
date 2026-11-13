// Tema claro/escuro. A escolha fica guardada na conta (nada no browser); por defeito o site é escuro.
import { store } from './user-store';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'mapa:theme';

/**
 * Cores da tablatura (alphaTab). Nos dois temas a tab é desenhada em "papel" claro (escura sobre clara),
 * como uma partitura: quem abre o site percebe logo que é um site de tabs.
 */
const PAPER = {
  staffLineColor: '#a8a399', barSeparatorColor: '#6b6860', barNumberColor: '#5b5850',
  mainGlyphColor: '#17171a', secondaryGlyphColor: '#5b5850', scoreInfoColor: '#17171a',
};
export const TAB_COLORS: Record<Theme, Record<string, string>> = { dark: PAPER, light: PAPER };

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** `keep` false: só aplica (ao ler as preferências da conta não se volta a escrevê-las). */
export function applyTheme(theme: Theme, keep = true): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f2f0' : '#0b0b0d');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  if (keep) store.set(THEME_KEY, theme);
}

/** Tema guardado na conta (ou null se a pessoa nunca escolheu). */
export const savedTheme = (): Theme | null => { const t = store.get<string>(THEME_KEY); return t === 'light' || t === 'dark' ? t : null; };

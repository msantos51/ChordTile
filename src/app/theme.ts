// Tema claro/escuro. A escolha fica guardada no browser; por defeito o site é escuro.
// (Um pequeno script no <head> aplica o tema antes de a página aparecer, para não piscar.)

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'mapa:theme';

/** Cores da tablatura (alphaTab) para cada tema. */
export const TAB_COLORS: Record<Theme, Record<string, string>> = {
  dark: {
    staffLineColor: '#33415a', barSeparatorColor: '#4a5a75', barNumberColor: '#a9b6c4',
    mainGlyphColor: '#eef2f7', secondaryGlyphColor: '#a9b6c4', scoreInfoColor: '#eef2f7',
  },
  light: {
    staffLineColor: '#c9ced8', barSeparatorColor: '#9aa1af', barNumberColor: '#5f6676',
    mainGlyphColor: '#1b1e27', secondaryGlyphColor: '#5f6676', scoreInfoColor: '#1b1e27',
  },
};

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f6f8' : '#0e0f13');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* sem armazenamento */ }
}

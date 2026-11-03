// Tema claro/escuro. A escolha fica guardada no browser; por defeito o site é escuro.
// (Um pequeno script no <head> aplica o tema antes de a página aparecer, para não piscar.)

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'mapa:theme';

/** Cores da tablatura (alphaTab) para cada tema. */
export const TAB_COLORS: Record<Theme, Record<string, string>> = {
  dark: {
    staffLineColor: '#3a3a3e', barSeparatorColor: '#56565c', barNumberColor: '#a3a3a3',
    mainGlyphColor: '#f2f2f2', secondaryGlyphColor: '#a3a3a3', scoreInfoColor: '#f2f2f2',
  },
  light: {
    staffLineColor: '#d2cec8', barSeparatorColor: '#9c968e', barNumberColor: '#66625c',
    mainGlyphColor: '#121212', secondaryGlyphColor: '#66625c', scoreInfoColor: '#121212',
  },
};

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f2f0' : '#121212');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* sem armazenamento */ }
}

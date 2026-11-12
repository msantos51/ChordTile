// Cores e música de exemplo, as mesmas do site (src/styles.css e public/sample.gp5).
export const C = {
  bg: '#16171b', panel: '#1f2024', panel2: '#2a2b31', line: 'rgba(255,255,255,.14)',
  ink: '#f5f5f6', soft: '#bfc0c6', accent: '#d0122f', accentText: '#ff6b7d', logo: '#c8102e',
};
// Cor de cada nota (Dó vermelho … Si rosa), como no quadro do site
export const NOTE = ['#ff4d4d', '#ff6d3a', '#ff9a2e', '#ffbe1f', '#f2d40a', '#9bd13b', '#3ccf6e', '#1cc2b0', '#3b9cff', '#7c5cff', '#c056f0', '#ff5fa8'];
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const noteColor = (chord: string) => NOTE[PC[chord[0]]];

// A música de exemplo: secções e o acorde de cada compasso
export const SONG: { name: string; bars: string[] }[] = [
  { name: 'INTRO', bars: ['A', 'B', 'A', 'B'] },
  { name: 'VERSE', bars: Array(4).fill(['B', 'C', 'B', 'G']).flat() },
  { name: 'CHORUS', bars: Array(2).fill(['A', 'B', 'G', 'D']).flat() },
  { name: 'VERSE', bars: Array(4).fill(['B', 'C', 'B', 'G']).flat() },
  { name: 'SOLO', bars: ['B', 'C', 'B', 'G', 'A', 'B', 'A', 'B'] },
];
export const LOGO_PATH = 'M76 16H180A60 60 0 0 1 240 76V180A60 60 0 0 1 180 240H76A60 60 0 0 1 16 180V76A60 60 0 0 1 76 16ZM199 104A43 43 0 0 0 156 61H108A43 43 0 0 0 65 104V152A43 43 0 0 0 108 195H156A43 43 0 0 0 199 152H169A13 13 0 0 1 156 165H108A13 13 0 0 1 95 152V104A13 13 0 0 1 108 91H156A13 13 0 0 1 169 104Z';

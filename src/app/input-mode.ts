// Anel de foco só para quem usa o teclado.
// Com o rato ou o toque, os botões e menus que o site foca sozinho (ao abrir janelas e painéis) não ficam
// com o anel à volta; ao carregar em Tab, nas setas, Enter, Espaço ou Esc o anel volta (acessibilidade).
const root = document.documentElement;
const set = (mode: 'mouse' | 'keyboard') => { if (root.dataset.input !== mode) root.dataset.input = mode; };
set('mouse');
addEventListener('pointerdown', () => set('mouse'), true);
addEventListener('keydown', e => {
  if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key.startsWith('Arrow')) set('keyboard');
}, true);

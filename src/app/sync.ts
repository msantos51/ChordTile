import type * as AlphaTab from '@coderline/alphatab';

type ICursorHandler = NonNullable<AlphaTab.AlphaTabApi['customCursorHandler']>;
type CursorMode = AlphaTab.midi.MidiTickLookupFindBeatResultCursorMode;

/**
 * Atrasa as atualizações visuais (cursor da tablatura, esquema) em relação ao som,
 * para compensar a latência da saída de áudio (ex.: auscultadores Bluetooth).
 */
export class VisualDelay {
  private pending = new Set<ReturnType<typeof setTimeout>>();

  constructor(private getDelayMs: () => number, private isPlaying: () => boolean) {}

  run(fn: () => void): void {
    const d = this.getDelayMs();
    if (d > 0 && this.isPlaying()) {
      const id = setTimeout(() => { this.pending.delete(id); fn(); }, d);
      this.pending.add(id);
    } else fn();
  }

  clear(): void {
    this.pending.forEach(clearTimeout);
    this.pending.clear();
  }

  /**
   * Cursor igual ao do alphaTab (anima até ao tempo seguinte), mas com o atraso aplicado.
   * O alphaTab só volta a "colocar" o cursor (linha, altura) quando acha que mudou de linha; as outras
   * atualizações só mexem no x. Se uma colocação se perder (atraso cancelado ao clicar, tablatura redesenhada
   * com um cursor novo), o cursor ficava na linha errada ou invisível. Por isso cada atualização confirma
   * que o cursor está na linha certa e com o tamanho certo, e recoloca-o se não estiver.
   */
  cursorHandler(toNextBeat: CursorMode): ICursorHandler {
    type Cur = Parameters<ICursorHandler['placeBeatCursor']>[0];
    type Bounds = Parameters<ICursorHandler['placeBeatCursor']>[1];
    // O que foi mesmo aplicado a cada cursor (linha, altura, e de onde até onde vai a animação)
    const state = new WeakMap<Cur, { y: number; h: number; from: number; to: number }>();
    const place = (cursor: Cur, bounds: Bounds, x: number) => {
      const bb = bounds.barBounds.masterBarBounds.visualBounds;
      cursor.transitionToX(0, x);
      cursor.setBounds(x, bb.y, 1, bb.h);
      state.set(cursor, { y: bb.y, h: bb.h, from: x, to: x });
      // Força o navegador a aplicar a posição antes da próxima animação (senão anima desde o sítio antigo)
      void (cursor as unknown as { element?: HTMLElement }).element?.offsetWidth;
    };
    return {
      onAttach() {},
      onDetach() {},
      placeBeatCursor: (cursor, bounds, x) => this.run(() => place(cursor, bounds, x)),
      placeBarCursor: (cursor, bounds) => this.run(() => {
        const bb = bounds.barBounds.masterBarBounds.visualBounds;
        cursor.setBounds(bb.x, bb.y, bb.w, bb.h);
      }),
      transitionBeatCursor: (cursor, bounds, x, nextX, duration, mode) => this.run(() => {
        const bb = bounds.barBounds.masterBarBounds.visualBounds;
        const s = state.get(cursor);
        if (!s || s.y !== bb.y || s.h !== bb.h || x < s.from - 1 || x > Math.max(s.from, s.to) + 1) place(cursor, bounds, x);
        const f = mode === toNextBeat ? 2 : 1, to = x + (nextX - x) * f;
        cursor.transitionToX(duration * f, to);
        const cur = state.get(cursor)!;
        cur.from = x; cur.to = to;
      }),
    };
  }
}

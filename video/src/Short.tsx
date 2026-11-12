// Vídeo curto (9:16) de apresentação: gravações reais do site, legendas animadas e um final de marca.
// Os cortes caem no tempo forte: a música de exemplo tem 100 bpm, um compasso = 2,4 s = 72 frames.
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, LOGO_PATH, noteColor, SONG } from './brand';

const BAR = 72;
const CARD = { x: 60, y: 470, w: 960, h: 1380, r: 56 };

/** Cenas: início e duração (frames), clip, frame do clip onde começa (o som de cada clip começa a ~0,2 s;
 *  no Tile by Tile a contagem começa a ~0,39 s e a música um compasso depois) e enquadramento. */
type Frame = { y: number; s: number };
type Scene = { from: number; dur: number; clip: string; start: number; a: Frame; b: Frame; kicker: string; lines: string[][]; accent: string[] };
const SCENES: Scene[] = [
  { from: 0, dur: 2 * BAR, clip: 'tab', start: 14, a: { y: 0, s: 1 }, b: { y: 140, s: 1.06 },
    kicker: 'For guitar & bass', lines: [['CAN’T', 'MEMORISE'], ['TABS?']], accent: ['TABS?'] },
  { from: 2 * BAR, dur: 2 * BAR, clip: 'chart', start: 6, a: { y: 478, s: 1 }, b: { y: 640, s: 1.1 },
    kicker: 'Any Guitar Pro file', lines: [['BECOMES', 'A', 'MAP'], ['OF', 'THE', 'SONG']], accent: ['MAP'] },
  { from: 4 * BAR, dur: 2 * BAR, clip: 'learn', start: 12, a: { y: 170, s: 1 }, b: { y: 210, s: 1.05 },
    kicker: 'Tile by Tile · step 1', lines: [['LEARN', 'A', 'SECTION'], ['WITH', 'THE', 'TAB']], accent: ['WITH', 'THE', 'TAB'] },
  { from: 6 * BAR, dur: 2 * BAR, clip: 'recall', start: 90, a: { y: 200, s: 1.04 }, b: { y: 300, s: 1.08 },
    kicker: 'Step 2', lines: [['PLAY', 'IT'], ['WITHOUT', 'THE', 'TAB']], accent: ['WITHOUT'] },
  { from: 8 * BAR, dur: 2 * BAR, clip: 'join', start: 90, a: { y: 180, s: 1 }, b: { y: 240, s: 1.05 },
    kicker: 'Step 3', lines: [['JOIN', 'IT'], ['TO', 'THE', 'REST']], accent: ['JOIN'] },
];
const WHOLE = { from: 10 * BAR, dur: 2 * BAR };
const END = { from: 12 * BAR, dur: 132 };
export const SHORT_FRAMES = END.from + END.dur;

const ease = Easing.bezier(0.22, 1, 0.36, 1);

// ---------- Fundo ----------
const Background = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 900px at 50% ${-10 + Math.sin(f / 60) * 3}%, rgba(208,18,47,.28), transparent 70%)` }} />
      {/* As seis cordas, como na página inicial */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: 150 + i * 46, height: 1 + i * 0.4, background: 'rgba(255,255,255,.05)',
          transform: `translateY(${Math.sin(f / 9 + i) * (i % 2 ? 1.2 : 0.8)}px)` }} />
      ))}
    </AbsoluteFill>
  );
};

// ---------- Legendas ----------
const Caption = ({ kicker, lines, accent, dur, delay = 0 }: { kicker: string; lines: string[][]; accent: string[]; dur: number; delay?: number }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const out = interpolate(f, [dur - 8, dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  let n = 0;
  const kIn = spring({ frame: f - delay, fps, config: { damping: 200 }, durationInFrames: 14 });
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, top: 120, height: 320, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      opacity: 1 - out, transform: `translateY(${-30 * out}px)` }}>
      <div style={{ fontFamily: 'Roboto Mono', fontWeight: 500, fontSize: 30, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accentText,
        marginBottom: 18, opacity: kIn, transform: `translateX(${(1 - kIn) * -24}px)` }}>{kicker}</div>
      {lines.map((ws, li) => (
        <div key={li} style={{ display: 'flex', gap: '0 26px', flexWrap: 'wrap' }}>
          {ws.map((w, wi) => {
            const t = spring({ frame: f - delay - 3 - 3 * n++, fps, config: { damping: 15, stiffness: 160, mass: 0.7 } });
            return (
              <span key={wi} style={{ display: 'inline-block', fontFamily: 'Roboto', fontWeight: 900, fontSize: 100, lineHeight: 1.02, letterSpacing: '-.015em',
                color: accent.includes(w) ? C.accentText : C.ink, opacity: Math.min(1, t * 1.4), transform: `translateY(${(1 - t) * 60}px)` }}>{w}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

// ---------- Cartão com a gravação do site ----------
const Card = ({ children, enter = 0 }: { children: React.ReactNode; enter?: number }) => (
  <div style={{ position: 'absolute', left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h, borderRadius: CARD.r, overflow: 'hidden',
    background: C.panel, border: `2px solid ${C.line}`, boxShadow: '0 40px 120px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4)',
    transform: `translateY(${(1 - enter) * 160}px) scale(${0.94 + 0.06 * enter})`, opacity: enter }}>
    {children}
  </div>
);

const Clip = ({ s }: { s: Scene }) => {
  const f = useCurrentFrame();
  const k = interpolate(f, [0, s.dur], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' });
  const y = s.a.y + (s.b.y - s.a.y) * k, sc = s.a.s + (s.b.s - s.a.s) * k;
  // No gancho, a tab "desaparece" (é o problema: fecha-se a tab e a música vai-se)
  const gone = s.clip === 'tab' ? interpolate(f, [62, 84], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }) : 0;
  const cut = interpolate(f, [0, 5], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: cut }}>
      <OffthreadVideo src={staticFile(`clips/${s.clip}.mp4`)} startFrom={s.start}
        volume={v => interpolate(v, [0, 3, s.dur - 4, s.dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        style={{ position: 'absolute', left: 0, top: 0, width: 960, height: 1816, transformOrigin: '50% 0',
          transform: `translateY(${-y}px) scale(${sc})`, filter: gone ? `blur(${gone * 16}px) brightness(${1 - gone * 0.3}) saturate(${1 - gone * 0.6})` : undefined }} />
    </AbsoluteFill>
  );
};

// ---------- "A música toda, sem tab": os compassos passam de cinzento a cor ----------
const WholeSong = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const bars = SONG.flatMap((sec, si) => sec.bars.map((c, bi) => ({ c, si, first: bi === 0, name: sec.name })));
  const lit = interpolate(f, [10, 100], [0, bars.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  const pct = Math.round((Math.min(lit, bars.length) / bars.length) * 100);
  const inT = spring({ frame: f, fps, config: { damping: 200 }, durationInFrames: 12 });
  const COLS = 8, GAP = 12, W = Math.floor((CARD.w - 4 - 96 - GAP * (COLS - 1)) / COLS), H = 122; // 4: a borda do cartão
  return (
    <AbsoluteFill style={{ background: C.panel, opacity: inT, padding: '56px 48px', fontFamily: 'Roboto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 34 }}>
        <span style={{ fontFamily: 'Roboto Mono', fontWeight: 500, fontSize: 30, letterSpacing: '.12em', color: C.accentText }}>TILE BY TILE</span>
        <span style={{ fontFamily: 'Roboto Mono', fontWeight: 500, fontSize: 30, color: C.soft }}>
          <b style={{ color: C.accentText, fontSize: 44 }}>{pct}%</b> no tab
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: GAP }}>
        {bars.map((b, i) => {
          const on = Math.max(0, Math.min(1, lit - i));
          const pop = on > 0 && on < 1 ? 1 + Math.sin(on * Math.PI) * 0.12 : 1;
          return (
            <div key={i} style={{ width: W, height: H, borderRadius: 18, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 40,
              background: on ? noteColor(b.c) : C.panel2, color: on ? '#121212' : 'rgba(255,255,255,.25)', transform: `scale(${pop})`,
              boxShadow: on >= 1 ? `0 8px 24px ${noteColor(b.c)}55` : 'none', opacity: 0.35 + 0.65 * Math.max(on, 0.3) }}>{b.c}</div>
          );
        })}
      </div>
      <div style={{ marginTop: 40, height: 14, borderRadius: 99, background: C.panel2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: C.accent, borderRadius: 99 }} />
      </div>
    </AbsoluteFill>
  );
};

// ---------- Final: marca e chamada ----------
const Logo = ({ size }: { size: number }) => (
  <svg viewBox="16 16 224 224" width={size} height={size}><path fill={C.logo} fillRule="evenodd" d={LOGO_PATH} /></svg>
);
const EndCard = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const a = (d: number) => spring({ frame: f - d, fps, config: { damping: 14, stiffness: 140, mass: 0.8 } });
  const fadeOut = interpolate(f, [END.dur - 14, END.dur], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: 'Roboto', color: C.ink, opacity: fadeOut, textAlign: 'center' }}>
      <div style={{ transform: `scale(${a(0)}) rotate(${(1 - a(0)) * -20}deg)` }}><Logo size={220} /></div>
      <div style={{ fontWeight: 900, fontSize: 120, letterSpacing: '-.02em', marginTop: 34, opacity: a(5), transform: `translateY(${(1 - a(5)) * 40}px)` }}>ChordTile</div>
      <div style={{ fontWeight: 500, fontSize: 46, color: C.soft, marginTop: 10, opacity: a(10), transform: `translateY(${(1 - a(10)) * 30}px)` }}>
        Learn songs without<br />memorising the tab
      </div>
      <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', opacity: a(18), transform: `translateY(${(1 - a(18)) * 30}px)` }}>
        <div style={{ background: C.accent, color: '#fff', fontWeight: 700, fontSize: 52, padding: '26px 56px', borderRadius: 999, boxShadow: '0 20px 60px rgba(208,18,47,.45)' }}>
          chordtile.com
        </div>
        <div style={{ fontFamily: 'Roboto Mono', fontWeight: 500, fontSize: 30, color: C.soft, letterSpacing: '.04em' }}>
          7 days of Premium free · no card
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Short = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const enter = spring({ frame: f, fps, config: { damping: 18, stiffness: 120 } });
  const leave = interpolate(f, [END.from - 4, END.from + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const hook = SCENES[0];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Background />
      {/* Gancho: a pergunta, e depois a resposta quando a tab desaparece */}
      <Sequence from={0} durationInFrames={72}><Caption kicker={hook.kicker} lines={hook.lines} accent={hook.accent} dur={72} /></Sequence>
      <Sequence from={72} durationInFrames={72}><Caption kicker="ChordTile" lines={[['LEARN', 'THE', 'SONG'], ['ANYWAY.']]} accent={['ANYWAY.']} dur={72} /></Sequence>
      {SCENES.slice(1).map(s => (
        <Sequence key={s.clip} from={s.from} durationInFrames={s.dur}><Caption kicker={s.kicker} lines={s.lines} accent={s.accent} dur={s.dur} /></Sequence>
      ))}
      <Sequence from={WHOLE.from} durationInFrames={WHOLE.dur}>
        <Caption kicker="And then" lines={[['THE', 'WHOLE', 'SONG.'], ['NO', 'TAB.']]} accent={['NO', 'TAB.']} dur={WHOLE.dur} />
      </Sequence>

      <div style={{ opacity: 1 - leave, transform: `scale(${1 - leave * 0.08})`, transformOrigin: '50% 60%' }}>
        <Card enter={enter}>
          {SCENES.map(s => (
            <Sequence key={s.clip} from={s.from} durationInFrames={s.dur} layout="none"><Clip s={s} /></Sequence>
          ))}
          <Sequence from={WHOLE.from} durationInFrames={WHOLE.dur + 14} layout="none"><WholeSong /></Sequence>
        </Card>
      </div>

      {/* Som do fim: o refrão, desde "a música toda" até ao fim */}
      <Sequence from={WHOLE.from} durationInFrames={WHOLE.dur + END.dur}>
        <Audio src={staticFile('clips/outro.mp4')} startFrom={6}
          volume={v => interpolate(v, [0, 3, WHOLE.dur + END.dur - 36, WHOLE.dur + END.dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      </Sequence>
      <Sequence from={END.from} durationInFrames={END.dur}><EndCard /></Sequence>
    </AbsoluteFill>
  );
};

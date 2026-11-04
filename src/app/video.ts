// Áudio original da música a tocar em sincronia com a tablatura, através do YouTube (IFrame Player API).
// O alphaTab tem um modo de "média externa": é ele que decide que compasso mostrar a cada instante do vídeo,
// a partir de pontos de sincronização (compasso → tempo do vídeo) que a pessoa marca uma vez por música.
// Este módulo só trata do que é do YouTube e dos pontos; a ligação ao leitor está em main.ts.

/** Um ponto de sincronização: o compasso `bar` (0 = primeiro) começa aos `ms` milissegundos do vídeo. */
export interface VideoPoint { bar: number; ms: number }

/** Ficheiro guardado no browser, por música. */
export interface SavedVideo { id: string; points: VideoPoint[] }

/** O formato do alphaTab para guardar pontos de sincronização (`Score.applyFlatSyncPoints`). */
export interface FlatPoint { barIndex: number; barPosition: number; barOccurence: number; millisecondOffset: number }

/** Identificador de 11 caracteres de um vídeo: aceita o endereço do vídeo (vários formatos) ou só o identificador. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : 'https://' + text); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else { const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/); id = m ? m[1] : null; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** "1:05.250" (minutos, segundos e milésimos). */
export function formatMs(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), r = t % 1000;
  return m + ':' + String(s).padStart(2, '0') + '.' + String(r).padStart(3, '0');
}

/** Os pontos por ordem de compasso, sem repetir compassos (o último a ser marcado ganha). */
export function cleanPoints(points: VideoPoint[]): VideoPoint[] {
  const byBar = new Map<number, number>();
  for (const p of points) if (Number.isFinite(p.bar) && Number.isFinite(p.ms) && p.bar >= 0 && p.ms >= 0) byBar.set(Math.round(p.bar), Math.round(p.ms));
  return [...byBar].map(([bar, ms]) => ({ bar, ms })).sort((a, b) => a.bar - b.bar);
}

/** Acrescenta ou substitui o ponto do compasso. */
export function withPoint(points: VideoPoint[], bar: number, ms: number): VideoPoint[] {
  return cleanPoints([...points.filter(p => p.bar !== bar), { bar, ms }]);
}

export function toFlat(points: VideoPoint[]): FlatPoint[] {
  return cleanPoints(points).map(p => ({ barIndex: p.bar, barPosition: 0, barOccurence: 0, millisecondOffset: p.ms }));
}

/** A velocidade que o YouTube aceita mais perto da pedida (ele só tem alguns valores). */
export function nearestRate(available: number[], wanted: number): number {
  if (!available.length) return wanted;
  return available.reduce((best, r) => (Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best), available[0]);
}

// ---------- API do YouTube (só se carrega quando se usa) ----------

/** O que usamos do leitor do YouTube (YT.Player). */
export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  loadVideoById(id: string): void;
  destroy(): void;
}
export interface YtNamespace {
  Player: new (element: string | HTMLElement, options: Record<string, unknown>) => YtPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
}

let apiPromise: Promise<YtNamespace> | null = null;
/** Carrega o script do YouTube uma vez. Falha (e deixa tentar de novo) se a rede o bloquear. */
export function loadYouTubeApi(): Promise<YtNamespace> {
  const w = window as unknown as { YT?: YtNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  apiPromise ??= new Promise<YtNamespace>((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { previous?.(); resolve(w.YT as YtNamespace); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { apiPromise = null; s.remove(); reject(new Error('Couldn’t load the YouTube player.')); };
    document.head.append(s);
    setTimeout(() => { if (!w.YT?.Player) { apiPromise = null; reject(new Error('The YouTube player took too long to load.')); } }, 15000);
  });
  return apiPromise;
}

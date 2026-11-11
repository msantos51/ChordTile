// Dados da pessoa (notas, secções, progresso, Tile by Tile, preferências), guardados NA CONTA.
// Enquanto a página está aberta ficam em memória; as alterações vão para a conta (tabela user_data)
// juntas, a cada 1,5 s. Nada fica no browser. Sem conta, valem só enquanto a página está aberta.

type Saver = (entries: Record<string, unknown>) => Promise<void>;

const mem = new Map<string, unknown>();
const dirty = new Map<string, unknown>();
let saver: Saver | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let onError: (() => void) | undefined;
/**
 * Já se leram os dados da conta? Enquanto não (sem rede ao abrir a página), as alterações ficam à espera:
 * enviá-las já podia escrever por cima do que está na conta sem nunca o ter visto.
 */
let hydrated = false;
/** Os envios vão um de cada vez, por ordem (dois em paralelo podiam chegar trocados e ficar o valor antigo). */
let queue: Promise<void> = Promise.resolve();

const clone = <T>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function schedule(ms = 1500) {
  if (!saver || !hydrated) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), ms);
}

async function send(): Promise<void> {
  const to = saver;
  if (!to || !hydrated || !dirty.size) return;
  clearTimeout(timer);
  const batch = Object.fromEntries(dirty); dirty.clear();
  try { await to(batch); }
  catch {
    if (saver !== to) return; // entretanto saiu da conta (ou entrou noutra): estes dados já não são para enviar
    for (const [k, v] of Object.entries(batch)) if (!dirty.has(k)) dirty.set(k, v);
    onError?.(); schedule(15000);
  }
}

/** Envia já o que está por guardar. Se falhar (sem rede), volta a tentar mais tarde. */
export function flush(): Promise<void> {
  queue = queue.then(send, send);
  return queue;
}

export const store = {
  get<T>(key: string): T | null {
    return mem.has(key) ? clone(mem.get(key) as T) : null;
  },
  set(key: string, value: unknown) {
    if (mem.has(key) && same(mem.get(key), value)) return; // sem alterações
    mem.set(key, clone(value));
    if (saver) { dirty.set(key, clone(value)); schedule(); }
  },
  /** Esquece chaves (por exemplo as de uma música apagada). */
  forget(keys: string[]) { for (const k of keys) { mem.delete(k); dirty.delete(k); } },
};

/**
 * Liga o armazém a uma conta e passa a guardar lá. `data`: os dados da conta, ou null se ainda não foi
 * possível lê-los (sem rede): nesse caso nada é enviado até `mergeRemote` os trazer.
 */
export function attachAccount(data: Record<string, unknown> | null, save: Saver, failed?: () => void): void {
  mem.clear(); dirty.clear(); clearTimeout(timer);
  if (data) for (const [k, v] of Object.entries(data)) mem.set(k, v);
  saver = save; onError = failed; hydrated = data !== null;
}

/**
 * Junta o que está na conta (lido agora) ao que está em memória: o que mudou noutro dispositivo passa a valer
 * aqui; o que foi alterado aqui e ainda não foi enviado mantém-se (e é enviado). Devolve as chaves que mudaram.
 */
export function mergeRemote(data: Record<string, unknown>): string[] {
  if (!saver) return [];
  const changed: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (dirty.has(k)) continue;
    if (!mem.has(k) || !same(mem.get(k), v)) { mem.set(k, v); changed.push(k); }
  }
  if (!hydrated) { hydrated = true; if (dirty.size) schedule(0); }
  return changed;
}

/** Sem conta (ou ao sair): os dados ficam só em memória, e começam vazios. */
export function detachAccount(): void {
  clearTimeout(timer); saver = null; onError = undefined; hydrated = false; mem.clear(); dirty.clear();
}

/** Há alterações por enviar? (para avisar antes de fechar a página) */
export const hasPending = () => dirty.size > 0;
/** Os dados da conta já foram lidos? */
export const isHydrated = () => hydrated;

/**
 * Envio de última hora (a página vai para segundo plano ou vai fechar): `sendNow` tem de começar o pedido
 * imediatamente (um pedido "keepalive", que o browser acaba mesmo depois de a página fechar) e devolve null se
 * não o puder fazer. Se a página continuar aberta e o pedido falhar, as alterações voltam à fila.
 */
export function flushOnExit(sendNow: (entries: Record<string, unknown>) => Promise<void> | null): void {
  const to = saver;
  if (!to || !hydrated || !dirty.size) return;
  const batch = Object.fromEntries(dirty);
  const sent = sendNow(batch);
  if (!sent) { void flush(); return; }
  dirty.clear(); clearTimeout(timer);
  sent.catch(() => {
    if (saver !== to) return;
    for (const [k, v] of Object.entries(batch)) if (!dirty.has(k)) dirty.set(k, v);
    schedule(15000);
  });
}

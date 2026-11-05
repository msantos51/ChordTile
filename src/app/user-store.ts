// Dados da pessoa (notas, secções, progresso, Tile by Tile, preferências), guardados NA CONTA.
// Enquanto a página está aberta ficam em memória; as alterações vão para a conta (tabela user_data)
// juntas, a cada 1,5 s. Nada fica no browser. Sem conta, valem só enquanto a página está aberta.

type Saver = (entries: Record<string, unknown>) => Promise<void>;

const mem = new Map<string, unknown>();
const dirty = new Map<string, unknown>();
let saver: Saver | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let onError: (() => void) | undefined;

const clone = <T>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

function schedule(ms = 1500) {
  if (!saver) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), ms);
}

/** Envia já o que está por guardar. Se falhar (sem rede), volta a tentar mais tarde. */
export async function flush(): Promise<void> {
  if (!saver || !dirty.size) return;
  const batch = Object.fromEntries(dirty); dirty.clear();
  try { await saver(batch); }
  catch {
    for (const [k, v] of Object.entries(batch)) if (!dirty.has(k)) dirty.set(k, v);
    onError?.(); schedule(15000);
  }
}

export const store = {
  get<T>(key: string): T | null {
    return mem.has(key) ? clone(mem.get(key) as T) : null;
  },
  set(key: string, value: unknown) {
    if (mem.has(key) && JSON.stringify(mem.get(key)) === JSON.stringify(value)) return; // sem alterações
    mem.set(key, clone(value));
    if (saver) { dirty.set(key, clone(value)); schedule(); }
  },
  /** Esquece chaves (por exemplo as de uma música apagada). */
  forget(keys: string[]) { for (const k of keys) { mem.delete(k); dirty.delete(k); } },
};

/** Liga o armazém a uma conta: carrega os dados dela e passa a guardar lá. */
export function attachAccount(data: Record<string, unknown>, save: Saver, failed?: () => void): void {
  mem.clear(); dirty.clear(); clearTimeout(timer);
  for (const [k, v] of Object.entries(data)) mem.set(k, v);
  saver = save; onError = failed;
}

/** Sem conta (ou ao sair): os dados ficam só em memória, e começam vazios. */
export function detachAccount(): void {
  clearTimeout(timer); saver = null; onError = undefined; mem.clear(); dirty.clear();
}

/** Há alterações por enviar? (para avisar antes de fechar a página) */
export const hasPending = () => dirty.size > 0;

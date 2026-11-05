// Sessão guardada pelo Supabase neste browser, lida sem carregar o cliente (que pesa ~60 KB).
// Serve só para as páginas simples (inicial, ajuda, termos) mostrarem "Your account" em vez de "Sign in".
// A sessão a sério (e a sua validade) continua a ser verificada no leitor e na página da conta.

export const accountsEnabled = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export interface StoredAccount { name: string; email: string }

export function storedAccount(): StoredAccount | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  try {
    const ref = new URL(url).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const s = JSON.parse(raw) as { refresh_token?: string; user?: { email?: string; user_metadata?: { name?: unknown } } };
    if (!s?.refresh_token || !s.user?.email) return null;
    return { name: String(s.user.user_metadata?.name ?? '').trim(), email: s.user.email };
  } catch {
    return null;
  }
}

/** Primeiro nome, ou a parte do email antes do @. */
export const firstName = (a: { name: string; email: string }) => a.name.split(/\s+/)[0] || a.email.split('@')[0];

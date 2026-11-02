/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do projeto Supabase (ativa as contas e a sincronização de "My songs"). */
  readonly VITE_SUPABASE_URL?: string;
  /** Chave pública ("anon") do projeto Supabase. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }

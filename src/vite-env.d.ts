/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do projeto Supabase (ativa as contas e a sincronização de "My songs"). */
  readonly VITE_SUPABASE_URL?: string;
  /** Chave pública ("anon") do projeto Supabase. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Stripe Payment Links (Premium mensal, anual e vitalício) e portal do cliente. */
  readonly VITE_STRIPE_LINK_MONTHLY?: string;
  readonly VITE_STRIPE_LINK_YEARLY?: string;
  readonly VITE_STRIPE_LINK_LIFETIME?: string;
  readonly VITE_STRIPE_PORTAL_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }

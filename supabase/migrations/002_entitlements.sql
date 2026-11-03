-- Planos: 14 dias de Premium ao criar conta ("reverse trial"), depois Free, a não ser que pague.
-- As escritas só são feitas pelo servidor (função stripe-webhook, com a chave de serviço).

create table if not exists public.entitlements (
  user_id                uuid        primary key references auth.users (id) on delete cascade,
  trial_ends_at          timestamptz not null default now() + interval '14 days',
  -- trial: ainda não pagou; monthly/yearly: subscrição; lifetime: pagamento único
  plan                   text        not null default 'trial' check (plan in ('trial', 'monthly', 'yearly', 'lifetime')),
  -- Fim do período pago (subscrições). Na vitalícia fica a null.
  premium_until          timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  updated_at             timestamptz not null default now()
);

alter table public.entitlements enable row level security;
create policy "entitlements: dono lê" on public.entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

-- Funções num esquema que a API não expõe (não podem ser chamadas por /rest/v1/rpc)
create schema if not exists private;
grant usage on schema private to authenticated;

-- Cada conta nova recebe o período de experiência
create or replace function private.start_trial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.entitlements (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_trial on auth.users;
create trigger on_auth_user_created_trial after insert on auth.users
  for each row execute function private.start_trial();
revoke execute on function private.start_trial() from public, anon, authenticated;

-- Contas que já existiam
insert into public.entitlements (user_id) select id from auth.users on conflict (user_id) do nothing;

-- Premium agora? (usado pelas regras de acesso; o site usa a mesma lógica em src/app/plan.ts)
create or replace function private.is_premium(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = uid
      and (e.plan = 'lifetime' or e.trial_ends_at > now() or coalesce(e.premium_until > now(), false))
  );
$$;
revoke execute on function private.is_premium(uuid) from public, anon;
grant execute on function private.is_premium(uuid) to authenticated;

-- A sincronização é Premium: só quem é Premium envia músicas novas para a conta.
-- Ler, apagar e marcar como apagada continua livre (ninguém perde o que já tem).
drop policy if exists "songs: dono cria" on public.songs;
create policy "songs: dono cria (premium)" on public.songs for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.is_premium((select auth.uid()))));

drop policy if exists "ficheiros: dono cria" on storage.objects;
create policy "ficheiros: dono cria (premium)" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select private.is_premium((select auth.uid()))));
drop policy if exists "ficheiros: dono altera" on storage.objects;
create policy "ficheiros: dono altera (premium)" on storage.objects for update to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select private.is_premium((select auth.uid()))));

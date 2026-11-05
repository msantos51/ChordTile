-- Formulário de contacto (/contact): as mensagens ficam aqui e só a função `contact` (service role)
-- as escreve. Ninguém as lê pelo site: sem políticas para anon/authenticated, a RLS bloqueia tudo.
create table if not exists public.contact_messages (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text        not null check (char_length(name) between 1 and 80),
  email      text        not null check (char_length(email) between 3 and 254),
  topic      text        not null check (topic in ('support', 'billing', 'privacy', 'feedback', 'other')),
  message    text        not null check (char_length(message) between 10 and 4000),
  user_id    uuid        references auth.users (id) on delete set null,
  ip_hash    text,                                   -- só o hash do IP, para limitar abusos
  emailed    boolean     not null default false,     -- a notificação por email foi enviada?
  status     text        not null default 'new' check (status in ('new', 'answered', 'spam'))
);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

create index if not exists contact_messages_recent on public.contact_messages (created_at desc);
create index if not exists contact_messages_ip on public.contact_messages (ip_hash, created_at desc);

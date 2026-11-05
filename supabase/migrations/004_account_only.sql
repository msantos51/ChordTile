-- Tudo na conta: as músicas de todas as contas (Gratuito e Premium) e os dados de cada pessoa
-- (notas, secções, progresso, Tile by Tile, preferências) ficam aqui. O site não guarda nada no browser,
-- além da sessão de login.

-- 1) Limite de músicas por conta, decidido pelo servidor: Premium sem limite, Gratuito 3.
--    `song_id`: a própria música não conta (voltar a guardar uma que já existe é sempre possível).
create or replace function private.can_add_song(uid uuid, song_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_premium(uid)
      or (select count(*) from public.songs s
          where s.user_id = uid and s.deleted_at is null and s.id <> song_id) < 3;
$$;
revoke execute on function private.can_add_song(uuid, text) from public, anon;
grant execute on function private.can_add_song(uuid, text) to authenticated;

drop policy if exists "songs: dono cria (premium)" on public.songs;
drop policy if exists "songs: dono cria" on public.songs;
create policy "songs: dono cria (até ao limite do plano)" on public.songs for insert to authenticated
  with check ((select auth.uid()) = user_id and private.can_add_song(user_id, id));

-- 2) Ficheiros: o mesmo limite (contado pelos ficheiros na pasta da pessoa).
create or replace function private.can_add_file(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_premium(uid)
      or (select count(*) from storage.objects o
          where o.bucket_id = 'songs' and (storage.foldername(o.name))[1] = uid::text) < 3;
$$;
revoke execute on function private.can_add_file(uuid) from public, anon;
grant execute on function private.can_add_file(uuid) to authenticated;

drop policy if exists "ficheiros: dono cria (premium)" on storage.objects;
drop policy if exists "ficheiros: dono cria" on storage.objects;
create policy "ficheiros: dono cria (até ao limite do plano)" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and private.can_add_file((select auth.uid())));
drop policy if exists "ficheiros: dono altera (premium)" on storage.objects;
drop policy if exists "ficheiros: dono altera" on storage.objects;
create policy "ficheiros: dono altera" on storage.objects for update to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3) Dados de cada pessoa (chave → valor): por música (notas, secções, progresso, passo do Tile by Tile)
--    e preferências (tema, quadrados por linha, som do metrónomo, atraso do áudio, tutorial visto).
create table if not exists public.user_data (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null check (char_length(key) between 1 and 400),
  value      jsonb       not null check (pg_column_size(value) <= 262144),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;
create policy "user_data: dono lê"     on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_data: dono cria"   on public.user_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_data: dono altera" on public.user_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_data: dono apaga"  on public.user_data for delete to authenticated using ((select auth.uid()) = user_id);

-- As linhas antigas marcadas com deleted_at ficam como estão: o site ignora-as e, se a pessoa voltar a
-- carregar essa música, a linha é reaproveitada. A partir de agora apagar uma música apaga a linha de vez.

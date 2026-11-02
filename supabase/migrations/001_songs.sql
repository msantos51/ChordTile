-- "My songs" na nuvem: uma linha por música de cada utilizador e o ficheiro no Storage.
-- Correr uma vez no SQL Editor do projeto Supabase (ou com `supabase db push`).

create table if not exists public.songs (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  id         text        not null,              -- id da música no site (título | artista | compassos)
  file_name  text        not null,
  title      text        not null,
  artist     text        not null default '',
  bars       integer     not null,
  added_at   timestamptz not null,
  opened_at  timestamptz not null,
  deleted_at timestamptz,                         -- apagada: os outros dispositivos apagam-na também
  primary key (user_id, id)
);

alter table public.songs enable row level security;

-- Cada pessoa só vê e altera as suas músicas
create policy "songs: dono lê"     on public.songs for select to authenticated using ((select auth.uid()) = user_id);
create policy "songs: dono cria"   on public.songs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "songs: dono altera" on public.songs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "songs: dono apaga"  on public.songs for delete to authenticated using ((select auth.uid()) = user_id);

-- Ficheiros: bucket privado, cada pessoa na sua pasta (<user_id>/<sha256 do id>)
insert into storage.buckets (id, name, public, file_size_limit)
values ('songs', 'songs', false, 20971520)   -- 20 MB por ficheiro
on conflict (id) do nothing;

create policy "ficheiros: dono lê" on storage.objects for select to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ficheiros: dono cria" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ficheiros: dono altera" on storage.objects for update to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "ficheiros: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);

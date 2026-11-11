-- Substituir o ficheiro de uma música que já está na conta não conta como "mais um ficheiro".
--
-- O limite de ficheiros (Gratuito: 3) contava TODOS os ficheiros da pasta, incluindo o que estava a ser
-- enviado outra vez. Quem já tinha 3 músicas (ou mais, depois do período de experiência) e voltava a carregar
-- uma delas via o envio ser recusado, como se fosse uma música nova. Agora o próprio ficheiro não conta
-- (tal como `can_add_song` já fazia para a linha da música).
create or replace function private.can_add_file(uid uuid, object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_premium(uid)
      or (select count(*) from storage.objects o
          where o.bucket_id = 'songs' and (storage.foldername(o.name))[1] = uid::text
            and o.name <> object_name) < 3;
$$;
revoke execute on function private.can_add_file(uuid, text) from public, anon;
grant execute on function private.can_add_file(uuid, text) to authenticated;

drop policy if exists "ficheiros: dono cria (até ao limite do plano)" on storage.objects;
create policy "ficheiros: dono cria (até ao limite do plano)" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and private.can_add_file((select auth.uid()), name));

drop function if exists private.can_add_file(uuid);

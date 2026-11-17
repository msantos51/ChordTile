-- Limite aos dados de cada pessoa (tabela user_data), decidido pelo servidor.
--
-- Cada valor já estava limitado a 256 KB, mas o número de chaves não: uma conta mal-intencionada podia criar
-- milhares de linhas e encher a base de dados (e a fatura). Agora cada conta tem no máximo 5000 chaves e 25 MB
-- no total. Uso normal: 4 chaves por música (notas, progresso, Tile by Tile, aviso) mais umas poucas de
-- preferências, por isso mesmo quem tem mais de mil músicas fica longe do limite.
--
-- O gatilho corre também nos "upserts" (insert ... on conflict), que é como o site grava: a própria chave
-- não conta (voltar a gravar uma chave que já existe nunca é recusado por causa da contagem).

create or replace function private.check_user_data_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n_keys bigint;
  n_bytes bigint;
begin
  -- Um pedido de cada vez por conta: dois envios em paralelo não passam os dois "à justa" do limite
  perform pg_advisory_xact_lock(hashtextextended('user_data:' || new.user_id::text, 0));
  select count(*), coalesce(sum(pg_column_size(d.value)), 0) into n_keys, n_bytes
    from public.user_data d
    where d.user_id = new.user_id and d.key <> new.key;
  if n_keys >= 5000 then
    raise exception 'user_data: too many keys for this account' using errcode = '54000';
  end if;
  if n_bytes + pg_column_size(new.value) > 25 * 1024 * 1024 then
    raise exception 'user_data: storage limit reached for this account' using errcode = '54000';
  end if;
  return new;
end $$;
revoke execute on function private.check_user_data_limits() from public, anon, authenticated;

drop trigger if exists user_data_limits on public.user_data;
create trigger user_data_limits before insert or update on public.user_data
  for each row execute function private.check_user_data_limits();

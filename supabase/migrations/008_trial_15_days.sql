-- O período de experiência de Premium passa de 7 para 15 dias (contas criadas a partir de agora).
-- As contas que já existem mantêm a data de fim que tinham.
alter table public.entitlements alter column trial_ends_at set default now() + interval '15 days';

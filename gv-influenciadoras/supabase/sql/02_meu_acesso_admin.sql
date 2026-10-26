-- Troque pelo e-mail que você usa para entrar no painel como administradora.
-- Para ter mais de uma administradora, repita a linha com outro e-mail.
insert into public.admin_emails (email) values (lower('seu-email@exemplo.com.br'))
on conflict do nothing;

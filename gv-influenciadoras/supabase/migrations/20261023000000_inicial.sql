-- =====================================================================
-- Clube de Influenciadoras · Grazzy Vaz Fragrâncias
-- Banco de dados completo. Cole tudo no SQL Editor do Supabase e rode uma vez.
-- =====================================================================

-- ---------- Tabelas ----------

-- E-mails que entram como administradora (você e quem mais administrar o clube)
create table if not exists public.admin_emails (
  email text primary key check (email = lower(email))
);

-- Regras gerais do clube (uma linha só)
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  release_days int not null default 15 check (release_days >= 0),
  store_uf text not null default 'MG',
  store_url text not null default 'https://www.grazzyvazfragrancias.com.br',
  tiers numeric[] not null default '{0,2000,6000,15000}',
  commission_base text not null default 'produtos' check (commission_base in ('produtos', 'total')),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.influencers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text,
  email text,
  phone text,
  coupon text not null,
  rate numeric(5,2) not null default 10 check (rate between 0 and 100),
  status text not null default 'ativa' check (status in ('ativa', 'inativa')),
  pix text,
  cpf text,
  cep text,
  street text,
  number text,
  complement text,
  district text,
  city text,
  state text,
  links jsonb not null default '[]'::jsonb,
  notes text,
  joined date not null default current_date,
  example boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists influencers_coupon_key on public.influencers (upper(coupon));
create unique index if not exists influencers_email_key on public.influencers (lower(email)) where email is not null;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,            -- 'bagy-<nº do pedido>' para pedidos da Bagy
  bagy_id text,                       -- id interno do pedido na Bagy
  order_number text,
  date date not null default current_date,
  customer text,
  coupon text,
  total numeric(12,2) not null default 0,   -- valor total do pedido
  base numeric(12,2),                       -- valor dos produtos com desconto, sem frete
  status text not null default 'aprovado' check (status in ('aprovado', 'pendente', 'cancelado')),
  paid_at date,                       -- dia em que o pedido apareceu como pago (conta o prazo de liberação)
  influencer_id uuid references public.influencers(id) on delete set null,
  rate numeric(5,2),                  -- % de comissão da influenciadora no momento da venda
  manual_override boolean not null default false,  -- editada à mão: a integração não sobrescreve
  source text not null default 'manual',
  raw jsonb,
  example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_influencer_date on public.sales (influencer_id, date);
create index if not exists sales_bagy_id on public.sales (bagy_id);
create index if not exists sales_coupon on public.sales (upper(coupon));

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  metric text not null default 'vendas' check (metric in ('vendas', 'pedidos')),
  target numeric(12,2) not null check (target > 0),
  start_date date not null default current_date,
  end_date date not null,
  reward text,
  bonus numeric(12,2) not null default 0,
  example boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  date date not null default current_date,
  note text,
  example boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.credits (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  challenge_id uuid references public.challenges(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  date date not null default current_date,
  note text,
  example boolean not null default false,
  created_at timestamptz not null default now(),
  unique (challenge_id, influencer_id)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_date date,
  end_date date,
  brief text,
  url text,
  hashtag text,
  extra text,
  active boolean not null default true,
  products jsonb not null default '[]'::jsonb,
  example boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  date date not null default current_date,
  items jsonb not null default '[]'::jsonb,
  nf text,
  tracking text,
  status text not null default 'preparando' check (status in ('preparando', 'enviado', 'entregue')),
  note text,
  example boolean not null default false,
  created_at timestamptz not null default now()
);

-- Registro dos avisos recebidos da Bagy (para conferir se a integração está funcionando)
create table if not exists public.bagy_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text,
  order_ref text,
  result text,
  detail text
);

-- Chave secreta do webhook (gerada sozinha; aparece na tela Integração Bagy)
create table if not exists public.integration (
  id int primary key default 1 check (id = 1),
  webhook_key text not null default replace(gen_random_uuid()::text, '-', '')
);
insert into public.integration (id) values (1) on conflict (id) do nothing;

-- ---------- Quem é quem ----------

-- Administradora: e-mail confirmado que está em admin_emails
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_emails a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- Influenciadora ativa cujo e-mail é o mesmo do login
create or replace function public.my_influencer_id()
returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select i.id
  from auth.users u
  join public.influencers i on lower(i.email) = lower(u.email)
  where u.id = auth.uid() and u.email_confirmed_at is not null and i.status = 'ativa'
  limit 1;
$$;

-- O que o painel chama ao entrar: diz se é admin ou influenciadora
create or replace function public.whoami()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'admin', public.is_admin(),
    'influencer_id', public.my_influencer_id()
  );
$$;

-- ---------- Ajustes automáticos ----------

create or replace function public.tg_influencers_normalize()
returns trigger language plpgsql as $$
begin
  new.coupon := upper(trim(new.coupon));
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.state := nullif(upper(trim(coalesce(new.state, ''))), '');
  return new;
end $$;

drop trigger if exists influencers_normalize on public.influencers;
create trigger influencers_normalize before insert or update on public.influencers
for each row execute function public.tg_influencers_normalize();

-- Quando uma influenciadora é cadastrada (ou muda o cupom), vendas antigas com aquele cupom passam a ser dela
create or replace function public.tg_influencers_claim_sales()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.sales set influencer_id = new.id
  where influencer_id is null and upper(coupon) = new.coupon;
  return null;
end $$;

drop trigger if exists influencers_claim_sales on public.influencers;
create trigger influencers_claim_sales after insert or update of coupon on public.influencers
for each row execute function public.tg_influencers_claim_sales();

-- Cada venda vai para a dona do cupom
create or replace function public.tg_sales_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.coupon := nullif(upper(trim(coalesce(new.coupon, ''))), '');
  if tg_op = 'UPDATE' and new.coupon is distinct from old.coupon
     and new.influencer_id is not distinct from old.influencer_id then
    new.influencer_id := null;
  end if;
  if new.influencer_id is null and new.coupon is not null then
    select id into new.influencer_id from public.influencers where upper(coupon) = new.coupon;
  end if;
  -- guarda a % de comissão do momento da venda (mudar a % depois não altera vendas antigas)
  if new.influencer_id is null then
    new.rate := null;
  elsif tg_op = 'INSERT' or new.influencer_id is distinct from old.influencer_id or new.rate is null then
    select rate into new.rate from public.influencers where id = new.influencer_id;
  end if;
  -- data do pagamento: o prazo de liberação da comissão conta a partir daqui
  if new.status = 'aprovado' and new.paid_at is null then
    if tg_op = 'UPDATE' and old.status = 'aprovado' and old.paid_at is not null then
      new.paid_at := old.paid_at;
    else
      new.paid_at := current_date;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sales_link on public.sales;
create trigger sales_link before insert or update on public.sales
for each row execute function public.tg_sales_link();

-- ---------- Regras de acesso (RLS) ----------

alter table public.admin_emails enable row level security;
alter table public.settings     enable row level security;
alter table public.influencers  enable row level security;
alter table public.sales        enable row level security;
alter table public.challenges   enable row level security;
alter table public.payouts      enable row level security;
alter table public.credits      enable row level security;
alter table public.campaigns    enable row level security;
alter table public.shipments    enable row level security;
alter table public.bagy_log     enable row level security;
alter table public.integration  enable row level security;

do $$
declare t text;
begin
  -- Administradora pode tudo em todas as tabelas
  foreach t in array array['settings','influencers','sales','challenges','payouts','credits','campaigns','shipments'] loop
    execute format('drop policy if exists admin_tudo on public.%I', t);
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists admin_le on public.admin_emails;
create policy admin_le on public.admin_emails for select to authenticated using (public.is_admin());

drop policy if exists admin_le on public.bagy_log;
create policy admin_le on public.bagy_log for select to authenticated using (public.is_admin());

drop policy if exists admin_le on public.integration;
create policy admin_le on public.integration for select to authenticated using (public.is_admin());

-- Influenciadoras ativas leem as regras, campanhas e desafios
drop policy if exists todas_leem on public.settings;
create policy todas_leem on public.settings for select to authenticated using (public.my_influencer_id() is not null);
drop policy if exists todas_leem on public.campaigns;
create policy todas_leem on public.campaigns for select to authenticated using (public.my_influencer_id() is not null);
drop policy if exists todas_leem on public.challenges;
create policy todas_leem on public.challenges for select to authenticated using (public.my_influencer_id() is not null);

-- Cada influenciadora lê só o que é dela
drop policy if exists le_o_seu on public.influencers;
create policy le_o_seu on public.influencers for select to authenticated using (id = public.my_influencer_id());
drop policy if exists le_o_seu on public.payouts;
create policy le_o_seu on public.payouts for select to authenticated using (influencer_id = public.my_influencer_id());
drop policy if exists le_o_seu on public.credits;
create policy le_o_seu on public.credits for select to authenticated using (influencer_id = public.my_influencer_id());
drop policy if exists le_o_seu on public.shipments;
create policy le_o_seu on public.shipments for select to authenticated using (influencer_id = public.my_influencer_id());
-- Vendas: a influenciadora não lê a tabela direto; usa a visão minhas_vendas (nome da cliente abreviado)

revoke all on public.admin_emails from anon;
revoke all on public.bagy_log from anon;
revoke all on public.integration from anon;

-- ---------- O que a influenciadora vê ----------

create or replace function public.abreviar_nome(n text)
returns text language sql immutable as $$
  select case
    when n is null or trim(n) = '' then 'Cliente'
    when array_length(regexp_split_to_array(trim(n), '\s+'), 1) = 1 then trim(n)
    else split_part(trim(n), ' ', 1) || ' ' ||
         left((regexp_split_to_array(trim(n), '\s+'))[array_length(regexp_split_to_array(trim(n), '\s+'), 1)], 1) || '.'
  end;
$$;

drop view if exists public.minhas_vendas;
create view public.minhas_vendas as
  select s.id, s.order_number, s.date, public.abreviar_nome(s.customer) as customer,
         s.coupon, s.total, s.base, s.status, s.paid_at, s.rate, s.influencer_id
  from public.sales s
  where s.influencer_id = public.my_influencer_id();
revoke all on public.minhas_vendas from anon;
grant select on public.minhas_vendas to authenticated;

-- Ranking: todas veem nome e nº de pedidos; o valor vendido só aparece para a admin e para a própria
create or replace function public.ranking(p_inicio date, p_fim date)
returns table (influencer_id uuid, name text, orders bigint, total numeric)
language sql stable security definer set search_path = public
as $$
  with me as (select public.is_admin() as adm, public.my_influencer_id() as mid)
  select i.id,
         i.name,
         count(s.id),
         case when me.adm or i.id = me.mid then coalesce(sum(s.total), 0) end
  from public.influencers i
  cross join me
  join public.sales s on s.influencer_id = i.id and s.status = 'aprovado'
                     and s.date between p_inicio and p_fim
  where i.status = 'ativa' and (me.adm or me.mid is not null)
  group by i.id, i.name, me.adm, me.mid
  order by coalesce(sum(s.total), 0) desc, count(s.id) desc;
$$;
revoke execute on function public.ranking(date, date) from public, anon;
grant execute on function public.ranking(date, date) to authenticated;

-- A influenciadora atualiza o próprio endereço, PIX e contato (não mexe em cupom nem comissão)
create or replace function public.atualizar_meus_dados(p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare v uuid := public.my_influencer_id();
begin
  if v is null then
    raise exception 'Acesso negado';
  end if;
  update public.influencers set
    handle = coalesce(p->>'handle', handle),
    phone = coalesce(p->>'phone', phone),
    pix = coalesce(p->>'pix', pix),
    cpf = coalesce(p->>'cpf', cpf),
    cep = coalesce(p->>'cep', cep),
    street = coalesce(p->>'street', street),
    number = coalesce(p->>'number', number),
    complement = coalesce(p->>'complement', complement),
    district = coalesce(p->>'district', district),
    city = coalesce(p->>'city', city),
    state = coalesce(p->>'state', state)
  where id = v;
end $$;
revoke execute on function public.atualizar_meus_dados(jsonb) from public, anon;
grant execute on function public.atualizar_meus_dados(jsonb) to authenticated;

-- Usada só pela função do servidor para criar ou trocar a senha de acesso
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke execute on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- ---------- Avisos em tempo real de novas vendas (painel da admin) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
end $$;

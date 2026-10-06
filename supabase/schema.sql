-- =====================================================================
-- Drive In Burger — Fila de espera & Reservas
-- Supabase (projeto "Drive-reservas")
--
-- Como usar: cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- Pode ser executado de novo sem perder dados (é idempotente).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Equipe (quem pode acessar o painel)
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 2. Configurações do restaurante (linha única)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                           int primary key default 1 check (id = 1),
  nome_restaurante             text    not null default 'Drive In Burger',
  fuso                         text    not null default 'America/Sao_Paulo',
  fila_aberta                  boolean not null default true,
  tempo_medio_por_grupo_min    int     not null default 7   check (tempo_medio_por_grupo_min between 1 and 120),
  duracao_reserva_min          int     not null default 90  check (duracao_reserva_min between 30 and 360),
  intervalo_slot_min           int     not null default 30  check (intervalo_slot_min between 15 and 120),
  ultima_reserva_antes_fechar_min int  not null default 60  check (ultima_reserva_antes_fechar_min between 0 and 360),
  max_pessoas_reserva          int     not null default 12  check (max_pessoas_reserva between 1 and 100),
  antecedencia_min_min         int     not null default 60  check (antecedencia_min_min between 0 and 1440),
  antecedencia_max_dias        int     not null default 30  check (antecedencia_max_dias between 1 and 365),
  confirmar_automatico         boolean not null default true,
  tolerancia_atraso_min        int     not null default 15  check (tolerancia_atraso_min between 0 and 120),
  whatsapp                     text    not null default '',
  -- chave = dia da semana (0 = domingo ... 6 = sábado); valor = lista de [abre, fecha]
  horarios                     jsonb   not null default '{
    "0":[["11:00","23:00"]],"1":[["11:00","23:00"]],"2":[["11:00","23:00"]],
    "3":[["11:00","23:00"]],"4":[["11:00","23:00"]],"5":[["11:00","23:00"]],
    "6":[["11:00","23:00"]]}'::jsonb
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Mesas (mapa do salão)
-- ---------------------------------------------------------------------
create table if not exists public.mesas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(nome) between 1 and 20),
  area          text not null default 'Salão Principal' check (area in ('Salão Principal','Mezanino','Kids')),
  cap_min       int  not null default 1 check (cap_min >= 1),
  cap_max       int  not null default 4 check (cap_max >= cap_min),
  pos_x         int  not null default 0,
  pos_y         int  not null default 0,
  ativa         boolean not null default true,
  status        text not null default 'livre' check (status in ('livre','ocupada','limpeza')),
  ocupada_desde timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Fila de espera (clientes que chegam sem reserva)
-- ---------------------------------------------------------------------
create table if not exists public.fila (
  id          uuid primary key default gen_random_uuid(),
  token       uuid not null unique default gen_random_uuid(),   -- segredo do cliente (fica só no celular dele)
  dia         date not null,
  pager       int  not null,
  nome        text not null check (char_length(nome) between 1 and 80),
  telefone    text not null check (char_length(telefone) between 8 and 20),
  pessoas     int  not null check (pessoas between 1 and 30),
  area        text not null default 'Sem preferência' check (area in ('Salão Principal','Mezanino','Kids','Sem preferência')),
  como_conheceu text not null default 'Não informado' check (char_length(como_conheceu) <= 80),
  prioritario boolean not null default false,   -- só a recepção marca
  pager_fisico text check (pager_fisico is null or char_length(pager_fisico) <= 10),  -- nº do pager entregue ao cliente
  status      text not null default 'aguardando'
              check (status in ('aguardando','chamado','sentado','cancelado','nao_compareceu')),
  mesa_id     uuid references public.mesas(id) on delete set null,
  created_at  timestamptz not null default now(),
  chamado_em  timestamptz,
  sentado_em  timestamptz,
  unique (dia, pager)
);
create index if not exists fila_dia_idx on public.fila (dia, status);

-- ---------------------------------------------------------------------
-- 5. Reservas
-- ---------------------------------------------------------------------
create table if not exists public.reservas (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nome        text not null check (char_length(nome) between 1 and 80),
  telefone    text not null check (char_length(telefone) between 8 and 20),
  email       text check (email is null or char_length(email) <= 120),
  data        date not null,
  hora        time not null,
  pessoas     int  not null check (pessoas between 1 and 100),
  area        text not null default 'Sem preferência' check (area in ('Salão Principal','Mezanino','Kids','Sem preferência')),
  como_conheceu text not null default 'Não informado' check (char_length(como_conheceu) <= 80),
  obs         text check (obs is null or char_length(obs) <= 300),
  status      text not null default 'pendente'
              check (status in ('pendente','confirmada','chegou','sentada','concluida','cancelada','nao_compareceu')),
  mesa_id     uuid references public.mesas(id) on delete set null,
  origem      text not null default 'online' check (origem in ('online','equipe')),
  created_at  timestamptz not null default now()
);
create index if not exists reservas_data_idx on public.reservas (data, status);
create index if not exists reservas_mesa_idx on public.reservas (mesa_id, data);

-- ---------------------------------------------------------------------
-- 5b. Migração (para bancos que já rodaram versões anteriores)
--     - salões: Salão Principal / Mezanino / Kids
--     - "ocasião" virou "como conheceu o Drive"
-- ---------------------------------------------------------------------
alter table public.mesas    drop constraint if exists mesas_area_check;
alter table public.fila     drop constraint if exists fila_area_check;
alter table public.reservas drop constraint if exists reservas_area_check;

update public.mesas    set area = 'Salão Principal' where area in ('Salão Interno','Área Externa');
update public.fila     set area = 'Salão Principal' where area in ('Salão Interno','Área Externa');
update public.reservas set area = 'Salão Principal' where area in ('Salão Interno','Área Externa');

alter table public.mesas    add constraint mesas_area_check    check (area in ('Salão Principal','Mezanino','Kids'));
alter table public.fila     add constraint fila_area_check     check (area in ('Salão Principal','Mezanino','Kids','Sem preferência'));
alter table public.reservas add constraint reservas_area_check check (area in ('Salão Principal','Mezanino','Kids','Sem preferência'));

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='fila' and column_name='ocasiao') then
    alter table public.fila rename column ocasiao to como_conheceu;
    alter table public.fila alter column como_conheceu set default 'Não informado';
    update public.fila set como_conheceu = 'Não informado';   -- os valores antigos eram "ocasião"
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='reservas' and column_name='ocasiao') then
    alter table public.reservas rename column ocasiao to como_conheceu;
    alter table public.reservas alter column como_conheceu set default 'Não informado';
    update public.reservas set como_conheceu = 'Não informado';
  end if;
end $$;

alter table public.fila     drop constraint if exists fila_ocasiao_check;
alter table public.fila     drop constraint if exists fila_como_conheceu_check;
alter table public.reservas drop constraint if exists reservas_ocasiao_check;
alter table public.reservas drop constraint if exists reservas_como_conheceu_check;
alter table public.fila     add constraint fila_como_conheceu_check     check (char_length(como_conheceu) <= 80);
alter table public.reservas add constraint reservas_como_conheceu_check check (char_length(como_conheceu) <= 80);

alter table public.fila add column if not exists pager_fisico text;
alter table public.fila drop constraint if exists fila_pager_fisico_check;
alter table public.fila add constraint fila_pager_fisico_check check (pager_fisico is null or char_length(pager_fisico) <= 10);

-- ---------------------------------------------------------------------
-- 6. Segurança (RLS): só a equipe lê/escreve direto nas tabelas.
--    O público (cliente) usa apenas as funções (RPC) da seção 7.
-- ---------------------------------------------------------------------
alter table public.staff    enable row level security;
alter table public.settings enable row level security;
alter table public.mesas    enable row level security;
alter table public.fila     enable row level security;
alter table public.reservas enable row level security;

drop policy if exists staff_self    on public.staff;
drop policy if exists settings_all  on public.settings;
drop policy if exists mesas_all     on public.mesas;
drop policy if exists fila_all      on public.fila;
drop policy if exists reservas_all  on public.reservas;

create policy staff_self   on public.staff    for select to authenticated using (user_id = auth.uid());
create policy settings_all on public.settings for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy mesas_all    on public.mesas    for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy fila_all     on public.fila     for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy reservas_all on public.reservas for all to authenticated using (public.is_staff()) with check (public.is_staff());

revoke all on public.staff, public.settings, public.mesas, public.fila, public.reservas from anon;
grant select on public.staff to authenticated;
grant select, insert, update, delete on public.settings, public.mesas, public.fila, public.reservas to authenticated;

-- ---------------------------------------------------------------------
-- 7. Funções internas
-- ---------------------------------------------------------------------
-- (os nomes dos parâmetros mudaram: remove as versões antigas antes de recriar)
drop function if exists public._fila_inserir(text,text,int,text,text,boolean);
drop function if exists public._reserva_inserir(text,text,text,date,text,int,text,text,text,text);
drop function if exists public.fila_entrar(text,text,int,text,text,boolean);
drop function if exists public.fila_adicionar_equipe(text,text,int,text,text,boolean);
drop function if exists public.reserva_criar(text,text,text,date,text,int,text,text,text);
drop function if exists public.reserva_criar_equipe(text,text,text,date,text,int,text,text,text);

create or replace function public._agora()
returns timestamp
language sql stable security definer set search_path = public as $$
  select now() at time zone (select fuso from public.settings where id = 1);
$$;

-- Melhor mesa livre (a menor que comporta o grupo) para o intervalo informado
create or replace function public._mesa_livre(p_inicio timestamp, p_pessoas int, p_area text, p_ignorar uuid default null)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  dur int;
  fim timestamp;
  achada uuid;
begin
  select duracao_reserva_min into dur from public.settings where id = 1;
  fim := p_inicio + make_interval(mins => dur);

  select m.id into achada
  from public.mesas m
  where m.ativa
    and m.cap_min <= p_pessoas
    and m.cap_max >= p_pessoas
    and (coalesce(p_area,'Sem preferência') = 'Sem preferência' or m.area = p_area)
    and not exists (
      select 1 from public.reservas r
      where r.mesa_id = m.id
        and r.status in ('pendente','confirmada','chegou','sentada')
        and (p_ignorar is null or r.id <> p_ignorar)
        and (r.data + r.hora) < fim
        and p_inicio < (r.data + r.hora + make_interval(mins => dur))
    )
  order by m.cap_max, m.nome
  limit 1;

  return achada;
end $$;

create or replace function public._fila_inserir(
  p_nome text, p_telefone text, p_pessoas int, p_area text, p_como_conheceu text, p_prioritario boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hoje date;
  tel  text;
  ex   public.fila%rowtype;
  n    int;
  novo public.fila%rowtype;
begin
  hoje := public._agora()::date;
  tel  := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');

  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe seu nome.'; end if;
  if length(tel) < 10 or length(tel) > 13 then raise exception 'Informe um telefone válido, com DDD.'; end if;
  if p_pessoas is null or p_pessoas < 1 or p_pessoas > 30 then raise exception 'Número de pessoas inválido.'; end if;
  if coalesce(p_area,'Sem preferência') not in ('Salão Principal','Mezanino','Kids','Sem preferência') then
    raise exception 'Área inválida.';
  end if;

  perform pg_advisory_xact_lock(hashtext('dib_fila'));

  -- mesmo telefone já na fila hoje: devolve a senha existente
  select * into ex from public.fila
   where dia = hoje
     and regexp_replace(telefone,'\D','','g') = tel
     and status in ('aguardando','chamado')
   limit 1;
  if found then
    return jsonb_build_object('token', ex.token, 'pager', ex.pager, 'ja_existia', true);
  end if;

  select coalesce(max(pager),0) + 1 into n from public.fila where dia = hoje;

  insert into public.fila (dia, pager, nome, telefone, pessoas, area, como_conheceu, prioritario)
  values (hoje, n, left(trim(p_nome),80), left(trim(p_telefone),20), p_pessoas,
          coalesce(nullif(p_area,''),'Sem preferência'),
          left(coalesce(nullif(trim(p_como_conheceu),''),'Não informado'),80),
          coalesce(p_prioritario,false))
  returning * into novo;

  return jsonb_build_object('token', novo.token, 'pager', novo.pager, 'ja_existia', false);
end $$;

create or replace function public._reserva_inserir(
  p_nome text, p_telefone text, p_email text, p_data date, p_hora text, p_pessoas int,
  p_area text, p_como_conheceu text, p_obs text, p_origem text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s      public.settings%rowtype;
  tel    text;
  ini    timestamp;
  mesa   uuid;
  cod    text;
  st     text;
  ok     boolean;
  futuras int;
  i      int;
  novo   public.reservas%rowtype;
begin
  select * into s from public.settings where id = 1;
  tel := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');

  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe seu nome.'; end if;
  if length(tel) < 10 or length(tel) > 13 then raise exception 'Informe um telefone válido, com DDD.'; end if;
  if p_pessoas is null or p_pessoas < 1 then raise exception 'Número de pessoas inválido.'; end if;
  if p_data is null or p_hora is null then raise exception 'Informe data e horário.'; end if;
  if coalesce(p_area,'Sem preferência') not in ('Salão Principal','Mezanino','Kids','Sem preferência') then
    raise exception 'Área inválida.';
  end if;

  ini := p_data + p_hora::time;

  perform pg_advisory_xact_lock(hashtext('dib_reservas'));

  if p_origem = 'online' then
    select d.disponivel into ok
      from public.reserva_disponibilidade(p_data, p_pessoas, coalesce(p_area,'Sem preferência')) d
     where d.hora = to_char(ini, 'HH24:MI');
    if not coalesce(ok, false) then
      raise exception 'Este horário não está mais disponível. Escolha outro horário.';
    end if;

    select count(*) into futuras from public.reservas
     where regexp_replace(telefone,'\D','','g') = tel
       and status in ('pendente','confirmada')
       and (data + hora) >= public._agora();
    if futuras >= 3 then
      raise exception 'Este telefone já tem 3 reservas ativas. Cancele uma para fazer outra.';
    end if;
  end if;

  mesa := public._mesa_livre(ini, p_pessoas, coalesce(p_area,'Sem preferência'), null);
  if mesa is null then
    raise exception 'Não há mesa disponível para este horário.';
  end if;

  loop
    cod := '';
    for i in 1..5 loop
      cod := cod || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random()*32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.reservas where codigo = cod);
  end loop;

  if p_origem = 'equipe' or s.confirmar_automatico then st := 'confirmada'; else st := 'pendente'; end if;

  insert into public.reservas (codigo, nome, telefone, email, data, hora, pessoas, area, como_conheceu, obs, status, mesa_id, origem)
  values (cod, left(trim(p_nome),80), left(trim(p_telefone),20), left(nullif(trim(coalesce(p_email,'')),''),120),
          p_data, p_hora::time, p_pessoas, coalesce(p_area,'Sem preferência'),
          left(coalesce(nullif(trim(p_como_conheceu),''),'Não informado'),80), left(nullif(trim(coalesce(p_obs,'')),''),300),
          st, mesa, p_origem)
  returning * into novo;

  return jsonb_build_object('codigo', novo.codigo, 'status', novo.status, 'data', novo.data,
                            'hora', to_char(novo.hora,'HH24:MI'), 'pessoas', novo.pessoas, 'nome', novo.nome);
end $$;

-- ---------------------------------------------------------------------
-- 8. Funções públicas (chamadas pelas páginas do cliente)
-- ---------------------------------------------------------------------
create or replace function public.config_publica()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome_restaurante', nome_restaurante,
    'fuso', fuso,
    'hoje', public._agora()::date,
    'fila_aberta', fila_aberta,
    'max_pessoas_reserva', max_pessoas_reserva,
    'antecedencia_max_dias', antecedencia_max_dias,
    'duracao_reserva_min', duracao_reserva_min,
    'confirmar_automatico', confirmar_automatico,
    'tolerancia_atraso_min', tolerancia_atraso_min,
    'whatsapp', whatsapp,
    'horarios', horarios)
  from public.settings where id = 1;
$$;

-- FILA ---------------------------------------------------------------
create or replace function public.fila_entrar(
  p_nome text, p_telefone text, p_pessoas int, p_area text, p_como_conheceu text, p_prioritario boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (select fila_aberta from public.settings where id = 1) then
    raise exception 'A fila de espera está fechada no momento.';
  end if;
  -- prioridade só pode ser marcada pela recepção: o parâmetro do cliente é ignorado
  return public._fila_inserir(p_nome, p_telefone, p_pessoas, p_area, p_como_conheceu, false);
end $$;

create or replace function public.fila_adicionar_equipe(
  p_nome text, p_telefone text, p_pessoas int, p_area text, p_como_conheceu text, p_prioritario boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Acesso restrito à equipe.'; end if;
  return public._fila_inserir(p_nome, p_telefone, p_pessoas, p_area, p_como_conheceu, p_prioritario);
end $$;

create or replace function public.fila_status(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e     public.fila%rowtype;
  s     public.settings%rowtype;
  hoje  date;
  ahead int;
  pos   int;
  st    text;
begin
  select * into e from public.fila where token = p_token;
  if not found then return null; end if;
  select * into s from public.settings where id = 1;
  hoje := public._agora()::date;

  st := e.status;
  if e.dia < hoje and e.status in ('aguardando','chamado') then st := 'expirado'; end if;

  if st = 'aguardando' then
    select count(*) into ahead from public.fila f
     where f.dia = e.dia and f.status = 'aguardando' and f.id <> e.id
       and (f.prioritario > e.prioritario
            or (f.prioritario = e.prioritario and f.created_at < e.created_at));
    pos := ahead + 1;
  end if;

  return jsonb_build_object(
    'pager', e.pager, 'pager_fisico', e.pager_fisico, 'nome', e.nome, 'pessoas', e.pessoas, 'area', e.area,
    'status', st, 'posicao', pos,
    'espera_min', case when pos is null then null else (pos - 1) * s.tempo_medio_por_grupo_min end);
end $$;

create or replace function public.fila_cancelar(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.fila set status = 'cancelado'
   where token = p_token and status in ('aguardando','chamado');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- RESERVAS -----------------------------------------------------------
create or replace function public.reserva_disponibilidade(p_data date, p_pessoas int, p_area text default 'Sem preferência')
returns table (hora text, disponivel boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  s      public.settings%rowtype;
  agora  timestamp;
  faixa  jsonb;
  abre   time;
  fecha  time;
  t      timestamp;
  limite timestamp;
begin
  select * into s from public.settings where id = 1;
  agora := public._agora();

  if p_pessoas is null or p_pessoas < 1 or p_pessoas > s.max_pessoas_reserva then return; end if;
  if p_data is null or p_data < agora::date or p_data > agora::date + s.antecedencia_max_dias then return; end if;

  for faixa in
    select * from jsonb_array_elements(coalesce(s.horarios -> (extract(dow from p_data))::int::text, '[]'::jsonb))
  loop
    abre   := (faixa ->> 0)::time;
    fecha  := (faixa ->> 1)::time;
    t      := p_data + abre;
    limite := (p_data + fecha) - make_interval(mins => s.ultima_reserva_antes_fechar_min);
    while t <= limite loop
      hora := to_char(t, 'HH24:MI');
      disponivel := t >= agora + make_interval(mins => s.antecedencia_min_min)
                    and public._mesa_livre(t, p_pessoas, coalesce(p_area,'Sem preferência'), null) is not null;
      return next;
      t := t + make_interval(mins => s.intervalo_slot_min);
    end loop;
  end loop;
end $$;

create or replace function public.reserva_criar(
  p_nome text, p_telefone text, p_email text, p_data date, p_hora text, p_pessoas int,
  p_area text, p_como_conheceu text, p_obs text)
returns jsonb
language sql security definer set search_path = public as $$
  select public._reserva_inserir(p_nome, p_telefone, p_email, p_data, p_hora, p_pessoas, p_area, p_como_conheceu, p_obs, 'online');
$$;

create or replace function public.reserva_criar_equipe(
  p_nome text, p_telefone text, p_email text, p_data date, p_hora text, p_pessoas int,
  p_area text, p_como_conheceu text, p_obs text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Acesso restrito à equipe.'; end if;
  return public._reserva_inserir(p_nome, p_telefone, p_email, p_data, p_hora, p_pessoas, p_area, p_como_conheceu, p_obs, 'equipe');
end $$;

-- consulta exige código + telefone (evita que alguém veja reservas de outras pessoas)
create or replace function public.reserva_consultar(p_codigo text, p_telefone text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', r.codigo, 'nome', r.nome, 'data', r.data, 'hora', to_char(r.hora,'HH24:MI'),
    'pessoas', r.pessoas, 'area', r.area, 'como_conheceu', r.como_conheceu, 'obs', r.obs, 'status', r.status)
  from public.reservas r
  where r.codigo = upper(trim(p_codigo))
    and regexp_replace(r.telefone,'\D','','g') = regexp_replace(coalesce(p_telefone,''),'\D','','g')
  limit 1;
$$;

create or replace function public.reserva_cancelar(p_codigo text, p_telefone text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.reservas set status = 'cancelada'
   where codigo = upper(trim(p_codigo))
     and regexp_replace(telefone,'\D','','g') = regexp_replace(coalesce(p_telefone,''),'\D','','g')
     and status in ('pendente','confirmada');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------------------------------------------------------------------
-- 9. Permissões de execução
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.config_publica()                                             to anon, authenticated;
grant execute on function public.fila_entrar(text,text,int,text,text,boolean)                 to anon, authenticated;
grant execute on function public.fila_status(uuid)                                            to anon, authenticated;
grant execute on function public.fila_cancelar(uuid)                                          to anon, authenticated;
grant execute on function public.reserva_disponibilidade(date,int,text)                       to anon, authenticated;
grant execute on function public.reserva_criar(text,text,text,date,text,int,text,text,text)   to anon, authenticated;
grant execute on function public.reserva_consultar(text,text)                                 to anon, authenticated;
grant execute on function public.reserva_cancelar(text,text)                                  to anon, authenticated;

grant execute on function public.is_staff()                                                   to authenticated;
grant execute on function public.fila_adicionar_equipe(text,text,int,text,text,boolean)       to authenticated;
grant execute on function public.reserva_criar_equipe(text,text,text,date,text,int,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Tempo real para o painel da equipe
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.fila;     exception when others then null; end;
    begin alter publication supabase_realtime add table public.reservas; exception when others then null; end;
    begin alter publication supabase_realtime add table public.mesas;    exception when others then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. Mesas de exemplo (só se ainda não existir nenhuma) — ajuste depois no painel
-- ---------------------------------------------------------------------
insert into public.mesas (nome, area, cap_min, cap_max, pos_x, pos_y)
select * from (values
  ('M1','Salão Principal',1,2,0,0), ('M2','Salão Principal',1,2,1,0), ('M3','Salão Principal',2,4,2,0),
  ('M4','Salão Principal',2,4,3,0), ('M5','Salão Principal',3,6,0,2), ('M6','Salão Principal',3,6,2,2),
  ('M7','Salão Principal',5,10,4,2),
  ('Z1','Mezanino',2,4,0,5), ('Z2','Mezanino',2,4,1,5), ('Z3','Mezanino',3,6,2,5), ('Z4','Mezanino',5,10,4,5),
  ('K1','Kids',2,4,7,0), ('K2','Kids',3,6,8,0), ('K3','Kids',5,10,9,2)
) as v(nome, area, cap_min, cap_max, pos_x, pos_y)
where not exists (select 1 from public.mesas);

-- ---------------------------------------------------------------------
-- 12. DEPOIS de criar o usuário da equipe em Authentication > Users,
--     libere o acesso dele com (troque o e-mail):
--
--   insert into public.staff (user_id, nome)
--   select id, 'Nome da pessoa' from auth.users where email = 'email@dominio.com'
--   on conflict do nothing;
-- ---------------------------------------------------------------------

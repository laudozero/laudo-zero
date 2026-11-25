-- =====================================================================
-- LAUDO ZERO - controle de acesso (e-mail + código da compra na Hotmart)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Pode ser executado de novo sem erro.
--
-- Regras:
--   * cada compra aprovada na Hotmart vira um acesso (e-mail + código da transação)
--   * cada acesso vale por 1 relatório (1 imóvel) e tem prazo de validade
--   * o crédito é descontado ao iniciar a vistoria no app (não ao gerar o PDF)
--   * reembolso, chargeback ou cancelamento bloqueiam o acesso
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists acessos (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,                          -- sempre em minúsculas
  transacao          text not null unique,                   -- código da compra na Hotmart (HP...), em maiúsculas
  produto_id         text,
  comprador_nome     text,
  relatorios_total   integer not null default 1 check (relatorios_total > 0),
  relatorios_usados  integer not null default 0 check (relatorios_usados >= 0),
  validade_ate       timestamptz not null,
  status             text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  cancelado_motivo   text,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint acessos_saldo_ok check (relatorios_usados <= relatorios_total)
);

create index if not exists idx_acessos_email on acessos (email);

create table if not exists vistorias_iniciadas (
  id               uuid primary key default gen_random_uuid(),
  acesso_id        uuid not null references acessos (id) on delete cascade,
  vistoria_codigo  text not null,                            -- código gerado pelo app (VZ-XXXXXX)
  imovel           text,
  iniciada_em      timestamptz not null default now(),
  unique (acesso_id, vistoria_codigo)
);

-- Auditoria dos avisos recebidos da Hotmart (sem o token secreto)
create table if not exists hotmart_eventos (
  id           uuid primary key default gen_random_uuid(),
  evento       text not null,
  transacao    text,
  payload      jsonb not null,
  recebido_em  timestamptz not null default now()
);

-- Tentativas de entrada com dados errados (limita adivinhação de códigos)
create table if not exists tentativas_acesso (
  id          bigserial primary key,
  email       text not null,
  tentou_em   timestamptz not null default now()
);

create index if not exists idx_tentativas_email on tentativas_acesso (email, tentou_em);

-- Mantém "atualizado_em" correto
create or replace function set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_acessos_atualizado on acessos;
create trigger trg_acessos_atualizado
  before update on acessos
  for each row execute function set_atualizado_em();

-- ---------------------------------------------------------------------
-- Função 1: entrar (confere e-mail + código; NÃO desconta crédito)
-- ---------------------------------------------------------------------
create or replace function entrar(p_email text, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_transacao  text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  a            acessos%rowtype;
  v_falhas     integer;
begin
  if v_email = '' or v_transacao = '' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;

  delete from tentativas_acesso where tentou_em < now() - interval '1 day';

  select count(*) into v_falhas
    from tentativas_acesso
   where email = v_email and tentou_em > now() - interval '15 minutes';
  if v_falhas >= 10 then
    return jsonb_build_object('ok', false, 'motivo', 'muitas_tentativas');
  end if;

  select * into a from acessos where transacao = v_transacao and email = v_email;
  if not found then
    insert into tentativas_acesso (email) values (v_email);
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;

  if a.status <> 'ativo' then
    return jsonb_build_object('ok', false, 'motivo', 'cancelado');
  end if;
  if a.relatorios_usados >= a.relatorios_total then
    return jsonb_build_object('ok', false, 'motivo', 'sem_saldo');
  end if;
  if a.validade_ate < now() then
    return jsonb_build_object('ok', false, 'motivo', 'expirado');
  end if;

  return jsonb_build_object(
    'ok', true,
    'restantes', a.relatorios_total - a.relatorios_usados,
    'validade_ate', a.validade_ate
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Função 2: iniciar_vistoria (desconta 1 crédito, uma única vez por vistoria)
-- Se o app chamar de novo para a mesma vistoria, não desconta de novo.
-- ---------------------------------------------------------------------
create or replace function iniciar_vistoria(p_email text, p_codigo text, p_vistoria text, p_imovel text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_transacao  text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_vistoria   text := btrim(coalesce(p_vistoria, ''));
  a            acessos%rowtype;
begin
  if v_email = '' or v_transacao = '' then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if length(v_vistoria) < 4 or length(v_vistoria) > 40 then
    return jsonb_build_object('ok', false, 'motivo', 'vistoria_invalida');
  end if;

  select * into a from acessos
   where transacao = v_transacao and email = v_email
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if a.status <> 'ativo' then
    return jsonb_build_object('ok', false, 'motivo', 'cancelado');
  end if;

  if exists (select 1 from vistorias_iniciadas where acesso_id = a.id and vistoria_codigo = v_vistoria) then
    return jsonb_build_object('ok', true, 'ja_iniciada', true,
                              'restantes', a.relatorios_total - a.relatorios_usados);
  end if;

  if a.validade_ate < now() then
    return jsonb_build_object('ok', false, 'motivo', 'expirado');
  end if;
  if a.relatorios_usados >= a.relatorios_total then
    return jsonb_build_object('ok', false, 'motivo', 'sem_saldo');
  end if;

  insert into vistorias_iniciadas (acesso_id, vistoria_codigo, imovel)
  values (a.id, v_vistoria, left(coalesce(p_imovel, ''), 200));

  update acessos set relatorios_usados = relatorios_usados + 1 where id = a.id;

  return jsonb_build_object('ok', true, 'ja_iniciada', false,
                            'restantes', a.relatorios_total - a.relatorios_usados - 1);
end;
$$;

-- ---------------------------------------------------------------------
-- Segurança: o app (chave pública) só pode chamar as 2 funções acima.
-- As tabelas ficam fechadas; só o servidor (chave secreta) as acessa.
-- ---------------------------------------------------------------------
alter table acessos             enable row level security;
alter table vistorias_iniciadas enable row level security;
alter table hotmart_eventos     enable row level security;
alter table tentativas_acesso   enable row level security;

revoke all on acessos, vistorias_iniciadas, hotmart_eventos, tentativas_acesso from anon, authenticated;
revoke all on sequence tentativas_acesso_id_seq from anon, authenticated;

revoke all on function entrar(text, text) from public;
revoke all on function iniciar_vistoria(text, text, text, text) from public;
grant execute on function entrar(text, text) to anon, authenticated;
grant execute on function iniciar_vistoria(text, text, text, text) to anon, authenticated;

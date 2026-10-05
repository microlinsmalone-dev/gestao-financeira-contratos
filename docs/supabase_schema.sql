-- ==============================================================================
-- MICROLINS POTIRENDABA - GESTÃO FINANCEIRA DE CONTRATOS
-- Tabela: contratos_financeiro
-- Execute este script no Supabase SQL Editor (https://supabase.com/dashboard)
-- ==============================================================================

create table if not exists public.contratos_financeiro (
  codigo bigint primary key,
  aluno text not null,
  aluno_normalizado text,
  data_vencimento text,
  forma_pagamento text,
  status_contrato text default 'Ativo',
  consultor text,
  qtd_parcelas int,
  valor_parcela numeric,
  valor_pago_total numeric,
  parcelas_restantes int,
  parcelas_atrasadas int default 0,
  parcelas_pagas int default 0,
  ultima_data_vencimento text,
  telefone_celular text,
  telefone_residencial text,
  resp_financeiro text,
  ignorar_emissao_boleto boolean default false,
  unit_id uuid default 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Adiciona novas colunas caso a tabela já tenha sido criada anteriormente
alter table public.contratos_financeiro add column if not exists parcelas_restantes int;
alter table public.contratos_financeiro add column if not exists parcelas_atrasadas int default 0;
alter table public.contratos_financeiro add column if not exists parcelas_pagas int default 0;
alter table public.contratos_financeiro add column if not exists ultima_data_vencimento text;
alter table public.contratos_financeiro add column if not exists telefone_celular text;
alter table public.contratos_financeiro add column if not exists telefone_residencial text;
alter table public.contratos_financeiro add column if not exists resp_financeiro text;
alter table public.contratos_financeiro add column if not exists ignorar_emissao_boleto boolean default false;

-- Índices para alta velocidade de busca e filtros
create index if not exists idx_contratos_aluno on public.contratos_financeiro (aluno);
create index if not exists idx_contratos_vencimento on public.contratos_financeiro (data_vencimento);
create index if not exists idx_contratos_unit on public.contratos_financeiro (unit_id);
create index if not exists idx_contratos_status on public.contratos_financeiro (status_contrato);
create index if not exists idx_contratos_restantes on public.contratos_financeiro (parcelas_restantes);
create index if not exists idx_contratos_atrasadas on public.contratos_financeiro (parcelas_atrasadas);

-- Trigger para atualização automática da coluna updated_at
create or replace function public.handle_contratos_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_contratos_updated_at on public.contratos_financeiro;
create trigger trigger_contratos_updated_at
  before update on public.contratos_financeiro
  for each row execute function public.handle_contratos_updated_at();

-- Habilitar RLS (Row Level Security) e permitir acesso via Anon Key
alter table public.contratos_financeiro enable row level security;

-- Política de Leitura Pública / Anon Key
drop policy if exists "Permitir leitura pública/anon" on public.contratos_financeiro;
create policy "Permitir leitura pública/anon"
  on public.contratos_financeiro for select
  using (true);

-- Política de Inserção, Atualização e Exclusão Pública / Anon Key
drop policy if exists "Permitir inserção e atualização pública/anon" on public.contratos_financeiro;
create policy "Permitir inserção e atualização pública/anon"
  on public.contratos_financeiro for all
  using (true)
  with check (true);

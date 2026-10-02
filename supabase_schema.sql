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
  unit_id uuid default 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Índices para alta velocidade de busca e filtros
create index if not exists idx_contratos_aluno on public.contratos_financeiro (aluno);
create index if not exists idx_contratos_vencimento on public.contratos_financeiro (data_vencimento);
create index if not exists idx_contratos_unit on public.contratos_financeiro (unit_id);
create index if not exists idx_contratos_status on public.contratos_financeiro (status_contrato);

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

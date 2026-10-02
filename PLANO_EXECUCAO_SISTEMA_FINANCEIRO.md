# 📘 PLANO COMPLETO DE EXECUÇÃO: SISTEMA DE GESTÃO FINANCEIRA DE CONTRATOS E MODALIDADES

> **Unidade:** Microlins Potirendaba  
> **Ambiente de Produção:** GitHub Pages (Web 100% Estático / Client-Side)  
> **Banco de Dados & Nuvem:** Supabase (PostgreSQL + Realtime Sync)  
> **Repositório / Diretório Local:** `D:\Malone\Projetos\Sistemas_Microlins\Sistema Data Financeiro e Modalidade`

---

## 📑 ÍNDICE

1. [Visão Geral e Objetivos do Sistema](#1-visão-geral-e-objetivos-do-sistema)
2. [Diagnóstico da Base de Dados (Relatório Controle Financeiro.xlsx)](#2-diagnóstico-da-base-de-dados)
3. [Regras de Negócio e Comportamentos Esperados](#3-regras-de-negócio-e-comportamentos-esperados)
4. [Identidade Visual e Design System (Microlins)](#4-identidade-visual-e-design-system)
5. [Arquitetura de Arquivos e Módulos](#5-arquitetura-de-arquivos-e-módulos)
6. [Estrutura do Banco de Dados (Supabase SQL)](#6-estrutura-do-banco-de-dados)
7. [Especificação Técnica dos Módulos Frontend](#7-especificação-técnica-dos-módulos-frontend)
8. [Roteiro Passo a Passo para Execução Futura](#8-roteiro-passo-a-passo-para-execução-futura)
9. [Guia de Publicação no GitHub Pages](#9-guia-de-publicação-no-github-pages)

---

## 1. VISÃO GERAL E OBJETIVOS DO SISTEMA

### 1.1 Contexto e Desafio
O sistema interno de gestão da escola não disponibiliza em uma mesma tela a exportação da **Data de Vencimento** das parcelas atrelada ao histórico de modalidades de pagamento e status do contrato. 

### 1.2 A Solução
Uma aplicação web ágil, leve e visualmente refinada que:
1. **Importa e Processa**: Lê a planilha `Relatório Controle Financeiro.xlsx` diretamente no navegador.
2. **Visualiza Modalidades em Badges**: Converte o texto acumulado de formas de pagamento (ex: `Boleto, Cartão de Débito, Dinheiro, PIX`) em mini-cards/badges coloridos com ícones representativos.
3. **Controle Manual de Vencimento (Híbrido)**: Permite ao usuário definir o dia de vencimento com botões rápidos (**05, 10, 15, 20, 25, 30**) ou digitação livre.
4. **Upsert Inteligente (Anti-Sobrescrita)**: Reimportações futuras do relatório atualizam novas formas de pagamento e dados cadastrais, **sem perder nenhuma data de vencimento preenchida manualmente**.
5. **Edição e Exclusão Segura**: Permite exclusão com confirmação e adição manual de alunos fora da planilha.
6. **Hospedagem GitHub Pages + Nuvem Supabase**: Funciona em qualquer navegador via link estático do GitHub Pages, salvando dados tanto localmente (*IndexedDB / LocalStorage*) quanto na nuvem Supabase da Microlins Potirendaba.

---

## 2. DIAGNÓSTICO DA BASE DE DADOS

Análise realizada sobre o arquivo de exemplo `Relatório Controle Financeiro.xlsx`:
- **Total de Linhas:** 832 contratos.
- **Chave Primária Natural:** Coluna `Código` (ex: `4643842`, `4643888`, etc. - 100% únicos e sem nulos).
- **Aluno:** Coluna `Aluno` (ex: `Guilherme de Oliveira Santos`).
- **Status do Contrato:** `Ativo` e `Inativo/Desistente`.
- **Formas de Pagamento Identificadas:**
  - `PIX` e `PIX - QR Code`
  - `Boleto`
  - `Cartão de Crédito`
  - `Cartão de Débito`
  - `Dinheiro`
  - `Carnê`
  - `Depósito Bancário`
  - `Cheque`
  - Caso vazio / sem forma: identificado apenas em 1 registro inativo (`Valeria Pereira Antas`), devendo ser exibido como badge sutil `Sem registro`.

---

## 3. REGRAS DE NEGÓCIO E COMPORTAMENTOS ESPERADOS

### 3.1 Significado da Coluna Forma de Pagamento
Se um contrato exibe `Boleto, Dinheiro, PIX`, isso significa que o aluno em algum momento realizou pagamentos por essas três vias. O sistema deve separar as modalidades por vírgula e renderizar **um badge visual independente para cada uma**.

### 3.2 Vencimento Híbrido
- Na tabela, cada aluno terá sua célula de vencimento.
- Ao clicar na célula ou no botão `+ Definir Dia`:
  - Exibe um popover suspenso com botões rápidos: **05**, **10**, **15**, **20**, **25**, **30**.
  - Um campo de entrada livre para digitar outro dia (ex: `12`) ou data completa (`12/10/2026`).
  - Salvamento instantâneo (*auto-save*) com feedback visual (animação de confirmação verde).

### 3.3 Algoritmo de Reimportação Inteligente
```
Para cada linha do Excel importado:
  codigo = linha['Código']
  se codigo já existe no banco:
      MANTÉM data_vencimento atual (não sobrescreve)
      ATUALIZA forma_pagamento com a lista mais recente
      ATUALIZA status_contrato, consultor e valores
  senão:
      INSERE novo contrato com data_vencimento = null
Fim
```

### 3.4 Exclusão com Confirmação
Ao clicar no ícone de lixeira, abre um modal destacado:
> *"Tem certeza que deseja excluir o contrato **#4643842 - Guilherme de Oliveira Santos**? Esta ação removerá o aluno da listagem."*  
> Botões: `[Cancelar]` e `[Sim, Excluir (Vermelho)]`.

---

## 4. IDENTIDADE VISUAL E DESIGN SYSTEM

Baseado no projeto de referência da **Microlins Potirendaba**:

### 4.1 Cores Principais
- **Azul Primário Microlins:** `#0f3b7d`
- **Azul Secundário:** `#1e54a4`
- **Vermelho Destaque:** `#d91a2a`
- **Background Principal:** `#f8fafd`
- **Card Background:** `#ffffff` com sombras suaves (`0 4px 20px -2px rgba(15, 23, 42, 0.05)`)
- **Texto Principal:** `#0f172a` (Slate 900)
- **Texto Secundário:** `#64748b` (Slate 500)

### 4.2 Badges das Modalidades de Pagamento
| Modalidade | Cor de Fundo | Cor da Borda | Cor do Texto / Ícone | Ícone |
| :--- | :--- | :--- | :--- | :---: |
| **PIX / QR Code** | `#ecfdf5` | `#a7f3d0` | `#047857` (Esmeralda) | 💠 Símbolo Pix |
| **Boleto** | `#fffbeb` | `#fde68a` | `#b45309` (Amber) | 📄 Código de barras |
| **Cartão de Crédito** | `#eef2ff` | `#c7d2fe` | `#4338ca` (Indigo) | 💳 Cartão Chip |
| **Cartão de Débito** | `#f0f9ff` | `#bae6fd` | `#0369a1` (Sky Blue) | 💳 Cartão Débito |
| **Dinheiro** | `#f0fdf4` | `#bbf7d0` | `#15803d` (Green) | 💵 Cédula |
| **Carnê** | `#fff1f2` | `#fecdd3` | `#be123c` (Rose) | 🎫 Talão / Carnê |
| **Depósito Bancário** | `#eff6ff` | `#bfdbfe` | `#1d4ed8` (Blue) | 🏦 Banco |
| **Cheque** | `#f8fafc` | `#cbd5e1` | `#475569` (Slate) | 📝 Folha de Cheque |

---

## 5. ARQUITETURA DE ARQUIVOS E MÓDULOS

A aplicação será 100% estática para execução direta no GitHub Pages, sem necessidade de build complexo:

```
Sistema Data Financeiro e Modalidade/
├── index.html                   # Estrutura semântica, layout e modais
├── css/
│   ├── main.css                 # Reset, tipografia, variáveis de cor, header e layout
│   ├── components.css           # Badges de pagamento, cards de métricas, popovers de data, modais
│   └── table.css                # Tabela de dados, paginação, filtros e barra de busca
├── js/
│   ├── config.js                # Chaves Supabase (Microlins Potirendaba) e parâmetros
│   ├── storage.js               # Gerenciador de dados híbrido (Supabase + LocalStorage/IndexedDB)
│   ├── excel-importer.js        # Parser SheetJS, mapeamento de colunas e upsert inteligente
│   ├── payment-badges.js        # Gerador de ícones SVG e badges de pagamento
│   ├── modals.js                # Modais: Novo Aluno, Confirmação de Exclusão e Configurações
│   └── app.js                   # Orquestrador da interface, busca, filtros e eventos
├── supabase_schema.sql          # Script SQL para criar a tabela e regras no Supabase
├── Relatório Controle Financeiro.xlsx # Arquivo de dados original da escola
└── README.md                    # Documentação de uso e publicação
```

---

## 6. ESTRUTURA DO BANCO DE DADOS (SUPABASE SQL)

Script pronto para execução no **Supabase SQL Editor**:

```sql
-- ==============================================================================
-- MICROLINS POTIRENDABA - GESTÃO FINANCEIRA DE CONTRATOS
-- Tabela: contratos_financeiro
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

-- Índices para alta velocidade de busca
create index if not exists idx_contratos_aluno on public.contratos_financeiro (aluno);
create index if not exists idx_contratos_vencimento on public.contratos_financeiro (data_vencimento);
create index if not exists idx_contratos_unit on public.contratos_financeiro (unit_id);

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

-- Habilitar RLS e permitir leitura/escrita com a chave anon
alter table public.contratos_financeiro enable row level security;

create policy "Permitir leitura pública/anon"
  on public.contratos_financeiro for select
  using (true);

create policy "Permitir inserção e atualização pública/anon"
  on public.contratos_financeiro for all
  using (true)
  with check (true);
```

---

## 7. ESPECIFICAÇÃO TÉCNICA DOS MÓDULOS FRONTEND

### 7.1 `js/config.js`
Armazena as configurações pré-carregadas da Microlins Potirendaba:
```javascript
export const CONFIG = {
  SUPABASE_URL: 'https://apfcbkucxjcleqxarlmv.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DZAXwbvMzgz31wR-pmbNkg_aNg3ofG0',
  UNIT_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  TABLE_NAME: 'contratos_financeiro',
  STORAGE_KEY: 'microlins_contratos_financeiro_local',
  PRESET_DAYS: ['05', '10', '15', '20', '25', '30'],
  ITEMS_PER_PAGE: 25
};
```

### 7.2 `js/storage.js`
Gerencia a persistência híbrida:
- Tenta carregar do Supabase via `@supabase/supabase-js`.
- Se o Supabase estiver indisponível ou a tabela não existir, usa `localStorage` / `IndexedDB` sem travar a aplicação.
- Fornece métodos:
  - `getAllContratos()`
  - `upsertContratos(listaNovosContratos)` -> preserva `data_vencimento` de registros existentes.
  - `updateVencimento(codigo, novoVencimento)`
  - `deleteContrato(codigo)`
  - `addContratoManual(contrato)`
  - `exportBackupJSON()` e `importBackupJSON()`

### 7.3 `js/excel-importer.js`
- Utiliza a biblioteca `xlsx.full.min.js` (SheetJS) via CDN.
- Lê o arquivo `.xlsx` / `.xls` via Drag & Drop ou Input File.
- Mapeia as colunas:
  - `Código` -> `codigo`
  - `Aluno` -> `aluno`
  - `Status Contrato` -> `status_contrato`
  - `Forma Pagamento Parcela` -> `forma_pagamento`
  - `Colaborador Consultor` -> `consultor`
  - `Quantidade Parcelas` -> `qtd_parcelas`
  - `Valor Parcela Líquido` -> `valor_parcela`
- Executa a mesclagem inteligente e reporta estatísticas:
  - Total processados
  - Novos adicionados
  - Atualizados com vencimento preservado

### 7.4 `js/payment-badges.js`
Gera os elementos visuais das formas de pagamento com ícones SVG vetorizados e cores padronizadas:
- `renderPaymentBadges(formaPagamentoString)`: recebe `"Boleto, Dinheiro, PIX"` e retorna HTML com 3 badges estilizados.

### 7.5 `js/modals.js`
- **Modal Novo Aluno**: Formulário para cadastrar alunos manualmente com validação de código único.
- **Modal de Confirmação de Exclusão**: Exibe aviso seguro antes de remover o contrato.
- **Modal de Configurações**: Permite visualizar status da nuvem e exportar backup em Excel/JSON.

---

## 8. ROTEIRO PASSO A PASSO PARA EXECUÇÃO FUTURA

Quando for iniciar a implementação prática, siga exatamente esta ordem:

### Passo 1: Executar o Script SQL no Supabase
1. Acesse o painel do Supabase do projeto `apfcbkucxjcleqxarlmv`.
2. Vá em **SQL Editor** -> **New Query**.
3. Cole o conteúdo da Seção 6 deste plano e clique em **Run**.

### Passo 2: Criar a Estrutura de Arquivos
1. Criar o arquivo `index.html`.
2. Criar a pasta `css/` com `main.css`, `components.css` e `table.css`.
3. Criar a pasta `js/` com `config.js`, `storage.js`, `excel-importer.js`, `payment-badges.js`, `modals.js` e `app.js`.

### Passo 3: Testar Localmente
1. Abrir um servidor local simples:
   ```bash
   npx serve .
   # ou python -m http.server 8080
   ```
2. Carregar a planilha de teste `Relatório Controle Financeiro.xlsx`.
3. Verificar a geração correta dos 832 registros e badges.
4. Preencher vencimentos em alguns alunos (ex: Dia 10, Dia 15).
5. Reimportar a planilha e certificar-se de que os vencimentos preenchidos continuaram intactos.

---

## 9. GUIA DE PUBLICAÇÃO NO GITHUB PAGES

1. Inicializar o repositório git na pasta:
   ```bash
   git init
   git add .
   git commit -m "feat: Sistema de Gestao Financeira Microlins"
   ```
2. Criar o repositório no GitHub (ex: `sistema-financeiro-microlins`).
3. Vincular e enviar:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/sistema-financeiro-microlins.git
   git branch -M main
   git push -u origin main
   ```
4. No GitHub, acessar: **Settings** -> **Pages** -> **Branch: main** -> **Folder: / (root)** -> **Save**.
5. Em instantes, o link público estará ativo (ex: `https://seu-usuario.github.io/sistema-financeiro-microlins/`).

---

*Documento gerado e validado com base nos requisitos da Microlins Potirendaba e na análise direta do arquivo `Relatório Controle Financeiro.xlsx`.*

# Sistema de Gestão Financeira de Contratos e Modalidades
### Microlins Potirendaba

> **Ambiente Web:** [https://microlinsmalone-dev.github.io/gestao-financeira-contratos/](https://microlinsmalone-dev.github.io/gestao-financeira-contratos/)  
> **Repositório GitHub:** [https://github.com/microlinsmalone-dev/gestao-financeira-contratos](https://github.com/microlinsmalone-dev/gestao-financeira-contratos)  
> **Banco de Dados & Nuvem:** Supabase (PostgreSQL + RLS)  
> **Persistência Híbrida:** Supabase Cloud + LocalStorage Offline  

---

## 1. Visão Geral

Este sistema unifica o controle de recebimentos e contratos da instituição de ensino, integrando:
1. **Identificação Visual das Modalidades:** Converte os lançamentos brutos (Boleto, Cartão de Crédito, PIX, Dinheiro) em identificadores visuais vetorizados.
2. **Definição de Vencimento:** Popover com dias pré-definidos (05, 10, 15, 20, 25, 30) ou dia customizado, com auto-save imediato.
3. **Reimportação Inteligente:** Preserva integralmente as datas de vencimento cadastradas quando novas planilhas são importadas.
4. **Cruzamento de Três Relatórios:**
   - **Relatório de Contrato Financeiro (.xlsx):** Dados cadastrais, modalidades e valores base.
   - **Recebimentos de Contratos (.xlsx):** Parcelas restantes reais, parcelas em atraso e datas.
   - **Baixa de Recebimentos (.xlsx):** Extrato transacional do caixa, detecção de pagamento em lote no cartão (6x+) e cálculo do próximo vencimento real.
5. **Filtro Automático para Emissão de Boletos:** Exclui automaticamente contratos quitados, inadimplentes e alunos já cobertos por pagamentos em lote de cartão.

---

## 2. Acesso Direto na Web (GitHub Pages)

Para utilizar o sistema diretamente pelo navegador em qualquer dispositivo sem necessidade de abrir o terminal:

### Endereço de Acesso
```
https://microlinsmalone-dev.github.io/gestao-financeira-contratos/
```

### Como Ativar o GitHub Pages no Repositório
1. Acesse o painel de configurações do repositório:  
   `https://github.com/microlinsmalone-dev/gestao-financeira-contratos/settings/pages`
2. Na seção **Build and deployment > Source**, selecione a opção **Deploy from a branch**.
3. No campo **Branch**, selecione `main` e a pasta `/ (root)`.
4. Clique em **Save**.
5. Em instantes o sistema estará operacional no link da web acima.

---

## 3. Como Rodar Localmente (Opcional)

Se desejar rodar em ambiente offline local:

### Opção 1: Iniciar Servidor Rápido
Duplo clique no arquivo `iniciar_servidor.bat` (ou execute `.\iniciar_servidor.ps1` no PowerShell).

### Opção 2: Servidor Python
```bash
python -m http.server 8080
```
Abra `http://localhost:8080` no navegador.

---

## 4. Estrutura do Projeto

```
gestao-financeira-contratos/
├── index.html                   # Estrutura principal da aplicação
├── css/
│   ├── main.css                 # Tipografia, variáveis de cores e layout geral
│   ├── components.css           # Badges, popovers e modais
│   └── table.css                # Tabela estilizada, barra de filtros e ações
├── js/
│   ├── config.js                # Chaves Supabase, Unit ID e constantes
│   ├── storage.js               # Persistência híbrida (Supabase + LocalStorage)
│   ├── excel-importer.js        # Motor de importação e detecção de planilhas
│   ├── payment-badges.js        # Gerador de badges SVG por modalidade
│   ├── modals.js                # Modais auxiliares
│   └── app.js                   # Orquestrador da aplicação e regras de negócio
├── test_suite.html              # Bateria de testes automatizados de ponta a ponta
├── Relatório Contrato Financeiro.xlsx
├── Recebimentos de Contratos.xlsx
├── Baixa de Recebimentos.xlsx
└── README.md
```

---

## 5. Suíte de Testes Automatizados

A aplicação dispõe de uma suíte de testes integrada acessível diretamente no navegador:
- Arquivo: `test_suite.html`
- Cobre 47 verificações automatizadas de integridade, cálculo de parcelas, regras de emissão de boleto e importação de planilhas.

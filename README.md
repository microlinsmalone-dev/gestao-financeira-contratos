# 🎓 Sistema de Gestão Financeira de Contratos e Modalidades
### Microlins Potirendaba

> **Ambiente de Produção:** GitHub Pages (Web 100% Estático / Client-Side)  
> **Banco de Dados & Nuvem:** Supabase (PostgreSQL + RLS)  
> **Persistência Híbrida:** Supabase Cloud + LocalStorage / IndexedDB Offline  

---

## 📌 1. Visão Geral

Este sistema resolve a limitação dos relatórios padrão da instituição de ensino, unificando em uma única tela interativa:
1. **Identificação Visual Instantânea das Modalidades de Pagamento:** Converte registros acumulados (ex: `Boleto, Cartão de Crédito, PIX`) em badges visuais coloridos com ícones vetoriais SVG padronizados.
2. **Definição Rápida da Data de Vencimento:** Popover inteligente com botões rápidos (**05**, **10**, **15**, **20**, **25**, **30**) e entrada personalizada com salvamento instantâneo (*auto-save*).
3. **Reimportação Inteligente (Upsert Anti-Sobrescrita):** Sempre que uma nova planilha `Relatório Controle Financeiro.xlsx` for importada, novos alunos e formas de pagamento são atualizados, mas **todas as datas de vencimento cadastradas previamente são rigorosamente preservadas**.
4. **Exportação com Vencimento Incluso:** Gera uma nova planilha Excel contendo a coluna `Data de Vencimento` preenchida para uso nas cobranças e conciliações bancárias.

---

## 🚀 2. Como Rodar Localmente

Por ser uma aplicação 100% estática baseada em módulos ES6 nativos, ela pode ser executada por qualquer servidor HTTP estático local:

### Opção 1: Via Python
```bash
python -m http.server 8080
```
Acesse no navegador: `http://localhost:8080`

### Opção 2: Via Node.js (npx serve)
```bash
npx serve .
```

### Opção 3: Extensão "Live Server" (VS Code)
Basta clicar com o botão direito no arquivo `index.html` e selecionar **Open with Live Server**.

---

## 🌐 3. Publicação no GitHub Pages

Para publicar o sistema e torná-lo acessível para toda a equipe da escola sem qualquer custo de servidor:

1. **Inicialize o repositório local:**
   ```bash
   git init
   git add .
   git commit -m "feat: Sistema de Gestão Financeira Microlins Potirendaba"
   ```

2. **Crie um repositório no seu GitHub** (ex: `sistema-financeiro-microlins`).

3. **Vincule o repositório remoto e envie o código:**
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/sistema-financeiro-microlins.git
   git branch -M main
   git push -u origin main
   ```

4. **Ative o GitHub Pages:**
   - No GitHub, acesse a aba **Settings** do repositório.
   - No menu lateral esquerdo, clique em **Pages**.
   - Em **Build and deployment > Source**, selecione **Deploy from a branch**.
   - Em **Branch**, selecione `main` e a pasta `/ (root)`.
   - Clique em **Save**.
   - Em menos de 2 minutos, o sistema estará online no endereço:  
     `https://SEU_USUARIO.github.io/sistema-financeiro-microlins/`

---

## 🗄️ 4. Configuração do Banco de Dados no Supabase

O sistema conecta-se ao Supabase da unidade para salvar os dados na nuvem:

1. Acesse o painel do Supabase do projeto: `https://supabase.com/dashboard/project/apfcbkucxjcleqxarlmv`
2. No menu lateral, clique em **SQL Editor** -> **New Query**.
3. Abra o arquivo `supabase_schema.sql` deste projeto, copie todo o seu conteúdo, cole no editor e clique em **Run**.
4. O script cria:
   - A tabela `contratos_financeiro` com chave primária em `codigo`.
   - Índices de performance para busca em alta velocidade (`aluno`, `data_vencimento`, `status_contrato`).
   - Gatilho automático para `updated_at`.
   - Políticas de segurança de nível de linha (RLS) para leitura e escrita pela chave anônima pública.

---

## 📁 5. Estrutura de Arquivos

```
Sistema Data Financeiro e Modalidade/
├── index.html                   # Estrutura semântica, cards de métricas, dropzone e modais
├── css/
│   ├── main.css                 # Reset, tipografia, variáveis de cores Microlins e header
│   ├── components.css           # Badges de pagamento, popovers de vencimento e modais
│   └── table.css                # Tabela estilizada, barra de filtros, busca e paginação
├── js/
│   ├── config.js                # Chaves Supabase, Unit ID, dias pré-definidos e constantes
│   ├── storage.js               # Persistência híbrida (Supabase + LocalStorage) e Upsert inteligente
│   ├── excel-importer.js        # Leitura da planilha com SheetJS e normalização de colunas
│   ├── payment-badges.js        # Ícones vetoriais SVG e gerador de badges por modalidade
│   ├── modals.js                # Modais: Novo Aluno, Exclusão Segura e Configurações/Backup
│   └── app.js                   # Orquestrador da aplicação, busca, ordenação, auto-save e exportação
├── supabase_schema.sql          # Script SQL para criação de tabelas e políticas RLS
├── Relatório Controle Financeiro.xlsx # Arquivo de dados original da escola para teste
└── README.md                    # Documentação técnica e guia operacional
```

---

## 🎨 6. Design System & Identidade Visual

O sistema utiliza a identidade oficial da **Microlins Potirendaba**:
- **Azul Primário Microlins:** `#0f3b7d`
- **Azul Secundário:** `#1e54a4`
- **Vermelho Destaque:** `#d91a2a`
- **Background Principal:** `#f8fafd`
- **Card Background:** `#ffffff` com sombras suaves

### Badges de Modalidades Suportadas
| Modalidade | Fundo | Borda | Texto/Ícone |
| :--- | :--- | :--- | :--- |
| **PIX / QR Code** | `#ecfdf5` | `#a7f3d0` | `#047857` (Esmeralda) |
| **Boleto** | `#fffbeb` | `#fde68a` | `#b45309` (Âmbar) |
| **Cartão de Crédito** | `#eef2ff` | `#c7d2fe` | `#4338ca` (Índigo) |
| **Cartão de Débito** | `#f0f9ff` | `#bae6fd` | `#0369a1` (Azul Céu) |
| **Dinheiro** | `#f0fdf4` | `#bbf7d0` | `#15803d` (Verde) |
| **Carnê** | `#fff1f2` | `#fecdd3` | `#be123c` (Rosé) |
| **Depósito Bancário** | `#eff6ff` | `#bfdbfe` | `#1d4ed8` (Azul Real) |
| **Cheque** | `#f8fafc` | `#cbd5e1` | `#475569` (Ardósia) |
| **Sem registro** | `#f1f5f9` | `#e2e8f0` | `#94a3b8` (Neutro) |

---

## 🔒 7. Segurança e Proteção dos Dados

- **Persistência Híbrida Inteligente:** Todas as alterações feitas na tela são gravadas imediatamente tanto no navegador (`localStorage`) quanto na nuvem Supabase. Se a conexão cair, o sistema continua funcionando normalmente e sincroniza quando a rede voltar.
- **Backups JSON e Excel:** Na tela de configurações, o usuário pode fazer download a qualquer momento de um backup completo em formato `.json` ou exportar a planilha `.xlsx` com todas as colunas e vencimentos.
- **Exclusão Segura:** Nenhuma exclusão acontece por clique acidental; um modal de confirmação exibe o nome e o código do contrato antes de qualquer remoção definitiva.

/**
 * ORQUESTRADOR PRINCIPAL DA APLICAÇÃO (APP.JS)
 * 
 * Controla:
 * - Ciclo de vida e carregamento inicial de dados
 * - Renderização da tabela e métricas do dashboard
 * - Busca em tempo real e filtros combinados
 * - Popover rápido de Data de Vencimento (Auto-save)
 * - Importação Excel (Drag & Drop e Seletor)
 * - Exportação para Excel e JSON
 * - Paginação e ordenação interativa
 */

import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { renderPaymentBadges, normalizeMethodKey } from './payment-badges.js';
import { importExcelFile, parseExcelData } from './excel-importer.js';
import {
  initModals,
  openAddStudentModal,
  openDeleteConfirmModal,
  openSettingsModal,
  closeAllModals
} from './modals.js';

// Estado global da interface
const state = {
  allContracts: [],
  filteredContracts: [],
  currentPage: 1,
  itemsPerPage: CONFIG.DEFAULT_ITEMS_PER_PAGE,
  sortField: 'aluno',
  sortAsc: true,
  filters: {
    search: '',
    status: 'Todos',
    paymentMethod: 'Todas',
    dueStatus: 'Todos' // 'Todos', 'Com Vencimento', 'Pendente'
  },
  activePopover: {
    isOpen: false,
    codigo: null,
    targetElement: null
  }
};

/**
 * Ponto de entrada após o carregamento da DOM
 */
document.addEventListener('DOMContentLoaded', async () => {
  setupToastContainer();
  setupEventListeners();
  initModals({
    onDataChanged: handleDataReload,
    showToast: showToast
  });

  // Mostra indicador de carregamento inicial
  showLoading(true, 'Iniciando sistema e conectando ao Supabase...');

  try {
    state.allContracts = await storage.init();
    updateCloudStatusBadge();
    applyFiltersAndRender();

    // Se o banco estiver vazio no primeiro acesso, sugere carregar a planilha
    if (state.allContracts.length === 0) {
      showToast('Bem-vindo! Importe a planilha de controle financeiro para começar.', 'info', 6000);
    } else {
      showToast(`${state.allContracts.length} contratos carregados com sucesso.`, 'success');
    }
  } catch (err) {
    console.error('[App] Erro na inicialização:', err);
    showToast('Iniciado em modo local. ' + (err.message || ''), 'warning');
    updateCloudStatusBadge();
    applyFiltersAndRender();
  } finally {
    showLoading(false);
  }
});

/**
 * Recarrega dados após adições, exclusões ou importações
 */
function handleDataReload() {
  state.allContracts = storage.getAllContratos();
  updateCloudStatusBadge();
  applyFiltersAndRender();
}

/**
 * Atualiza o indicador de conexão com a nuvem no cabeçalho
 */
function updateCloudStatusBadge() {
  const badge = document.getElementById('cloudStatusIndicator');
  if (!badge) return;

  const status = storage.getSyncStatus();
  if (status.isConnected) {
    badge.className = 'status-indicator status-online';
    badge.innerHTML = '<span class="status-pulse"></span><span>Supabase Nuvem</span>';
    badge.title = `Conectado ao Supabase (Última sync: ${status.lastSync || 'agora'})`;
  } else {
    badge.className = 'status-indicator status-offline';
    badge.innerHTML = '<span class="status-pulse"></span><span>Modo Local</span>';
    badge.title = 'Modo Local (LocalStorage) - Dados salvos com segurança no navegador';
  }
}

/**
 * Configuração de todos os ouvintes de eventos da página
 */
function setupEventListeners() {
  // Input de busca em tempo real com debounce suave
  const searchInput = document.getElementById('inputBusca');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.filters.search = e.target.value.trim();
        state.currentPage = 1;
        applyFiltersAndRender();
      }, 150);
    });
  }

  // Filtro de Status do Contrato
  const filterStatus = document.getElementById('selectFiltroStatus');
  if (filterStatus) {
    filterStatus.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  // Filtro de Modalidade de Pagamento
  const filterPayment = document.getElementById('selectFiltroModalidade');
  if (filterPayment) {
    filterPayment.addEventListener('change', (e) => {
      state.filters.paymentMethod = e.target.value;
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  // Filtro de Situação do Vencimento
  const filterDue = document.getElementById('selectFiltroVencimento');
  if (filterDue) {
    filterDue.addEventListener('change', (e) => {
      state.filters.dueStatus = e.target.value;
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  // Botão Limpar Filtros
  const btnClearFilters = document.getElementById('btnLimparFiltros');
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', resetFilters);
  }

  // Seletor de itens por página
  const selectPerPage = document.getElementById('selectItensPorPagina');
  if (selectPerPage) {
    selectPerPage.value = state.itemsPerPage;
    selectPerPage.addEventListener('change', (e) => {
      state.itemsPerPage = parseInt(e.target.value, 10);
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  // Botão Novo Aluno
  const btnNovoAluno = document.getElementById('btnNovoAluno');
  if (btnNovoAluno) {
    btnNovoAluno.addEventListener('click', openAddStudentModal);
  }

  // Botão Configurações
  const btnConfig = document.getElementById('btnConfiguracoes');
  if (btnConfig) {
    btnConfig.addEventListener('click', openSettingsModal);
  }

  // Botão Exportar Excel
  const btnExportExcel = document.getElementById('btnExportarExcel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', exportToExcel);
  }

  // Configurações do Modal de Configurações
  const btnTestConn = document.getElementById('btnTestarConexao');
  if (btnTestConn) {
    btnTestConn.addEventListener('click', async () => {
      showLoading(true, 'Testando comunicação com Supabase...');
      const success = await storage.refreshFromSupabase();
      showLoading(false);
      if (success) {
        showToast('Conexão com Supabase restabelecida com sucesso!', 'success');
      } else {
        const status = storage.getSyncStatus();
        showToast(status.errorMessage || 'Supabase inacessível no momento. Continuando em modo local.', 'warning', 6000);
      }
      openSettingsModal();
      updateCloudStatusBadge();
    });
  }

  const btnSyncAll = document.getElementById('btnSincronizarNuvem');
  if (btnSyncAll) {
    btnSyncAll.addEventListener('click', async () => {
      showLoading(true, 'Sincronizando contratos com a nuvem...');
      try {
        const res = await storage.syncAllToSupabase();
        showToast(`${res.total} contratos sincronizados na nuvem Supabase!`, 'success');
        openSettingsModal();
        updateCloudStatusBadge();
      } catch (err) {
        showToast('Erro ao sincronizar com a nuvem: ' + err.message, 'error', 7000);
        openSettingsModal();
        updateCloudStatusBadge();
      } finally {
        showLoading(false);
      }
    });
  }

  const btnExportJson = document.getElementById('btnExportarBackupJson');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => {
      const json = storage.exportBackupJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_contratos_microlins_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup JSON exportado com sucesso.', 'success');
    });
  }

  const inputImportJson = document.getElementById('inputImportarBackupJson');
  if (inputImportJson) {
    inputImportJson.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          showLoading(true, 'Restaurando backup JSON...');
          const result = await storage.importBackupJSON(evt.target.result);
          handleDataReload();
          showToast(`Backup restaurado! ${result.total} contratos processados.`, 'success');
          closeAllModals();
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          showLoading(false);
          inputImportJson.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  // Upload de Excel via File Input
  const excelFileInput = document.getElementById('excelFileInput');
  if (excelFileInput) {
    excelFileInput.addEventListener('change', handleExcelUpload);
  }

  // Drag and Drop para importação de Excel
  setupDragAndDrop();

  // Fechar popover de vencimento ao clicar fora
  document.addEventListener('click', (e) => {
    if (state.activePopover.isOpen) {
      const popoverEl = document.getElementById('dueDatePopover');
      if (popoverEl && !popoverEl.contains(e.target) && !e.target.closest('.due-date-trigger')) {
        closeDueDatePopover();
      }
    }
  });

  // Ordenação por colunas da tabela
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (state.sortField === field) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortField = field;
        state.sortAsc = true;
      }
      applyFiltersAndRender();
    });
  });
}

/**
 * Utilitário de normalização de texto para busca insensível a acentos e maiúsculas
 */
function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Reseta todos os filtros para os padrões
 */
function resetFilters() {
  state.filters.search = '';
  state.filters.status = 'Todos';
  state.filters.paymentMethod = 'Todas';
  state.filters.dueStatus = 'Todos';
  state.currentPage = 1;

  const searchInput = document.getElementById('inputBusca');
  if (searchInput) searchInput.value = '';

  const filterStatus = document.getElementById('selectFiltroStatus');
  if (filterStatus) filterStatus.value = 'Todos';

  const filterPayment = document.getElementById('selectFiltroModalidade');
  if (filterPayment) filterPayment.value = 'Todas';

  const filterDue = document.getElementById('selectFiltroVencimento');
  if (filterDue) filterDue.value = 'Todos';

  applyFiltersAndRender();
  showToast('Filtros restaurados.', 'info');
}

/**
 * Aplica busca, filtros e ordenação aos contratos e atualiza a view
 */
function applyFiltersAndRender() {
  const { search, status, paymentMethod, dueStatus } = state.filters;
  const normalizedSearch = normalizeSearchText(search);

  state.filteredContracts = state.allContracts.filter(item => {
    // 1. Busca por texto (Código, Aluno ou Consultor) com tolerância rigorosa a acentuação
    if (normalizedSearch) {
      const matchCodigo = String(item.codigo).includes(normalizedSearch);
      const matchAluno = normalizeSearchText(item.aluno_normalizado || item.aluno).includes(normalizedSearch);
      const matchConsultor = normalizeSearchText(item.consultor).includes(normalizedSearch);

      if (!matchCodigo && !matchAluno && !matchConsultor) {
        return false;
      }
    }

    // 2. Filtro de Status
    if (status !== 'Todos') {
      if (status === 'Ativo') {
        if (!item.status_contrato || !item.status_contrato.toLowerCase().includes('ativo') || item.status_contrato.toLowerCase().includes('inativo')) {
          return false;
        }
      } else if (status === 'Inativo/Desistente') {
        if (!item.status_contrato || !item.status_contrato.toLowerCase().includes('inativo')) {
          return false;
        }
      }
    }

    // 3. Filtro de Modalidade de Pagamento
    if (paymentMethod !== 'Todas') {
      const itemMethods = (item.forma_pagamento || '').toLowerCase();
      const targetNorm = normalizeMethodKey(paymentMethod);

      if (targetNorm === 'sem registro') {
        if (itemMethods && !itemMethods.includes('sem registro') && itemMethods.trim() !== '') {
          return false;
        }
      } else {
        const itemNorm = normalizeMethodKey(itemMethods);
        if (!itemNorm.includes(targetNorm)) {
          return false;
        }
      }
    }

    // 4. Filtro de Situação do Vencimento
    if (dueStatus !== 'Todos') {
      const hasDue = Boolean(item.data_vencimento && String(item.data_vencimento).trim());
      if (dueStatus === 'Com Vencimento' && !hasDue) return false;
      if (dueStatus === 'Pendente' && hasDue) return false;
    }

    return true;
  });

  // Ordenação dos resultados
  sortFilteredData();

  // Garante que a página atual não ultrapasse o total de páginas existentes
  const totalPages = Math.max(1, Math.ceil(state.filteredContracts.length / state.itemsPerPage));
  if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }

  // Renderiza Métricas, Tabela e Paginação
  renderMetrics();
  renderTable();
  renderPagination();
  updateSortingIndicators();
}

/**
 * Ordena os contratos filtrados conforme a coluna e direção selecionadas
 */
function sortFilteredData() {
  const field = state.sortField;
  const modifier = state.sortAsc ? 1 : -1;

  state.filteredContracts.sort((a, b) => {
    let valA = a[field];
    let valB = b[field];

    if (field === 'codigo') {
      return (Number(valA) - Number(valB)) * modifier;
    }

    if (field === 'valor_parcela' || field === 'valor_pago_total' || field === 'qtd_parcelas') {
      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      return (numA - numB) * modifier;
    }

    if (field === 'data_vencimento') {
      const hasA = Boolean(valA && String(valA).trim());
      const hasB = Boolean(valB && String(valB).trim());
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1; // Registros sem vencimento ficam sempre ao final
      if (!hasB) return -1;

      const extractDay = (val) => {
        const m = String(val).match(/\d+/);
        return m ? parseInt(m[0], 10) : 998;
      };
      return (extractDay(valA) - extractDay(valB)) * modifier;
    }

    // Ordenação padrão por string alfabética
    valA = (valA || '').toString().toLowerCase();
    valB = (valB || '').toString().toLowerCase();
    return valA.localeCompare(valB, 'pt-BR') * modifier;
  });
}

/**
 * Renderiza os cards de métricas no topo do painel
 */
function renderMetrics() {
  const total = state.allContracts.length;
  let ativos = 0;
  let comVencimento = 0;
  let pendentes = 0;

  for (const c of state.allContracts) {
    const isAtivo = c.status_contrato && c.status_contrato.toLowerCase().includes('ativo') && !c.status_contrato.toLowerCase().includes('inativo');
    if (isAtivo) ativos++;

    if (c.data_vencimento && c.data_vencimento.trim()) {
      comVencimento++;
    } else {
      pendentes++;
    }
  }

  const pctAtivos = total > 0 ? ((ativos / total) * 100).toFixed(0) : 0;
  const pctVenc = total > 0 ? ((comVencimento / total) * 100).toFixed(0) : 0;

  document.getElementById('metricTotalContratos').textContent = total.toLocaleString('pt-BR');
  document.getElementById('metricContratosAtivos').textContent = `${ativos.toLocaleString('pt-BR')} (${pctAtivos}%)`;
  document.getElementById('metricComVencimento').textContent = `${comVencimento.toLocaleString('pt-BR')} (${pctVenc}%)`;
  document.getElementById('metricSemVencimento').textContent = pendentes.toLocaleString('pt-BR');
}

/**
 * Renderiza as linhas da tabela de acordo com a página atual
 */
function renderTable() {
  const tbody = document.getElementById('tabelaContratosBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  const total = state.filteredContracts.length;
  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty-state">
          <div class="empty-state-content">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <h3>Nenhum contrato encontrado</h3>
            <p>Nenhum registro corresponde aos filtros selecionados ou à busca.</p>
            <button class="btn btn-secondary btn-sm" id="btnEmptyReset">Limpar todos os filtros</button>
          </div>
        </td>
      </tr>
    `;
    const btnReset = document.getElementById('btnEmptyReset');
    if (btnReset) btnReset.addEventListener('click', resetFilters);
    return;
  }

  // Cálculo de corte da paginação
  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = Math.min(startIndex + state.itemsPerPage, total);
  const pageRows = state.filteredContracts.slice(startIndex, endIndex);

  const fragment = document.createDocumentFragment();

  for (const contrato of pageRows) {
    const tr = document.createElement('tr');
    tr.dataset.codigo = contrato.codigo;

    // Status formatado
    const isAtivo = contrato.status_contrato && contrato.status_contrato.toLowerCase().includes('ativo') && !contrato.status_contrato.toLowerCase().includes('inativo');
    const statusPillClass = isAtivo ? 'pill-status-ativo' : 'pill-status-inativo';
    const statusLabel = isAtivo ? 'Ativo' : 'Inativo';

    // Formatação de vencimento
    const hasDueDate = Boolean(contrato.data_vencimento && contrato.data_vencimento.trim());
    const dueDateDisplay = hasDueDate ? formatDueBadgeText(contrato.data_vencimento) : '+ Definir Dia';
    const dueDateBtnClass = hasDueDate ? 'due-badge-defined' : 'due-badge-empty';

    // Valores
    const parcelasInfo = formatParcelasInfo(contrato.qtd_parcelas, contrato.valor_parcela);

    tr.innerHTML = `
      <td class="col-codigo">
        <span class="code-badge" title="Clique para copiar" data-copy="${contrato.codigo}">
          #${contrato.codigo}
        </span>
      </td>
      <td class="col-aluno">
        <div class="student-cell">
          <div class="student-avatar">${getInitials(contrato.aluno)}</div>
          <div class="student-info">
            <span class="student-name">${escapeHtml(contrato.aluno)}</span>
            <span class="student-consultor">${escapeHtml(contrato.consultor || 'Consultor não informado')}</span>
          </div>
        </div>
      </td>
      <td class="col-status">
        <span class="status-pill-badge ${statusPillClass}">${statusLabel}</span>
      </td>
      <td class="col-vencimento">
        <button class="due-date-trigger ${dueDateBtnClass}" 
                data-codigo="${contrato.codigo}" 
                title="Clique para alterar a data de vencimento">
          <svg class="due-calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span class="due-text">${dueDateDisplay}</span>
        </button>
      </td>
      <td class="col-modalidades">
        ${renderPaymentBadges(contrato.forma_pagamento)}
      </td>
      <td class="col-parcelas">
        <span class="parcelas-text">${parcelasInfo}</span>
      </td>
      <td class="col-acoes">
        <div class="row-actions">
          <button class="btn-action-icon btn-delete-row" data-codigo="${contrato.codigo}" data-aluno="${escapeHtml(contrato.aluno)}" title="Excluir contrato">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </td>
    `;

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);

  // Anexa ouvintes de clique específicos da tabela
  attachTableDynamicEvents();
}

/**
 * Conecta ouvintes às células dinâmicas da tabela
 */
function attachTableDynamicEvents() {
  // Triggers do Popover de Data de Vencimento
  document.querySelectorAll('.due-date-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const codigo = btn.dataset.codigo;
      openDueDatePopover(codigo, btn);
    });
  });

  // Excluir linha
  document.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const codigo = btn.dataset.codigo;
      const aluno = btn.dataset.aluno;
      openDeleteConfirmModal(codigo, aluno);
    });
  });

  // Copiar código do contrato ao clicar
  document.querySelectorAll('.code-badge[data-copy]').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.copy;
      navigator.clipboard?.writeText(code);
      showToast(`Código #${code} copiado!`, 'info', 2000);
    });
  });
}

/**
 * Formata o texto exibido no badge de vencimento
 */
function formatDueBadgeText(venc) {
  if (!venc) return '+ Definir Dia';
  const str = String(venc).trim();
  // Se for apenas número ("05", "10"), exibe "Dia 05"
  if (/^\d{1,2}$/.test(str)) {
    return `Dia ${str.padStart(2, '0')}`;
  }
  return str;
}

/**
 * Retorna as iniciais do nome do aluno para o avatar
 */
function getInitials(name) {
  if (!name) return 'ML';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Formata o resumo das parcelas com cálculo correto da mensalidade (ex: "42x de R$ 179,90" e "Total: R$ 7.555,80")
 */
function formatParcelasInfo(qtd, valor) {
  if (!qtd && !valor) return '-';

  const qtdNum = Number(qtd) || 0;
  const valNum = Number(valor) || 0;

  if (qtdNum > 1 && valNum > 0) {
    // Na base de dados escolar, valor_parcela é o valor total líquido das parcelas quando >= 500,
    // e o valor unitário da mensalidade quando < 500. Tratamos ambos com precisão.
    let valorParcelaUnit;
    let valorTotal;

    if (valNum >= 500) {
      valorTotal = valNum;
      valorParcelaUnit = valNum / qtdNum;
    } else {
      valorParcelaUnit = valNum;
      valorTotal = valNum * qtdNum;
    }

    const unitFmt = valorParcelaUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const totalFmt = valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return `
      <div class="parcelas-detail">
        <span class="parcelas-main">${qtdNum}x de ${unitFmt}</span>
        <span class="parcelas-total">Total: ${totalFmt}</span>
      </div>
    `;
  }

  if (valNum > 0) {
    const totalFmt = valNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return `<span class="parcelas-main">${totalFmt}</span>`;
  }

  return `<span class="parcelas-main">${qtdNum} parcelas</span>`;
}

/**
 * Renderiza os controles de paginação
 */
function renderPagination() {
  const container = document.getElementById('paginationContainer');
  const countLabel = document.getElementById('paginationCountLabel');
  if (!container) return;

  const total = state.filteredContracts.length;
  if (total === 0) {
    container.innerHTML = '';
    if (countLabel) countLabel.textContent = 'Nenhum resultado';
    return;
  }

  const totalPages = Math.ceil(total / state.itemsPerPage);
  const start = (state.currentPage - 1) * state.itemsPerPage + 1;
  const end = Math.min(state.currentPage * state.itemsPerPage, total);

  if (countLabel) {
    countLabel.innerHTML = `Mostrando <strong>${start}–${end}</strong> de <strong>${total}</strong> contratos`;
  }

  let html = '';

  // Botão Anterior
  html += `
    <button class="btn-page ${state.currentPage === 1 ? 'disabled' : ''}" 
            data-page="${state.currentPage - 1}" 
            ${state.currentPage === 1 ? 'disabled' : ''} 
            title="Página anterior">
      &lsaquo;
    </button>
  `;

  // Números de páginas com elipses
  const pages = getPaginationPageNumbers(state.currentPage, totalPages);
  for (const p of pages) {
    if (p === '...') {
      html += `<span class="page-ellipsis">&hellip;</span>`;
    } else {
      const activeClass = p === state.currentPage ? 'active' : '';
      html += `<button class="btn-page ${activeClass}" data-page="${p}">${p}</button>`;
    }
  }

  // Botão Próximo
  html += `
    <button class="btn-page ${state.currentPage === totalPages ? 'disabled' : ''}" 
            data-page="${state.currentPage + 1}" 
            ${state.currentPage === totalPages ? 'disabled' : ''} 
            title="Próxima página">
      &rsaquo;
    </button>
  `;

  container.innerHTML = html;

  // Ouvinte nos botões da paginação
  container.querySelectorAll('.btn-page:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPage = parseInt(btn.dataset.page, 10);
      if (targetPage >= 1 && targetPage <= totalPages) {
        state.currentPage = targetPage;
        renderTable();
        renderPagination();
        window.scrollTo({ top: document.querySelector('.table-card')?.offsetTop - 20 || 0, behavior: 'smooth' });
      }
    });
  });
}

/**
 * Gera a lista de números de páginas visíveis com elipses
 */
function getPaginationPageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }

  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }

  return [1, '...', current - 1, current, current + 1, '...', total];
}

/**
 * Atualiza indicadores de seta nas colunas de cabeçalho da tabela
 */
function updateSortingIndicators() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const field = th.dataset.sort;
    th.classList.remove('sort-asc', 'sort-desc');
    if (field === state.sortField) {
      th.classList.add(state.sortAsc ? 'sort-asc' : 'sort-desc');
    }
  });
}

/**
 * ==============================================================================
 * POPOVER RÁPIDO DE DATA DE VENCIMENTO (AUTO-SAVE)
 * ==============================================================================
 */

/**
 * Abre o popover de seleção rápida de vencimento ancorado no botão clicado
 */
function openDueDatePopover(codigo, targetBtn) {
  const popover = document.getElementById('dueDatePopover');
  if (!popover) return;

  state.activePopover.isOpen = true;
  state.activePopover.codigo = codigo;
  state.activePopover.targetElement = targetBtn;

  const contrato = storage.getContrato(codigo);
  const currentVal = contrato?.data_vencimento || '';

  // Atualiza campo de entrada livre
  const customInput = document.getElementById('popoverCustomInput');
  if (customInput) {
    customInput.value = currentVal;
  }

  // Destaca o botão pré-definido se coincidir
  popover.querySelectorAll('.btn-popover-preset').forEach(btn => {
    const day = btn.dataset.day;
    if (currentVal === day || currentVal === `Dia ${day}`) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });

  // Posiciona o popover abaixo ou acima do botão
  const rect = targetBtn.getBoundingClientRect();
  popover.style.display = 'block';

  const popoverWidth = 240;
  const popoverHeight = 220;

  let left = rect.left + window.scrollX - (popoverWidth / 2) + (rect.width / 2);
  let top = rect.bottom + window.scrollY + 8;

  // Previne sair da tela à direita ou esquerda
  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

  // Se passar da parte inferior da tela, abre acima do botão
  if (rect.bottom + popoverHeight > window.innerHeight) {
    top = rect.top + window.scrollY - popoverHeight - 8;
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.add('is-open');

  if (customInput) {
    setTimeout(() => customInput.focus(), 50);
  }
}

/**
 * Fecha o popover de vencimento
 */
function closeDueDatePopover() {
  const popover = document.getElementById('dueDatePopover');
  if (popover) {
    popover.classList.remove('is-open');
    popover.style.display = 'none';
  }
  state.activePopover.isOpen = false;
  state.activePopover.codigo = null;
  state.activePopover.targetElement = null;
}

/**
 * Salva a alteração de vencimento selecionada mantendo sincronizado o estado da memória
 */
async function saveDueDate(newVal) {
  const codigo = state.activePopover.codigo;
  if (!codigo) return;

  const valorFormatado = newVal ? String(newVal).trim() : null;

  try {
    await storage.updateVencimento(codigo, valorFormatado);

    // Sincroniza imediatamente o estado em memória para manter consistência em buscas, filtros e exportações
    const strCod = String(codigo);
    const itemInAll = state.allContracts.find(c => String(c.codigo) === strCod);
    if (itemInAll) {
      itemInAll.data_vencimento = valorFormatado;
      itemInAll.updated_at = new Date().toISOString();
    }
    const itemInFiltered = state.filteredContracts.find(c => String(c.codigo) === strCod);
    if (itemInFiltered) {
      itemInFiltered.data_vencimento = valorFormatado;
      itemInFiltered.updated_at = new Date().toISOString();
    }

    // Efeito visual no botão de gatilho
    if (state.activePopover.targetElement) {
      const btn = state.activePopover.targetElement;
      const textSpan = btn.querySelector('.due-text');
      if (textSpan) {
        textSpan.textContent = valorFormatado ? formatDueBadgeText(valorFormatado) : '+ Definir Dia';
      }
      btn.className = `due-date-trigger ${valorFormatado ? 'due-badge-defined' : 'due-badge-empty'} due-pulse-success`;
      setTimeout(() => btn.classList.remove('due-pulse-success'), 800);
    }

    closeDueDatePopover();
    renderMetrics();
    showToast(`Vencimento do contrato #${codigo} atualizado: ${valorFormatado ? formatDueBadgeText(valorFormatado) : 'removido'}`, 'success', 2500);
  } catch (err) {
    showToast('Erro ao atualizar vencimento: ' + err.message, 'error');
  }
}

// Configura os botões internos do popover de vencimento
document.querySelectorAll('.btn-popover-preset').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const day = btn.dataset.day;
    saveDueDate(`Dia ${day}`);
  });
});

const btnSaveCustomDue = document.getElementById('btnSaveCustomDue');
if (btnSaveCustomDue) {
  btnSaveCustomDue.addEventListener('click', (e) => {
    e.stopPropagation();
    const val = document.getElementById('popoverCustomInput')?.value || '';
    saveDueDate(val);
  });
}

const customDueInput = document.getElementById('popoverCustomInput');
if (customDueInput) {
  customDueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDueDate(customDueInput.value);
    }
  });
}

const btnClearDue = document.getElementById('btnClearDue');
if (btnClearDue) {
  btnClearDue.addEventListener('click', (e) => {
    e.stopPropagation();
    saveDueDate(null);
  });
}

/**
 * ==============================================================================
 * IMPORTAÇÃO E DRAG & DROP DO EXCEL
 * ==============================================================================
 */

/**
 * Trata o envio do arquivo via Input File
 */
async function handleExcelUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  await processExcelFile(file);
  e.target.value = '';
}

/**
 * Configura a zona de arrastar e soltar (Drag & Drop)
 */
function setupDragAndDrop() {
  const dropzone = document.getElementById('excelDropzone');
  const fileInput = document.getElementById('excelFileInput');

  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    }, false);
  });

  dropzone.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    const file = dt.files?.[0];
    if (file) {
      await processExcelFile(file);
    }
  });

  dropzone.addEventListener('click', () => {
    fileInput?.click();
  });
}

/**
 * Processa a planilha com feedback de progresso e estatísticas
 */
async function processExcelFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Por favor, selecione um arquivo Excel válido (.xlsx ou .xls)', 'warning');
    return;
  }

  showLoading(true, `Lendo "${file.name}" e mesclando dados...`);

  try {
    const stats = await importExcelFile(file);
    handleDataReload();

    const msg = `Planilha processada com sucesso!\n• ${stats.total} contratos analisados\n• ${stats.added} novos inseridos\n• ${stats.updated} atualizados\n• ${stats.preservedDueDates} vencimentos preservados intactos`;
    showToast(msg, 'success', 6000);
  } catch (err) {
    console.error('[Excel] Falha ao importar:', err);
    showToast('Erro ao importar planilha: ' + err.message, 'error', 6000);
  } finally {
    showLoading(false);
  }
}

/**
 * ==============================================================================
 * EXPORTAÇÃO EXCEL COM DATA DE VENCIMENTO INCLUSA
 * ==============================================================================
 */

function exportToExcel() {
  if (!window.XLSX) {
    showToast('Biblioteca SheetJS não disponível para exportação.', 'error');
    return;
  }

  const isFiltered = Boolean(state.filters.search || state.filters.status !== 'Todos' || state.filters.paymentMethod !== 'Todas' || state.filters.dueStatus !== 'Todos');
  const dataToExport = isFiltered ? state.filteredContracts : state.allContracts;

  if (dataToExport.length === 0) {
    showToast('Nenhum contrato encontrado para os filtros atuais.', 'warning');
    return;
  }

  // Prepara os dados com colunas amigáveis em português
  const rows = dataToExport.map(item => ({
    'Código': item.codigo,
    'Aluno': item.aluno,
    'Status Contrato': item.status_contrato,
    'Data de Vencimento': item.data_vencimento || '',
    'Forma Pagamento Parcela': item.forma_pagamento,
    'Colaborador Consultor': item.consultor || '',
    'Quantidade Parcelas': item.qtd_parcelas || '',
    'Valor Parcela Líquido': item.valor_parcela || '',
    'Valor Pago Total': item.valor_pago_total || ''
  }));

  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Controles e Vencimentos');

  const dateStr = new Date().toISOString().slice(0, 10);
  window.XLSX.writeFile(workbook, `Relatorio_Controle_Financeiro_Vencimentos_${dateStr}.xlsx`);
  showToast(`${rows.length} contratos exportados para Excel com sucesso!`, 'success');
}

/**
 * ==============================================================================
 * SISTEMA DE NOTIFICAÇÕES (TOAST) E LOADING
 * ==============================================================================
 */

function setupToastContainer() {
  if (!document.getElementById('toastContainer')) {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;

  const iconSvg = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  }[type] || '';

  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-message">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
    <button class="toast-close" aria-label="Fechar">&times;</button>
  `;

  toast.querySelector('.toast-close')?.addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showLoading(active, text = 'Carregando...') {
  const loader = document.getElementById('globalLoadingOverlay');
  const label = document.getElementById('globalLoadingLabel');
  if (!loader) return;

  if (active) {
    if (label) label.textContent = text;
    loader.classList.add('is-active');
  } else {
    loader.classList.remove('is-active');
  }
}

/**
 * Utilitário de escape de HTML contra XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * APLICAÇÃO PRINCIPAL - GESTÃO FINANCEIRA DE CONTRATOS
 * MICROLINS POTIRENDABA
 * 
 * Controla:
 * - Filtros em tempo real e busca inteligente
 * - Filtro automático 'Emitir Boletos' (trimestral)
 * - Exibição exclusiva de alunos ativos
 * - Renderização de parcelas restantes e indicador de inadimplência
 * - Cruzamento de 'Planilha de Contrato Financeiro' e 'Recebimentos de Contratos'
 */

import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { 
  importContratoFile, 
  importRecebimentosFile, 
  importBaixaRecebimentosFile,
  importExcelFile,
  parseExcelData,
  normalizeHeader,
  parseSafeNumber 
} from './excel-importer.js';
import { renderPaymentBadges, normalizeMethodKey } from './payment-badges.js';
import { 
  initModals, 
  openModal, 
  closeModal, 
  openDeleteConfirmModal, 
  openSettingsModal 
} from './modals.js';

// Estado global da aplicação
const state = {
  allContracts: [],
  filteredContracts: [],
  currentPage: 1,
  itemsPerPage: CONFIG.DEFAULT_ITEMS_PER_PAGE,
  sortField: 'codigo',
  sortAsc: true,
  filters: {
    search: '',
    paymentMethod: 'Todas',
    dueStatus: 'Todos',
    emitirBoletos: false,
    apenasModalidadeBoleto: true,
    filtroCartaoLote: false
  },
  activePopover: {
    isOpen: false,
    codigo: null,
    targetElement: null
  }
};

/**
 * Ponto de entrada do sistema
 */
document.addEventListener('DOMContentLoaded', async () => {
  setupToastContainer();
  setupEventListeners();
  initModals({
    onDataChanged: handleDataReload,
    showToast: showToast
  });

  showLoading(true, 'Iniciando sistema e conectando ao banco de dados...');

  try {
    state.allContracts = await storage.init();

    // Auto-carregamento inteligente inicial das planilhas locais
    const precisaCarregarContratos = state.allContracts.length === 0;
    const precisaEnriquecerBaixa = state.allContracts.length > 0 && !state.allContracts.some(c => c.perfil_pagamento);

    if (precisaCarregarContratos || precisaEnriquecerBaixa) {
      try {
        let recarregou = false;

        if (precisaCarregarContratos) {
          const resp1 = await fetch(encodeURI('Relatório Contrato Financeiro.xlsx'));
          if (resp1.ok) {
            const buf1 = await resp1.arrayBuffer();
            const p1 = await parseExcelData(buf1);
            await storage.upsertContratos(p1.data);
            recarregou = true;
            const b1 = document.getElementById('badgeStatusContrato');
            if (b1) { b1.textContent = 'Carregada'; b1.className = 'badge-upload-status badge-upload-loaded'; }
          }

          const resp2 = await fetch(encodeURI('Recebimentos de Contratos.xlsx'));
          if (resp2.ok) {
            const buf2 = await resp2.arrayBuffer();
            const p2 = await parseExcelData(buf2);
            await storage.mergeRecebimentos(p2.data);
            recarregou = true;
            const b2 = document.getElementById('badgeStatusRecebimentos');
            if (b2) { b2.textContent = 'Atualizado'; b2.className = 'badge-upload-status badge-upload-loaded'; }
          }
        }

        // Tenta sempre carregar a Baixa de Recebimentos se disponível
        try {
          const resp3 = await fetch(encodeURI('Baixa de Recebimentos.xlsx'));
          if (resp3.ok) {
            const buf3 = await resp3.arrayBuffer();
            const p3 = await parseExcelData(buf3);
            if (p3.type === 'baixa_recebimentos') {
              await storage.mergeBaixaRecebimentos(p3.data);
              recarregou = true;
              const b3 = document.getElementById('badgeStatusBaixa');
              if (b3) { b3.textContent = 'Processada'; b3.className = 'badge-upload-status badge-upload-loaded'; }
            }
          }
        } catch (eBaixa) {
          console.info('[App] Baixa de Recebimentos não carregada automaticamente:', eBaixa);
        }

        if (recarregou) {
          state.allContracts = storage.getAllContratos();
        }
      } catch (errAuto) {
        console.info('[App] Inicialização padrão sem auto-carregamento:', errAuto);
      }
    }

    // Atualiza os badges visuais dos cards e classe de anexo
    updateImportCardsStatus();
    updateCloudStatusBadge();
    applyFiltersAndRender();

    if (state.allContracts.length === 0) {
      showToast('Bem-vindo! Importe o Relatório de Contrato Financeiro para começar.', 'info', 6000);
    } else {
      const lotes = state.allContracts.filter(c => c.perfil_pagamento === 'CARTAO_LOTE').length;
      const loteMsg = lotes > 0 ? ` (${lotes} alunos em Cartão 6x+)` : '';
      showToast(`${state.allContracts.length} contratos ativos carregados com sucesso${loteMsg}.`, 'success');
    }
  } catch (err) {
    console.error('[App] Erro na inicialização:', err);
    showToast('Iniciado em modo local. ' + (err.message || ''), 'warning');
    updateCloudStatusBadge();
    updateImportCardsStatus();
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
  updateImportCardsStatus();
  applyFiltersAndRender();
}

/**
 * Atualiza o indicador de conexão com a nuvem no cabeçalho
 */
function updateCloudStatusBadge() {
  const badge = document.getElementById('cloudStatusIndicator');
  if (!badge) return;

  const status = storage.syncStatus;
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

  // Botão Filtro Rápido 'Emitir Boletos'
  const btnEmitirBoletos = document.getElementById('btnEmitirBoletos');
  if (btnEmitirBoletos) {
    btnEmitirBoletos.addEventListener('click', () => {
      state.filters.emitirBoletos = !state.filters.emitirBoletos;
      if (state.filters.emitirBoletos) {
        btnEmitirBoletos.classList.add('is-active');
      } else {
        btnEmitirBoletos.classList.remove('is-active');
      }
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  // Checkbox 'Apenas modalidade Boleto'
  const checkApenasBoleto = document.getElementById('checkApenasBoleto');
  if (checkApenasBoleto) {
    checkApenasBoleto.addEventListener('change', (e) => {
      state.filters.apenasModalidadeBoleto = e.target.checked;
      state.currentPage = 1;
      applyFiltersAndRender();
    });
  }

  // Botão Filtro Rápido 'Cartão em Lote (6x+)'
  const btnFiltroCartaoLote = document.getElementById('btnFiltroCartaoLote');
  if (btnFiltroCartaoLote) {
    btnFiltroCartaoLote.addEventListener('click', () => {
      state.filters.filtroCartaoLote = !state.filters.filtroCartaoLote;
      if (state.filters.filtroCartaoLote) {
        btnFiltroCartaoLote.classList.add('is-active');
      } else {
        btnFiltroCartaoLote.classList.remove('is-active');
      }
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

  // Configurações do Modal de Nuvem / Backup
  setupSettingsModalActions();

  // Upload dos dois arquivos de Excel separados
  setupSeparateUploads();

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
 * Configuração dos botões do modal de configurações e backup
 */
function setupSettingsModalActions() {
  const btnTestConn = document.getElementById('btnTestarConexao');
  if (btnTestConn) {
    btnTestConn.addEventListener('click', async () => {
      showLoading(true, 'Testando comunicação com Supabase...');
      const success = await storage.refreshFromSupabase();
      showLoading(false);
      if (success) {
        showToast('Conexão com Supabase restabelecida com sucesso!', 'success');
      } else {
        showToast(storage.syncStatus.errorMessage || 'Supabase inacessível no momento. Continuando em modo local.', 'warning', 6000);
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
        const records = Array.from(storage.memoryData.values());
        await storage._batchUpsertSupabase(records);
        showToast(`${records.length} contratos sincronizados na nuvem Supabase!`, 'success');
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
          const total = await storage.importBackupJSON(evt.target.result);
          handleDataReload();
          showToast(`Backup restaurado! ${total} contratos processados.`, 'success');
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
}

/**
 * Atualiza o status visual dos cards de importação (badges e botão de remover anexo)
 */
export function updateImportCardsStatus() {
  const all = state.allContracts || [];

  // Card 1: Relatório de Contrato Financeiro
  const dzContrato = document.getElementById('dropzoneContrato');
  const bContrato = document.getElementById('badgeStatusContrato');
  const isContratoLoaded = all.length > 0;
  if (dzContrato) {
    if (isContratoLoaded) dzContrato.classList.add('is-attached');
    else dzContrato.classList.remove('is-attached');
  }
  if (bContrato) {
    bContrato.textContent = isContratoLoaded ? 'Carregada' : 'Disponível';
    bContrato.className = isContratoLoaded 
      ? 'badge-upload-status badge-upload-loaded' 
      : 'badge-upload-status badge-upload-ready';
  }

  // Card 2: Recebimentos de Contratos
  const dzReceb = document.getElementById('dropzoneRecebimentos');
  const bReceb = document.getElementById('badgeStatusRecebimentos');
  const isRecebLoaded = all.some(c => c.parcelas_restantes !== undefined && c.parcelas_restantes !== null);
  if (dzReceb) {
    if (isRecebLoaded) dzReceb.classList.add('is-attached');
    else dzReceb.classList.remove('is-attached');
  }
  if (bReceb) {
    bReceb.textContent = isRecebLoaded ? 'Atualizado' : 'Analítico';
    bReceb.className = isRecebLoaded 
      ? 'badge-upload-status badge-upload-loaded' 
      : 'badge-upload-status badge-upload-ready';
  }

  // Card 3: Baixa de Recebimentos
  const dzBaixa = document.getElementById('dropzoneBaixa');
  const bBaixa = document.getElementById('badgeStatusBaixa');
  const isBaixaLoaded = all.some(c => c.perfil_pagamento);
  if (dzBaixa) {
    if (isBaixaLoaded) dzBaixa.classList.add('is-attached');
    else dzBaixa.classList.remove('is-attached');
  }
  if (bBaixa) {
    bBaixa.textContent = isBaixaLoaded ? 'Processada' : 'Transacional';
    bBaixa.className = isBaixaLoaded 
      ? 'badge-upload-status badge-upload-loaded' 
      : 'badge-upload-status badge-upload-ready';
  }
}

/**
 * Remove anexo do Relatório de Contrato Financeiro
 */
export async function removerAnexoContrato() {
  const inputContrato = document.getElementById('excelFileInputContrato');
  if (inputContrato) inputContrato.value = '';

  storage.clearLocalStorageOnly();
  state.allContracts = [];
  state.filteredContracts = [];
  state.currentPage = 1;

  updateImportCardsStatus();
  applyFiltersAndRender();
  showToast('Relatório de Contrato Financeiro removido com sucesso.', 'info');
}

/**
 * Remove anexo de Recebimentos de Contratos
 */
export async function removerAnexoRecebimentos() {
  const inputReceb = document.getElementById('excelFileInputRecebimentos');
  if (inputReceb) inputReceb.value = '';

  storage.removeRecebimentosData();
  state.allContracts = storage.getAllContratos();
  state.currentPage = 1;

  updateImportCardsStatus();
  applyFiltersAndRender();
  showToast('Relatório de Recebimentos de Contratos removido.', 'info');
}

/**
 * Remove anexo da Baixa de Recebimentos
 */
export async function removerAnexoBaixa() {
  const inputBaixa = document.getElementById('excelFileInputBaixa');
  if (inputBaixa) inputBaixa.value = '';

  storage.removeBaixaData();
  state.allContracts = storage.getAllContratos();

  if (state.filters.filtroCartaoLote) {
    state.filters.filtroCartaoLote = false;
    const btn = document.getElementById('btnFiltroCartaoLote');
    if (btn) btn.classList.remove('is-active');
  }
  state.currentPage = 1;

  updateImportCardsStatus();
  applyFiltersAndRender();
  showToast('Planilha de Baixa de Recebimentos removida.', 'info');
}

/**
 * Configuração dos inputs e zonas de upload separados
 */
function setupSeparateUploads() {
  // Input 1: Planilha de Contrato Financeiro
  const inputContrato = document.getElementById('excelFileInputContrato');
  const dropzoneContrato = document.getElementById('dropzoneContrato');

  if (inputContrato) {
    inputContrato.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await processContratoFile(file);
        inputContrato.value = '';
      }
    });
  }

  if (dropzoneContrato) {
    setupCardDragDrop(dropzoneContrato, inputContrato, processContratoFile);
  }

  // Input 2: Recebimentos de Contratos
  const inputReceb = document.getElementById('excelFileInputRecebimentos');
  const dropzoneReceb = document.getElementById('dropzoneRecebimentos');

  if (inputReceb) {
    inputReceb.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await processRecebimentosFile(file);
        inputReceb.value = '';
      }
    });
  }

  if (dropzoneReceb) {
    setupCardDragDrop(dropzoneReceb, inputReceb, processRecebimentosFile);
  }

  // Input 3: Baixa de Recebimentos
  const inputBaixa = document.getElementById('excelFileInputBaixa');
  const dropzoneBaixa = document.getElementById('dropzoneBaixa');

  if (inputBaixa) {
    inputBaixa.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await processBaixaFile(file);
        inputBaixa.value = '';
      }
    });
  }

  if (dropzoneBaixa) {
    setupCardDragDrop(dropzoneBaixa, inputBaixa, processBaixaFile);
  }

  // Botões de remoção de anexos (Botão X em cada card)
  const btnRemoveContrato = document.getElementById('btnRemoverContrato');
  if (btnRemoveContrato) {
    btnRemoveContrato.addEventListener('click', (e) => {
      e.stopPropagation();
      removerAnexoContrato();
    });
  }

  const btnRemoveReceb = document.getElementById('btnRemoverRecebimentos');
  if (btnRemoveReceb) {
    btnRemoveReceb.addEventListener('click', (e) => {
      e.stopPropagation();
      removerAnexoRecebimentos();
    });
  }

  const btnRemoveBaixa = document.getElementById('btnRemoverBaixa');
  if (btnRemoveBaixa) {
    btnRemoveBaixa.addEventListener('click', (e) => {
      e.stopPropagation();
      removerAnexoBaixa();
    });
  }
}

function setupCardDragDrop(dropzone, inputEl, processFn) {
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
      await processFn(file);
    }
  });

  dropzone.addEventListener('click', (e) => {
    if (!e.target.closest('button')) {
      inputEl?.click();
    }
  });
}

/**
 * Processamento da Planilha de Contrato Financeiro
 */
async function processContratoFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Por favor, selecione um arquivo Excel válido (.xlsx ou .xls)', 'warning');
    return;
  }

  showLoading(true, `Lendo Relatório de Contrato Financeiro "${file.name}"...`);

  try {
    const stats = await importContratoFile(file);
    handleDataReload();

    const badge = document.getElementById('badgeStatusContrato');
    if (badge) {
      badge.textContent = 'Carregada';
      badge.className = 'badge-upload-status badge-upload-loaded';
    }

    const msg = `Relatório de Contrato Financeiro processado!\n• ${stats.total} contratos ativos atualizados\n• ${stats.added || 0} novos inseridos\n• ${stats.preservedDueDates || 0} vencimentos preservados`;
    showToast(msg, 'success', 6000);
  } catch (err) {
    console.error('[Contrato] Falha ao importar:', err);
    showToast('Erro ao importar Planilha de Contrato: ' + err.message, 'error', 6000);
  } finally {
    showLoading(false);
  }
}

/**
 * Processamento do relatório de Recebimentos de Contratos
 */
async function processRecebimentosFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Por favor, selecione um arquivo Excel válido (.xlsx ou .xls)', 'warning');
    return;
  }

  showLoading(true, `Lendo relatório de Recebimentos "${file.name}"...`);

  try {
    const stats = await importRecebimentosFile(file);
    handleDataReload();

    const badge = document.getElementById('badgeStatusRecebimentos');
    if (badge) {
      badge.textContent = 'Atualizado';
      badge.className = 'badge-upload-status badge-upload-loaded';
    }

    const msg = `Recebimentos de Contratos processado com sucesso!\n• ${stats.total} contratos analisados\n• Parcelas restantes e atrasos atualizados\n• Cruzamento realizado pelo Nº do Contrato`;
    showToast(msg, 'success', 6000);
  } catch (err) {
    console.error('[Recebimentos] Falha ao importar:', err);
    showToast('Erro ao importar Recebimentos: ' + err.message, 'error', 6000);
  } finally {
    showLoading(false);
  }
}

/**
 * Processamento do relatório de Baixa de Recebimentos (Extrato e Detecção de Cartão 6x+)
 */
async function processBaixaFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Por favor, selecione um arquivo Excel válido (.xlsx ou .xls)', 'warning');
    return;
  }

  showLoading(true, `Lendo Baixa de Recebimentos "${file.name}"...`);

  try {
    const stats = await importBaixaRecebimentosFile(file);
    handleDataReload();

    const badge = document.getElementById('badgeStatusBaixa');
    if (badge) {
      badge.textContent = 'Processada';
      badge.className = 'badge-upload-status badge-upload-loaded';
    }

    const lotesCount = state.allContracts.filter(c => c.perfil_pagamento === 'CARTAO_LOTE').length;
    const msg = `Baixa de Recebimentos processada com sucesso!\n• ${stats.total} contratos enriquecidos com extrato real de caixa\n• ${lotesCount} alunos identificados com Cartão 6x+ (em lote)\n• Prazos de cobertura e próximos vencimentos calculados`;
    showToast(msg, 'success', 6000);
  } catch (err) {
    console.error('[Baixa] Falha ao importar:', err);
    showToast('Erro ao importar Baixa de Recebimentos: ' + err.message, 'error', 6000);
  } finally {
    showLoading(false);
  }
}

/**
 * Regra de Negócio: Verifica se o contrato é elegível para emissão de boletos trimestrais
 */
export function isElegivelBoleto(contrato, apenasBoleto = true) {
  if (!contrato) return false;
  if (contrato.ignorar_emissao_boleto) return false;

  // 1. Deve ser ativo
  const isAtivo = contrato.status_contrato && 
    contrato.status_contrato.toLowerCase().includes('ativo') && 
    !contrato.status_contrato.toLowerCase().includes('inativo');
  if (!isAtivo) return false;

  // 2. Não quitado e com pelo menos 3 parcelas restantes (emissão trimestral)
  const restantes = contrato.parcelas_restantes !== undefined && contrato.parcelas_restantes !== null
    ? Number(contrato.parcelas_restantes)
    : null;

  if (restantes === null || restantes < 3) return false;

  // 3. Sem parcelas em atraso (inadimplentes fora)
  const atrasadas = Number(contrato.parcelas_atrasadas) || 0;
  if (atrasadas > 0) return false;

  // 4. Se o aluno paga no Cartão em Lote (6x+), ele NÃO deve receber carnê de boletos!
  if (contrato.perfil_pagamento === 'CARTAO_LOTE') {
    return false;
  }

  // 5. Modalidade de pagamento
  if (apenasBoleto) {
    const forma = (contrato.forma_pagamento || '').toLowerCase();
    if (!forma.includes('boleto')) return false;
  }

  return true;
}

/**
 * Utilitário de normalização de texto para busca
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
  state.filters.paymentMethod = 'Todas';
  state.filters.dueStatus = 'Todos';
  state.filters.emitirBoletos = false;
  state.filters.apenasModalidadeBoleto = true;
  state.filters.filtroCartaoLote = false;
  state.currentPage = 1;

  const searchInput = document.getElementById('inputBusca');
  if (searchInput) searchInput.value = '';

  const filterPayment = document.getElementById('selectFiltroModalidade');
  if (filterPayment) filterPayment.value = 'Todas';

  const filterDue = document.getElementById('selectFiltroVencimento');
  if (filterDue) filterDue.value = 'Todos';

  const btnEmitirBoletos = document.getElementById('btnEmitirBoletos');
  if (btnEmitirBoletos) btnEmitirBoletos.classList.remove('is-active');

  const btnCartaoLote = document.getElementById('btnFiltroCartaoLote');
  if (btnCartaoLote) btnCartaoLote.classList.remove('is-active');

  const checkApenasBoleto = document.getElementById('checkApenasBoleto');
  if (checkApenasBoleto) checkApenasBoleto.checked = true;

  applyFiltersAndRender();
  showToast('Filtros restaurados.', 'info');
}

/**
 * Aplica busca, filtros e ordenação aos contratos e atualiza a view
 */
function applyFiltersAndRender() {
  const { search, paymentMethod, dueStatus, emitirBoletos, apenasModalidadeBoleto, filtroCartaoLote } = state.filters;
  const normalizedSearch = normalizeSearchText(search);

  // Calcula a quantidade global de aptos para boletos para atualizar o contador
  const totalElegiveisBoletos = state.allContracts.filter(c => isElegivelBoleto(c, apenasModalidadeBoleto)).length;
  const badgeCountBoletos = document.getElementById('badgeCountBoletos');
  if (badgeCountBoletos) {
    badgeCountBoletos.textContent = totalElegiveisBoletos;
  }

  // Atualiza contador de contratos com Cartão em Lote (6x+)
  const totalCartaoLote = state.allContracts.filter(c => c.perfil_pagamento === 'CARTAO_LOTE').length;
  const badgeCountCartaoLote = document.getElementById('badgeCountCartaoLote');
  if (badgeCountCartaoLote) {
    badgeCountCartaoLote.textContent = totalCartaoLote;
  }

  state.filteredContracts = state.allContracts.filter(item => {
    // 1. Busca por texto (Nº Contrato ou Aluno)
    if (normalizedSearch) {
      const matchCodigo = String(item.codigo).includes(normalizedSearch);
      const matchAluno = normalizeSearchText(item.aluno_normalizado || item.aluno).includes(normalizedSearch);
      if (!matchCodigo && !matchAluno) {
        return false;
      }
    }

    // 2. Filtro Especial 'Emitir Boletos'
    if (emitirBoletos) {
      if (!isElegivelBoleto(item, apenasModalidadeBoleto)) {
        return false;
      }
    }

    // 3. Filtro Especial 'Cartão em Lote (6x+)'
    if (filtroCartaoLote) {
      if (item.perfil_pagamento !== 'CARTAO_LOTE') {
        return false;
      }
    }

    // 4. Filtro de Modalidade de Pagamento
    if (paymentMethod !== 'Todas') {
      if (paymentMethod === 'Cartão em Lote') {
        if (item.perfil_pagamento !== 'CARTAO_LOTE') return false;
      } else if (paymentMethod === 'Cartão Mensal') {
        if (item.perfil_pagamento !== 'CARTAO_MENSAL') return false;
      } else {
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

  // Paginação segura
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

    if (field === 'parcelas_restantes' || field === 'valor_parcela' || field === 'qtd_parcelas') {
      const numA = (valA !== null && valA !== undefined) ? Number(valA) : -1;
      const numB = (valB !== null && valB !== undefined) ? Number(valB) : -1;
      return (numA - numB) * modifier;
    }

    if (field === 'data_vencimento') {
      const hasA = Boolean(valA && String(valA).trim());
      const hasB = Boolean(valB && String(valB).trim());
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;

      const extractDay = (val) => {
        const m = String(val).match(/\d+/);
        return m ? parseInt(m[0], 10) : 998;
      };
      return (extractDay(valA) - extractDay(valB)) * modifier;
    }

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
  let comVencimento = 0;
  let pendentes = 0;
  let aptosBoleto = 0;

  for (const c of state.allContracts) {
    if (c.data_vencimento && c.data_vencimento.trim()) {
      comVencimento++;
    } else {
      pendentes++;
    }

    if (isElegivelBoleto(c, state.filters.apenasModalidadeBoleto)) {
      aptosBoleto++;
    }
  }

  const pctAptos = total > 0 ? ((aptosBoleto / total) * 100).toFixed(0) : 0;
  const pctVenc = total > 0 ? ((comVencimento / total) * 100).toFixed(0) : 0;

  const elTotal = document.getElementById('metricTotalContratos');
  if (elTotal) elTotal.textContent = total.toLocaleString('pt-BR');

  const elAtivos = document.getElementById('metricContratosAtivos');
  if (elAtivos) elAtivos.textContent = `${aptosBoleto.toLocaleString('pt-BR')} (${pctAptos}%)`;

  const elLabelAtivos = elAtivos?.closest('.metric-card')?.querySelector('.metric-label');
  if (elLabelAtivos) elLabelAtivos.textContent = 'Aptos p/ Boletos';

  const elComVenc = document.getElementById('metricComVencimento');
  if (elComVenc) elComVenc.textContent = `${comVencimento.toLocaleString('pt-BR')} (${pctVenc}%)`;

  const elSemVenc = document.getElementById('metricSemVencimento');
  if (elSemVenc) elSemVenc.textContent = pendentes.toLocaleString('pt-BR');
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
        <td colspan="6" class="table-empty-state">
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

  const startIndex = (state.currentPage - 1) * state.itemsPerPage;
  const endIndex = Math.min(startIndex + state.itemsPerPage, total);
  const pageRows = state.filteredContracts.slice(startIndex, endIndex);

  const fragment = document.createDocumentFragment();

  for (const contrato of pageRows) {
    const tr = document.createElement('tr');
    tr.dataset.codigo = contrato.codigo;

    // Formatação de vencimento
    const hasDueDate = Boolean(contrato.data_vencimento && contrato.data_vencimento.trim());
    const dueDateDisplay = hasDueDate ? formatDueBadgeText(contrato.data_vencimento) : '+ Definir Dia';
    const dueDateBtnClass = hasDueDate ? 'due-badge-defined' : 'due-badge-empty';

    // Formatação de Parcelas Restantes
    const parcelasHtml = formatParcelasInfo(contrato);

    // Indicador visual de boleto ignorado
    const isIgnorado = Boolean(contrato.ignorar_emissao_boleto);

    tr.innerHTML = `
      <td class="col-codigo">
        <span class="code-badge" title="Clique para copiar" data-copy="${contrato.codigo}">
          ${contrato.codigo}
        </span>
      </td>
      <td class="col-aluno">
        <div class="student-cell" data-detalhes="${contrato.codigo}" style="cursor: pointer;" title="Clique para ver o extrato financeiro detalhado deste aluno">
          <div class="student-avatar">${getInitials(contrato.aluno)}</div>
          <div class="student-info">
            <span class="student-name">${escapeHtml(contrato.aluno)}</span>
          </div>
        </div>
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
        ${renderPaymentBadges(contrato)}
      </td>
      <td class="col-parcelas">
        ${parcelasHtml}
      </td>
      <td class="col-acoes">
        <div class="row-actions">
          <button class="btn-action-icon btn-view-extrato" data-codigo="${contrato.codigo}" title="Ver extrato e histórico financeiro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </button>
          <button class="btn-action-icon btn-toggle-boleto ${isIgnorado ? 'btn-boleto-ignored' : ''}" 
                  data-codigo="${contrato.codigo}" 
                  title="${isIgnorado ? 'Aluno excluído da emissão de boleto. Clique para reativar.' : 'Clique para ignorar/excluir este aluno da emissão de boletos'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
          </button>
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
  attachTableDynamicEvents();
}

/**
 * Conecta ouvintes às células dinâmicas da tabela
 */
function attachTableDynamicEvents() {
  // Abertura do Extrato / Detalhes ao clicar no Aluno ou no botão de extrato
  document.querySelectorAll('[data-detalhes]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const codigo = el.dataset.detalhes;
      openDetalhesAlunoModal(codigo);
    });
  });

  document.querySelectorAll('.btn-view-extrato').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const codigo = btn.dataset.codigo;
      openDetalhesAlunoModal(codigo);
    });
  });

  // Popover de Data de Vencimento
  document.querySelectorAll('.due-date-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const codigo = btn.dataset.codigo;
      openDueDatePopover(codigo, btn);
    });
  });

  // Alternar ignorar boleto
  document.querySelectorAll('.btn-toggle-boleto').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const codigo = btn.dataset.codigo;
      const updated = await storage.toggleIgnorarBoleto(codigo);
      if (updated) {
        const itemAll = state.allContracts.find(c => String(c.codigo) === String(codigo));
        if (itemAll) itemAll.ignorar_emissao_boleto = updated.ignorar_emissao_boleto;
        applyFiltersAndRender();
        showToast(`Contrato ${codigo}: ${updated.ignorar_emissao_boleto ? 'marcado para ignorar boletos' : 'reativado para emissão de boletos'}`, 'info', 2500);
      }
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
      showToast(`Nº do Contrato ${code} copiado!`, 'info', 2000);
    });
  });
}

/**
 * Abre o modal com o extrato financeiro completo e histórico de baixas do aluno
 */
function openDetalhesAlunoModal(codigo) {
  const contrato = state.allContracts.find(c => String(c.codigo) === String(codigo));
  if (!contrato) return;

  const nomeEl = document.getElementById('detalhesAlunoNome');
  const codigoEl = document.getElementById('detalhesAlunoCodigoBadge');
  const perfilEl = document.getElementById('detalhesPerfilBadge');
  const parcelasEl = document.getElementById('detalhesParcelasRestantes');
  const totalPagoEl = document.getElementById('detalhesTotalPago');
  const vencEl = document.getElementById('detalhesProximoVencimento');
  const loteBanner = document.getElementById('detalhesLoteBanner') || document.getElementById('detalhesLapadaBanner');
  const loteTexto = document.getElementById('detalhesLoteTexto') || document.getElementById('detalhesLapadaTexto');
  const baixasBody = document.getElementById('detalhesTabelaBaixasBody');
  const totalBaixasCount = document.getElementById('detalhesTotalBaixasCount');

  if (nomeEl) nomeEl.textContent = contrato.aluno;
  if (codigoEl) codigoEl.textContent = `Contrato nº ${contrato.codigo}`;

  // Perfil badge
  if (perfilEl) {
    if (contrato.perfil_pagamento === 'CARTAO_LOTE') {
      perfilEl.innerHTML = `<span class="badge-cartao-lote"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>Cartão em Lote (6x+)</span></span>`;
    } else if (contrato.perfil_pagamento === 'CARTAO_MENSAL') {
      perfilEl.innerHTML = `<span class="badge-cartao-mensal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg><span>Cartão Mês a Mês</span></span>`;
    } else if (contrato.perfil_pagamento) {
      perfilEl.innerHTML = `<span style="font-weight: 600;">${escapeHtml(contrato.perfil_pagamento)}</span>`;
    } else {
      perfilEl.textContent = contrato.forma_pagamento || 'Normal';
    }
  }

  // Parcelas restantes
  if (parcelasEl) {
    if (contrato.parcelas_restantes === 0) {
      parcelasEl.innerHTML = '<span class="text-success font-bold">0 (Quitado)</span>';
    } else if (contrato.parcelas_restantes !== undefined && contrato.parcelas_restantes !== null) {
      const atr = Number(contrato.parcelas_atrasadas) || 0;
      const atrTxt = atr > 0 ? ` <span style="font-size: 0.8rem; color: var(--accent); font-weight: 600;">(${atr} em atraso)</span>` : '';
      parcelasEl.innerHTML = `${contrato.parcelas_restantes} restantes${atrTxt}`;
    } else {
      parcelasEl.textContent = '-';
    }
  }

  // Total pago acumulado
  if (totalPagoEl) {
    const val = Number(contrato.total_pago_acumulado) || Number(contrato.valor_pago_total) || 0;
    totalPagoEl.textContent = `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }

  // Próximo vencimento
  if (vencEl) {
    vencEl.textContent = contrato.proximo_vencimento_real || contrato.data_vencimento || 'Não informado';
  }

  // Banner de Pagamento em Lote no Cartão se houver
  if (loteBanner && loteTexto) {
    const lote = contrato.pagamento_lote_cartao || contrato.lapada_cartao;
    if (contrato.perfil_pagamento === 'CARTAO_LOTE' && lote) {
      loteBanner.style.display = 'flex';
      loteTexto.innerHTML = `
        <div style="font-weight: 700; color: #581c87; margin-bottom: 2px;">Pagamento em Lote no Cartão Detectado</div>
        <div>O aluno realizou um pagamento em lote de <strong>R$ ${lote.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> (~${lote.equiv_parcelas}x parcelas) no cartão em <strong>${lote.data}</strong>.</div>
        ${contrato.proximo_vencimento_real ? `<div style="margin-top: 2px; color: #6b21a8;">Período coberto até o próximo vencimento em <strong>${contrato.proximo_vencimento_real}</strong>.</div>` : ''}
      `;
    } else {
      loteBanner.style.display = 'none';
    }
  }

  // Extrato das Baixas
  if (baixasBody) {
    baixasBody.innerHTML = '';
    const historico = contrato.historico_baixas || [];
    if (totalBaixasCount) totalBaixasCount.textContent = `${historico.length} lançamento(s)`;

    if (historico.length === 0) {
      baixasBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 18px;">Nenhum lançamento transacional encontrado para este contrato. Importe a planilha 'Baixa de Recebimentos' para visualizar o extrato de caixa.</td></tr>`;
    } else {
      for (const item of historico) {
        const isPaid = item.valor_pago !== null && Number(item.valor_pago) > 0;
        const vlrPagoFormatted = isPaid ? `R$ ${Number(item.valor_pago).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';
        const vlrFormatted = item.valor ? `R$ ${Number(item.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

        const rowTr = document.createElement('tr');
        if (isPaid && (item.forma || '').toLowerCase().includes('cart')) {
          rowTr.style.background = '#faf5ff';
        }
        rowTr.innerHTML = `
          <td style="padding: 6px 12px; font-weight: 600;">${escapeHtml(item.ordem)}</td>
          <td style="padding: 6px 12px;">${escapeHtml(item.tipo)}</td>
          <td style="padding: 6px 12px;"><span class="font-mono" style="font-size: 0.78rem;">${escapeHtml(item.forma)}</span></td>
          <td style="padding: 6px 12px; text-align: right;">${vlrFormatted}</td>
          <td style="padding: 6px 12px; text-align: right; font-weight: 600; color: ${isPaid ? '#059669' : 'inherit'};">${vlrPagoFormatted}</td>
          <td style="padding: 6px 12px;">${escapeHtml(item.vencimento || '-')}</td>
          <td style="padding: 6px 12px;">${escapeHtml(item.pagamento || '-')}</td>
          <td style="padding: 6px 12px; font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.usuario_baixa || '-')}</td>
        `;
        baixasBody.appendChild(rowTr);
      }
    }
  }

  openModal('modalDetalhesAluno');
}

/**
 * Formata o texto exibido no badge de vencimento
 */
function formatDueBadgeText(venc) {
  if (!venc) return '+ Definir Dia';
  const str = String(venc).trim();
  if (str.toLowerCase().startsWith('dia')) return str;
  return `Dia ${str}`;
}

/**
 * Obtém as iniciais do aluno para o avatar
 */
function getInitials(name) {
  if (!name) return 'ML';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Formata o resumo visual das parcelas restantes e indicadores de inadimplência
 */
function formatParcelasInfo(contrato) {
  const restantes = contrato.parcelas_restantes;
  const atrasadas = Number(contrato.parcelas_atrasadas) || 0;

  if (restantes === 0) {
    return `
      <span class="badge-parcelas badge-parcelas-quitado" title="Contrato integralmente quitado">
        <svg class="badge-icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Quitado
      </span>
    `;
  }

  if (restantes === null || restantes === undefined) {
    if (contrato.qtd_parcelas) {
      return `<span class="badge-parcelas badge-parcelas-restantes">${contrato.qtd_parcelas} parcelas</span>`;
    }
    return `<span class="badge-parcelas badge-parcelas-pendente">-</span>`;
  }

  if (atrasadas > 0) {
    return `
      <div class="parcelas-stacked">
        <span class="badge-parcelas badge-parcelas-alerta">
          ${restantes} restante${restantes > 1 ? 's' : ''}
        </span>
        <span class="parcelas-atraso-tag" title="${atrasadas} parcela(s) em atraso (inadimplente)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}
        </span>
      </div>
    `;
  }

  return `
    <span class="badge-parcelas badge-parcelas-restantes">
      ${restantes} restante${restantes > 1 ? 's' : ''}
    </span>
  `;
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

  html += `
    <button class="btn-page ${state.currentPage === 1 ? 'disabled' : ''}" 
            data-page="${state.currentPage - 1}" 
            ${state.currentPage === 1 ? 'disabled' : ''} 
            title="Página anterior">
      &lsaquo;
    </button>
  `;

  const pages = getPaginationPageNumbers(state.currentPage, totalPages);
  for (const p of pages) {
    if (p === '...') {
      html += `<span class="page-ellipsis">&hellip;</span>`;
    } else {
      const activeClass = p === state.currentPage ? 'active' : '';
      html += `<button class="btn-page ${activeClass}" data-page="${p}">${p}</button>`;
    }
  }

  html += `
    <button class="btn-page ${state.currentPage === totalPages ? 'disabled' : ''}" 
            data-page="${state.currentPage + 1}" 
            ${state.currentPage === totalPages ? 'disabled' : ''} 
            title="Próxima página">
      &rsaquo;
    </button>
  `;

  container.innerHTML = html;

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

function openDueDatePopover(codigo, targetBtn) {
  const popover = document.getElementById('dueDatePopover');
  if (!popover) return;

  state.activePopover.isOpen = true;
  state.activePopover.codigo = codigo;
  state.activePopover.targetElement = targetBtn;

  const contrato = storage.getContrato(codigo);
  const currentVal = contrato?.data_vencimento || '';

  const customInput = document.getElementById('popoverCustomInput');
  if (customInput) {
    customInput.value = currentVal;
  }

  popover.querySelectorAll('.btn-popover-preset').forEach(btn => {
    const day = btn.dataset.day;
    if (currentVal === day || currentVal === `Dia ${day}`) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });

  const rect = targetBtn.getBoundingClientRect();
  popover.style.display = 'block';

  const popoverWidth = 240;
  const popoverHeight = 220;

  let left = rect.left + window.scrollX - (popoverWidth / 2) + (rect.width / 2);
  let top = rect.bottom + window.scrollY + 8;

  if (left < 10) left = 10;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = window.innerWidth - popoverWidth - 10;
  }

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

async function saveDueDate(newVal) {
  const codigo = state.activePopover.codigo;
  if (!codigo) return;

  const valorFormatado = newVal ? String(newVal).trim() : null;

  try {
    await storage.updateVencimento(codigo, valorFormatado);

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
    showToast(`Vencimento do contrato ${codigo} atualizado: ${valorFormatado ? formatDueBadgeText(valorFormatado) : 'removido'}`, 'success', 2500);
  } catch (err) {
    showToast('Erro ao atualizar vencimento: ' + err.message, 'error');
  }
}

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
 * EXPORTAÇÃO EXCEL PROFISSIONAL FORMATADA PARA ANÁLISE
 * ==============================================================================
 */

export async function exportToExcel() {
  const isFiltered = Boolean(
    state.filters.search || 
    state.filters.emitirBoletos ||
    state.filters.filtroCartaoLote ||
    state.filters.paymentMethod !== 'Todas' || 
    state.filters.dueStatus !== 'Todos'
  );
  const dataToExport = isFiltered ? state.filteredContracts : state.allContracts;

  if (dataToExport.length === 0) {
    showToast('Nenhum contrato encontrado para os filtros atuais.', 'warning');
    return;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = state.filters.emitirBoletos 
    ? `Emissao_Boletos_Microlins_${dateStr}.xlsx`
    : `Relatorio_Contrato_Financeiro_${dateStr}.xlsx`;
  const sheetTitle = state.filters.emitirBoletos ? 'Emissao_Boletos' : 'Contrato_Financeiro';

  // 1. Motor Primário: ExcelJS (Gera planilha altamente formatada com estilos, cores e layout profissional)
  if (window.ExcelJS) {
    try {
      showLoading(true, 'Gerando planilha Excel formatada...');
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Microlins Potirendaba';
      wb.created = new Date();

      const ws = wb.addWorksheet(sheetTitle, {
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
      });

      // Definição das colunas principais (espelhando a visualização da tabela na interface)
      const columns = [
        { header: 'Nº CONTRATO', key: 'codigo', width: 16 },
        { header: 'ALUNO', key: 'aluno', width: 36 },
        { header: 'VENCIMENTO', key: 'vencimento', width: 18 },
        { header: 'MODALIDADES DE PAGAMENTO', key: 'modalidade', width: 32 },
        { header: 'PARCELAS RESTANTES', key: 'restantes', width: 22 },
        { header: 'PARCELAS EM ATRASO', key: 'atrasadas', width: 22 },
        { header: 'APTO P/ BOLETO', key: 'apto_boleto', width: 18 },
        { header: 'TELEFONE', key: 'telefone', width: 20 },
        { header: 'STATUS', key: 'status', width: 16 }
      ];
      ws.columns = columns;

      // Estilização do Cabeçalho Superior (Linha 1) - Azul Microlins com Texto Branco
      const headerRow = ws.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3B7D' } };
        cell.alignment = { vertical: 'middle', horizontal: colNumber === 2 ? 'left' : 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF0F3B7D' } },
          bottom: { style: 'medium', color: { argb: 'FF0A2652' } },
          left: { style: 'thin', color: { argb: 'FF1E4B8F' } },
          right: { style: 'thin', color: { argb: 'FF1E4B8F' } }
        };
      });

      // Inserção das Linhas de Dados com Estilo e Cores Inteligentes
      dataToExport.forEach((item, index) => {
        const isApto = isElegivelBoleto(item, state.filters.apenasModalidadeBoleto);
        const atraso = item.parcelas_atrasadas || 0;
        const restantesVal = (item.parcelas_restantes !== null && item.parcelas_restantes !== undefined)
          ? item.parcelas_restantes
          : '-';
        const vencText = item.data_vencimento || 'Pendente';
        const modalidadeText = item.perfil_pagamento === 'CARTAO_LOTE'
          ? (item.forma_pagamento ? `${item.forma_pagamento} (Cartão 6x+)` : 'Cartão de Crédito (Lote 6x+)')
          : (item.forma_pagamento || '-');

        const row = ws.addRow({
          codigo: item.codigo,
          aluno: item.aluno || '',
          vencimento: vencText,
          modalidade: modalidadeText,
          restantes: restantesVal,
          atrasadas: atraso,
          apto_boleto: isApto ? 'SIM' : 'NÃO',
          telefone: item.telefone_celular || item.telefone_residencial || '',
          status: item.status_contrato || 'Ativo'
        });

        row.height = 22;

        const isEven = index % 2 === 0;
        const rowBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF1E293B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };

          // Coluna 1: Nº Contrato
          if (colNumber === 1) {
            cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0F3B7D' } };
          }
          // Coluna 2: Aluno
          else if (colNumber === 2) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
          }
          // Coluna 3: Vencimento
          else if (colNumber === 3) {
            if (item.data_vencimento) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
              cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF047857' } };
            } else {
              cell.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF94A3B8' } };
            }
          }
          // Coluna 4: Modalidades
          else if (colNumber === 4) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          }
          // Coluna 5: Parcelas Restantes
          else if (colNumber === 5) {
            cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
          }
          // Coluna 6: Parcelas em Atraso
          else if (colNumber === 6) {
            if (atraso > 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
              cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFDC2626' } };
            } else {
              cell.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF94A3B8' } };
            }
          }
          // Coluna 7: Apto p/ Boleto
          else if (colNumber === 7) {
            if (isApto) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
              cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF16A34A' } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
              cell.font = { name: 'Calibri', size: 10.5, color: { argb: 'FF64748B' } };
            }
          }
          // Coluna 9: Status
          else if (colNumber === 9) {
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
          }
        });
      });

      // AutoFilter em todas as colunas
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: dataToExport.length + 1, column: columns.length }
      };

      // Gravação e download via Blob do navegador
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      showToast(`${dataToExport.length} contratos exportados para Excel com formatação profissional!`, 'success');
      return;
    } catch (errExcelJS) {
      console.warn('[Export] Falha com ExcelJS, recorrendo ao SheetJS:', errExcelJS);
    } finally {
      showLoading(false);
    }
  }

  // 2. Motor Secundário: SheetJS (Fallback resiliente)
  if (!window.XLSX) {
    showToast('Biblioteca de exportação não disponível.', 'error');
    return;
  }

  const rows = dataToExport.map(item => ({
    'Nº CONTRATO': item.codigo,
    'ALUNO': item.aluno,
    'VENCIMENTO': item.data_vencimento || 'Pendente',
    'MODALIDADES DE PAGAMENTO': item.forma_pagamento || '-',
    'PARCELAS RESTANTES': (item.parcelas_restantes !== null && item.parcelas_restantes !== undefined) ? item.parcelas_restantes : '-',
    'PARCELAS EM ATRASO': item.parcelas_atrasadas || 0,
    'APTO P/ BOLETO': isElegivelBoleto(item, state.filters.apenasModalidadeBoleto) ? 'SIM' : 'NÃO',
    'TELEFONE': item.telefone_celular || item.telefone_residencial || '',
    'STATUS': item.status_contrato || 'Ativo'
  }));

  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 16 }, { wch: 36 }, { wch: 18 }, { wch: 32 },
    { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 16 }
  ];
  worksheet['!autofilter'] = { ref: `A1:I${rows.length + 1}` };
  worksheet['!views'] = [{ state: 'frozen', ySplit: 1 }];

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, sheetTitle);
  window.XLSX.writeFile(workbook, fileName);
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function openAddStudentModal() {
  const form = document.getElementById('formNovoAluno');
  if (form) form.reset();
  openModal('modalNovoAluno');
}

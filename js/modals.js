/**
 * GERENCIADOR DE MODAIS
 * 
 * Controla os modais de:
 * 1. Cadastro manual de Novo Aluno
 * 2. Confirmação de Exclusão segura
 * 3. Configurações, Status da Nuvem e Backup
 */

import { storage } from './storage.js';
import { CONFIG } from './config.js';

let currentDeleteCodigo = null;
let onDataChangedCallback = null;
let toastNotifier = null;

export function initModals({ onDataChanged, showToast }) {
  onDataChangedCallback = onDataChanged;
  toastNotifier = showToast;

  // Fechar modais com tecla ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // Fechar modais ao clicar no backdrop (overlay)
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeAllModals();
      }
    });
  });

  // Botões de fechar (X) ou botões data-modal-close
  document.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Configuração do formulário de Novo Aluno
  const formNovoAluno = document.getElementById('formNovoAluno');
  if (formNovoAluno) {
    formNovoAluno.addEventListener('submit', handleAddStudentSubmit);
  }

  // Configuração do botão de confirmação de exclusão
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');
  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', handleConfirmDelete);
  }

  // Preset days no formulário de novo aluno
  document.querySelectorAll('#formNovoAluno .btn-preset-day').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('novoVencimento');
      if (input) {
        input.value = btn.dataset.day;
      }
    });
  });
}

/**
 * Abre um modal por ID
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.add('is-active');
  document.body.classList.add('modal-open');

  // Foco no primeiro campo de input
  const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100);
  }
}

/**
 * Fecha um modal específico ou todos
 */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('is-active');
  }
  if (!document.querySelector('.modal-overlay.is-active')) {
    document.body.classList.remove('modal-open');
  }
}

export function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.classList.remove('is-active');
  });
  document.body.classList.remove('modal-open');
}

/**
 * Abre o modal de cadastro de novo aluno limpo
 */
export function openAddStudentModal() {
  const form = document.getElementById('formNovoAluno');
  if (form) {
    form.reset();
    // Limpa checkboxes de pagamento
    form.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = false);
  }
  openModal('modalNovoAluno');
}

/**
 * Handler de envio do formulário Novo Aluno
 */
async function handleAddStudentSubmit(e) {
  e.preventDefault();

  const form = e.target;
  const codigoRaw = document.getElementById('novoCodigo')?.value;
  const aluno = document.getElementById('novoAluno')?.value;
  const status = document.getElementById('novoStatus')?.value || 'Ativo';
  const vencimento = document.getElementById('novoVencimento')?.value || null;
  const consultor = document.getElementById('novoConsultor')?.value || '';
  const qtdParcelas = document.getElementById('novoQtdParcelas')?.value || null;
  const valorParcela = document.getElementById('novoValorParcela')?.value || null;

  // Formas de pagamento selecionadas
  const selectedMethods = [];
  form.querySelectorAll('input[name="novoFormaPagamento"]:checked').forEach(chk => {
    selectedMethods.push(chk.value);
  });

  const formaPagamentoStr = selectedMethods.length > 0 ? selectedMethods.join(', ') : 'Sem registro';

  if (!codigoRaw || !aluno) {
    toastNotifier?.('Preencha os campos obrigatórios (Nº do Contrato e Aluno)', 'warning');
    return;
  }

  const codigo = parseInt(codigoRaw, 10);
  if (isNaN(codigo) || codigo <= 0) {
    toastNotifier?.('Nº do Contrato inválido. Digite um número positivo.', 'warning');
    return;
  }

  try {
    await storage.addContratoManual({
      codigo,
      aluno,
      status_contrato: status,
      data_vencimento: vencimento,
      forma_pagamento: formaPagamentoStr,
      consultor,
      qtd_parcelas: qtdParcelas,
      valor_parcela: valorParcela
    });

    closeModal('modalNovoAluno');
    toastNotifier?.(`Contrato ${codigo} cadastrado com sucesso!`, 'success');

    if (typeof onDataChangedCallback === 'function') {
      onDataChangedCallback();
    }
  } catch (err) {
    toastNotifier?.(err.message || 'Erro ao adicionar aluno', 'error');
  }
}

/**
 * Abre o modal de confirmação de exclusão
 */
export function openDeleteConfirmModal(codigo, nomeAluno) {
  currentDeleteCodigo = codigo;
  const msgEl = document.getElementById('deleteModalDescricao');
  if (msgEl) {
    msgEl.innerHTML = `Tem certeza que deseja excluir o contrato <strong>${codigo} - ${nomeAluno}</strong>? Esta ação removerá o aluno da listagem permanente.`;
  }
  openModal('modalConfirmDelete');
}

/**
 * Handler de exclusão confirmada
 */
async function handleConfirmDelete() {
  if (!currentDeleteCodigo) return;

  try {
    await storage.deleteContrato(currentDeleteCodigo);
    toastNotifier?.(`Contrato ${currentDeleteCodigo} excluído com sucesso.`, 'info');
    closeModal('modalConfirmDelete');
    currentDeleteCodigo = null;

    if (typeof onDataChangedCallback === 'function') {
      onDataChangedCallback();
    }
  } catch (err) {
    toastNotifier?.(err.message || 'Erro ao excluir contrato', 'error');
  }
}

/**
 * Atualiza e abre o modal de configurações
 */
export function openSettingsModal() {
  const status = storage.getSyncStatus();
  
  const statusBadge = document.getElementById('settingsSyncBadge');
  const lastSyncTime = document.getElementById('settingsLastSyncTime');
  const totalCount = document.getElementById('settingsTotalCount');

  if (statusBadge) {
    if (status.isConnected) {
      statusBadge.className = 'status-pill status-pill-online';
      statusBadge.innerHTML = '<span class="status-dot"></span> Nuvem Supabase Ativa';
    } else {
      statusBadge.className = 'status-pill status-pill-offline';
      statusBadge.innerHTML = '<span class="status-dot"></span> Modo Local (LocalStorage)';
    }
  }

  if (lastSyncTime) {
    lastSyncTime.textContent = status.lastSync ? `Última sincronização: ${status.lastSync}` : 'Nenhuma sincronização recente';
  }

  if (totalCount) {
    totalCount.textContent = `${status.totalRecords} contratos salvos`;
  }

  openModal('modalConfiguracoes');
}

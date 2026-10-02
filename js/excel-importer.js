/**
 * IMPORTADOR DE PLANILHAS EXCEL (SHEETJS)
 * 
 * Processa o arquivo 'Relatório Controle Financeiro.xlsx', realiza
 * o mapeamento inteligente das colunas e aciona o Upsert Inteligente
 * garantindo que vencimentos já preenchidos nunca sejam perdidos.
 */

import { storage } from './storage.js';

/**
 * Normaliza uma chave de cabeçalho para comparação flexível
 */
function normalizeHeader(key) {
  if (!key) return '';
  return String(key)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Converte valor numérico em float seguro, tratando formatação brasileira (R$, vírgulas)
 */
function parseSafeNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;

  const str = String(val)
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '') // remove separador de milhar
    .replace(',', '.'); // substitui vírgula decimal

  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Lê um arquivo File (Blob) como ArrayBuffer
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Erro ao ler arquivo: ' + (e.target.error?.message || 'Falha na leitura')));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Analisa a pasta de trabalho SheetJS e extrai os dados mapeados
 */
export async function parseExcelData(fileOrBuffer) {
  if (!window.XLSX) {
    throw new Error('Biblioteca SheetJS (XLSX) não encontrada. Verifique sua conexão com a internet.');
  }

  let buffer;
  if (fileOrBuffer instanceof ArrayBuffer) {
    buffer = fileOrBuffer;
  } else if (fileOrBuffer instanceof Blob || fileOrBuffer instanceof File) {
    buffer = await readFileAsArrayBuffer(fileOrBuffer);
  } else {
    throw new Error('Formato de arquivo inválido para leitura.');
  }

  const workbook = window.XLSX.read(buffer, { type: 'array' });
  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('A planilha está vazia ou corrompida.');
  }

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = window.XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('Nenhuma linha de dados encontrada na primeira aba da planilha.');
  }

  // Identifica as colunas através dos cabeçalhos da primeira linha
  const firstRow = rawRows[0];
  const headerMap = {};

  for (const rawCol of Object.keys(firstRow)) {
    const norm = normalizeHeader(rawCol);

    if (norm === 'codigo' || norm === 'cod' || norm.startsWith('codigodoaluno') || norm.startsWith('codigocontrato')) {
      headerMap.codigo = rawCol;
    } else if (norm === 'aluno' || norm === 'nome' || norm === 'nomedoaluno') {
      headerMap.aluno = rawCol;
    } else if (norm === 'statuscontrato' || norm === 'status') {
      headerMap.status_contrato = rawCol;
    } else if (norm.includes('formapagamentoparcela') || norm.includes('formapagamento') || norm.includes('modalidade')) {
      headerMap.forma_pagamento = rawCol;
    } else if (norm.includes('colaboradorconsultor') || norm === 'consultor') {
      headerMap.consultor = rawCol;
    } else if (norm.includes('quantidadeparcelas') || norm === 'parcelas' || norm === 'qtdparcelas') {
      headerMap.qtd_parcelas = rawCol;
    } else if (norm.includes('valorparcelaliquido') || norm.includes('valorparcela')) {
      headerMap.valor_parcela = rawCol;
    } else if (norm.includes('valorpagototal') || norm.includes('valorpago')) {
      headerMap.valor_pago_total = rawCol;
    } else if (norm.includes('datavencimento') || norm.includes('vencimento') || norm.includes('diavencimento')) {
      headerMap.data_vencimento = rawCol;
    }
  }

  if (!headerMap.codigo || !headerMap.aluno) {
    throw new Error('A planilha deve conter pelo menos as colunas "Código" e "Aluno".');
  }

  const parsedContracts = [];

  for (const row of rawRows) {
    const rawCod = row[headerMap.codigo];
    if (rawCod === undefined || rawCod === null || String(rawCod).trim() === '') {
      continue;
    }

    const codNumber = parseInt(String(rawCod).replace(/\D/g, ''), 10);
    if (!codNumber || isNaN(codNumber)) {
      continue;
    }

    const aluno = String(row[headerMap.aluno] || '').trim();
    if (!aluno) continue;

    const alunoNormalizado = aluno
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const status = headerMap.status_contrato ? String(row[headerMap.status_contrato] || 'Ativo').trim() : 'Ativo';
    const formaPagamento = headerMap.forma_pagamento ? String(row[headerMap.forma_pagamento] || '').trim() : '';
    const consultor = headerMap.consultor ? String(row[headerMap.consultor] || '').trim() : '';
    const qtdParcelas = headerMap.qtd_parcelas ? parseInt(row[headerMap.qtd_parcelas], 10) || null : null;
    const valorParcela = headerMap.valor_parcela ? parseSafeNumber(row[headerMap.valor_parcela]) : null;
    const valorPagoTotal = headerMap.valor_pago_total ? parseSafeNumber(row[headerMap.valor_pago_total]) : 0;
    
    // Se a planilha possuir uma coluna de vencimento preenchida, respeita
    const dataVencimento = headerMap.data_vencimento ? String(row[headerMap.data_vencimento] || '').trim() : null;

    parsedContracts.push({
      codigo: codNumber,
      aluno,
      aluno_normalizado: alunoNormalizado,
      status_contrato: status || 'Ativo',
      forma_pagamento: formaPagamento || 'Sem registro',
      data_vencimento: dataVencimento || null,
      consultor,
      qtd_parcelas: qtdParcelas,
      valor_parcela: valorParcela,
      valor_pago_total: valorPagoTotal
    });
  }

  return parsedContracts;
}

/**
 * Importa o arquivo Excel e executa a mesclagem inteligente com o banco de dados
 */
export async function importExcelFile(file) {
  const contracts = await parseExcelData(file);
  const result = await storage.upsertContratos(contracts);
  return {
    ...result,
    filename: file.name
  };
}

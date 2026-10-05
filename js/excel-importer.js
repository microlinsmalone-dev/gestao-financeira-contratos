/**
 * IMPORTADOR DE PLANILHAS EXCEL (SHEETJS)
 * 
 * Suporta o processamento independente ou simultâneo de:
 * 1. Planilha de Contrato Financeiro (.xlsx) -> dados cadastrais, modalidades e valores
 * 2. Recebimentos de Contratos (.xlsx) -> parcelas restantes exatas, atrasos e contatos
 * 
 * Realiza o mapeamento inteligente de colunas e mesclagem segura (Anti-Sobrescrita).
 */

import { storage } from './storage.js';

/**
 * Normaliza uma chave de cabeçalho para comparação flexível
 */
export function normalizeHeader(key) {
  if (!key) return '';
  return String(key)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/cdigo/g, 'codigo');
}

/**
 * Converte valor numérico em float seguro, tratando formatação brasileira (R$, vírgulas)
 */
export function parseSafeNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;

  let str = String(val)
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .trim();

  if (!str) return null;

  if (str.includes('.') && str.includes(',')) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Converte data serial do Excel (ex: 47031) ou string para formato legível (DD/MM/YYYY)
 */
export function formatExcelDate(val) {
  if (!val) return null;
  if (typeof val === 'number' || (!isNaN(Number(val)) && Number(val) > 30000 && Number(val) < 60000)) {
    const num = Number(val);
    const date = new Date((num - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const year = date.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }
  }
  return String(val).trim();
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
 * Lê uma pasta de trabalho SheetJS
 */
async function getWorkbookAndRows(fileOrBuffer) {
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

  return { workbook, rawRows };
}

/**
 * Converte qualquer representação de data para timestamp milissegundos
 */
export function parseDateToTimestamp(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.getTime();
  if (typeof val === 'number') {
    if (val > 30000 && val < 60000) {
      return (val - 25569) * 86400 * 1000;
    }
    return val;
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.substring(0, 10) + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
    const parts = str.split('/');
    const d = new Date(`${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

/**
 * Identifica o tipo da planilha a partir dos cabeçalhos
 */
export function detectSpreadsheetType(rawRows) {
  if (!rawRows || rawRows.length === 0) return 'desconhecido';
  const firstRow = rawRows[0];
  const keys = Object.keys(firstRow).map(k => normalizeHeader(k));

  // 1. Planilha de Baixa de Recebimentos (contém exclusivamente as colunas 'usuariobaixa', 'tiporeceb' e 'lancamento')
  const hasBaixaExclusive = keys.some(k => k.includes('usuariobaixa') || k.includes('tiporeceb') || k.includes('lancamento'));
  if (hasBaixaExclusive) {
    return 'baixa_recebimentos';
  }

  // 2. Planilha de Recebimentos de Contratos (contém parcelas restantes, parcelas atrasadas)
  const hasRecebRestantes = keys.some(k => k.includes('recebrestantes') || k.includes('parcelasrestantes'));
  const hasRecebAtrasadas = keys.some(k => k.includes('recebparcelasatrasadas') || k.includes('recebatrasados'));
  if (hasRecebRestantes || hasRecebAtrasadas) {
    return 'recebimentos';
  }

  // 3. Planilha de Contrato Financeiro
  const hasFormaPagamento = keys.some(k => k.includes('formapagamento') || k.includes('formapagamentoparcela'));
  const hasCodigoOrAluno = keys.some(k => k === 'codigo' || k === 'contrato') && keys.some(k => k === 'aluno' || k === 'nome');
  if (hasFormaPagamento || hasCodigoOrAluno) {
    return 'contrato';
  }

  return 'desconhecido';
}

/**
 * Processa a 'Planilha de Contrato Financeiro'
 */
export function parseContratoFinanceiroRows(rawRows) {
  const firstRow = rawRows[0];
  const headerMap = {};

  for (const rawCol of Object.keys(firstRow)) {
    const norm = normalizeHeader(rawCol);

    if (norm === 'codigo' || norm === 'cod' || norm.startsWith('codigodoaluno') || norm.startsWith('codigocontrato') || norm.includes('numcontrato') || norm.includes('ncontrato')) {
      headerMap.codigo = rawCol;
    } else if (!headerMap.codigo && (norm === 'contrato' || norm === 'numero') && firstRow[rawCol] && /^\d+$/.test(String(firstRow[rawCol]).trim())) {
      headerMap.codigo = rawCol;
    } else if (norm === 'aluno' || norm === 'nome' || norm === 'nomedoaluno') {
      headerMap.aluno = rawCol;
    } else if (norm === 'statuscontrato' || norm === 'status' || norm.startsWith('statuscontrato') || norm.includes('descricaostatus')) {
      headerMap.status_contrato = rawCol;
    } else if (norm.includes('formapagamentoparcela') || norm.includes('formapagamento') || norm.includes('modalidade')) {
      headerMap.forma_pagamento = rawCol;
    } else if (norm.includes('colaboradorconsultor') || norm === 'consultor' || norm.includes('consultorvenda')) {
      headerMap.consultor = rawCol;
    } else if (norm.includes('quantidadeparcelas') || norm === 'parcelas' || norm === 'qtdparcelas') {
      headerMap.qtd_parcelas = rawCol;
    } else if (norm === 'valorparcelaliquido' || norm === 'valorparcela' || (norm.includes('valorparcela') && !norm.includes('desconto') && !norm.includes('pago') && !norm.includes('bruto'))) {
      headerMap.valor_parcela = rawCol;
    } else if (norm === 'valorparcelapago' || (norm.includes('valorparcela') && norm.includes('pago'))) {
      headerMap.valor_parcela_pago = rawCol;
    } else if (norm === 'valorpagototal' || norm === 'valorpago' || (norm.includes('valorpago') && !norm.includes('material') && !norm.includes('matricula') && !norm.includes('outros'))) {
      headerMap.valor_pago_total = rawCol;
    } else if (norm.includes('datavencimento') || norm.includes('vencimento') || norm.includes('diavencimento')) {
      headerMap.data_vencimento = rawCol;
    }
  }

  if (!headerMap.codigo || !headerMap.aluno) {
    throw new Error('A Planilha de Contrato Financeiro deve conter pelo menos as colunas "Nº Contrato / Código" e "Aluno".');
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
    
    // Regra acordada: trabalhar exclusivamente com contratos Ativos
    const isAtivo = status.toLowerCase().includes('ativo') && !status.toLowerCase().includes('inativo');
    if (!isAtivo) {
      continue; // Pula inativos/desistentes
    }

    const formaPagamento = headerMap.forma_pagamento ? String(row[headerMap.forma_pagamento] || '').trim() : '';
    const consultor = headerMap.consultor ? String(row[headerMap.consultor] || '').trim() : '';
    const qtdParcelas = headerMap.qtd_parcelas ? parseInt(row[headerMap.qtd_parcelas], 10) || null : null;
    const valorParcela = headerMap.valor_parcela ? parseSafeNumber(row[headerMap.valor_parcela]) : null;
    const valorParcelaPago = headerMap.valor_parcela_pago ? parseSafeNumber(row[headerMap.valor_parcela_pago]) : null;
    const valorPagoTotal = headerMap.valor_pago_total ? parseSafeNumber(row[headerMap.valor_pago_total]) : 0;
    const dataVencimento = headerMap.data_vencimento ? String(row[headerMap.data_vencimento] || '').trim() : null;

    // Cálculo preliminar de parcelas restantes caso a planilha de recebimentos ainda não tenha sido subida
    let parcelasRestantesEstimadas = null;
    if (qtdParcelas && valorParcela && valorParcela > 0) {
      const unit = valorParcela / qtdParcelas;
      const pago = valorParcelaPago !== null ? valorParcelaPago : valorPagoTotal;
      if (unit > 0) {
        const pagas = Math.round(pago / unit);
        parcelasRestantesEstimadas = Math.max(0, qtdParcelas - pagas);
      }
    }

    parsedContracts.push({
      codigo: codNumber,
      aluno,
      aluno_normalizado: alunoNormalizado,
      status_contrato: 'Ativo',
      forma_pagamento: formaPagamento || 'Sem registro',
      data_vencimento: dataVencimento || null,
      consultor,
      qtd_parcelas: qtdParcelas,
      valor_parcela: valorParcela,
      valor_pago_total: valorPagoTotal,
      parcelas_restantes: parcelasRestantesEstimadas,
      parcelas_atrasadas: 0
    });
  }

  return parsedContracts;
}

/**
 * Processa a planilha 'Recebimentos de Contratos'
 */
export function parseRecebimentosRows(rawRows) {
  const firstRow = rawRows[0];
  const headerMap = {};

  for (const rawCol of Object.keys(firstRow)) {
    const norm = normalizeHeader(rawCol);

    if (norm === 'contrato' || norm === 'codigo' || norm === 'cod') {
      headerMap.codigo = rawCol;
    } else if (norm === 'aluno' || norm === 'nome' || norm === 'nomedoaluno') {
      headerMap.aluno = rawCol;
    } else if (norm.includes('descricaostatus') || norm === 'statuscontrato' || norm === 'status') {
      headerMap.status_contrato = rawCol;
    } else if (norm.includes('recebrestantes') || norm.includes('parcelasrestantes')) {
      headerMap.receb_restantes = rawCol;
    } else if (norm.includes('recebparcelasatrasadas') || norm.includes('parcelasatrasadas')) {
      headerMap.receb_atrasadas = rawCol;
    } else if (norm.includes('recebatrasados')) {
      headerMap.receb_atrasados_total = rawCol;
    } else if (norm.includes('recebparcelaspagas') || norm.includes('parcelaspagas')) {
      headerMap.receb_pagas = rawCol;
    } else if (norm === 'recebpagos' || norm.includes('recebpagos')) {
      headerMap.receb_pagos = rawCol;
    } else if (norm.includes('recebcancelados')) {
      headerMap.receb_cancelados = rawCol;
    } else if (norm.includes('totalreceb')) {
      headerMap.total_receb = rawCol;
    } else if (norm.includes('ultimadatavencimento') || norm.includes('ultimovencimento')) {
      headerMap.ultima_data_vencimento = rawCol;
    } else if (norm === 'telcel' || norm.includes('celular') || norm.includes('telefonecelular')) {
      headerMap.tel_cel = rawCol;
    } else if (norm.includes('telefoneresidencial') || norm === 'telres') {
      headerMap.tel_res = rawCol;
    } else if (norm.includes('respfin') || norm.includes('responsavelfinanceiro')) {
      headerMap.resp_fin = rawCol;
    } else if (norm.includes('consultorvenda') || norm.includes('geradormatricula')) {
      headerMap.consultor = rawCol;
    }
  }

  if (!headerMap.codigo) {
    throw new Error('A planilha de Recebimentos deve conter a coluna "Contrato".');
  }

  const parsedRecebimentos = [];

  for (const row of rawRows) {
    const rawCod = row[headerMap.codigo];
    if (rawCod === undefined || rawCod === null || String(rawCod).trim() === '') {
      continue;
    }

    const codNumber = parseInt(String(rawCod).replace(/\D/g, ''), 10);
    if (!codNumber || isNaN(codNumber)) {
      continue;
    }

    const aluno = headerMap.aluno ? String(row[headerMap.aluno] || '').trim() : '';

    // Filtrar inativos se houver coluna de status
    const status = headerMap.status_contrato ? String(row[headerMap.status_contrato] || 'Ativo').trim() : 'Ativo';
    const isAtivo = status.toLowerCase().includes('ativo') && !status.toLowerCase().includes('inativo');
    if (!isAtivo) {
      continue;
    }

    const restantesRaw = headerMap.receb_restantes ? row[headerMap.receb_restantes] : 0;
    const atrasadasRaw = headerMap.receb_atrasadas ? row[headerMap.receb_atrasadas] : 0;
    const atrasadosTotRaw = headerMap.receb_atrasados_total ? row[headerMap.receb_atrasados_total] : 0;
    const pagasRaw = headerMap.receb_pagas ? row[headerMap.receb_pagas] : 0;
    const pagasTotRaw = headerMap.receb_pagos ? row[headerMap.receb_pagos] : 0;

    const parcelasRestantes = parseInt(restantesRaw, 10) || 0;
    const parcelasAtrasadas = Math.max(parseInt(atrasadasRaw, 10) || 0, parseInt(atrasadosTotRaw, 10) || 0);
    const parcelasPagas = Math.max(parseInt(pagasRaw, 10) || 0, parseInt(pagasTotRaw, 10) || 0);

    const ultimaVencimentoRaw = headerMap.ultima_data_vencimento ? row[headerMap.ultima_data_vencimento] : null;
    const ultimaVencimentoFmt = formatExcelDate(ultimaVencimentoRaw);

    const telCel = headerMap.tel_cel ? String(row[headerMap.tel_cel] || '').trim() : '';
    const telRes = headerMap.tel_res ? String(row[headerMap.tel_res] || '').trim() : '';
    const respFin = headerMap.resp_fin ? String(row[headerMap.resp_fin] || '').trim() : '';
    const consultor = headerMap.consultor ? String(row[headerMap.consultor] || '').trim() : '';

    parsedRecebimentos.push({
      codigo: codNumber,
      aluno,
      status_contrato: 'Ativo',
      parcelas_restantes: parcelasRestantes,
      parcelas_atrasadas: parcelasAtrasadas,
      parcelas_pagas: parcelasPagas,
      ultima_data_vencimento: ultimaVencimentoFmt,
      telefone_celular: telCel,
      telefone_residencial: telRes,
      resp_financeiro: respFin,
      consultor
    });
  }

  return parsedRecebimentos;
}

/**
 * Processa a planilha 'Baixa de Recebimentos' (extrato transacional detalhado)
 * Detecta deterministamente pagamentos de Cartão em Lote (6x+) vs Cartão Mês a Mês.
 */
export function parseBaixaRecebimentosRows(rawRows) {
  if (!rawRows || rawRows.length === 0) return [];
  const firstRow = rawRows[0];
  const headerMap = {};

  for (const rawCol of Object.keys(firstRow)) {
    const norm = normalizeHeader(rawCol);

    if (norm === 'contrato' || norm === 'codigo' || norm === 'cod') {
      headerMap.codigo = rawCol;
    } else if (norm === 'aluno' || norm === 'nome' || norm === 'nomedoaluno') {
      headerMap.aluno = rawCol;
    } else if (norm === 'statuscontrato' || norm === 'status' || norm.includes('descricaostatus')) {
      headerMap.status_contrato = rawCol;
    } else if (norm.includes('tiporeceb') || norm === 'tipo') {
      headerMap.tipo_receb = rawCol;
    } else if (norm.includes('formapag') || norm === 'forma' || norm.includes('formapagamento')) {
      headerMap.forma_pag = rawCol;
    } else if (norm === 'ordem') {
      headerMap.ordem = rawCol;
    } else if (norm === 'valor') {
      headerMap.valor = rawCol;
    } else if (norm === 'valorpago' || norm === 'pago') {
      headerMap.valor_pago = rawCol;
    } else if (norm.includes('vencimento')) {
      headerMap.vencimento = rawCol;
    } else if (norm.includes('pagamento')) {
      headerMap.pagamento = rawCol;
    } else if (norm.includes('lancamento')) {
      headerMap.lancamento = rawCol;
    } else if (norm.includes('consultorvenda') || norm.includes('consultor')) {
      headerMap.consultor = rawCol;
    } else if (norm.includes('usuariobaixa')) {
      headerMap.usuario_baixa = rawCol;
    }
  }

  if (!headerMap.codigo) {
    throw new Error('A planilha de Baixa de Recebimentos deve conter a coluna "Contrato".');
  }

  // Agrupa todas as linhas por contrato
  const contractRowsMap = new Map();

  for (const row of rawRows) {
    const rawCod = row[headerMap.codigo];
    if (rawCod === undefined || rawCod === null || String(rawCod).trim() === '') continue;

    const codNumber = parseInt(String(rawCod).replace(/\D/g, ''), 10);
    if (!codNumber || isNaN(codNumber)) continue;

    const status = headerMap.status_contrato ? String(row[headerMap.status_contrato] || 'Ativo').trim() : 'Ativo';
    const isAtivo = status.toLowerCase().includes('ativo') && !status.toLowerCase().includes('inativo');
    if (!isAtivo) continue;

    if (!contractRowsMap.has(codNumber)) {
      contractRowsMap.set(codNumber, []);
    }
    contractRowsMap.get(codNumber).push(row);
  }

  const parsedBaixaContracts = [];

  for (const [codNumber, rows] of contractRowsMap.entries()) {
    const aluno = headerMap.aluno ? String(rows[0][headerMap.aluno] || '').trim() : '';

    // Estima a mensalidade típica de parcela (mínimo positivo > 50)
    const parcelaValues = [];
    for (const r of rows) {
      const tipo = headerMap.tipo_receb ? String(r[headerMap.tipo_receb] || '').toLowerCase() : '';
      if (tipo.includes('parcela')) {
        const v = parseSafeNumber(r[headerMap.valor]);
        if (v && v > 50) parcelaValues.push(v);
      }
    }
    parcelaValues.sort((a, b) => a - b);
    const baseParcela = parcelaValues.length > 0 ? parcelaValues[0] : 200.0;

    // Analisa pagamentos realizados
    const paidRows = [];
    const unpaidRows = [];
    const cardByDay = new Map();
    let totalPagoAcumulado = 0;
    const totalsByForma = {};

    for (const r of rows) {
      const vp = parseSafeNumber(r[headerMap.valor_pago]);
      const isPaid = vp !== null && vp > 0;
      const forma = headerMap.forma_pag ? String(r[headerMap.forma_pag] || '').trim() : 'Outro';

      if (isPaid) {
        paidRows.push(r);
        totalPagoAcumulado += vp;
        totalsByForma[forma] = (totalsByForma[forma] || 0) + vp;

        const isCard = forma.toLowerCase().includes('cart') || forma.toLowerCase().includes('credito') || forma.toLowerCase().includes('debito');
        if (isCard) {
          const dtRaw = r[headerMap.pagamento] || r[headerMap.lancamento] || '';
          const dtKey = formatExcelDate(dtRaw) || 'Data não informada';
          if (!cardByDay.has(dtKey)) {
            cardByDay.set(dtKey, []);
          }
          cardByDay.get(dtKey).push({
            valor: vp,
            ordem: r[headerMap.ordem],
            tipo: r[headerMap.tipo_receb]
          });
        }
      } else {
        unpaidRows.push(r);
      }
    }

    // Identificação de Pagamentos em Lote no Cartão (>= 6x parcelas ou >= R$ 1.000 no mesmo dia)
    const pagamentosLote = [];
    for (const [dtKey, items] of cardByDay.entries()) {
      const totDay = items.reduce((acc, it) => acc + it.valor, 0);
      const equiv = baseParcela > 0 ? totDay / baseParcela : items.length;

      if (totDay >= 1000.0 || equiv >= 5.5 || items.length >= 6) {
        pagamentosLote.push({
          data: dtKey,
          valor: totDay,
          equiv_parcelas: Math.round(equiv * 10) / 10,
          qtd_linhas: items.length
        });
      }
    }

    // Classificação determinística de perfil real
    let perfilPagamento = 'SEM_BAIXAS';
    let loteDestaque = null;

    if (pagamentosLote.length > 0) {
      perfilPagamento = 'CARTAO_LOTE';
      // Pega o lote mais recente / de maior valor
      pagamentosLote.sort((a, b) => b.valor - a.valor);
      loteDestaque = {
        data: pagamentosLote[0].data,
        valor: pagamentosLote[0].valor,
        equiv_parcelas: pagamentosLote[0].equiv_parcelas,
        total_lotes: pagamentosLote.length
      };
    } else if (cardByDay.size > 0) {
      perfilPagamento = 'CARTAO_MENSAL';
    } else if (Object.keys(totalsByForma).length > 0) {
      // Determina forma predominante
      const topMethod = Object.entries(totalsByForma).sort((a, b) => b[1] - a[1])[0][0].toLowerCase();
      if (topMethod.includes('boleto')) perfilPagamento = 'BOLETO';
      else if (topMethod.includes('pix')) perfilPagamento = 'PIX';
      else if (topMethod.includes('dinheiro')) perfilPagamento = 'DINHEIRO';
      else if (topMethod.includes('deposito')) perfilPagamento = 'DEPOSITO';
      else perfilPagamento = 'OUTROS';
    }

    // Próximo vencimento real (a menor data entre parcelas em aberto)
    let proximoVencimentoReal = null;
    let proximoVencTimestamp = Infinity;

    for (const r of unpaidRows) {
      const vRaw = r[headerMap.vencimento];
      const ts = parseDateToTimestamp(vRaw);
      if (ts && ts < proximoVencTimestamp) {
        proximoVencTimestamp = ts;
        proximoVencimentoReal = formatExcelDate(vRaw);
      }
    }

    // Compila histórico das transações (ordenado, até 40 registros)
    const historicoBaixas = rows.map(r => ({
      ordem: r[headerMap.ordem] ? String(r[headerMap.ordem]).trim() : '-',
      tipo: r[headerMap.tipo_receb] ? String(r[headerMap.tipo_receb]).trim() : 'Parcela',
      forma: r[headerMap.forma_pag] ? String(r[headerMap.forma_pag]).trim() : '-',
      valor: parseSafeNumber(r[headerMap.valor]) || 0,
      valor_pago: parseSafeNumber(r[headerMap.valor_pago]) || null,
      vencimento: formatExcelDate(r[headerMap.vencimento]),
      pagamento: formatExcelDate(r[headerMap.pagamento]),
      usuario_baixa: r[headerMap.usuario_baixa] ? String(r[headerMap.usuario_baixa]).trim() : ''
    })).slice(0, 40);

    parsedBaixaContracts.push({
      codigo: codNumber,
      aluno,
      status_contrato: 'Ativo',
      perfil_pagamento: perfilPagamento,
      pagamento_lote_cartao: loteDestaque,
      lapada_cartao: loteDestaque,
      proximo_vencimento_real: proximoVencimentoReal,
      total_pago_acumulado: Math.round(totalPagoAcumulado * 100) / 100,
      qtd_parcelas_pagas: paidRows.length,
      qtd_parcelas_abertas: unpaidRows.length,
      historico_baixas: historicoBaixas
    });
  }

  return parsedBaixaContracts;
}

/**
 * Analisa e processa qualquer um dos relatórios do Excel de forma inteligente
 */
export async function parseExcelData(fileOrBuffer) {
  const { rawRows } = await getWorkbookAndRows(fileOrBuffer);
  const type = detectSpreadsheetType(rawRows);

  if (type === 'baixa_recebimentos') {
    return {
      type: 'baixa_recebimentos',
      data: parseBaixaRecebimentosRows(rawRows)
    };
  }

  if (type === 'recebimentos') {
    return {
      type: 'recebimentos',
      data: parseRecebimentosRows(rawRows)
    };
  }

  // Padrão ou tipo 'contrato'
  return {
    type: 'contrato',
    data: parseContratoFinanceiroRows(rawRows)
  };
}

/**
 * Importa o arquivo da Planilha de Contrato Financeiro
 */
export async function importContratoFile(file) {
  const { rawRows } = await getWorkbookAndRows(file);
  const type = detectSpreadsheetType(rawRows);

  if (type === 'baixa_recebimentos') {
    const baixaData = parseBaixaRecebimentosRows(rawRows);
    const result = await storage.mergeBaixaRecebimentos(baixaData);
    return { ...result, type: 'baixa_recebimentos', filename: file.name };
  }

  if (type === 'recebimentos') {
    const recebData = parseRecebimentosRows(rawRows);
    const result = await storage.mergeRecebimentos(recebData);
    return { ...result, type: 'recebimentos', filename: file.name };
  }

  const contracts = parseContratoFinanceiroRows(rawRows);
  const result = await storage.upsertContratos(contracts);
  return { ...result, type: 'contrato', filename: file.name };
}

/**
 * Importa o arquivo da planilha Recebimentos de Contratos
 */
export async function importRecebimentosFile(file) {
  const { rawRows } = await getWorkbookAndRows(file);
  const type = detectSpreadsheetType(rawRows);

  if (type === 'baixa_recebimentos') {
    const baixaData = parseBaixaRecebimentosRows(rawRows);
    const result = await storage.mergeBaixaRecebimentos(baixaData);
    return { ...result, type: 'baixa_recebimentos', filename: file.name };
  }

  if (type === 'contrato') {
    const contracts = parseContratoFinanceiroRows(rawRows);
    const result = await storage.upsertContratos(contracts);
    return { ...result, type: 'contrato', filename: file.name };
  }

  const recebData = parseRecebimentosRows(rawRows);
  const result = await storage.mergeRecebimentos(recebData);
  return { ...result, type: 'recebimentos', filename: file.name };
}

/**
 * Importa o arquivo da planilha Baixa de Recebimentos
 */
export async function importBaixaRecebimentosFile(file) {
  const { rawRows } = await getWorkbookAndRows(file);
  const type = detectSpreadsheetType(rawRows);

  if (type === 'contrato') {
    const contracts = parseContratoFinanceiroRows(rawRows);
    const result = await storage.upsertContratos(contracts);
    return { ...result, type: 'contrato', filename: file.name };
  }

  if (type === 'recebimentos') {
    const recebData = parseRecebimentosRows(rawRows);
    const result = await storage.mergeRecebimentos(recebData);
    return { ...result, type: 'recebimentos', filename: file.name };
  }

  const baixaData = parseBaixaRecebimentosRows(rawRows);
  const result = await storage.mergeBaixaRecebimentos(baixaData);
  return {
    ...result,
    type: 'baixa_recebimentos',
    filename: file.name
  };
}

/**
 * Importa arquivo genérico (compatibilidade retroativa)
 */
export async function importExcelFile(file) {
  const parsed = await parseExcelData(file);
  if (parsed.type === 'baixa_recebimentos') {
    const result = await storage.mergeBaixaRecebimentos(parsed.data);
    return { ...result, type: 'baixa_recebimentos', filename: file.name };
  } else if (parsed.type === 'recebimentos') {
    const result = await storage.mergeRecebimentos(parsed.data);
    return { ...result, type: 'recebimentos', filename: file.name };
  } else {
    const result = await storage.upsertContratos(parsed.data);
    return { ...result, type: 'contrato', filename: file.name };
  }
}

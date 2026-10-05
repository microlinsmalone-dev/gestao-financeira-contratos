/**
 * GERADOR DE BADGES VISUAIS PARA FORMAS DE PAGAMENTO
 * 
 * Converte strings de formas de pagamento (ex: "Boleto, Dinheiro, PIX")
 * em badges estilizados com cores e ícones SVG vetorizados, seguindo
 * o Design System da Microlins Potirendaba.
 */

// Ícones SVG vetorizados inline (sem dependência de fontes externas)
const ICONS = {
  pix: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7.5 7.5L12 3l4.5 4.5M16.5 16.5L12 21l-4.5-4.5M3 12l4.5-4.5L12 12l-4.5 4.5L3 12zm18 0l-4.5-4.5L12 12l4.5 4.5L21 12z"/>
    </svg>`,
  
  boleto: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14"/>
    </svg>`,

  credito: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
      <rect x="5" y="13" width="4" height="3" rx="0.5" fill="currentColor"/>
    </svg>`,

  debito: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
      <path d="M6 14h3M15 14h3"/>
    </svg>`,

  dinheiro: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M6 12h.01M18 12h.01"/>
    </svg>`,

  carne: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <path d="M9 4v16" stroke-dasharray="2 2"/>
      <circle cx="6" cy="12" r="1.5" fill="currentColor"/>
    </svg>`,

  deposito: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3l9 7H3l9-7z"/>
    </svg>`,

  cheque: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <path d="M6 10h4M6 14h12M14 10l2 2 4-4"/>
    </svg>`,

  semRegistro: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>
    </svg>`,

  padrao: `
    <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 8v8M8 12h8"/>
    </svg>`
};

/**
 * Normaliza o nome da forma de pagamento removendo acentos e espaços extras
 */
export function normalizeMethodKey(method) {
  if (!method) return '';
  return method
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Mapeia o nome bruto da modalidade para configuração visual de badge
 */
export function getBadgeConfig(rawMethod) {
  const norm = normalizeMethodKey(rawMethod);

  if (!norm || norm === 'sem registro' || norm === 'sem forma' || norm === 'nenhum' || norm === 'nao informado') {
    return {
      key: 'sem-registro',
      label: 'Sem registro',
      className: 'badge-sem-registro',
      iconSvg: ICONS.semRegistro,
      title: 'Contrato sem forma de pagamento registrada'
    };
  }

  if (norm.includes('pix')) {
    const isQr = norm.includes('qr');
    return {
      key: isQr ? 'pix-qr' : 'pix',
      label: isQr ? 'PIX QR Code' : 'PIX',
      className: 'badge-pix',
      iconSvg: ICONS.pix,
      title: isQr ? 'Pagamento via PIX QR Code' : 'Pagamento via PIX instantâneo'
    };
  }

  if (norm.includes('boleto')) {
    return {
      key: 'boleto',
      label: 'Boleto',
      className: 'badge-boleto',
      iconSvg: ICONS.boleto,
      title: 'Boleto Bancário'
    };
  }

  if (norm.includes('credito') || norm.includes('credit')) {
    return {
      key: 'cartao-credito',
      label: 'Cartão de Crédito',
      className: 'badge-cartao-credito',
      iconSvg: ICONS.credito,
      title: 'Cartão de Crédito'
    };
  }

  if (norm.includes('debito') || norm.includes('debit')) {
    return {
      key: 'cartao-debito',
      label: 'Cartão de Débito',
      className: 'badge-cartao-debito',
      iconSvg: ICONS.debito,
      title: 'Cartão de Débito'
    };
  }

  if (norm.includes('dinheiro') || norm.includes('especie')) {
    return {
      key: 'dinheiro',
      label: 'Dinheiro',
      className: 'badge-dinheiro',
      iconSvg: ICONS.dinheiro,
      title: 'Pagamento em Dinheiro / Espécie'
    };
  }

  if (norm.includes('carne')) {
    return {
      key: 'carne',
      label: 'Carnê',
      className: 'badge-carne',
      iconSvg: ICONS.carne,
      title: 'Carnê Escolar'
    };
  }

  if (norm.includes('deposito')) {
    return {
      key: 'deposito',
      label: 'Depósito Bancário',
      className: 'badge-deposito',
      iconSvg: ICONS.deposito,
      title: 'Depósito / Transferência Bancária'
    };
  }

  if (norm.includes('cheque')) {
    return {
      key: 'cheque',
      label: 'Cheque',
      className: 'badge-cheque',
      iconSvg: ICONS.cheque,
      title: 'Cheque'
    };
  }

  // Fallback para modalidades personalizadas
  return {
    key: 'outro',
    label: rawMethod.trim(),
    className: 'badge-outro',
    iconSvg: ICONS.padrao,
    title: rawMethod.trim()
  };
}

/**
 * Renderiza o HTML de um único badge
 */
export function renderSingleBadge(method) {
  const config = getBadgeConfig(method);
  return `
    <span class="payment-badge ${config.className}" title="${config.title}" data-method="${config.key}">
      ${config.iconSvg}
      <span class="badge-text">${config.label}</span>
    </span>
  `;
}

/**
 * Converte uma string ou objeto de contrato com formas de pagamento
 * em um container HTML com badges individuais e indicadores de Cartão em Lote.
 * 
 * Exemplo de entrada: "Boleto, Dinheiro, PIX" ou objeto contrato com perfil_pagamento
 */
export function renderPaymentBadges(contratoOrString) {
  let paymentString = '';
  let contrato = null;

  if (contratoOrString && typeof contratoOrString === 'object') {
    contrato = contratoOrString;
    paymentString = contrato.forma_pagamento || '';
  } else if (typeof contratoOrString === 'string') {
    paymentString = contratoOrString;
  }

  const rawTokens = paymentString ? paymentString.split(',') : [];
  const seenKeys = new Set();
  const badgesHtml = [];

  // 1. Badge Especial de Cartão em Lote (Lapada 6x+)
  if (contrato && contrato.perfil_pagamento === 'CARTAO_LOTE') {
    const lapada = contrato.lapada_cartao;
    const lapadaDesc = lapada
      ? `Passou R$ ${lapada.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${lapada.equiv_parcelas}x) em ${lapada.data}.`
      : 'Paga no cartão de crédito em lotes de no mínimo 6 parcelas.';
    const vencDesc = contrato.proximo_vencimento_real
      ? ` Próximo vencimento só em ${contrato.proximo_vencimento_real}.`
      : '';

    badgesHtml.push(`
      <span class="badge-cartao-lote" title="${lapadaDesc}${vencDesc}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>Cartão 6x+</span>
      </span>
    `);
    seenKeys.add('cartao-credito');
  } else if (contrato && contrato.perfil_pagamento === 'CARTAO_MENSAL') {
    badgesHtml.push(`
      <span class="badge-cartao-mensal" title="Pagamento mensal no cartão (1 a 2 parcelas por mês)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
        <span>Cartão Mensal</span>
      </span>
    `);
    seenKeys.add('cartao-credito');
    seenKeys.add('cartao-debito');
  }

  // 2. Badges normais mapeados das modalidades cadastradas
  for (const token of rawTokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    
    const config = getBadgeConfig(trimmed);
    if (!seenKeys.has(config.key)) {
      seenKeys.add(config.key);
      badgesHtml.push(renderSingleBadge(trimmed));
    }
  }

  if (badgesHtml.length === 0) {
    badgesHtml.push(renderSingleBadge('Sem registro'));
  }

  // 3. Indicador de cobertura se estiver coberto por pagamento em lote
  let cobertoHtml = '';
  if (contrato && contrato.perfil_pagamento === 'CARTAO_LOTE' && contrato.proximo_vencimento_real) {
    cobertoHtml = `
      <span class="badge-coberto-tag" title="O aluno já pagou antecipadamente. Próxima cobrança apenas em ${contrato.proximo_vencimento_real}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10" style="vertical-align: -1px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Coberto até ${contrato.proximo_vencimento_real}</span>
      </span>
    `;
  }

  return `
    <div class="payment-badges-group" style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
      <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
        ${badgesHtml.join('')}
      </div>
      ${cobertoHtml}
    </div>
  `;
}

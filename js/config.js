/**
 * CONFIGURAÇÕES GLOBAIS - SISTEMA DE GESTÃO FINANCEIRA MICROLINS POTIRENDABA
 * 
 * Centraliza credenciais de nuvem (Supabase), chaves de armazenamento local,
 * predefinições de vencimento e paginação.
 */

export const CONFIG = {
  // Supabase Microlins Potirendaba
  SUPABASE_URL: 'https://apfcbkucxjcleqxarlmv.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DZAXwbvMzgz31wR-pmbNkg_aNg3ofG0',
  UNIT_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  TABLE_NAME: 'contratos_financeiro',

  // Chaves de LocalStorage para persistência offline e cache rápido
  STORAGE_KEY: 'microlins_contratos_financeiro_local',
  SETTINGS_KEY: 'microlins_contratos_financeiro_settings',
  LAST_SYNC_KEY: 'microlins_contratos_last_sync',

  // Atalhos rápidos para definição de dia de vencimento
  PRESET_DAYS: ['05', '10', '15', '20', '25', '30'],

  // Opções de paginação
  ITEMS_PER_PAGE_OPTIONS: [10, 25, 50, 100, 200],
  DEFAULT_ITEMS_PER_PAGE: 25,

  // Lista padronizada de modalidades reconhecidas
  PAYMENT_METHODS: [
    'PIX',
    'PIX - QR Code',
    'Boleto',
    'Cartão de Crédito',
    'Cartão de Débito',
    'Dinheiro',
    'Carnê',
    'Depósito Bancário',
    'Cheque'
  ],

  // Status de contratos
  STATUS_OPTIONS: [
    'Ativo',
    'Inativo/Desistente'
  ]
};

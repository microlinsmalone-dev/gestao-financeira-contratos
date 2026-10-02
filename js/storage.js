/**
 * GERENCIADOR DE DADOS HÍBRIDO (SUPABASE + LOCALSTORAGE)
 * 
 * Garante funcionamento contínuo:
 * - Se a nuvem Supabase estiver acessível, sincroniza em tempo real.
 * - Se estiver offline ou sem tabela criada, opera 100% via LocalStorage.
 * - Protege a Data de Vencimento contra sobrescrita durante reimportações do Excel.
 */

import { CONFIG } from './config.js';

class DataStorage {
  constructor() {
    this.supabase = null;
    this.memoryData = new Map(); // Map com codigo como chave
    this.syncStatus = {
      isConnected: false,
      provider: 'local',
      lastSync: null,
      errorMessage: null
    };
  }

  /**
   * Inicializa o cliente Supabase e testa a conexão
   */
  async init() {
    // Carrega dados locais do cache imediatamente para inicialização instantânea
    this._loadFromLocalStorage();

    // Tenta inicializar o cliente Supabase se a biblioteca estiver disponível globalmente
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        this.supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      } catch (err) {
        console.warn('[Storage] Erro ao instanciar cliente Supabase:', err);
      }
    }

    // Testa conexão com o Supabase e sincroniza se disponível
    if (this.supabase) {
      await this.refreshFromSupabase();
    }

    return this.getAllContratos();
  }

  /**
   * Carrega dados do LocalStorage para a memória
   */
  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.memoryData.clear();
          for (const item of parsed) {
            if (item && item.codigo !== undefined) {
              this.memoryData.set(String(item.codigo), item);
            }
          }
        }
      }
      const lastSync = localStorage.getItem(CONFIG.LAST_SYNC_KEY);
      if (lastSync) {
        this.syncStatus.lastSync = lastSync;
      }
    } catch (e) {
      console.error('[Storage] Erro ao ler LocalStorage:', e);
    }
  }

  /**
   * Salva os dados atuais da memória no LocalStorage
   */
  _saveToLocalStorage() {
    try {
      const array = Array.from(this.memoryData.values());
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(array));
    } catch (e) {
      console.error('[Storage] Erro ao salvar no LocalStorage:', e);
    }
  }

  /**
   * Busca contratos do Supabase na nuvem e atualiza a memória local
   */
  async refreshFromSupabase() {
    if (!this.supabase) {
      this.syncStatus.isConnected = false;
      this.syncStatus.provider = 'local';
      return false;
    }

    try {
      // Busca em páginas de 1000 registros para garantir cobertura completa mesmo com grandes volumes
      let allData = [];
      let from = 0;
      const step = 1000;

      while (true) {
        const { data, error } = await this.supabase
          .from(CONFIG.TABLE_NAME)
          .select('*')
          .range(from, from + step - 1);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          break;
        }

        allData.push(...data);
        if (data.length < step) {
          break; // Última página
        }
        from += step;
      }

      this.syncStatus.isConnected = true;
      this.syncStatus.provider = 'supabase';
      this.syncStatus.errorMessage = null;
      this.syncStatus.lastSync = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      localStorage.setItem(CONFIG.LAST_SYNC_KEY, this.syncStatus.lastSync);

      if (allData.length > 0) {
        // Se a nuvem tem registros, mesclamos com o local preservando vencimentos locais mais recentes
        for (const remote of allData) {
          const key = String(remote.codigo);
          const local = this.memoryData.get(key);

          if (local && local.data_vencimento && !remote.data_vencimento) {
            // Se no local já tinha vencimento e na nuvem ainda não, mantém o do local e agenda sync
            this.memoryData.set(key, { ...remote, data_vencimento: local.data_vencimento });
            this._asyncPushVencimento(remote.codigo, local.data_vencimento);
          } else {
            this.memoryData.set(key, remote);
          }
        }
        this._saveToLocalStorage();
      } else if (this.memoryData.size > 0) {
        // Nuvem está vazia mas temos dados locais: sincroniza os locais para a nuvem
        this.syncAllToSupabase().catch(console.warn);
      }

      return true;
    } catch (err) {
      let friendlyMsg = err.message || 'Falha de comunicação com o Supabase';
      if (err.code === 'PGRST205' || friendlyMsg.includes('not find the table') || friendlyMsg.includes('does not exist')) {
        friendlyMsg = 'Tabela contratos_financeiro não encontrada no Supabase. Execute o script supabase_schema.sql no SQL Editor.';
      }
      console.warn('[Storage] Supabase indisponível, usando modo offline:', friendlyMsg);
      this.syncStatus.isConnected = false;
      this.syncStatus.provider = 'local';
      this.syncStatus.errorMessage = friendlyMsg;
      return false;
    }
  }

  /**
   * Retorna lista de todos os contratos em formato de Array
   */
  getAllContratos() {
    return Array.from(this.memoryData.values());
  }

  /**
   * Busca um contrato específico por código
   */
  getContrato(codigo) {
    return this.memoryData.get(String(codigo)) || null;
  }

  /**
   * Upsert inteligente: adiciona novos contratos e atualiza existentes,
   * PRESERVANDO A DATA DE VENCIMENTO já cadastrada!
   */
  async upsertContratos(novosContratos) {
    let countAdded = 0;
    let countUpdated = 0;
    let countPreservedDates = 0;

    const listToPersist = [];

    for (const novo of novosContratos) {
      if (!novo || novo.codigo === undefined || novo.codigo === null) continue;
      const key = String(novo.codigo);
      const existing = this.memoryData.get(key);

      let recordToSave;

      if (existing) {
        countUpdated++;
        // REGRA DE OURO: Mantém a data de vencimento existente!
        let dataVencimento = existing.data_vencimento;
        if (dataVencimento) {
          countPreservedDates++;
        } else if (novo.data_vencimento) {
          dataVencimento = novo.data_vencimento;
        }

        recordToSave = {
          ...novo,
          data_vencimento: dataVencimento || null,
          unit_id: CONFIG.UNIT_ID,
          created_at: existing.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      } else {
        countAdded++;
        recordToSave = {
          ...novo,
          data_vencimento: novo.data_vencimento || null,
          unit_id: CONFIG.UNIT_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }

      this.memoryData.set(key, recordToSave);
      listToPersist.push(recordToSave);
    }

    // Salva localmente de forma síncrona imediata
    this._saveToLocalStorage();

    // Se o Supabase estiver disponível, envia em lotes de 100 para evitar payload excessivo
    if (this.supabase && this.syncStatus.isConnected && listToPersist.length > 0) {
      this._batchUpsertSupabase(listToPersist).catch(err => {
        console.warn('[Storage] Erro no sync em lote com Supabase:', err.message || err);
      });
    }

    return {
      total: listToPersist.length,
      added: countAdded,
      updated: countUpdated,
      preservedDueDates: countPreservedDates
    };
  }

  /**
   * Envia lotes de contratos para o Supabase com tratamento rigoroso de erros
   */
  async _batchUpsertSupabase(records) {
    if (!this.supabase) return;
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);
      const { error } = await this.supabase
        .from(CONFIG.TABLE_NAME)
        .upsert(chunk, { onConflict: 'codigo' });

      if (error) {
        let msg = error.message || `Falha ao sincronizar lote de contratos`;
        if (error.code === 'PGRST205' || msg.includes('not find the table') || msg.includes('does not exist')) {
          msg = 'Tabela contratos_financeiro não encontrada no Supabase. Execute o script supabase_schema.sql no SQL Editor.';
        }
        throw new Error(msg);
      }
    }
  }

  /**
   * Atualiza especificamente a Data de Vencimento de um aluno (Auto-save)
   */
  async updateVencimento(codigo, novoVencimento) {
    const key = String(codigo);
    const existing = this.memoryData.get(key);

    if (!existing) {
      throw new Error(`Contrato #${codigo} não encontrado.`);
    }

    const valorFormatado = novoVencimento ? String(novoVencimento).trim() : null;
    existing.data_vencimento = valorFormatado;
    existing.updated_at = new Date().toISOString();

    this.memoryData.set(key, existing);
    this._saveToLocalStorage();

    // Sync na nuvem
    if (this.supabase) {
      try {
        const { error } = await this.supabase
          .from(CONFIG.TABLE_NAME)
          .update({
            data_vencimento: valorFormatado,
            updated_at: new Date().toISOString()
          })
          .eq('codigo', codigo);

        if (error) {
          console.warn('[Storage] Aviso ao atualizar vencimento no Supabase:', error);
        }
      } catch (err) {
        console.warn('[Storage] Erro de rede ao atualizar vencimento:', err);
      }
    }

    return existing;
  }

  /**
   * Empurra atualização de vencimento em segundo plano
   */
  async _asyncPushVencimento(codigo, dataVencimento) {
    if (!this.supabase) return;
    try {
      await this.supabase
        .from(CONFIG.TABLE_NAME)
        .update({ data_vencimento: dataVencimento })
        .eq('codigo', codigo);
    } catch (e) {
      // Falha silenciosa em background
    }
  }

  /**
   * Adiciona um contrato manualmente (fora da planilha)
   */
  async addContratoManual(contrato) {
    if (!contrato || !contrato.codigo || !contrato.aluno) {
      throw new Error('Código e Nome do Aluno são obrigatórios.');
    }

    const key = String(contrato.codigo);
    if (this.memoryData.has(key)) {
      throw new Error(`Já existe um contrato cadastrado com o código #${contrato.codigo}.`);
    }

    const record = {
      codigo: Number(contrato.codigo),
      aluno: contrato.aluno.trim(),
      aluno_normalizado: contrato.aluno.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      status_contrato: contrato.status_contrato || 'Ativo',
      forma_pagamento: contrato.forma_pagamento || 'Sem registro',
      data_vencimento: contrato.data_vencimento || null,
      consultor: contrato.consultor || '',
      qtd_parcelas: contrato.qtd_parcelas ? Number(contrato.qtd_parcelas) : null,
      valor_parcela: contrato.valor_parcela ? Number(contrato.valor_parcela) : null,
      valor_pago_total: contrato.valor_pago_total ? Number(contrato.valor_pago_total) : 0,
      unit_id: CONFIG.UNIT_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.memoryData.set(key, record);
    this._saveToLocalStorage();

    if (this.supabase) {
      try {
        const { error } = await this.supabase
          .from(CONFIG.TABLE_NAME)
          .insert([record]);

        if (error) {
          console.warn('[Storage] Erro ao inserir contrato no Supabase:', error);
        }
      } catch (err) {
        console.warn('[Storage] Erro de rede ao inserir contrato no Supabase:', err);
      }
    }

    return record;
  }

  /**
   * Exclui um contrato por código
   */
  async deleteContrato(codigo) {
    const key = String(codigo);
    if (!this.memoryData.has(key)) {
      throw new Error(`Contrato #${codigo} não encontrado.`);
    }

    this.memoryData.delete(key);
    this._saveToLocalStorage();

    if (this.supabase) {
      try {
        const { error } = await this.supabase
          .from(CONFIG.TABLE_NAME)
          .delete()
          .eq('codigo', codigo);

        if (error) {
          console.warn('[Storage] Erro ao deletar no Supabase:', error);
        }
      } catch (err) {
        console.warn('[Storage] Erro de rede ao deletar no Supabase:', err);
      }
    }

    return true;
  }

  /**
   * Exporta todos os dados em formato JSON para download de segurança
   */
  exportBackupJSON() {
    const data = this.getAllContratos();
    const payload = {
      unit: 'Microlins Potirendaba',
      unit_id: CONFIG.UNIT_ID,
      version: '1.0',
      exported_at: new Date().toISOString(),
      total_records: data.length,
      records: data
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Importa backup JSON restaurando todos os contratos
   */
  async importBackupJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      const records = Array.isArray(parsed) ? parsed : (parsed.records || []);
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('O arquivo de backup não contém uma lista válida de contratos.');
      }

      const res = await this.upsertContratos(records);
      return res;
    } catch (err) {
      throw new Error('Falha ao processar arquivo JSON de backup: ' + err.message);
    }
  }

  /**
   * Sincroniza todos os registros em memória com o Supabase
   */
  async syncAllToSupabase() {
    if (!this.supabase) {
      throw new Error('Supabase não inicializado.');
    }
    const all = this.getAllContratos();
    if (all.length === 0) {
      return { total: 0 };
    }

    await this._batchUpsertSupabase(all);
    this.syncStatus.isConnected = true;
    this.syncStatus.provider = 'supabase';
    this.syncStatus.lastSync = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    localStorage.setItem(CONFIG.LAST_SYNC_KEY, this.syncStatus.lastSync);

    return { total: all.length };
  }

  /**
   * Limpa todos os dados locais (com cuidado)
   */
  clearLocalStorageOnly() {
    this.memoryData.clear();
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem(CONFIG.LAST_SYNC_KEY);
  }

  /**
   * Retorna o status atual da conexão
   */
  getSyncStatus() {
    return { ...this.syncStatus, totalRecords: this.memoryData.size };
  }
}

// Singleton export
export const storage = new DataStorage();

/**
 * GERENCIADOR DE DADOS HÍBRIDO (SUPABASE + LOCALSTORAGE)
 * 
 * Garante funcionamento contínuo:
 * - Se a nuvem Supabase estiver acessível, sincroniza em tempo real.
 * - Se estiver offline ou sem tabela criada, opera 100% via LocalStorage.
 * - Protege a Data de Vencimento contra sobrescrita durante reimportações do Excel.
 * - Suporta fusão inteligente de dados cadastrais e de cobrança (Recebimentos).
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

        if (!data || data.length === 0) break;
        allData = allData.concat(data);

        if (data.length < step) break;
        from += step;
      }

      if (allData.length > 0) {
        // Atualiza a memória local preservando edições locais mais recentes
        for (const remote of allData) {
          if (!remote || remote.codigo === undefined) continue;
          const key = String(remote.codigo);
          const local = this.memoryData.get(key);

          if (!local) {
            this.memoryData.set(key, remote);
          } else {
            // Mescla priorizando dados mais recentes
            const localUpdated = new Date(local.updated_at || 0).getTime();
            const remoteUpdated = new Date(remote.updated_at || 0).getTime();

            if (remoteUpdated >= localUpdated) {
              this.memoryData.set(key, remote);
            }
          }
        }

        this._saveToLocalStorage();
      }

      this.syncStatus.isConnected = true;
      this.syncStatus.provider = 'supabase';
      this.syncStatus.lastSync = new Date().toISOString();
      this.syncStatus.errorMessage = null;

      localStorage.setItem(CONFIG.LAST_SYNC_KEY, this.syncStatus.lastSync);
      return true;
    } catch (err) {
      console.warn('[Storage] Conexão com Supabase indisponível. Operando via LocalStorage:', err.message || err);
      this.syncStatus.isConnected = false;
      this.syncStatus.provider = 'local';
      this.syncStatus.errorMessage = err.message || 'Falha ao conectar com o Supabase';
      return false;
    }
  }

  /**
   * Retorna todos os contratos armazenados em memória (apenas Ativos por padrão)
   */
  getAllContratos(apenasAtivos = true) {
    const todos = Array.from(this.memoryData.values());
    if (!apenasAtivos) return todos;
    return todos.filter(c => {
      if (!c.status_contrato) return true;
      const st = c.status_contrato.toLowerCase();
      return st.includes('ativo') && !st.includes('inativo');
    });
  }

  /**
   * Busca um contrato específico por código
   */
  getContrato(codigo) {
    return this.memoryData.get(String(codigo)) || null;
  }

  /**
   * Upsert inteligente: adiciona novos contratos e atualiza existentes,
   * PRESERVANDO A DATA DE VENCIMENTO e as parcelas restantes já apuradas!
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

        // Se já tínhamos parcelas restantes exatas da planilha de recebimentos, preserva!
        const parcelasRestantes = (existing.parcelas_restantes !== undefined && existing.parcelas_restantes !== null)
          ? existing.parcelas_restantes
          : novo.parcelas_restantes;

        const parcelasAtrasadas = (existing.parcelas_atrasadas !== undefined && existing.parcelas_atrasadas !== null)
          ? existing.parcelas_atrasadas
          : (novo.parcelas_atrasadas || 0);

        recordToSave = {
          ...existing,
          ...novo,
          data_vencimento: dataVencimento || null,
          parcelas_restantes: parcelasRestantes,
          parcelas_atrasadas: parcelasAtrasadas,
          telefone_celular: existing.telefone_celular || novo.telefone_celular || '',
          resp_financeiro: existing.resp_financeiro || novo.resp_financeiro || '',
          ignorar_emissao_boleto: existing.ignorar_emissao_boleto || false,
          unit_id: CONFIG.UNIT_ID,
          created_at: existing.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      } else {
        countAdded++;
        recordToSave = {
          ...novo,
          data_vencimento: novo.data_vencimento || null,
          parcelas_restantes: novo.parcelas_restantes !== undefined ? novo.parcelas_restantes : null,
          parcelas_atrasadas: novo.parcelas_atrasadas || 0,
          ignorar_emissao_boleto: false,
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
   * Mesclagem de dados analíticos da planilha 'Recebimentos de Contratos'
   */
  async mergeRecebimentos(incomingRecebimentos) {
    let countUpdated = 0;
    let countAdded = 0;
    const listToPersist = [];

    for (const rec of incomingRecebimentos) {
      if (!rec || rec.codigo === undefined || rec.codigo === null) continue;
      const key = String(rec.codigo);
      const existing = this.memoryData.get(key);

      let recordToSave;
      if (existing) {
        countUpdated++;
        recordToSave = {
          ...existing,
          parcelas_restantes: rec.parcelas_restantes !== undefined ? rec.parcelas_restantes : existing.parcelas_restantes,
          parcelas_atrasadas: rec.parcelas_atrasadas !== undefined ? rec.parcelas_atrasadas : (existing.parcelas_atrasadas || 0),
          parcelas_pagas: rec.parcelas_pagas !== undefined ? rec.parcelas_pagas : existing.parcelas_pagas,
          ultima_data_vencimento: rec.ultima_data_vencimento || existing.ultima_data_vencimento || null,
          telefone_celular: rec.telefone_celular || existing.telefone_celular || '',
          telefone_residencial: rec.telefone_residencial || existing.telefone_residencial || '',
          resp_financeiro: rec.resp_financeiro || existing.resp_financeiro || '',
          updated_at: new Date().toISOString()
        };

        // Sugere dia do vencimento se ainda não estiver definido
        if (!recordToSave.data_vencimento && rec.ultima_data_vencimento) {
          const parts = rec.ultima_data_vencimento.split('/');
          if (parts.length === 3) {
            recordToSave.data_vencimento = `Dia ${parts[0]}`;
          }
        }
      } else {
        countAdded++;
        let dataVenc = null;
        if (rec.ultima_data_vencimento) {
          const parts = rec.ultima_data_vencimento.split('/');
          if (parts.length === 3) {
            dataVenc = `Dia ${parts[0]}`;
          }
        }

        recordToSave = {
          codigo: rec.codigo,
          aluno: rec.aluno || `Aluno ${rec.codigo}`,
          aluno_normalizado: (rec.aluno || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
          status_contrato: 'Ativo',
          forma_pagamento: 'Sem registro',
          data_vencimento: dataVenc,
          consultor: rec.consultor || '',
          parcelas_restantes: rec.parcelas_restantes || 0,
          parcelas_atrasadas: rec.parcelas_atrasadas || 0,
          parcelas_pagas: rec.parcelas_pagas || 0,
          ultima_data_vencimento: rec.ultima_data_vencimento || null,
          telefone_celular: rec.telefone_celular || '',
          telefone_residencial: rec.telefone_residencial || '',
          resp_financeiro: rec.resp_financeiro || '',
          ignorar_emissao_boleto: false,
          unit_id: CONFIG.UNIT_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }

      this.memoryData.set(key, recordToSave);
      listToPersist.push(recordToSave);
    }

    this._saveToLocalStorage();

    if (this.supabase && this.syncStatus.isConnected && listToPersist.length > 0) {
      this._batchUpsertSupabase(listToPersist).catch(err => {
        console.warn('[Storage] Erro no sync em lote de recebimentos com Supabase:', err.message || err);
      });
    }

    return {
      total: listToPersist.length,
      updated: countUpdated,
      added: countAdded
    };
  }

  /**
   * Mesclagem de dados transacionais e de inteligência da planilha 'Baixa de Recebimentos'
   */
  async mergeBaixaRecebimentos(incomingBaixas) {
    let countUpdated = 0;
    let countAdded = 0;
    const listToPersist = [];

    for (const baixa of incomingBaixas) {
      if (!baixa || baixa.codigo === undefined || baixa.codigo === null) continue;
      const key = String(baixa.codigo);
      const existing = this.memoryData.get(key);

      let recordToSave;
      if (existing) {
        countUpdated++;
        recordToSave = {
          ...existing,
          perfil_pagamento: baixa.perfil_pagamento,
          lapada_cartao: baixa.lapada_cartao || existing.lapada_cartao || null,
          proximo_vencimento_real: baixa.proximo_vencimento_real || existing.proximo_vencimento_real || null,
          total_pago_acumulado: baixa.total_pago_acumulado !== undefined ? baixa.total_pago_acumulado : (existing.total_pago_acumulado || 0),
          qtd_parcelas_pagas: baixa.qtd_parcelas_pagas !== undefined ? baixa.qtd_parcelas_pagas : (existing.qtd_parcelas_pagas || existing.parcelas_pagas || 0),
          qtd_parcelas_abertas: baixa.qtd_parcelas_abertas !== undefined ? baixa.qtd_parcelas_abertas : (existing.qtd_parcelas_abertas || existing.parcelas_restantes || 0),
          historico_baixas: baixa.historico_baixas || existing.historico_baixas || [],
          updated_at: new Date().toISOString()
        };

        // Se ainda não tinha data de vencimento e a baixa possui próximo vencimento real, sugere
        if (!recordToSave.data_vencimento && baixa.proximo_vencimento_real) {
          const parts = baixa.proximo_vencimento_real.split('/');
          if (parts.length === 3) {
            recordToSave.data_vencimento = `Dia ${parts[0]}`;
          }
        }
      } else {
        countAdded++;
        let dataVenc = null;
        if (baixa.proximo_vencimento_real) {
          const parts = baixa.proximo_vencimento_real.split('/');
          if (parts.length === 3) {
            dataVenc = `Dia ${parts[0]}`;
          }
        }

        recordToSave = {
          codigo: baixa.codigo,
          aluno: baixa.aluno || `Aluno ${baixa.codigo}`,
          aluno_normalizado: (baixa.aluno || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
          status_contrato: 'Ativo',
          forma_pagamento: baixa.perfil_pagamento === 'CARTAO_LOTE' ? 'Cartão de Crédito' : 'Sem registro',
          perfil_pagamento: baixa.perfil_pagamento,
          lapada_cartao: baixa.lapada_cartao || null,
          proximo_vencimento_real: baixa.proximo_vencimento_real || null,
          total_pago_acumulado: baixa.total_pago_acumulado || 0,
          qtd_parcelas_pagas: baixa.qtd_parcelas_pagas || 0,
          qtd_parcelas_abertas: baixa.qtd_parcelas_abertas || 0,
          parcelas_restantes: baixa.qtd_parcelas_abertas || 0,
          parcelas_atrasadas: 0,
          parcelas_pagas: baixa.qtd_parcelas_pagas || 0,
          data_vencimento: dataVenc,
          historico_baixas: baixa.historico_baixas || [],
          ignorar_emissao_boleto: false,
          unit_id: CONFIG.UNIT_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }

      this.memoryData.set(key, recordToSave);
      listToPersist.push(recordToSave);
    }

    this._saveToLocalStorage();

    if (this.supabase && this.syncStatus.isConnected && listToPersist.length > 0) {
      this._batchUpsertSupabase(listToPersist).catch(err => {
        console.warn('[Storage] Erro no sync em lote de baixa com Supabase:', err.message || err);
      });
    }

    return {
      total: listToPersist.length,
      updated: countUpdated,
      added: countAdded
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
      throw new Error(`Contrato ${codigo} não encontrado.`);
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
   * Alterna a flag para ignorar/incluir emissão de boleto manualmente para um aluno
   */
  async toggleIgnorarBoleto(codigo, forcarValor = null) {
    const key = String(codigo);
    const existing = this.memoryData.get(key);
    if (!existing) return null;

    const novoValor = forcarValor !== null ? Boolean(forcarValor) : !existing.ignorar_emissao_boleto;
    existing.ignorar_emissao_boleto = novoValor;
    existing.updated_at = new Date().toISOString();

    this.memoryData.set(key, existing);
    this._saveToLocalStorage();

    if (this.supabase) {
      try {
        await this.supabase
          .from(CONFIG.TABLE_NAME)
          .update({
            ignorar_emissao_boleto: novoValor,
            updated_at: new Date().toISOString()
          })
          .eq('codigo', codigo);
      } catch (e) {
        console.warn('[Storage] Erro ao sincronizar flag ignorar_emissao_boleto:', e);
      }
    }

    return existing;
  }

  /**
   * Adiciona um contrato manualmente (fora da planilha)
   */
  async addContratoManual(contrato) {
    if (!contrato || !contrato.codigo || !contrato.aluno) {
      throw new Error('Nº do Contrato e Nome do Aluno são obrigatórios.');
    }

    const key = String(contrato.codigo);
    if (this.memoryData.has(key)) {
      throw new Error(`Já existe um contrato cadastrado com o número ${contrato.codigo}.`);
    }

    const qtdParcelas = contrato.qtd_parcelas ? Number(contrato.qtd_parcelas) : null;
    const parcelasRestantes = contrato.parcelas_restantes !== undefined && contrato.parcelas_restantes !== null
      ? Number(contrato.parcelas_restantes)
      : qtdParcelas;

    const record = {
      codigo: Number(contrato.codigo),
      aluno: contrato.aluno.trim(),
      aluno_normalizado: contrato.aluno.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
      status_contrato: contrato.status_contrato || 'Ativo',
      forma_pagamento: contrato.forma_pagamento || 'Sem registro',
      data_vencimento: contrato.data_vencimento || null,
      consultor: contrato.consultor || '',
      qtd_parcelas: qtdParcelas,
      valor_parcela: contrato.valor_parcela ? Number(contrato.valor_parcela) : null,
      valor_pago_total: contrato.valor_pago_total ? Number(contrato.valor_pago_total) : 0,
      parcelas_restantes: parcelasRestantes,
      parcelas_atrasadas: 0,
      ignorar_emissao_boleto: false,
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
      throw new Error(`Contrato ${codigo} não encontrado.`);
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
   * Limpa todos os dados locais
   */
  clearLocalStorageOnly() {
    this.memoryData.clear();
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem(CONFIG.LAST_SYNC_KEY);
  }

  /**
   * Remove dados derivados exclusivamente da planilha de Recebimentos de Contratos
   */
  removeRecebimentosData() {
    let count = 0;
    for (const record of this.memoryData.values()) {
      record.parcelas_restantes = null;
      record.parcelas_atrasadas = 0;
      delete record.parcelas_pagas;
      delete record.historico_recebimentos;
      delete record.ultima_data_vencimento;
      record.updated_at = new Date().toISOString();
      count++;
    }
    this._saveToLocalStorage();
    return count;
  }

  /**
   * Remove dados derivados exclusivamente da planilha de Baixa de Recebimentos
   */
  removeBaixaData() {
    let count = 0;
    for (const record of this.memoryData.values()) {
      delete record.perfil_pagamento;
      delete record.pagamento_lote_cartao;
      delete record.lapada_cartao;
      delete record.proximo_vencimento_real;
      delete record.total_pago_acumulado;
      delete record.qtd_parcelas_pagas;
      delete record.qtd_parcelas_abertas;
      delete record.historico_baixas;
      record.updated_at = new Date().toISOString();
      count++;
    }
    this._saveToLocalStorage();
    return count;
  }

  /**
   * Gera arquivo JSON para backup completo
   */
  exportBackupJSON() {
    const list = Array.from(this.memoryData.values());
    const backup = {
      version: '2.0.0',
      exported_at: new Date().toISOString(),
      unit: 'Microlins Potirendaba',
      count: list.length,
      records: list
    };
    return JSON.stringify(backup, null, 2);
  }

  /**
   * Restaura contratos a partir de um JSON de backup
   */
  async importBackupJSON(jsonString) {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.records)) {
      throw new Error('Formato de backup inválido.');
    }

    for (const item of parsed.records) {
      if (item && item.codigo !== undefined) {
        this.memoryData.set(String(item.codigo), item);
      }
    }

    this._saveToLocalStorage();

    if (this.supabase && this.syncStatus.isConnected) {
      const records = Array.from(this.memoryData.values());
      await this._batchUpsertSupabase(records);
    }

    return parsed.records.length;
  }
}

export const storage = new DataStorage();

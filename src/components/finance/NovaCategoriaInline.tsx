import React, { useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { showError } from '../../utils/alerts';
import { criarCategoriaDoPlano } from '../../services/baixaFinanceiraService';
import type { TipoDeCategoria } from '../../utils/configuracoesGeraisDomain';

/*
 * CATEGORIA NOVA NA TELA DE LANCAMENTO (pedido do dono, 19/10/2026): quem lanca
 * a conta cria a categoria ali mesmo, sem ir em Configuracoes. O servidor
 * acrescenta ao plano de contas de todas as filiais (so' acrescenta).
 * Fica dentro de um <form>: Enter cria a categoria, nao envia o lancamento.
 */
interface Props {
  tipo: TipoDeCategoria;
  tenantId: string;
  onCriada: (nome: string, lista: string[]) => void;
}

const NovaCategoriaInline: React.FC<Props> = ({ tipo, tenantId, onCriada }) => {
  // Mesma cor da janela: receita verde, despesa vermelha.
  const cor = tipo === 'despesa' ? '#ef4444' : '#10b981';
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    if (salvando) return;
    if (!nome.trim()) { showError('Nova categoria', 'Digite o nome da nova categoria.'); return; }
    setSalvando(true);
    try {
      const r = await criarCategoriaDoPlano({ tipo, nome, tenantId });
      onCriada(r.nome, r.lista);
      setNome('');
      setAberta(false);
    } catch (erro) {
      showError('Não foi possível criar a categoria', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setSalvando(false);
    }
  };

  if (!aberta) {
    return (
      <button
        type="button"
        onClick={() => setAberta(true)}
        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: cor, fontSize: '12.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        <Plus size={14} /> Nova categoria
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label htmlFor={`nova-categoria-${tipo}`} style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Nome da nova categoria</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          id={`nova-categoria-${tipo}`}
          type="text"
          value={nome}
          maxLength={60}
          autoFocus
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void criar(); }
            if (e.key === 'Escape') { e.stopPropagation(); setAberta(false); setNome(''); }
          }}
          style={{ flex: '1 1 100%', minWidth: 0, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
        />
        <button type="button" className="btn-primary" onClick={() => void criar()} disabled={salvando} style={{ backgroundColor: cor, borderColor: cor, padding: '9px 14px' }}>
          {salvando ? <Loader2 size={16} className="spin-animation" /> : <Check size={16} />} Criar
        </button>
        <button type="button" className="btn-secondary" onClick={() => { setAberta(false); setNome(''); }} disabled={salvando} style={{ padding: '9px 14px' }}>
          Cancelar
        </button>
      </div>
    </div>
  );
};

export default NovaCategoriaInline;

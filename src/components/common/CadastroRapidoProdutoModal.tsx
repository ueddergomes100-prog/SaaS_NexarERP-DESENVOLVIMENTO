import React, { useEffect, useState } from 'react';
import { addDoc, collection, getCountFromServer, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { X, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';

export interface ProdutoCadastradoRapido {
  id: string;
  codigo: string;
  nome: string;
  unidadeMedidaSigla: string;
  unidadeMedidaCasasDecimais: number;
  unidadeMedidaFracionado: boolean;
}

interface UnidadeOpcao {
  id: string;
  sigla: string;
  nome: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

const UNIDADE_FALLBACK: UnidadeOpcao = { id: '', sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false };
const CATEGORIA_FALLBACK = 'DIVERSOS';

/** Linha de embalagem no rascunho do modal -- mesmo espirito do
 * EmbalagemFormRow de EstoqueForm.tsx, so que sem toggle de ativo/inativo
 * (aqui tudo nasce ativo) e sem descricao (campo raramente usado, cabe
 * editar depois no cadastro completo se precisar). */
interface EmbalagemRapidaRow {
  id: string;
  unidadeMedidaId: string;
  fatorConversao: string;
  precoVenda: string;
  codigoBarras: string;
}

const makeEmbalagemRowId = () => `emb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const emptyEmbalagemRapida = (): EmbalagemRapidaRow => ({
  id: '', unidadeMedidaId: '', fatorConversao: '1', precoVenda: '', codigoBarras: '',
});

interface CadastroRapidoProdutoModalProps {
  open: boolean;
  nomeInicial?: string;
  /** So mostra a secao de embalagem quando o tenant tem a chave "vender por
   * embalagem" ligada -- mesma config que a tela chamadora (Nota Avulsa)
   * ja le, passada por prop pra nao abrir um segundo listener duplicado. */
  venderPorEmbalagem?: boolean;
  onClose: () => void;
  onCriado: (produto: ProdutoCadastradoRapido) => void;
}

/**
 * Cadastro rapido de produto -- mesmo espirito do CadastroRapidoClienteModal,
 * so que pro Estoque: campos essenciais pra identificar o item (nome,
 * categoria, unidade, embalagem opcional). Preco de custo/venda NAO entram
 * aqui de proposito -- quem usa este modal e' a Nota Avulsa, que ja pede
 * custo/venda por item na propria tela; duplicar o campo aqui so criaria
 * duas fontes pro mesmo dado. Quantidade nasce 0: quem incrementa e' a
 * operacao que chamou este modal.
 */
const CadastroRapidoProdutoModal: React.FC<CadastroRapidoProdutoModalProps> = ({
  open,
  nomeInicial,
  venderPorEmbalagem = false,
  onClose,
  onCriado,
}) => {
  const { currentUser, tenantId } = useAuth();
  const [nome, setNome] = useState('');
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const [categoria, setCategoria] = useState('');
  const [unidades, setUnidades] = useState<UnidadeOpcao[]>([]);
  const [unidadeId, setUnidadeId] = useState('');
  const [embalagens, setEmbalagens] = useState<EmbalagemRapidaRow[]>([]);
  const [novaEmbalagem, setNovaEmbalagem] = useState<EmbalagemRapidaRow>(emptyEmbalagemRapida);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(nomeInicial?.trim() || '');
    setCategoria('');
    setUnidadeId('');
    setEmbalagens([]);
    setNovaEmbalagem(emptyEmbalagemRapida());
  }, [open, nomeInicial]);

  useEffect(() => {
    if (!open || !tenantId) return;
    getDocs(query(collection(db, 'categorias'), where('tenantId', '==', tenantId)))
      .then((snap) => {
        // Mesmo filtro de EstoqueForm.tsx: categoria de servico nao entra
        // na lista de um cadastro rapido que so cria produto.
        const nomes = snap.docs
          .map((d) => d.data())
          .filter((data) => data.tipo === 'Peça' || data.tipo === 'Produto' || !data.tipo)
          .map((data) => String(data.nome || ''))
          .filter(Boolean);
        setCategoriasDB(nomes);
        setCategoria((atual) => atual || nomes[0] || '');
      })
      .catch((error) => console.error('Erro ao carregar categorias:', error));
  }, [open, tenantId]);

  useEffect(() => {
    if (!open || !tenantId) return;
    getDocs(query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId)))
      .then((snap) => {
        const lista = snap.docs.map((d) => ({
          id: d.id,
          sigla: String(d.data().sigla || '').toUpperCase(),
          nome: d.data().nome || '',
          casasDecimais: Number(d.data().casasDecimais) || 0,
          permiteFracionado: d.data().permiteFracionado === true,
        }));
        setUnidades(lista);
        // Sem isso, o <select> ficava exibindo "UN" na tela (fallback
        // visual, primeira opcao) sem o estado unidadeId de fato apontar
        // pra ela -- ao salvar, caia na unidade REAL que chegasse primeiro
        // da consulta (ordem do Firestore, nao necessariamente UN).
        const padrao = lista.find((u) => u.sigla === 'UN') || lista[0];
        if (padrao) setUnidadeId(padrao.id);
      })
      .catch((error) => console.error('Erro ao carregar unidades de medida:', error));
  }, [open, tenantId]);

  if (!open) return null;

  const opcoesCategoria = categoriasDB.length > 0 ? categoriasDB : [CATEGORIA_FALLBACK];
  const opcoesUnidade = unidades.length > 0 ? unidades : [UNIDADE_FALLBACK];

  const handleAddEmbalagem = () => {
    const fator = Number(novaEmbalagem.fatorConversao.replace(',', '.'));
    if (!novaEmbalagem.unidadeMedidaId) {
      showError('Embalagem incompleta', 'Selecione a unidade de medida da embalagem.');
      return;
    }
    if (!Number.isFinite(fator) || fator <= 0) {
      showError('Embalagem inválida', 'O fator de conversão deve ser maior que zero.');
      return;
    }
    if (novaEmbalagem.unidadeMedidaId === unidadeId) {
      showError('Unidade repetida', 'Esta já é a unidade base do produto — ela sempre aparece na venda, sem precisar de embalagem.');
      return;
    }
    if (embalagens.some((e) => e.unidadeMedidaId === novaEmbalagem.unidadeMedidaId)) {
      showError('Unidade repetida', 'Já existe uma embalagem adicionada nesta unidade de medida.');
      return;
    }

    setEmbalagens((atual) => [...atual, { ...novaEmbalagem, id: makeEmbalagemRowId() }]);
    setNovaEmbalagem(emptyEmbalagemRapida());
  };

  const handleRemoveEmbalagem = (id: string) => {
    setEmbalagens((atual) => atual.filter((e) => e.id !== id));
  };

  const handleSalvar = async () => {
    const nomeLimpo = nome.toUpperCase().trim();
    if (!nomeLimpo) {
      showError('Campo obrigatório', 'Informe o nome do produto.');
      return;
    }
    if (!currentUser || !tenantId) return;

    setIsSaving(true);
    try {
      const unidadeEscolhida = unidades.find((u) => u.id === unidadeId) || opcoesUnidade[0];

      const qCount = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const countSnap = await getCountFromServer(qCount);
      const codigo = String(countSnap.data().count + 1);

      const embalagensParaSalvar = venderPorEmbalagem
        ? embalagens.map((e) => {
            const unidadeEmb = unidades.find((u) => u.id === e.unidadeMedidaId);
            return {
              id: e.id,
              unidadeMedidaId: e.unidadeMedidaId,
              unidadeMedidaSigla: unidadeEmb?.sigla || 'UN',
              unidadeMedidaCasasDecimais: unidadeEmb ? Number(unidadeEmb.casasDecimais) : 0,
              unidadeMedidaFracionado: Boolean(unidadeEmb?.permiteFracionado),
              descricao: '',
              fatorConversao: Number(e.fatorConversao.replace(',', '.')) || 1,
              precoVenda: Number(e.precoVenda.replace(',', '.')) || 0,
              codigoBarras: e.codigoBarras.trim(),
              ativo: true,
            };
          })
        : [];

      const novoProdutoRef = await addDoc(collection(db, 'estoque'), {
        codigo,
        nome: nomeLimpo,
        categoria: categoria.trim().toUpperCase() || CATEGORIA_FALLBACK,
        quantidade: 0,
        estoqueMinimo: 0,
        precoCusto: 0,
        precoVenda: 0,
        ...(unidadeEscolhida.id ? { unidadeMedidaId: unidadeEscolhida.id } : {}),
        unidadeMedidaSigla: unidadeEscolhida.sigla,
        unidadeMedidaCasasDecimais: unidadeEscolhida.casasDecimais,
        unidadeMedidaFracionado: unidadeEscolhida.permiteFracionado,
        ...(embalagensParaSalvar.length > 0 ? { embalagens: embalagensParaSalvar } : {}),
        tenantId,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });

      onCriado({
        id: novoProdutoRef.id,
        codigo,
        nome: nomeLimpo,
        unidadeMedidaSigla: unidadeEscolhida.sigla,
        unidadeMedidaCasasDecimais: unidadeEscolhida.casasDecimais,
        unidadeMedidaFracionado: unidadeEscolhida.permiteFracionado,
      });
      onClose();
    } catch (error) {
      console.error('Erro ao cadastrar produto:', error);
      showError('Erro ao salvar', 'Verifique sua conexão e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1300,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div className="card" style={{
        backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <PackagePlus size={20} color="#8b5cf6" />
            Cadastrar Produto
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome *</label>
            <input
              type="text"
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="form-select"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              >
                {opcoesCategoria.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Unidade</label>
              <select
                value={unidadeId}
                onChange={(e) => setUnidadeId(e.target.value)}
                className="form-select"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              >
                {opcoesUnidade.map((u) => <option key={u.id || u.sigla} value={u.id}>{u.sigla}</option>)}
              </select>
            </div>
          </div>

          {venderPorEmbalagem && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Embalagem (opcional) — só se este produto também for vendido em outra unidade
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '8px', alignItems: 'flex-end' }}>
                <select
                  value={novaEmbalagem.unidadeMedidaId}
                  onChange={(e) => setNovaEmbalagem((atual) => ({ ...atual, unidadeMedidaId: e.target.value }))}
                  className="form-select"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 10px', color: 'var(--text-primary)' }}
                >
                  <option value="">Unidade...</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.sigla}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="Fator (ex: 20)"
                  value={novaEmbalagem.fatorConversao}
                  onChange={(e) => setNovaEmbalagem((atual) => ({ ...atual, fatorConversao: e.target.value }))}
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 10px', color: 'var(--text-primary)' }}
                />
                <input
                  type="text"
                  placeholder="Preço venda"
                  value={novaEmbalagem.precoVenda}
                  onChange={(e) => setNovaEmbalagem((atual) => ({ ...atual, precoVenda: e.target.value }))}
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 10px', color: 'var(--text-primary)' }}
                />
                <input
                  type="text"
                  placeholder="Cód. barras"
                  value={novaEmbalagem.codigoBarras}
                  onChange={(e) => setNovaEmbalagem((atual) => ({ ...atual, codigoBarras: e.target.value }))}
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 10px', color: 'var(--text-primary)' }}
                />
                <button type="button" className="btn-secondary" onClick={handleAddEmbalagem} style={{ padding: '8px 10px' }} title="Adicionar embalagem">
                  <Plus size={16} />
                </button>
              </div>

              {embalagens.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {embalagens.map((e) => {
                    const unidadeEmb = unidades.find((u) => u.id === e.unidadeMedidaId);
                    return (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', padding: '4px 8px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                        <span>1 {unidadeEmb?.sigla || '?'} = {e.fatorConversao || '1'} {opcoesUnidade.find((u) => u.id === unidadeId)?.sigla || 'UN'}</span>
                        <button type="button" onClick={() => handleRemoveEmbalagem(e.id)} className="icon-btn" title="Remover embalagem" style={{ color: '#ef4444' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            Preço de custo e de venda são informados na própria nota avulsa. Quem precisar de mais (NCM, estoque mínimo, fornecedor padrão...) edita o cadastro completo depois em Estoque.
          </p>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSalvar()}
            disabled={isSaving}
            style={{ opacity: isSaving ? 0.6 : 1 }}
          >
            {isSaving ? 'Salvando...' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CadastroRapidoProdutoModal;

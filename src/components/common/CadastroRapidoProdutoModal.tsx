import React, { useEffect, useState } from 'react';
import { addDoc, collection, getCountFromServer, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { X, PackagePlus } from 'lucide-react';
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

interface CadastroRapidoProdutoModalProps {
  open: boolean;
  nomeInicial?: string;
  onClose: () => void;
  onCriado: (produto: ProdutoCadastradoRapido) => void;
}

/**
 * Cadastro rapido de produto -- mesmo espirito do CadastroRapidoClienteModal,
 * so que pro Estoque: campos essenciais pra identificar o item (nome,
 * categoria, unidade). Preco de custo/venda NAO entram aqui de proposito --
 * quem usa este modal e' a Nota Avulsa, que ja pede custo/venda por item na
 * propria tela; duplicar o campo aqui so criaria duas fontes pro mesmo dado.
 * Quantidade nasce 0: quem incrementa e' a operacao que chamou este modal.
 */
const CadastroRapidoProdutoModal: React.FC<CadastroRapidoProdutoModalProps> = ({
  open,
  nomeInicial,
  onClose,
  onCriado,
}) => {
  const { currentUser, tenantId } = useAuth();
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [unidades, setUnidades] = useState<UnidadeOpcao[]>([]);
  const [unidadeId, setUnidadeId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(nomeInicial?.trim() || '');
    setCategoria('');
    setUnidadeId('');
  }, [open, nomeInicial]);

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

  const opcoesUnidade = unidades.length > 0 ? unidades : [UNIDADE_FALLBACK];

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

      const novoProdutoRef = await addDoc(collection(db, 'estoque'), {
        codigo,
        nome: nomeLimpo,
        categoria: categoria.trim().toUpperCase() || 'DIVERSOS',
        quantidade: 0,
        estoqueMinimo: 0,
        precoCusto: 0,
        precoVenda: 0,
        ...(unidadeEscolhida.id ? { unidadeMedidaId: unidadeEscolhida.id } : {}),
        unidadeMedidaSigla: unidadeEscolhida.sigla,
        unidadeMedidaCasasDecimais: unidadeEscolhida.casasDecimais,
        unidadeMedidaFracionado: unidadeEscolhida.permiteFracionado,
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
        width: '100%', maxWidth: '480px', overflow: 'hidden',
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
              <input
                type="text"
                placeholder="DIVERSOS"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
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

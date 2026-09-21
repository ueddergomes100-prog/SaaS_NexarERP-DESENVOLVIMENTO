import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  DEFAULT_MINUTA_MOSTRAR_LOCAL,
  DEFAULT_MINUTA_MOSTRAR_MARCA,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  ordenarPorLocalizacao,
} from '../../utils/conferenciaDomain';
import { rotuloDoMotivoTroca } from '../../utils/trocaDomain';
import MinutaPrintDocument, { type MinutaCliente, type MinutaItem } from '../Expedicao/MinutaPrintDocument';
import '../OS/OsPrint.css';

/**
 * Minuta de entrega da TROCA: o mesmo papel da minuta de venda (separacao e
 * entrega, sem valores), com o titulo "MINUTA DE TROCA — SEM COBRANÇA" e a
 * condicao "SEM COBRANÇA", pro entregador nao cobrar nada.
 */
const TrocaMinutaPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [trocaData, setTrocaData] = useState<Record<string, unknown> | null>(null);
  const [itens, setItens] = useState<MinutaItem[]>([]);
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
  const [cliente, setCliente] = useState<MinutaCliente | null>(null);
  const [vendedorCodigo, setVendedorCodigo] = useState('');
  const [usuarioNome, setUsuarioNome] = useState('');
  const [geradoEm] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const mostrarMarca = (configData?.minutaMostrarMarca ?? DEFAULT_MINUTA_MOSTRAR_MARCA) !== false;
  const mostrarLocal = (configData?.minutaMostrarLocal ?? DEFAULT_MINUTA_MOSTRAR_LOCAL) !== false;

  useEffect(() => {
    const carregar = async () => {
      if (!id || !tenantId) return;
      try {
        const snap = await getDoc(doc(db, 'trocas', id));
        if (!snap.exists() || snap.data().tenantId !== tenantId) {
          alert('Troca não encontrada!');
          navigate('/vendas/trocas');
          return;
        }
        const troca = { id: snap.id, ...snap.data() } as Record<string, any>;
        // O documento da minuta le "pedidoData": adapta os nomes da troca.
        setTrocaData({
          id: troca.id,
          numeroPedido: troca.numeroTroca,
          createdAt: troca.createdAt,
          status: '',
          clienteNome: troca.clienteNome,
          observacao: troca.observacao || '',
          vendedorNome: troca.vendedorNome,
          pagamentos: [],
        });

        try {
          if (troca.clienteId) {
            const clienteSnap = await getDoc(doc(db, 'clientes', troca.clienteId));
            if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) setCliente(clienteSnap.data() as MinutaCliente);
          }
        } catch (err) {
          console.error('Erro ao buscar o cliente da minuta de troca:', err);
        }
        try {
          if (troca.vendedorId) {
            const vendedorSnap = await getDoc(doc(db, 'usuarios', troca.vendedorId));
            if (vendedorSnap.exists() && vendedorSnap.data().tenantId === tenantId) setVendedorCodigo(String(vendedorSnap.data().codigoVendedor || ''));
          }
          if (currentUser) {
            const perfilSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
            const perfil = perfilSnap.exists() ? perfilSnap.data() : null;
            setUsuarioNome(String(perfil?.nome || perfil?.nomeResponsavel || currentUser.displayName || currentUser.email || ''));
          }
        } catch (err) {
          console.error('Erro ao buscar o usuario da minuta de troca:', err);
          setUsuarioNome(currentUser?.displayName || currentUser?.email || '');
        }

        let config: Record<string, any> = {};
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) {
          config = configSnap.data();
          setConfigData(config);
        }

        // Codigo, codigo de barras, marca e local vem do CADASTRO do produto (a troca so' guarda id/nome/quantidade).
        const enriquecidos: MinutaItem[] = await Promise.all(
          (Array.isArray(troca.itens) ? troca.itens : []).map(async (item: any): Promise<MinutaItem> => {
            const base: MinutaItem = {
              id: item.id,
              // O motivo sai junto do nome: o entregador leva o produto certo e sabe por que.
              nome: `${item.nome} — ${rotuloDoMotivoTroca(item.motivo)}${item.motivoDescricao ? ` (${item.motivoDescricao})` : ''}`,
              quantidade: item.quantidade,
              unidadeMedidaSigla: item.unidadeMedidaSigla,
              unidadeMedidaCasasDecimais: item.unidadeMedidaCasasDecimais,
            };
            try {
              const estoqueSnap = await getDoc(doc(db, 'estoque', item.id));
              if (estoqueSnap.exists()) {
                const produto = estoqueSnap.data();
                return { ...base, codigo: produto.codigo || '', codigoBarras: String(produto.codigoBarras || '').trim(), marca: produto.marca || '', localizacaoEstoque: produto.localizacaoEstoque || '' };
              }
            } catch (err) {
              console.error('Erro ao buscar dados de estoque do item da minuta de troca:', err);
            }
            return base;
          }),
        );
        const ordenarPorLocal = config.ordenarMinutaPorLocal ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL;
        setItens(ordenarPorLocal ? ordenarPorLocalizacao(enriquecidos) : enriquecidos);
      } catch (error) {
        console.error('Erro ao buscar dados para a minuta de troca:', error);
      } finally {
        setLoading(false);
      }
    };
    void carregar();
  }, [id, navigate, currentUser, tenantId]);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando minuta de troca...</div>;
  if (!trocaData) return null;

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate(`/vendas/trocas/${id}`)}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir Minuta de Troca
        </button>
      </div>

      <MinutaPrintDocument
        pedidoData={trocaData}
        itens={itens}
        configData={configData}
        cliente={cliente}
        vendedorCodigo={vendedorCodigo}
        usuarioNome={usuarioNome}
        geradoEm={geradoEm}
        mostrarMarca={mostrarMarca}
        mostrarLocal={mostrarLocal}
        titulo="MINUTA DE TROCA — SEM COBRANÇA"
        rotuloNumero="Troca"
        operacao="TROCA"
        condicaoPagto="SEM COBRANÇA"
      />
    </div>
  );
};

export default TrocaMinutaPrint;

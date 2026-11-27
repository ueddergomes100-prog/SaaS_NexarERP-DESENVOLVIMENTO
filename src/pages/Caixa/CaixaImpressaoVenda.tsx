import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { buscarClienteDoDocumento } from '../../services/clienteDoDocumentoService';
import { useAuth } from '../../contexts/AuthContext';
import PedidoPrintModelo from '../Vendas/PedidoPrintModelo';
import { parcelasParaImpressao } from '../../utils/parcelasExibicaoDomain';
import { modeloDeImpressaoDoCaixa, MODELO_CUPOM_DO_CAIXA } from '../../utils/pedidoPrintModels';
import { isVendaDoUsuario } from '../../utils/visibilidadeVendasDomain';
import '../OS/OsPrint.css';

/**
 * Venda da Frente de Caixa no modelo do Pedido de Venda (27/11/2026): A4, meia
 * folha ou pre-venda, para a loja sem impressora de bobina (Configuracoes da
 * filial > Modelo de impressao da Frente de Caixa). O PDV abre esta pagina numa
 * area escondida (cupomDoCaixa.imprimirVendaNaFolha); ela monta o papel com o
 * MESMO componente do Pedido de Venda, chama a impressao e avisa o PDV.
 */
export const MENSAGEM_IMPRESSO = 'hennder:caixa-impresso';
export const MENSAGEM_ERRO_IMPRESSAO = 'hennder:caixa-impressao-erro';

const avisarCaixa = (tipo: string, mensagem = '') => {
  if (window.parent && window.parent !== window) window.parent.postMessage({ tipo, mensagem }, window.location.origin);
};

const CaixaImpressaoVenda: React.FC = () => {
  const { id } = useParams();
  const { tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [dados, setDados] = useState<{ pedido: Record<string, unknown>; cliente: unknown; config: Record<string, unknown>; parcelas: Array<{ numero: number; dataVencimento: string; valor: number }> } | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!id || !tenantId) return undefined;
    let vivo = true;
    (async () => {
      try {
        const [pedidoSnap, configSnap, parcelasSnap] = await Promise.all([
          getDoc(doc(db, 'pedidos_venda', id)),
          getDoc(doc(db, 'configuracoes', tenantId)),
          getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('pedidoId', '==', id))),
        ]);
        const pedido = pedidoSnap.exists() ? { id: pedidoSnap.id, ...pedidoSnap.data() } as Record<string, unknown> : null;
        if (!pedido || pedido.tenantId !== tenantId) throw new Error('A venda não foi encontrada para imprimir. Reimprima pelas Vendas do caixa (F9).');
        if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(pedido as { vendedorId?: string }, vendasVisiveisDeUsuarioId)) {
          throw new Error('Esta venda é de outro vendedor e não pode ser impressa por este usuário.');
        }
        const cliente = await buscarClienteDoDocumento(tenantId, pedido as Parameters<typeof buscarClienteDoDocumento>[1]);
        const parcelasLidas = parcelasSnap.docs
          .map((d) => d.data())
          .sort((a, b) => (a.paymentIndex ?? 0) - (b.paymentIndex ?? 0))
          .map((t, indice) => ({ numero: t.paymentIndex ?? (indice + 1), dataVencimento: t.dataVencimento || '', valor: t.valor || 0 }));
        if (!vivo) return;
        setDados({
          pedido,
          cliente,
          config: configSnap.exists() ? configSnap.data() : {},
          parcelas: parcelasParaImpressao(parcelasLidas, pedido.pagamentos as Parameters<typeof parcelasParaImpressao>[1]),
        });
      } catch (falha) {
        const mensagem = falha instanceof Error && falha.message ? falha.message : 'Não foi possível montar a impressão da venda. Reimprima pelas Vendas do caixa (F9).';
        if (vivo) setErro(mensagem);
        avisarCaixa(MENSAGEM_ERRO_IMPRESSAO, mensagem);
      }
    })();
    return () => { vivo = false; };
  }, [id, tenantId, vendasVisiveisDeUsuarioId]);

  // Papel desenhado: chama a impressao e avisa o caixa quando a janela de imprimir fechar.
  useEffect(() => {
    if (!dados) return undefined;
    const espera = window.setTimeout(() => {
      window.print();
      avisarCaixa(MENSAGEM_IMPRESSO);
    }, 400);
    return () => window.clearTimeout(espera);
  }, [dados]);

  if (erro) return <div style={{ padding: '24px', color: '#ef4444' }}>{erro}</div>;
  if (!dados) return <div style={{ padding: '24px' }}>Preparando a impressão...</div>;

  const modelo = modeloDeImpressaoDoCaixa(dados.config);
  return (
    <div className="print-layout-wrapper">
      <PedidoPrintModelo
        pedidoData={dados.pedido}
        clientData={dados.cliente}
        configData={{ ...dados.config, modeloImpressaoPedidoVenda: modelo === MODELO_CUPOM_DO_CAIXA ? undefined : modelo }}
        parcelas={dados.parcelas}
      />
    </div>
  );
};

export default CaixaImpressaoVenda;

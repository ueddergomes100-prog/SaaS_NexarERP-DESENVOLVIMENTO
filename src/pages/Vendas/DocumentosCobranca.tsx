import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { showError, showWarning } from '../../utils/alerts';
import { parcelasParaImpressao } from '../../utils/parcelasExibicaoDomain';
import { isVendaDoUsuario, MENSAGEM_VENDA_DE_OUTRO_USUARIO, TITULO_VENDA_DE_OUTRO_USUARIO } from '../../utils/visibilidadeVendasDomain';
import { mensagemDoDocumento, parseMensagensPadrao } from '../../utils/mensagensPadraoDomain';
import {
  DOCUMENTOS_DE_COBRANCA,
  VIAS_MAXIMAS,
  emitenteDaConfiguracao,
  formatarDataBr,
  montarCarne,
  montarDuplicatas,
  montarPromissorias,
  parcelasDoPedido,
  parseEmissaoDocumentos,
  parteDoCliente,
  reaisFormatado,
  type DocumentoDeCobranca,
  type DuplicataDocumento,
  type EmissaoDocumentos,
  type ParcelaDocumento,
  type ParteDocumento,
  type VendaParaDocumentos,
} from '../../utils/documentosCobrancaDomain';
import { gerarPdfDocumentosDaVenda } from '../../utils/documentosCobrancaPdf';

/*
 * DOCUMENTOS DE COBRANCA DA VENDA (Configuracoes por filial, fase D -- 2026-10-07).
 *
 * Promissoria, carne de parcelas e duplicata do pedido, em PDF, dentro do
 * sistema (PdfVisualizador). Chega-se aqui de dois jeitos: pelo "Mais acoes >
 * Documentos de cobranca" do pedido, a qualquer hora, ou automaticamente ao
 * finalizar uma venda a prazo, conforme a filial configurou em Configuracoes
 * (`?emitir=promissoria,carne`). `?depois=` e' para onde o fluxo da venda
 * seguiria (recibo, minuta, lista): o botao "Continuar" leva pra la', entao
 * nada do fluxo de hoje se perde.
 */

type DocumentoDaVenda = Exclude<DocumentoDeCobranca, 'recibo'>;
type InfoDocumento = (typeof DOCUMENTOS_DE_COBRANCA)[number] & { chave: DocumentoDaVenda };

const DOCUMENTOS_DA_VENDA = DOCUMENTOS_DE_COBRANCA.filter((d): d is InfoDocumento => d.chave !== 'recibo');
const ehDocumentoDaVenda = (valor: string): valor is DocumentoDaVenda => DOCUMENTOS_DA_VENDA.some((d) => d.chave === valor);

interface DadosDaVenda {
  venda: VendaParaDocumentos;
  parcelas: ParcelaDocumento[];
  empresa: ParteDocumento;
  cliente: ParteDocumento;
  mensagem: string;
  emissao: EmissaoDocumentos;
}

const DocumentosCobranca: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [dados, setDados] = useState<DadosDaVenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [marcados, setMarcados] = useState<Record<DocumentoDaVenda, boolean>>({ promissoria: true, carne: false, duplicata: false });
  const [vias, setVias] = useState<Record<DocumentoDaVenda, number>>({ promissoria: 1, carne: 1, duplicata: 1 });
  const [pdf, setPdf] = useState<{ blob: Blob; nome: string } | null>(null);
  const emitidoAutomatico = useRef(false);

  const pedidosDaUrl = useMemo(
    () => (searchParams.get('emitir') || '').split(',').map((s) => s.trim()).filter(ehDocumentoDaVenda),
    [searchParams],
  );
  const depois = searchParams.get('depois') || '';

  useEffect(() => {
    const carregar = async () => {
      if (!id || !tenantId) return;
      try {
        const snap = await getDoc(doc(db, 'pedidos_venda', id));
        if (!snap.exists()) {
          showError('Pedido não encontrado', 'Este pedido não existe mais ou pertence a outra filial.');
          navigate('/pedidos-venda');
          return;
        }
        const pedido = { id: snap.id, ...snap.data() } as Record<string, any>;
        if (vendasVisiveisDeUsuarioId && !isVendaDoUsuario(pedido, vendasVisiveisDeUsuarioId)) {
          showError(TITULO_VENDA_DE_OUTRO_USUARIO, MENSAGEM_VENDA_DE_OUTRO_USUARIO);
          navigate('/pedidos-venda');
          return;
        }

        // Cadastro do cliente: pelo id quando a venda guardou, senao pelo nome (vendas antigas).
        let cadastroCliente: unknown = null;
        if (pedido.clienteId) {
          const snapCliente = await getDoc(doc(db, 'clientes', String(pedido.clienteId)));
          if (snapCliente.exists()) cadastroCliente = snapCliente.data();
        }
        if (!cadastroCliente && pedido.clienteNome) {
          const snapClientes = await getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', pedido.clienteNome)));
          if (!snapClientes.empty) cadastroCliente = snapClientes.docs[0].data();
        }

        // Parcelas: as transacoes de entrada da venda (juros/multa e cancelada fora), como no recibo impresso.
        const snapTransacoes = await getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('pedidoId', '==', id)));
        const parcelasCarregadas = snapTransacoes.docs
          .map((docT) => docT.data())
          .filter((t) => t.tipo !== 'saida' && t.status !== 'Cancelada' && !t.acrescimoDaTransacaoId)
          .sort((a, b) => (a.paymentIndex ?? 0) - (b.paymentIndex ?? 0))
          .map((t, index) => ({ numero: t.paymentIndex ?? (index + 1), dataVencimento: t.dataVencimento || '', valor: t.valor || 0 }));
        const parcelas = parcelasDoPedido(parcelasParaImpressao(parcelasCarregadas, pedido.pagamentos));

        const snapConfig = await getDoc(doc(db, 'configuracoes', tenantId));
        const config = (snapConfig.exists() ? snapConfig.data() : {}) as Record<string, unknown>;
        const emissao = parseEmissaoDocumentos(config.emissaoDocumentos);

        setDados({
          venda: {
            numeroPedido: String(pedido.numeroPedido ?? ''),
            dataVenda: String(pedido.dataVenda || pedido.data || '').slice(0, 10),
            totalCentavos: Math.round(Number(pedido.valorTotal || 0) * 100),
          },
          parcelas,
          empresa: emitenteDaConfiguracao(config),
          cliente: parteDoCliente(cadastroCliente, pedido.clienteNome),
          mensagem: mensagemDoDocumento(parseMensagensPadrao(config.mensagensPadrao), 'carne'),
          emissao,
        });
        setVias({ promissoria: emissao.promissoria.vias, carne: emissao.carne.vias, duplicata: emissao.duplicata.vias });
        const iniciais: DocumentoDaVenda[] = pedidosDaUrl.length > 0
          ? pedidosDaUrl
          : DOCUMENTOS_DA_VENDA.filter((d) => emissao[d.chave].modo !== 'nunca').map((d) => d.chave);
        setMarcados({
          promissoria: iniciais.length === 0 || iniciais.includes('promissoria'),
          carne: iniciais.includes('carne'),
          duplicata: iniciais.includes('duplicata'),
        });
      } catch (error) {
        console.error('Erro ao carregar os documentos da venda', error);
        showError('Não foi possível carregar a venda', error instanceof Error ? error.message : 'Tente abrir de novo pelo pedido.');
      } finally {
        setLoading(false);
      }
    };
    void carregar();
  }, [id, tenantId, vendasVisiveisDeUsuarioId, navigate, pedidosDaUrl]);

  const duplicata = useMemo(() => (dados ? montarDuplicatas(dados) : null), [dados]);

  const emitir = (selecionados: DocumentoDaVenda[]) => {
    if (!dados) return;
    if (dados.parcelas.length === 0) {
      showError('Venda sem parcelas', 'Esta venda não tem parcelas registradas no financeiro, e promissória, carnê e duplicata precisam delas.');
      return;
    }
    let duplicatas: DuplicataDocumento[] | undefined;
    if (selecionados.includes('duplicata') && duplicata) {
      if (duplicata.ok) duplicatas = duplicata.duplicatas;
      else showWarning('Duplicata não emitida', duplicata.erro);
    }
    const promissorias = selecionados.includes('promissoria') ? montarPromissorias(dados) : undefined;
    const carne = selecionados.includes('carne') ? montarCarne(dados) : undefined;
    if (!promissorias && !carne && !duplicatas) return;
    const blob = gerarPdfDocumentosDaVenda({ promissorias, carne, duplicatas, vias });
    const tipos = [promissorias && 'PROMISSORIA', carne && 'CARNE', duplicatas && 'DUPLICATA'].filter(Boolean).join(' ');
    setPdf({ blob, nome: `${tipos} PEDIDO ${dados.venda.numeroPedido} - ${dados.cliente.nome}.pdf` });
  };

  // Veio do fim da venda com documentos ja' escolhidos: abre o PDF sem clique.
  useEffect(() => {
    if (!dados || emitidoAutomatico.current || pedidosDaUrl.length === 0) return;
    emitidoAutomatico.current = true;
    emitir(pedidosDaUrl);
  }, [dados, pedidosDaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const continuar = () => navigate(depois || '/pedidos-venda');
  const duplicataIndisponivel = duplicata !== null && !duplicata.ok;
  const selecionados = DOCUMENTOS_DA_VENDA.map((d) => d.chave).filter((chave) => marcados[chave] && !(chave === 'duplicata' && duplicataIndisponivel));

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando a venda...</div>;
  }
  if (!dados) return null;

  const primeiraParcela = dados.parcelas[0];
  const ultimaParcela = dados.parcelas[dados.parcelas.length - 1];
  const estiloSelect: React.CSSProperties = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--text-primary)' };

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button type="button" className="btn-secondary" onClick={() => navigate(`/pedidos-venda/visualizar/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} /> Voltar
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={20} style={{ color: 'var(--accent-purple)' }} /> Documentos da venda nº {dados.venda.numeroPedido}
          </h1>
        </div>
        {depois && (
          <button type="button" className="btn-secondary" onClick={continuar} title="Segue o fluxo da venda (recibo, minuta ou lista)" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Continuar <ArrowRight size={16} />
          </button>
        )}
      </div>

      <div className="card" style={{ padding: '16px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '14px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Cliente</div>
          <div style={{ fontWeight: 600 }}>{dados.cliente.nome || '—'}</div>
          {dados.cliente.documento && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{dados.cliente.documento}</div>}
        </div>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Parcelas</div>
          <div style={{ fontWeight: 600 }}>{dados.parcelas.length === 0 ? 'Nenhuma no financeiro' : `${dados.parcelas.length}x`}</div>
          {primeiraParcela && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {!primeiraParcela.vencimento ? 'Sem vencimento no financeiro (venda à vista)' : dados.parcelas.length === 1 ? `Vence em ${formatarDataBr(primeiraParcela.vencimento)}` : `De ${formatarDataBr(primeiraParcela.vencimento)} a ${formatarDataBr(ultimaParcela.vencimento)}`}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total da venda</div>
          <div style={{ fontWeight: 600 }}>{reaisFormatado(dados.venda.totalCentavos)}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Venda de {formatarDataBr(dados.venda.dataVenda)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: '20px 24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {DOCUMENTOS_DA_VENDA.map((info) => {
          const indisponivel = info.chave === 'duplicata' && duplicataIndisponivel;
          return (
            <label key={info.chave} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 100px', gap: '16px', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)', cursor: indisponivel ? 'not-allowed' : 'pointer', opacity: indisponivel ? 0.6 : 1 }}>
              <input
                type="checkbox"
                checked={marcados[info.chave] && !indisponivel}
                disabled={indisponivel}
                onChange={(e) => { const ligado = e.target.checked; setMarcados((atual) => ({ ...atual, [info.chave]: ligado })); }}
                style={{ width: '18px', height: '18px' }}
              />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{info.rotulo}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {indisponivel && duplicata && !duplicata.ok ? duplicata.erro : info.quando}
                </div>
              </div>
              <select
                value={vias[info.chave]}
                disabled={indisponivel}
                title="Quantas vias saem no PDF"
                onChange={(e) => { const n = Number(e.target.value); setVias((atual) => ({ ...atual, [info.chave]: n })); }}
                onClick={(e) => e.stopPropagation()}
                style={estiloSelect}
              >
                {Array.from({ length: VIAS_MAXIMAS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} via{n > 1 ? 's' : ''}</option>)}
              </select>
            </label>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', paddingTop: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>O PDF abre aqui dentro, com Imprimir e Salvar.</span>
          <button type="button" className="btn-primary" disabled={selecionados.length === 0 || dados.parcelas.length === 0} onClick={() => emitir(selecionados)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={16} /> Gerar PDF
          </button>
        </div>
      </div>

      {pdf && <PdfVisualizador titulo={`Documentos da venda nº ${dados.venda.numeroPedido}`} nomeArquivo={pdf.nome} pdf={pdf.blob} onFechar={() => setPdf(null)} />}
    </div>
  );
};

export default DocumentosCobranca;

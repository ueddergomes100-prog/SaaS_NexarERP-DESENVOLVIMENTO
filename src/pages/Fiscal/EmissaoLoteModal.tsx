import React, { useMemo, useRef, useState } from 'react';
import { X, Loader2, CheckCircle, XCircle, AlertCircle, MinusCircle, Search, FileText, FileDown, Printer } from 'lucide-react';
import SeletorTodas from '../../components/common/SeletorTodas';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { NexusSwal, showError, showWarning } from '../../utils/alerts';
import { nomeArquivoDocumento } from '../../utils/nomeArquivoDomain';
import { juntarPdfs } from '../../utils/juntarPdfs';

/**
 * Ate' 10 notas por lote (2026-09-30, combinado com o dono): cada nota leva alguns
 * segundos na SEFAZ e, no fim, os PDFs das autorizadas aparecem aqui pra conferir e
 * salvar um por um -- com 10 a lista ainda cabe na tela e a espera e' curta.
 */
export const LIMITE_NOTAS_POR_LOTE = 10;

/**
 * EMITIR VARIAS NF-e DE UMA VEZ (2026-09-30, pedido do dono: "checkbox pra emitir
 * varias notas ao mesmo tempo", na tela de Notas Fiscais).
 *
 * Esta tela so' escolhe os pedidos e mostra o andamento. Quem monta e transmite
 * cada nota e' a propria NFE.tsx (`executar`), com as MESMAS regras da emissao
 * normal: trava de nota duplicada, endereco/IE do cadastro, parcelas e fatura do
 * boleto. Uma nota por vez; um pedido com problema nao para os outros.
 */

export interface PedidoParaLote {
  id: string;
  numeroPedido: string;
  clienteNome: string;
  clienteCodigo: string;
  valorTotal: number;
  formaPagamento: string;
  data: string;
  /** Ja' teve NF-e rejeitada: a emissao em lote reenvia a mesma nota corrigida. */
  temRejeitada: boolean;
}

export type EstadoItemLote = 'aguardando' | 'emitindo' | 'processando' | 'autorizada' | 'rejeitada' | 'pulada' | 'erro';

export interface ResultadoItemLote {
  estado: EstadoItemLote;
  mensagem?: string;
  numeroNota?: number | null;
  /** Id da nota na Spedy -- pra abrir o PDF (DANFE) das autorizadas no fim do lote. */
  spedyId?: string;
}

interface Props {
  pedidos: PedidoParaLote[];
  onFechar: () => void;
  /** Emite os pedidos na ordem, chamando `avisar` a cada mudanca; para entre um pedido e outro se `deveParar()`. */
  executar: (ids: string[], avisar: (id: string, resultado: ResultadoItemLote) => void, deveParar: () => boolean) => Promise<void>;
  /** PDF (DANFE) de uma nota autorizada, pelo id da Spedy. */
  baixarPdf: (spedyId: string) => Promise<Blob>;
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const ROTULO: Record<EstadoItemLote, { texto: string; cor: string; Icone: React.FC<{ size?: number; className?: string }> }> = {
  aguardando: { texto: 'Na fila', cor: 'var(--text-muted)', Icone: MinusCircle },
  emitindo: { texto: 'Transmitindo...', cor: '#3b82f6', Icone: Loader2 },
  processando: { texto: 'Aguardando a SEFAZ...', cor: '#f59e0b', Icone: Loader2 },
  autorizada: { texto: 'Autorizada', cor: '#10b981', Icone: CheckCircle },
  rejeitada: { texto: 'Rejeitada', cor: '#ef4444', Icone: XCircle },
  pulada: { texto: 'Não emitida', cor: '#f59e0b', Icone: AlertCircle },
  erro: { texto: 'Não emitida', cor: '#ef4444', Icone: XCircle },
};

const EmissaoLoteModal: React.FC<Props> = ({ pedidos, onFechar, executar, baixarPdf }) => {
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [resultados, setResultados] = useState<Record<string, ResultadoItemLote> | null>(null);
  const [rodando, setRodando] = useState(false);
  const pararRef = useRef(false);
  const [pdfAberto, setPdfAberto] = useState<{ titulo: string; nome: string; blob: Blob; imprimir?: boolean } | null>(null);
  const [carregandoPdf, setCarregandoPdf] = useState<string | null>(null);
  const [salvandoTodos, setSalvandoTodos] = useState(false);
  const [imprimindoTodas, setImprimindoTodas] = useState(false);

  const nomeDoPdf = (p: PedidoParaLote, r: ResultadoItemLote) => nomeArquivoDocumento({ tipo: 'NFE', numero: r.numeroNota, destinatario: p.clienteNome });
  const verPdf = async (p: PedidoParaLote, r: ResultadoItemLote) => {
    if (!r.spedyId) return;
    setCarregandoPdf(p.id);
    try {
      const blob = await baixarPdf(r.spedyId);
      setPdfAberto({ titulo: `NF-e nº ${r.numeroNota ?? ''} — ${p.clienteNome}`, nome: nomeDoPdf(p, r), blob });
    } catch (erro) {
      showError('Não foi possível abrir o PDF', (erro as Error).message || 'Tente de novo em instantes.');
    } finally {
      setCarregandoPdf(null);
    }
  };
  /** Baixa o PDF de cada autorizada, um arquivo por nota, ja' com o nome certo. */
  const salvarTodos = async () => {
    const autorizadas = pedidos.filter((p) => resultados?.[p.id]?.estado === 'autorizada' && resultados[p.id].spedyId);
    setSalvandoTodos(true);
    let falhas = 0;
    for (const p of autorizadas) {
      const r = resultados![p.id];
      try {
        const blob = await baixarPdf(r.spedyId!);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nomeDoPdf(p, r);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        // Um respiro entre os arquivos: alguns navegadores barram varios downloads seguidos.
        await new Promise((resolver) => setTimeout(resolver, 400));
      } catch {
        falhas += 1;
      }
    }
    setSalvandoTodos(false);
    if (falhas > 0) showError('Alguns PDFs não foram salvos', `${falhas} PDF(s) não puderam ser baixados. Use "Ver PDF" na linha da nota.`);
  };

  /**
   * "Imprimir as emitidas" (2026-10-01, pedido do cliente): junta os DANFEs das
   * autorizadas num PDF so', na ordem da lista, e ja' abre a impressao -- uma
   * janela de impressao so' em vez de salvar arquivo por arquivo.
   */
  const imprimirTodas = async () => {
    const autorizadas = pedidos.filter((p) => resultados?.[p.id]?.estado === 'autorizada' && resultados[p.id].spedyId);
    setImprimindoTodas(true);
    const arquivos: Blob[] = [];
    const semPdf: string[] = [];
    for (const p of autorizadas) {
      const r = resultados![p.id];
      try {
        arquivos.push(await baixarPdf(r.spedyId!));
      } catch {
        semPdf.push(`nº ${r.numeroNota ?? '?'} (${p.clienteNome})`);
      }
    }
    try {
      if (arquivos.length === 0) {
        showError('Não foi possível montar a impressão', 'Nenhum PDF das notas autorizadas pôde ser baixado agora. Tente de novo em instantes.');
        return;
      }
      const unico = await juntarPdfs(arquivos);
      setPdfAberto({ titulo: `${arquivos.length} NF-e autorizada${arquivos.length === 1 ? '' : 's'} do lote`, nome: 'NFE lote.pdf', blob: unico, imprimir: true });
      if (semPdf.length > 0) {
        showWarning('Algumas notas ficaram fora da impressão', `Não foi possível baixar o PDF da(s) nota(s) ${semPdf.join(', ')}. Use "Ver PDF" na linha da nota.`);
      }
    } catch (erro) {
      console.error('Erro ao juntar os PDFs do lote:', erro);
      showError('Não foi possível montar a impressão', 'Os PDFs foram baixados, mas não deu para juntá-los. Use "Salvar os PDFs" ou "Ver PDF" em cada nota.');
    } finally {
      setImprimindoTodas(false);
    }
  };

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return pedidos;
    // Codigo do cliente: "7", "07" e "0007" sao o mesmo cliente.
    const codigo = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '');
    const codigoBuscado = codigo(termo);
    return pedidos.filter((p) => (
      p.clienteNome.toLowerCase().includes(termo)
      || p.numeroPedido.includes(termo)
      || (codigoBuscado !== '' && codigo(p.clienteCodigo) === codigoBuscado)
    ));
  }, [pedidos, busca]);

  const idsVisiveis = visiveis.map((p) => p.id);
  const marcadosVisiveis = idsVisiveis.filter((id) => selecionados.includes(id)).length;
  const estadoSeletor = marcadosVisiveis === 0 ? 'nenhuma' : marcadosVisiveis === idsVisiveis.length ? 'todas' : 'parcial';

  const avisarLimite = () => showWarning(`Até ${LIMITE_NOTAS_POR_LOTE} notas por lote`, `Emita estas ${LIMITE_NOTAS_POR_LOTE} e depois abra o lote de novo para as próximas.`);
  const alternar = (id: string) => {
    if (!selecionados.includes(id) && selecionados.length >= LIMITE_NOTAS_POR_LOTE) {
      avisarLimite();
      return;
    }
    setSelecionados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  };
  const alternarVisiveis = (marcar: boolean) => {
    if (!marcar) {
      setSelecionados((atual) => atual.filter((id) => !idsVisiveis.includes(id)));
      return;
    }
    const novos = [...new Set([...selecionados, ...idsVisiveis])];
    if (novos.length > LIMITE_NOTAS_POR_LOTE) avisarLimite();
    setSelecionados(novos.slice(0, LIMITE_NOTAS_POR_LOTE));
  };

  const iniciar = async () => {
    const ordem = pedidos.filter((p) => selecionados.includes(p.id)).map((p) => p.id);
    if (ordem.length === 0) return;
    const total = pedidos.filter((p) => selecionados.includes(p.id)).reduce((s, p) => s + p.valorTotal, 0);
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: `Emitir ${ordem.length} NF-e?`,
      text: `Serão transmitidas ${ordem.length} notas fiscais de verdade para a SEFAZ (total ${moeda(total)}), uma de cada vez. Pedido com problema no cadastro fica de fora e aparece com o motivo — os outros seguem.`,
      showCancelButton: true,
      confirmButtonText: 'Sim, emitir',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;

    pararRef.current = false;
    setRodando(true);
    setResultados(Object.fromEntries(ordem.map((id) => [id, { estado: 'aguardando' as const }])));
    try {
      await executar(
        ordem,
        (id, resultado) => setResultados((atual) => ({ ...(atual || {}), [id]: resultado })),
        () => pararRef.current,
      );
    } finally {
      setRodando(false);
    }
  };

  const lista = resultados ? pedidos.filter((p) => resultados[p.id]) : visiveis;
  const contagem = resultados
    ? Object.values(resultados).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.estado]: (acc[r.estado] || 0) + 1 }), {})
    : {};

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
      <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '980px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 12px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--text-primary)' }}>Emitir NF-e em lote</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {resultados
                ? `${contagem.autorizada || 0} autorizada(s) · ${(contagem.rejeitada || 0) + (contagem.erro || 0) + (contagem.pulada || 0)} com problema · ${(contagem.aguardando || 0) + (contagem.emitindo || 0) + (contagem.processando || 0)} em andamento`
                : `Pedidos finalizados que ainda não têm NF-e. Marque até ${LIMITE_NOTAS_POR_LOTE} por vez — no fim, os PDFs aparecem aqui para conferir e salvar.`}
            </p>
          </div>
          <button type="button" onClick={onFechar} disabled={rodando} title={rodando ? 'Aguarde terminar (ou clique em Parar)' : 'Fechar'} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: rodando ? 'not-allowed' : 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        {!resultados && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 28px 12px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 280px' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por cliente, código do cliente ou nº do pedido..."
                style={{ width: '100%', padding: '10px 12px 10px 36px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
              />
            </div>
            <SeletorTodas estado={estadoSeletor} onAlternar={alternarVisiveis} rotulo={busca ? 'as encontradas' : 'todas'} desabilitado={idsVisiveis.length === 0} />
          </div>
        )}

        <div style={{ overflowY: 'auto', padding: '0 28px', flex: 1 }}>
          {lista.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>
              {pedidos.length === 0 ? 'Nenhum pedido finalizado sem NF-e.' : 'Nenhum pedido encontrado para essa busca.'}
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  {!resultados && <th style={{ padding: '8px 6px', width: '32px' }} />}
                  <th style={{ padding: '8px 6px' }}>Pedido</th>
                  <th style={{ padding: '8px 6px' }}>Cód.</th>
                  <th style={{ padding: '8px 6px' }}>Cliente</th>
                  <th style={{ padding: '8px 6px' }}>Data</th>
                  <th style={{ padding: '8px 6px' }}>Pagamento</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Valor</th>
                  {resultados && <th style={{ padding: '8px 6px' }}>Situação</th>}
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const r = resultados?.[p.id];
                  const rotulo = r ? ROTULO[r.estado] : null;
                  return (
                    <tr key={p.id} onClick={() => !resultados && alternar(p.id)} style={{ borderTop: '1px solid var(--border-color)', cursor: resultados ? 'default' : 'pointer' }}>
                      {!resultados && (
                        <td style={{ padding: '8px 6px' }}>
                          <input type="checkbox" checked={selecionados.includes(p.id)} onChange={() => alternar(p.id)} onClick={(e) => e.stopPropagation()} aria-label={`Emitir NF-e do pedido ${p.numeroPedido}`} />
                        </td>
                      )}
                      <td style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--text-primary)' }}>#{p.numeroPedido}</td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{p.clienteCodigo || '—'}</td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-primary)' }}>
                        {p.clienteNome}
                        {p.temRejeitada && !resultados && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#f59e0b' }}>(reenvio da rejeitada)</span>}
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{p.data}</td>
                      <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{p.formaPagamento || '—'}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-primary)' }}>{moeda(p.valorTotal)}</td>
                      {resultados && rotulo && (
                        <td style={{ padding: '8px 6px', color: rotulo.cor, minWidth: '220px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                            <rotulo.Icone size={14} className={r?.estado === 'emitindo' || r?.estado === 'processando' ? 'spin-icon' : undefined} />
                            {rotulo.texto}{r?.numeroNota ? ` nº ${r.numeroNota}` : ''}
                          </span>
                          {r?.mensagem && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{r.mensagem}</div>}
                          {r?.estado === 'autorizada' && r.spedyId && (
                            <button type="button" className="btn-secondary" onClick={() => void verPdf(p, r)} disabled={carregandoPdf === p.id}
                              style={{ marginTop: '6px', padding: '4px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              {carregandoPdf === p.id ? <Loader2 size={14} className="spin-icon" /> : <FileText size={14} />} Ver PDF
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 28px 24px', borderTop: '1px solid var(--border-color)' }}>
          {!resultados && (
            <>
              <button type="button" className="btn-secondary" onClick={onFechar}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={iniciar} disabled={selecionados.length === 0}>
                Emitir {selecionados.length > 0 ? `${selecionados.length} ` : ''}NF-e
              </button>
            </>
          )}
          {resultados && rodando && (
            <button type="button" className="btn-secondary" onClick={() => { pararRef.current = true; }}>
              Parar depois desta nota
            </button>
          )}
          {resultados && !rodando && (contagem.autorizada || 0) > 0 && (
            <button type="button" className="btn-primary" onClick={() => void imprimirTodas()} disabled={imprimindoTodas}
              title="Junta as notas autorizadas num PDF só e abre a impressão"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {imprimindoTodas ? <Loader2 size={16} className="spin-icon" /> : <Printer size={16} />}
              Imprimir {contagem.autorizada === 1 ? 'a emitida' : `as ${contagem.autorizada} emitidas`}
            </button>
          )}
          {resultados && !rodando && (contagem.autorizada || 0) > 0 && (
            <button type="button" className="btn-secondary" onClick={() => void salvarTodos()} disabled={salvandoTodos}
              title="Baixa um PDF por nota, já com o nome: NFE número - cliente"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {salvandoTodos ? <Loader2 size={16} className="spin-icon" /> : <FileDown size={16} />}
              Salvar os {contagem.autorizada} PDF{contagem.autorizada === 1 ? '' : 's'}
            </button>
          )}
          {resultados && !rodando && (
            <button type="button" className="btn-primary" onClick={onFechar}>Fechar</button>
          )}
        </div>
      </div>
      {pdfAberto && (
        <PdfVisualizador titulo={pdfAberto.titulo} nomeArquivo={pdfAberto.nome} pdf={pdfAberto.blob} imprimirAoAbrir={pdfAberto.imprimir} onFechar={() => setPdfAberto(null)} />
      )}
    </div>
  );
};

export default EmissaoLoteModal;

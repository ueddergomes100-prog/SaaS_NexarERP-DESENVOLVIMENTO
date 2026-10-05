import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Printer, ShoppingBag, Undo2, X } from 'lucide-react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  ROTULO_STATUS_CONDICIONAL,
  acoesDoCondicional,
  estaVencido,
  itensQueFicaram,
  planejarDevolucao,
  quantidadePendente,
  resumirCondicional,
} from '../../utils/condicionalDomain';
import { CondicionalError, condicionalService } from '../../services/condicionalService';
import PdfVisualizador from '../../components/common/PdfVisualizador';
import { gerarTermoCondicionalPdf, nomeArquivoTermoCondicional } from './condicionalPdf';
import { MensagemCondicionalDesligado, MensagemSemPermissaoCondicional, usePodeUsarCondicional } from './CondicionaisList';
import { ESTILO_STATUS, dataBr, moeda, type CondicionalDoc } from './condicionalTipos';

/**
 * DETALHE DO CONDICIONAL (2026-10-05): a tela de trabalho. Em cada item a
 * pessoa digita quanto voltou AGORA e escolhe:
 *  - Registrar devolução: libera a reserva do que voltou; o resto continua com o cliente.
 *  - Fechar: aplica o que voltou agora e o que ficou vira PRÉ-VENDA (com a reserva).
 *  - Cancelar: libera a reserva de tudo que ainda estava com o cliente.
 * Quem grava é o servidor (condicionalService).
 */

const ROTULO_HISTORICO: Record<string, string> = {
  saida: 'Saída',
  devolucao: 'Devolução',
  fechamento: 'Fechamento',
  cancelamento: 'Cancelamento',
};

const CondicionalDetalhe: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { tenantId, trabalhaComCondicional, userNome, currentUser } = useAuth();
  const podeUsar = usePodeUsarCondicional();
  const [condicional, setCondicional] = useState<CondicionalDoc | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [voltouAgora, setVoltouAgora] = useState<Record<string, string>>({});
  const [processando, setProcessando] = useState(false);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [nomeEmpresa, setNomeEmpresa] = useState('');

  useEffect(() => {
    if (!id || !tenantId || !trabalhaComCondicional || !podeUsar) return undefined;
    return onSnapshot(doc(db, 'condicionais', id), (snap) => {
      const dados = snap.exists() ? ({ id: snap.id, ...snap.data() } as CondicionalDoc & { tenantId?: string }) : null;
      setCondicional(dados && dados.tenantId === tenantId ? dados : null);
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao abrir condicional:', erro);
      setCarregando(false);
    });
  }, [id, tenantId, trabalhaComCondicional, podeUsar]);

  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => setNomeEmpresa(String(snap.data()?.nomeOficina || snap.data()?.razaoSocial || '').trim()))
      .catch(() => setNomeEmpresa(''));
  }, [tenantId]);

  const hoje = getDateInputInTimeZone();
  const itens = useMemo(() => condicional?.itens || [], [condicional]);
  const devolucoesDigitadas = useMemo(() => itens
    .map((item) => ({ id: item.id, quantidade: Number(String(voltouAgora[item.id] || '').replace(',', '.')) || 0 }))
    .filter((d) => d.quantidade > 0), [itens, voltouAgora]);

  if (!trabalhaComCondicional) return <MensagemCondicionalDesligado />;
  if (!podeUsar) return <MensagemSemPermissaoCondicional />;
  if (carregando) return <div className="card" style={{ padding: '32px', textAlign: 'center' }}><Loader2 className="spin-icon" /></div>;
  if (!condicional || !tenantId) {
    return <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Condicional não encontrado.</div>;
  }

  const acoes = acoesDoCondicional(condicional.status);
  const resumo = resumirCondicional(itens);
  const vencido = estaVencido(condicional, hoje);
  const estilo = ESTILO_STATUS[condicional.status] || ESTILO_STATUS.cancelado;

  /** Confere o que foi digitado com a mesma regra do servidor, antes de enviar. */
  const conferirDigitado = (): boolean => {
    if (devolucoesDigitadas.length === 0) return true;
    const plano = planejarDevolucao(itens, devolucoesDigitadas);
    if (plano.erros.length) { showError('Confira as quantidades', plano.erros.join('\n')); return false; }
    return true;
  };

  const registrarDevolucao = async () => {
    if (processando) return;
    if (devolucoesDigitadas.length === 0) { showError('Nada a devolver', 'Digite, na coluna "Voltou agora", a quantidade que o cliente devolveu.'); return; }
    if (!conferirDigitado()) return;
    setProcessando(true);
    try {
      const r = await condicionalService.devolver(condicional.id, devolucoesDigitadas, tenantId);
      setVoltouAgora({});
      showSuccess(r.tudoDevolvido ? 'Tudo devolvido! As peças voltaram para o estoque disponível.' : 'Devolução registrada. As peças que voltaram já estão disponíveis.');
    } catch (erro) {
      showError('Não foi possível registrar a devolução', erro instanceof CondicionalError ? erro.message : 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  const fechar = async () => {
    if (processando || !conferirDigitado()) return;
    const depois = devolucoesDigitadas.length ? planejarDevolucao(itens, devolucoesDigitadas).itens : itens;
    const ficaram = itensQueFicaram(depois);
    const totalFicou = ficaram.reduce((s, i) => s + i.subtotal, 0);
    const pecasVoltam = devolucoesDigitadas.reduce((s, d) => s + d.quantidade, 0);
    const html = ficaram.length
      ? `<div style="text-align:left;font-size:14px">${pecasVoltam ? `<b>${pecasVoltam}</b> peça(s) voltam para o estoque.<br/><br/>` : ''}`
        + `O cliente <b>fica</b> com:<br/>${ficaram.map((i) => `• ${i.quantidade.toLocaleString('pt-BR')} ${escaparHtml(i.unidadeMedidaSigla)} — ${escaparHtml(i.nome)}`).join('<br/>')}`
        + `<br/><br/>Isso vira uma <b>pré-venda de ${moeda(totalFicou)}</b>, para finalizar com o pagamento em Pedidos de Venda.</div>`
      : '<div style="text-align:left;font-size:14px">Nada ficou com o cliente: o condicional fecha como <b>tudo devolvido</b> e não gera venda.</div>';
    const confirmacao = await NexusSwal.fire({
      title: 'Fechar o condicional?',
      html,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: ficaram.length ? 'Fechar e gerar pré-venda' : 'Fechar',
      cancelButtonText: 'Voltar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessando(true);
    try {
      const r = await condicionalService.fechar(condicional.id, devolucoesDigitadas, tenantId);
      setVoltouAgora({});
      if (r.pedidoId && r.numeroPedido) {
        showSuccess(`Condicional fechado. Pré-venda #${r.numeroPedido} criada.`);
        openTab(`/pedidos-venda/visualizar/${r.pedidoId}`, `Pedido #${r.numeroPedido}`);
      } else {
        showSuccess('Condicional fechado: tudo devolvido.');
      }
    } catch (erro) {
      showError('Não foi possível fechar o condicional', erro instanceof CondicionalError ? erro.message : 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  const cancelar = async () => {
    if (processando) return;
    const resultado = await NexusSwal.fire({
      title: 'Cancelar o condicional?',
      icon: 'warning',
      html: '<div style="text-align:left;font-size:14px">Use quando a saída foi lançada por engano. A reserva de tudo que ainda está com o cliente é liberada. Para registrar o que o cliente devolveu, use "Registrar devolução" ou "Fechar".</div>',
      input: 'text',
      inputLabel: 'Motivo do cancelamento',
      inputPlaceholder: 'Ex.: lançado no cliente errado',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar',
      cancelButtonText: 'Voltar',
      preConfirm: (motivo: string) => {
        if (String(motivo || '').trim().length < 5) {
          NexusSwal.showValidationMessage('Explique o motivo do cancelamento (mínimo 5 letras).');
          return false;
        }
        return String(motivo).trim();
      },
    });
    if (!resultado.isConfirmed) return;
    setProcessando(true);
    try {
      await condicionalService.cancelar(condicional.id, String(resultado.value), tenantId);
      showSuccess('Condicional cancelado. A reserva das peças foi liberada.');
    } catch (erro) {
      showError('Não foi possível cancelar', erro instanceof CondicionalError ? erro.message : 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  const imprimirTermo = () => {
    try {
      setPdf(gerarTermoCondicionalPdf({
        numeroCondicional: condicional.numeroCondicional,
        nomeEmpresa: nomeEmpresa || 'Loja',
        clienteNome: condicional.clienteNome,
        clienteTelefone: condicional.clienteTelefone,
        dataSaida: condicional.dataSaida,
        prazoDevolucao: condicional.prazoDevolucao,
        observacao: condicional.observacao,
        itens,
        usuarioNome: String(userNome || currentUser?.email || ''),
        geradoEm: new Date(),
      }));
    } catch (erro) {
      console.error('Erro ao gerar termo:', erro);
      showError('Não foi possível gerar o termo', 'Tente novamente.');
    }
  };

  const celula: React.CSSProperties = { padding: '10px 8px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/vendas/condicional')} title="Voltar"><ArrowLeft size={20} /></button>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShoppingBag size={26} color="var(--accent-purple)" /> Condicional #{condicional.numeroCondicional}
              <span style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, color: estilo.cor, backgroundColor: estilo.fundo }}>
                {ROTULO_STATUS_CONDICIONAL[condicional.status] || condicional.status}
              </span>
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              {condicional.clienteNome}{condicional.clienteTelefone ? ` · ${condicional.clienteTelefone}` : ''} · saída em {dataBr(condicional.dataSaida)}
            </p>
          </div>
        </div>
        <button type="button" className="btn-secondary" onClick={imprimirTermo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Printer size={18} /> Imprimir termo
        </button>
      </div>

      {vencido && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
          <AlertTriangle size={18} /> O prazo de devolução era {dataBr(condicional.prazoDevolucao)}. Entre em contato com o cliente.
        </div>
      )}
      {condicional.status === 'finalizado' && condicional.pedidoId && (
        <button
          type="button"
          onClick={() => openTab(`/pedidos-venda/visualizar/${condicional.pedidoId}`, `Pedido #${condicional.numeroPedido}`)}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.4)', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', cursor: 'pointer', textAlign: 'left' }}
        >
          <CheckCircle2 size={18} /> O que ficou com o cliente virou a pré-venda #{condicional.numeroPedido}. Clique para abrir e finalizar com o pagamento.
        </button>
      )}
      {condicional.status === 'cancelado' && condicional.motivoCancelamento && (
        <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
          Cancelado: {condicional.motivoCancelamento}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        {[
          ['Devolver até', dataBr(condicional.prazoDevolucao)],
          ['Peças levadas', resumo.pecasLevadas.toLocaleString('pt-BR')],
          ['Peças devolvidas', resumo.pecasDevolvidas.toLocaleString('pt-BR')],
          ['Com o cliente', `${resumo.pecasComCliente.toLocaleString('pt-BR')} · ${moeda(resumo.valorComCliente)}`],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{rotulo}</div>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>{valor}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '24px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              <th style={celula}>Produto</th>
              <th style={{ ...celula, textAlign: 'right' }}>Levou</th>
              <th style={{ ...celula, textAlign: 'right' }}>Devolveu</th>
              <th style={{ ...celula, textAlign: 'right' }}>Com o cliente</th>
              <th style={{ ...celula, textAlign: 'right' }}>Preço</th>
              {acoes.devolver && <th style={{ ...celula, textAlign: 'right' }}>Voltou agora</th>}
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const pendente = quantidadePendente(item);
              return (
                <tr key={item.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={celula}>{item.codigo ? `${item.codigo} — ` : ''}{item.nome}</td>
                  <td style={{ ...celula, textAlign: 'right' }}>{item.quantidade.toLocaleString('pt-BR')} {item.unidadeMedidaSigla}</td>
                  <td style={{ ...celula, textAlign: 'right' }}>{item.quantidadeDevolvida.toLocaleString('pt-BR')}</td>
                  <td style={{ ...celula, textAlign: 'right', fontWeight: 700 }}>{pendente.toLocaleString('pt-BR')}</td>
                  <td style={{ ...celula, textAlign: 'right' }}>{moeda(item.precoUnitario)}</td>
                  {acoes.devolver && (
                    <td style={{ ...celula, textAlign: 'right' }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Quanto de ${item.nome} voltou agora`}
                        placeholder="0"
                        disabled={pendente === 0 || processando}
                        value={voltouAgora[item.id] || ''}
                        onChange={(e) => setVoltouAgora((atual) => ({ ...atual, [item.id]: e.target.value.replace(/[^0-9,.]/g, '') }))}
                        style={{ width: '90px', textAlign: 'right', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--text-primary)' }}
                      />
                      {pendente > 0 && (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Voltou tudo deste item"
                          disabled={processando}
                          onClick={() => setVoltouAgora((atual) => ({ ...atual, [item.id]: String(pendente) }))}
                          style={{ marginLeft: '4px' }}
                        >
                          <Undo2 size={15} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {condicional.observacao && (
          <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Obs.: {condicional.observacao}</p>
        )}
      </div>

      {(acoes.devolver || acoes.fechar || acoes.cancelar) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          {acoes.cancelar && (
            <button type="button" className="btn-secondary" disabled={processando} onClick={() => void cancelar()} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
              <X size={18} /> Cancelar condicional
            </button>
          )}
          {acoes.devolver && (
            <button type="button" className="btn-secondary" disabled={processando} onClick={() => void registrarDevolucao()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Undo2 size={18} /> Registrar devolução
            </button>
          )}
          {acoes.fechar && (
            <button type="button" className="btn-primary" disabled={processando} onClick={() => void fechar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {processando ? <Loader2 size={18} className="spin-icon" /> : <CheckCircle2 size={18} />} Fechar condicional
            </button>
          )}
        </div>
      )}

      {(condicional.historico || []).length > 0 && (
        <div className="card" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px' }}>Histórico</h3>
          <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(condicional.historico || []).map((h, i) => (
              <li key={`${h.em}-${i}`}>
                <strong style={{ color: 'var(--text-primary)' }}>{ROTULO_HISTORICO[h.tipo] || h.tipo}</strong>
                {' '}em {new Date(h.em).toLocaleString('pt-BR')}{h.porNome ? ` por ${h.porNome}` : ''}
                {h.tipo === 'devolucao' && h.itens ? ` — ${h.itens.reduce((s, x) => s + x.quantidade, 0)} peça(s)` : ''}
                {h.tipo === 'fechamento' && h.numeroPedido ? ` — virou a pré-venda #${h.numeroPedido}` : ''}
                {h.tipo === 'fechamento' && h.semVenda ? ' — tudo devolvido' : ''}
                {h.tipo === 'cancelamento' && h.motivo ? ` — ${h.motivo}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pdf && (
        <PdfVisualizador
          titulo={`Termo do condicional #${condicional.numeroCondicional}`}
          nomeArquivo={nomeArquivoTermoCondicional(condicional.numeroCondicional, condicional.clienteNome)}
          pdf={pdf}
          onFechar={() => setPdf(null)}
        />
      )}
    </div>
  );
};

export default CondicionalDetalhe;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import { devolucaoAppService, type DadosDevolucaoNoApp } from '../../services/devolucaoAppService';
import { ROTULO_DESTINO_DEVOLUCAO, montarItensDevolvidos, type DestinoDevolucao } from '../../utils/devolucaoVendaDomain';
import VendedorHeader from './VendedorHeader';
import { useVoltarPara } from './navegacaoApp';
import { novoLocalId } from './vendedorRascunhosStore';

/**
 * DEVOLUCAO PELO APP (24/11/2026). O vendedor escolhe os itens de um pedido
 * QUE ELE FEZ no app e a loja ja' faturou, o motivo e para onde vai o valor.
 * Tudo e' conferido e gravado pelo servidor (devolucaoAppService); precisa de
 * internet. Padrao: fica "Aguardando confirmacao" ate' o escritorio confirmar.
 */

const OBSERVACAO_MAX = 300;
const DESTINOS: DestinoDevolucao[] = ['credito', 'caixa', 'banco'];
const EXPLICA_DESTINO: Record<DestinoDevolucao, string> = {
  credito: 'Fica como saldo para o cliente usar em compras.',
  caixa: 'A loja devolve em dinheiro, do caixa.',
  banco: 'Pix ou transferência, de um banco da loja.',
};

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const arred = (n: number) => Math.round(n * 10000) / 10000;

const cartao: React.CSSProperties = {
  padding: '14px 16px', borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
};
const tituloSecao: React.CSSProperties = {
  fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px',
};
const opcao = (marcada: boolean): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', width: '100%', textAlign: 'left', padding: '11px 14px',
  borderRadius: '12px', cursor: 'pointer', fontSize: '15px', fontWeight: 700,
  border: `1.5px solid ${marcada ? 'var(--brand-500)' : 'var(--border-color)'}`,
  backgroundColor: marcada ? 'rgba(139,92,246,0.12)' : 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
});
const botaoQtd: React.CSSProperties = {
  width: '38px', height: '38px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)',
  color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
};

const VendedorNovaDevolucao: React.FC = () => {
  const { pedidoId = '' } = useParams();
  const navigate = useNavigate();
  const voltarPara = useVoltarPara();
  const [dados, setDados] = useState<DadosDevolucaoNoApp | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState('');
  const [destino, setDestino] = useState<DestinoDevolucao>('credito');
  const [bancoId, setBancoId] = useState('');
  const [formaBancaria, setFormaBancaria] = useState('Pix');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Id fixo deste envio: reenviar depois de uma queda nao duplica a devolucao.
  const idDocumento = useRef(novoLocalId());

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    devolucaoAppService.dados(pedidoId)
      .then((d) => { if (!cancelado) setDados(d); })
      .catch((erro) => { if (!cancelado) setErroCarga(erro instanceof Error ? erro.message : 'Não foi possível abrir o pedido.'); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [pedidoId]);

  const voltar = () => voltarPara(`/vendedor/pedido/${pedidoId}`);

  const montagem = useMemo(() => {
    if (!dados) return null;
    const emAguardo = new Map(dados.itens.map((i) => [i.indice, i.emAguardo]));
    return montarItensDevolvidos(
      dados.itens,
      dados.itens.map((i) => ({ indice: i.indice, id: i.id, nome: i.nome, quantidade: Number(String(quantidades[i.indice] || '0').replace(',', '.')) || 0 })),
      emAguardo,
    );
  }, [dados, quantidades]);

  const algumItem = Object.values(quantidades).some((q) => Number(String(q).replace(',', '.')) > 0);
  const valorTotal = montagem && montagem.ok ? montagem.valorTotal : 0;
  const bloqueadoPeloPrazo = Boolean(dados?.prazo.foraDoPrazo && dados.prazo.acao === 'bloquear');
  const faltando = !algumItem ? 'Escolha os itens e as quantidades.'
    : montagem && !montagem.ok ? montagem.erro
      : !motivo ? 'Escolha o motivo.'
        : destino === 'banco' && !bancoId ? 'Escolha o banco.'
          : '';

  const mudarQtd = (indice: number, valor: string, disponivel: number) => {
    const limpo = valor.replace(/[^0-9.,]/g, '');
    const n = Number(limpo.replace(',', '.'));
    setQuantidades((atual) => ({ ...atual, [indice]: Number.isFinite(n) && n > disponivel ? String(disponivel) : limpo }));
  };
  const somar = (indice: number, delta: number, disponivel: number) => {
    setQuantidades((atual) => {
      const n = Number(String(atual[indice] || '0').replace(',', '.')) || 0;
      const novo = Math.max(0, Math.min(disponivel, arred(n + delta)));
      return { ...atual, [indice]: novo > 0 ? String(novo) : '' };
    });
  };

  const enviar = async () => {
    if (!dados || enviando || faltando || bloqueadoPeloPrazo || !montagem || !montagem.ok) return;
    const banco = dados.bancos.find((b) => b.id === bancoId);
    const confirmacao = await NexusSwal.fire({
      icon: 'question',
      title: dados.jaConfirmada ? 'Fazer a devolução?' : 'Enviar a devolução?',
      html: `<div style="text-align:left;font-size:15px;line-height:1.5">`
        + `<p style="margin:0 0 6px">${montagem.itensDevolvidos.map((i) => escaparHtml(`${i.quantidadeDevolvida.toLocaleString('pt-BR')}x ${i.nome}`)).join('<br>')}</p>`
        + `<p style="margin:0 0 6px">Valor: <strong>${moeda(valorTotal)}</strong></p>`
        + `<p style="margin:0">${ROTULO_DESTINO_DEVOLUCAO[destino]}${banco ? escaparHtml(` — ${formaBancaria} (${banco.nome})`) : ''}</p>`
        + `<p style="margin:10px 0 0;font-size:13px;opacity:.8">${dados.jaConfirmada ? 'Ela vale na hora: o estoque e o valor já mudam.' : 'A loja confere e confirma. Até lá, nada muda no estoque nem no dinheiro.'}</p>`
        + '</div>',
      showCancelButton: true,
      confirmButtonText: dados.jaConfirmada ? 'Fazer devolução' : 'Enviar',
      cancelButtonText: 'Voltar',
      reverseButtons: true,
    });
    if (!confirmacao.isConfirmed) return;
    setEnviando(true);
    try {
      const r = await devolucaoAppService.enviar({
        pedidoId,
        itens: montagem.itensDevolvidos.map((i) => ({ indice: Number(i.indice), quantidade: i.quantidadeDevolvida })),
        motivo,
        observacao: observacao.trim(),
        destino,
        bancoId: destino === 'banco' ? bancoId : '',
        formaBancaria: destino === 'banco' ? formaBancaria : '',
        idDocumento: idDocumento.current,
      });
      showSuccess(r.status === 'concluida'
        ? `Devolução do pedido #${r.numeroPedido} feita.`
        : `Devolução do pedido #${r.numeroPedido} enviada. A loja vai conferir e confirmar.`);
      navigate('/vendedor/devolucoes', { replace: true });
    } catch (erro) {
      showError('Não foi possível enviar a devolução', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo="Devolução"
        subtitulo={dados ? `Pedido #${dados.pedido.numeroPedido} · ${dados.pedido.clienteNome}` : undefined}
        aoVoltar={voltar}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erroCarga || !dados ? (
          <div style={{ ...cartao, fontSize: '14.5px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{erroCarga || 'Pedido não encontrado.'}</div>
        ) : (
          <>
            <div
              style={{
                display: 'flex', gap: '10px', padding: '12px 14px', borderRadius: '14px', border: '1px solid rgba(139,92,246,0.45)',
                backgroundColor: 'rgba(139,92,246,0.10)', fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.45,
              }}
            >
              <RotateCcw size={18} color="var(--brand-400)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>
                {dados.jaConfirmada
                  ? <><strong style={{ color: 'var(--text-primary)' }}>A devolução vale na hora.</strong> A mercadoria volta para o estoque e o valor vai para onde você escolher.</>
                  : <><strong style={{ color: 'var(--text-primary)' }}>A loja confere e confirma.</strong> Até a confirmação, nada muda no estoque nem no dinheiro. Acompanhe em "Minhas Devoluções".</>}
              </span>
            </div>
            {dados.prazo.foraDoPrazo && (
              <div style={{ ...cartao, borderColor: 'rgba(245,158,11,0.5)', fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                <strong style={{ color: '#d97706' }}>Fora do prazo de devolução.</strong> {bloqueadoPeloPrazo ? 'A loja não aceita devolução depois do prazo. Fale com o escritório.' : 'A loja vai ver o aviso ao conferir.'}
              </div>
            )}

            <div style={cartao}>
              <div style={tituloSecao}>Itens a devolver</div>
              {dados.itens.map((item, n) => {
                const qtd = quantidades[item.indice] || '';
                const esgotado = item.disponivel <= 0;
                return (
                  <div key={`${item.id}-${item.indice}`} style={{ padding: '10px 0', borderTop: n === 0 ? 'none' : '1px solid var(--border-color)', opacity: esgotado ? 0.55 : 1 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.nome}</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Vendido {item.quantidade.toLocaleString('pt-BR')} {item.unidadeMedidaSigla}
                      {item.quantidadeJaDevolvida > 0 ? ` · já devolvido ${item.quantidadeJaDevolvida.toLocaleString('pt-BR')}` : ''}
                      {item.emAguardo > 0 ? ` · aguardando ${item.emAguardo.toLocaleString('pt-BR')}` : ''}
                    </div>
                    {esgotado ? (
                      <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#ef4444', marginTop: '4px' }}>Nada a devolver</div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                        <button type="button" aria-label={`Menos ${item.nome}`} style={botaoQtd} onClick={() => somar(item.indice, -1, item.disponivel)}><Minus size={16} /></button>
                        <input
                          type="text"
                          inputMode={item.fracionado ? 'decimal' : 'numeric'}
                          aria-label={`Quantidade a devolver de ${item.nome}`}
                          value={qtd}
                          onChange={(e) => mudarQtd(item.indice, e.target.value, item.disponivel)}
                          style={{ width: '76px', height: '38px', textAlign: 'center', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '16px' }}
                        />
                        <button type="button" aria-label={`Mais ${item.nome}`} style={botaoQtd} onClick={() => somar(item.indice, 1, item.disponivel)}><Plus size={16} /></button>
                        <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>de {item.disponivel.toLocaleString('pt-BR')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={cartao}>
              <div style={tituloSecao}>Motivo</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {dados.motivos.map((m) => (
                  <button key={m} type="button" onClick={() => setMotivo(m)} aria-pressed={motivo === m} style={{ ...opcao(motivo === m), fontSize: '14px', alignItems: 'center', textAlign: 'center' }}>{m}</button>
                ))}
              </div>
            </div>

            <div style={cartao}>
              <div style={tituloSecao}>Para onde vai o valor</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {DESTINOS.map((d) => (
                  <button key={d} type="button" onClick={() => setDestino(d)} aria-pressed={destino === d} style={opcao(destino === d)}>
                    {ROTULO_DESTINO_DEVOLUCAO[d]}
                    <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text-muted)' }}>{EXPLICA_DESTINO[d]}</span>
                  </button>
                ))}
              </div>
              {destino === 'banco' && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {dados.formasBancarias.map((f) => (
                      <button key={f} type="button" onClick={() => setFormaBancaria(f)} aria-pressed={formaBancaria === f} style={{ ...opcao(formaBancaria === f), alignItems: 'center' }}>{f}</button>
                    ))}
                  </div>
                  {dados.bancos.length === 0 ? (
                    <div style={{ fontSize: '13px', color: '#d97706' }}>A loja não tem banco ativo cadastrado. Escolha crédito ou caixa, ou fale com o escritório.</div>
                  ) : dados.bancos.map((b) => (
                    <button key={b.id} type="button" onClick={() => setBancoId(b.id)} aria-pressed={bancoId === b.id} style={opcao(bancoId === b.id)}>{b.nome}</button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="devolucao-observacao" style={tituloSecao}>Observação</label>
              <textarea
                id="devolucao-observacao"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                maxLength={OBSERVACAO_MAX}
                rows={3}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 'var(--app-raio-linha)', border: '1px solid var(--border-color)', fontSize: '16px',
                  backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'none',
                }}
              />
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textAlign: 'right' }}>{observacao.length}/{OBSERVACAO_MAX}</div>
            </div>
          </>
        )}
      </div>

      {dados && !erroCarga && (
        <div style={{ padding: '12px 20px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
            <span>Valor a devolver</span>
            <span>{moeda(valorTotal)}</span>
          </div>
          {faltando && algumItem && <div style={{ fontSize: '12.5px', color: '#d97706' }}>{faltando}</div>}
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || Boolean(faltando) || bloqueadoPeloPrazo}
            style={{
              height: '50px', borderRadius: '14px', border: 'none', color: '#fff', fontSize: '16px', fontWeight: 800, cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
              opacity: enviando || faltando || bloqueadoPeloPrazo ? 0.55 : 1,
            }}
          >
            {enviando ? 'Enviando...' : dados.jaConfirmada ? 'Fazer devolução' : 'Enviar devolução'}
          </button>
        </div>
      )}
    </div>
  );
};

export default VendedorNovaDevolucao;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, RefreshCw, X } from 'lucide-react';
import { fromCents } from '../../../utils/financeDomain';
import { montarRelatorioDoCaixa, type DadosDoRelatorioDoCaixa } from '../../../utils/relatorioDoCaixaBobinaDomain';
import { currency } from '../pdvHelpers';

/**
 * Relatorio PARCIAL do caixa (F10, 26/11/2026, pedido do dono): o que ja'
 * passou pelo caixa aberto -- vendas por forma, dinheiro e sangrias -- na
 * tela e no papel, sem fechar o caixa. Regra e papel em
 * src/utils/relatorioDoCaixaBobinaDomain.ts.
 */
interface RelatorioDoCaixaModalProps {
  open: boolean;
  /** Le de novo o que passou pelo caixa (vendas, sangrias e o esperado). */
  carregar: () => Promise<DadosDoRelatorioDoCaixa>;
  onClose: () => void;
  onImprimir: (dados: DadosDoRelatorioDoCaixa) => Promise<void>;
}

const hora = (quando: Date | null): string => (quando
  ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(quando)
  : '—');

const reais = (centavos: number) => currency.format(fromCents(centavos));

const RelatorioDoCaixaModal: React.FC<RelatorioDoCaixaModalProps> = ({ open, carregar, onClose, onImprimir }) => {
  const [dados, setDados] = useState<DadosDoRelatorioDoCaixa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [listarVendas, setListarVendas] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);

  const ler = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await carregar());
    } catch (falha) {
      console.error('Relatório do caixa: não foi possível ler o que passou pelo caixa.', falha);
      setErro(falha instanceof Error && falha.message ? falha.message : 'Não foi possível ler as vendas deste caixa. Confira a internet e tente de novo.');
    } finally {
      setCarregando(false);
    }
  }, [carregar]);

  useEffect(() => {
    if (!open) return;
    setDados(null);
    setListarVendas(false);
    void ler();
    // So' ao abrir: "Atualizar" le de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const relatorio = useMemo(() => (dados ? montarRelatorioDoCaixa({ ...dados, listarVendas }) : null), [dados, listarVendas]);

  if (!open) return null;

  const imprimir = async () => {
    if (!dados || imprimindo) return;
    setImprimindo(true);
    try {
      await onImprimir({ ...dados, listarVendas, emitidoEm: new Date() });
    } finally {
      setImprimindo(false);
    }
  };

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal pdv-small-modal pdv-relatorio-caixa" role="dialog" aria-modal="true" aria-label="Relatório parcial do caixa">
        <div className="pdv-modal-header">
          <div>
            <span>F10</span>
            <h2>Relatório do caixa</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar" disabled={imprimindo}>
            <X size={20} />
          </button>
        </div>

        {carregando && !relatorio ? (
          <div className="pdv-modal-empty"><Loader2 className="spin-animation" size={20} /> Somando o que passou pelo caixa...</div>
        ) : erro ? (
          <div className="pdv-modal-empty pdv-prevendas-erro">
            <p>{erro}</p>
            <button type="button" className="pdv-prevendas-atualizar" onClick={() => void ler()}>
              <RefreshCw size={16} aria-hidden="true" /> Tentar de novo
            </button>
          </div>
        ) : relatorio ? (
          <>
            <p className="pdv-relatorio-caixa-aviso">O caixa continua aberto: isto não é o fechamento.</p>

            <section className="pdv-relatorio-caixa-bloco" aria-label="Vendas">
              <div className="pdv-relatorio-caixa-total">
                <span>{relatorio.vendas === 1 ? '1 venda' : `${relatorio.vendas} vendas`}</span>
                <strong>{reais(relatorio.totalVendidoCentavos)}</strong>
              </div>
              {relatorio.canceladas > 0 && (
                <div className="pdv-relatorio-caixa-linha pdv-relatorio-caixa-fraca">
                  <span>{relatorio.canceladas === 1 ? '1 cancelada' : `${relatorio.canceladas} canceladas`} (fora do total)</span>
                  <span>{reais(relatorio.totalCanceladoCentavos)}</span>
                </div>
              )}
              {relatorio.recebimentos.length > 0 && (
                <div className="pdv-relatorio-caixa-linha">
                  <span>{relatorio.recebimentos.length === 1 ? '1 notinha recebida' : `${relatorio.recebimentos.length} notinhas recebidas`}</span>
                  <span>{reais(relatorio.totalRecebidoCentavos)}</span>
                </div>
              )}
              {relatorio.porForma.map((f) => (
                <div key={f.forma} className="pdv-relatorio-caixa-linha">
                  <span>{f.forma} <small>({f.pagamentos})</small></span>
                  <span>{reais(f.valorCentavos)}</span>
                </div>
              ))}
            </section>

            <section className="pdv-relatorio-caixa-bloco" aria-label="Dinheiro no caixa">
              <h3>Dinheiro no caixa</h3>
              <div className="pdv-relatorio-caixa-linha"><span>Saldo inicial (troco)</span><span>{reais(relatorio.dinheiro.saldoInicialCentavos)}</span></div>
              <div className="pdv-relatorio-caixa-linha"><span>+ Vendas em dinheiro</span><span>{reais(relatorio.dinheiro.vendasCentavos)}</span></div>
              {relatorio.dinheiro.recebimentosCentavos > 0 && (
                <div className="pdv-relatorio-caixa-linha"><span>+ Notinhas recebidas em dinheiro</span><span>{reais(relatorio.dinheiro.recebimentosCentavos)}</span></div>
              )}
              {relatorio.dinheiro.suprimentosCentavos > 0 && (
                <div className="pdv-relatorio-caixa-linha"><span>+ Suprimentos ({relatorio.suprimentos.length})</span><span>{reais(relatorio.dinheiro.suprimentosCentavos)}</span></div>
              )}
              <div className="pdv-relatorio-caixa-linha"><span>− Sangrias</span><span>{reais(relatorio.dinheiro.sangriasCentavos)}</span></div>
              <div className="pdv-relatorio-caixa-linha pdv-relatorio-caixa-soma"><span>= Dinheiro deste caixa</span><span>{reais(relatorio.dinheiro.contaDoCaixaCentavos)}</span></div>
              {relatorio.esperado?.modo === 'gaveta' && (
                <>
                  <div className="pdv-relatorio-caixa-linha pdv-relatorio-caixa-soma"><span>Esperado na gaveta</span><span>{reais(relatorio.esperado.saldoEsperadoCentavos)}</span></div>
                  <p className="pdv-relatorio-caixa-nota">{relatorio.esperado.explicacao}</p>
                </>
              )}
            </section>

            <section className="pdv-relatorio-caixa-bloco" aria-label="Sangrias">
              <h3>Sangrias ({relatorio.sangrias.length})</h3>
              {relatorio.sangrias.length === 0 ? (
                <p className="pdv-relatorio-caixa-nota">Nenhuma sangria neste caixa.</p>
              ) : relatorio.sangrias.map((s, indice) => (
                <div key={`${s.registradoEm?.getTime() || 0}-${indice}`} className="pdv-relatorio-caixa-linha">
                  <span>{hora(s.registradoEm)} · {s.motivo || 'Sangria'}{s.bancoNome ? <small> · depósito em {s.bancoNome}</small> : null}</span>
                  <span>{reais(s.valorCentavos)}</span>
                </div>
              ))}
            </section>

            <label className="pdv-relatorio-caixa-opcao">
              <input type="checkbox" checked={listarVendas} onChange={(event) => setListarVendas(event.target.checked)} />
              <span>Listar cada venda no papel ({relatorio.vendas + relatorio.canceladas})</span>
            </label>

            <div className="pdv-relatorio-caixa-acoes">
              <button type="button" className="btn-secondary" onClick={() => void ler()} disabled={carregando || imprimindo} title="Somar de novo, com as vendas e sangrias de agora">
                {carregando ? <Loader2 className="spin-animation" size={16} /> : <RefreshCw size={16} aria-hidden="true" />} Atualizar
              </button>
              <button type="button" className="btn-primary" onClick={() => void imprimir()} disabled={carregando || imprimindo} autoFocus>
                {imprimindo ? <Loader2 className="spin-animation" size={18} /> : <Printer size={18} aria-hidden="true" />}
                Imprimir
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(RelatorioDoCaixaModal);

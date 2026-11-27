import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HandCoins, Loader2, RefreshCw, UserRound, X } from 'lucide-react';
import ConsultaClientesModal from '../../../components/common/ConsultaClientesModal';
import { FILTROS_CONSULTA_PADRAO, type FiltrosConsultaCliente } from '../../../utils/clientSearch';
import { fromCents, paymentRequiresBankAccount, type PaymentMethod } from '../../../utils/financeDomain';
import { getDateInputInTimeZone } from '../../../utils/dateTime';
import {
  listarContasAbertasNoCaixa,
  receberContasNoCaixa,
  type ContaAbertaNoCaixa,
  type ResultadoDoRecebimentoNoCaixa,
} from '../../../services/baixaFinanceiraService';
import { currency, fromCurrencyInput } from '../pdvHelpers';
import { descontoPercentualPorConta, ratearDescontoGeral } from '../../../utils/baixaEmLoteDomain';
import type { PdvClient } from '../types';

/**
 * RECEBER NOTINHA NO CAIXA (28/11/2026, pedido do dono): o operador escolhe o
 * cliente, marca as contas em aberto dele (Contas a Receber) e recebe em
 * dinheiro, Pix ou cartao. Juros e multa no padrao da filial; quita a conta.
 * Quem grava e confere e' o servidor (services/recebimentoNoCaixa.js); o
 * dinheiro entra no esperado do fechamento deste caixa.
 */
export interface RecebimentoConcluido {
  cliente: PdvClient;
  forma: string;
  entregueCentavos: number;
  itens: Array<{ descricao: string; vencimento: string; valorCentavos: number; acrescimoCentavos: number; descontoCentavos?: number }>;
}

interface ReceberContaModalProps {
  open: boolean;
  sessaoId: string | null;
  clients: PdvClient[];
  /** Cliente ja' escolhido no cupom (se nao for o consumidor final). */
  clienteInicial: PdvClient | null;
  bancos: Array<{ id: string; nome: string }>;
  /** Desconto geral (27/11/2026): so' com a permissao de desconto na baixa (o servidor confere). */
  podeDescontar?: boolean;
  onClose: () => void;
  onRecebido: (recebimento: RecebimentoConcluido) => void;
}

const FORMAS: PaymentMethod[] = ['Dinheiro', 'Pix', 'Cartão de Débito', 'Cartão de Crédito'];

const dataCurta = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso || '—');
const reais = (centavos: number) => currency.format(fromCents(centavos));

const ReceberContaModal: React.FC<ReceberContaModalProps> = ({ open, sessaoId, clients, clienteInicial, bancos, podeDescontar = false, onClose, onRecebido }) => {
  const [cliente, setCliente] = useState<PdvClient | null>(null);
  const [consultaAberta, setConsultaAberta] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosConsultaCliente>(FILTROS_CONSULTA_PADRAO);
  const [contas, setContas] = useState<ContaAbertaNoCaixa[]>([]);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [forma, setForma] = useState<PaymentMethod>('Dinheiro');
  const [bancoId, setBancoId] = useState('');
  const [entregue, setEntregue] = useState('');
  const [recebendo, setRecebendo] = useState(false);
  const [falhas, setFalhas] = useState<ResultadoDoRecebimentoNoCaixa[]>([]);
  // Desconto geral (27/11/2026, igual a baixa em lote): repartido pelo valor das contas marcadas.
  const [descontoGeral, setDescontoGeral] = useState('');
  const [descontoEmPercentual, setDescontoEmPercentual] = useState(false);
  // A consulta chama onSelect e logo onClose: o fechar le' daqui se ja' tem cliente
  // (o estado ainda nao atualizou nesse instante e fecharia a janela toda).
  const clienteEscolhido = useRef<PdvClient | null>(null);

  const carregarContas = useCallback(async (clienteId: string) => {
    setCarregando(true);
    setErro('');
    setFalhas([]);
    try {
      const lista = await listarContasAbertasNoCaixa(clienteId);
      setContas(lista);
      setMarcadas(new Set(lista.map((c) => c.transacaoId)));
    } catch (falha) {
      setContas([]);
      setMarcadas(new Set());
      setErro(falha instanceof Error && falha.message ? falha.message : 'Não foi possível ler as contas do cliente. Confira a internet e tente de novo.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setForma('Dinheiro');
    setBancoId('');
    setEntregue('');
    setFalhas([]);
    setContas([]);
    setMarcadas(new Set());
    setErro('');
    setDescontoGeral('');
    setDescontoEmPercentual(false);
    clienteEscolhido.current = clienteInicial;
    if (clienteInicial) {
      setCliente(clienteInicial);
      setConsultaAberta(false);
      void carregarContas(clienteInicial.id);
    } else {
      setCliente(null);
      setConsultaAberta(true);
    }
    // So' ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc fecha a janela, como as outras do caixa. Com a consulta de clientes por
  // cima, fecha so' a consulta (e a janela, se ainda nao ha' cliente). A Frente de
  // Caixa nao tem a pilha de Esc do ERP; se outra camada ja' tratou, nao repete.
  useEffect(() => {
    if (!open || recebendo) return undefined;
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (consultaAberta) {
        setConsultaAberta(false);
        if (!clienteEscolhido.current) onClose();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [open, consultaAberta, recebendo, onClose]);

  const escolherCliente = (escolhido: PdvClient) => {
    clienteEscolhido.current = escolhido;
    setConsultaAberta(false);
    setCliente(escolhido);
    void carregarContas(escolhido.id);
  };

  const escolhidas = useMemo(() => contas.filter((c) => marcadas.has(c.transacaoId)), [contas, marcadas]);
  const { descontos, erroDesconto } = useMemo(() => {
    const texto = descontoGeral.trim();
    if (!texto || !podeDescontar) return { descontos: escolhidas.map(() => 0), erroDesconto: '' };
    const valores = escolhidas.map((c) => c.valorCentavos);
    if (descontoEmPercentual) {
      const p = Number(texto.replace(',', '.'));
      const partes = Number.isFinite(p) ? descontoPercentualPorConta(valores, p) : null;
      return partes ? { descontos: partes, erroDesconto: '' } : { descontos: escolhidas.map(() => 0), erroDesconto: 'Porcentagem de 0 a 100 (ex.: 10 ou 7,5).' };
    }
    const totalDesconto = fromCurrencyInput(texto);
    const partes = ratearDescontoGeral(valores, totalDesconto);
    return partes ? { descontos: partes, erroDesconto: '' } : { descontos: escolhidas.map(() => 0), erroDesconto: 'O desconto não pode passar do valor das contas marcadas.' };
  }, [descontoGeral, descontoEmPercentual, escolhidas, podeDescontar]);
  const totalDescontos = descontos.reduce((a, b) => a + b, 0);
  const total = escolhidas.reduce((soma, c) => soma + c.totalCentavos, 0) - totalDescontos;
  const precisaBanco = paymentRequiresBankAccount(forma);
  const entregueCentavos = forma === 'Dinheiro' ? fromCurrencyInput(entregue) : 0;
  const troco = entregueCentavos > total ? entregueCentavos - total : 0;
  const hoje = getDateInputInTimeZone();
  const podeReceber = Boolean(sessaoId) && escolhidas.length > 0 && (!precisaBanco || Boolean(bancoId)) && !recebendo && !erroDesconto
    && !(forma === 'Dinheiro' && entregueCentavos > 0 && entregueCentavos < total);

  if (!open) return null;

  const alternar = (id: string) => setMarcadas((atual) => {
    const nova = new Set(atual);
    if (nova.has(id)) nova.delete(id); else nova.add(id);
    return nova;
  });

  const receber = async () => {
    if (!podeReceber || !sessaoId || !cliente) return;
    setRecebendo(true);
    setFalhas([]);
    try {
      const resultados = await receberContasNoCaixa({
        sessaoId,
        formaPagamento: forma,
        ...(precisaBanco ? { bancoId } : {}),
        titulos: escolhidas.map((c, i) => ({
          transacaoId: c.transacaoId, jurosCentavos: c.jurosCentavos, multaCentavos: c.multaCentavos,
          ...(descontos[i] > 0 ? { descontoCentavos: descontos[i] } : {}),
        })),
      });
      const certas = resultados.filter((r) => r.ok);
      const erradas = resultados.filter((r) => !r.ok);
      if (certas.length > 0) {
        onRecebido({
          cliente,
          forma,
          entregueCentavos,
          itens: certas.map((r) => {
            const conta = contas.find((c) => c.transacaoId === r.transacaoId);
            return {
              descricao: r.descricao || conta?.descricao || 'Conta',
              vencimento: conta?.vencimento || '',
              valorCentavos: r.valorCentavos ?? conta?.valorCentavos ?? 0,
              acrescimoCentavos: r.acrescimoCentavos ?? 0,
              descontoCentavos: r.descontoCentavos ?? 0,
            };
          }),
        });
      }
      if (erradas.length > 0) {
        setFalhas(erradas);
        await carregarContas(cliente.id);
      } else {
        onClose();
      }
    } catch (falha) {
      setFalhas([{ transacaoId: '', ok: false, erro: falha instanceof Error && falha.message ? falha.message : 'Não foi possível receber. Nada foi gravado. Tente de novo.' }]);
    } finally {
      setRecebendo(false);
    }
  };

  return (
    <>
      <div className="pdv-modal-backdrop" role="presentation">
        <div className="pdv-modal pdv-payment-modal pdv-receber-conta" role="dialog" aria-modal="true" aria-label="Receber conta do cliente">
          <div className="pdv-modal-header">
            <div>
              <h2>Receber conta do cliente</h2>
            </div>
            <button type="button" onClick={onClose} title="Fechar" disabled={recebendo}>
              <X size={20} />
            </button>
          </div>

          <div className="pdv-receber-cliente">
            <UserRound size={18} aria-hidden="true" />
            <strong>{cliente ? cliente.nome : 'Escolha o cliente'}</strong>
            <button type="button" className="btn-secondary" onClick={() => setConsultaAberta(true)} disabled={recebendo}>
              {cliente ? 'Trocar cliente' : 'Escolher cliente'}
            </button>
          </div>

          {carregando ? (
            <div className="pdv-modal-empty"><Loader2 className="spin-animation" size={20} /> Procurando as contas em aberto...</div>
          ) : erro ? (
            <div className="pdv-modal-empty pdv-prevendas-erro">
              <p>{erro}</p>
              {cliente && (
                <button type="button" className="pdv-prevendas-atualizar" onClick={() => void carregarContas(cliente.id)}>
                  <RefreshCw size={16} aria-hidden="true" /> Tentar de novo
                </button>
              )}
            </div>
          ) : cliente && contas.length === 0 ? (
            <div className="pdv-modal-empty">{cliente.nome} não tem contas em aberto para receber no caixa. Cheque, cartão e boleto emitido no banco ficam no Financeiro.</div>
          ) : cliente ? (
            <div className="pdv-receber-lista" role="list" aria-label="Contas em aberto">
              {contas.map((c) => {
                const vencida = c.vencimento && c.vencimento < hoje;
                const acrescimo = c.jurosCentavos + c.multaCentavos;
                return (
                  <label key={c.transacaoId} role="listitem" className={`pdv-receber-item${marcadas.has(c.transacaoId) ? ' marcada' : ''}`}>
                    <input type="checkbox" checked={marcadas.has(c.transacaoId)} onChange={() => alternar(c.transacaoId)} disabled={recebendo} />
                    <span className="pdv-receber-desc">
                      {c.descricao || 'Conta'}
                      <small className={vencida ? 'vencida' : undefined}>
                        Venc. {dataCurta(c.vencimento)}{vencida ? ' · vencida' : ''}{acrescimo > 0 ? ` · ${reais(c.valorCentavos)} + ${reais(acrescimo)} de juros e multa` : ''}
                      </small>
                    </span>
                    <strong>{reais(c.totalCentavos)}</strong>
                  </label>
                );
              })}
            </div>
          ) : null}

          {cliente && contas.length > 0 && (
            <>
              <div className="pdv-receber-forma">
                <label>
                  <span>Forma</span>
                  <select value={forma} onChange={(e) => { setForma(e.target.value as PaymentMethod); setBancoId(''); }} disabled={recebendo}>
                    {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                {precisaBanco && (
                  <label>
                    <span>Banco onde caiu *</span>
                    <select value={bancoId} onChange={(e) => setBancoId(e.target.value)} disabled={recebendo} aria-invalid={!bancoId}>
                      <option value="">Selecione...</option>
                      {bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                    </select>
                  </label>
                )}
                {forma === 'Dinheiro' && (
                  <label>
                    <span>Valor entregue (para o troco)</span>
                    <input value={entregue} inputMode="decimal" onChange={(e) => setEntregue(e.target.value)} disabled={recebendo} />
                  </label>
                )}
              </div>

              {podeDescontar && (
                <div className="pdv-receber-desconto">
                  <span className="pdv-receber-desconto-rotulo">Desconto geral</span>
                  <div className="pdv-receber-desconto-linha">
                    <div role="group" aria-label="Desconto em reais ou em porcentagem" className="pdv-receber-desconto-tipo">
                      {([['R$', false], ['%', true]] as const).map(([rotulo, emPercentual]) => (
                        <button key={rotulo} type="button" aria-pressed={descontoEmPercentual === emPercentual} disabled={recebendo} onClick={() => setDescontoEmPercentual(emPercentual)}>
                          {rotulo}
                        </button>
                      ))}
                    </div>
                    <input
                      aria-label="Valor do desconto geral"
                      inputMode="decimal"
                      value={descontoGeral}
                      disabled={recebendo}
                      aria-invalid={Boolean(erroDesconto)}
                      onChange={(e) => setDescontoGeral(e.target.value)}
                    />
                  </div>
                  {erroDesconto
                    ? <small className="warn">{erroDesconto}</small>
                    : totalDescontos > 0 && <small>Desconto de {reais(totalDescontos)}, repartido pelo valor de cada conta marcada.</small>}
                </div>
              )}

              <div className="pdv-payment-total">
                <span>{escolhidas.length === 1 ? '1 conta marcada' : `${escolhidas.length} contas marcadas`}</span>
                <strong>{reais(total)}</strong>
                {forma === 'Dinheiro' && entregueCentavos > 0 && (
                  entregueCentavos < total
                    ? <small className="warn">O valor entregue é menor que o total.</small>
                    : <small className="ok">Troco: {reais(troco)}</small>
                )}
              </div>
            </>
          )}

          {falhas.length > 0 && (
            <div className="pdv-receber-falhas" role="alert">
              {falhas.map((f) => <p key={f.transacaoId || 'geral'}>{f.erro}</p>)}
            </div>
          )}

          {cliente && contas.length > 0 && (
            <button type="button" className="btn-primary pdv-modal-submit" onClick={() => void receber()} disabled={!podeReceber}>
              {recebendo ? <Loader2 className="spin-animation" size={18} /> : <HandCoins size={18} aria-hidden="true" />}
              {recebendo ? 'Recebendo...' : `Receber ${reais(total)}`}
            </button>
          )}
        </div>
      </div>

      <ConsultaClientesModal
        open={consultaAberta}
        onClose={() => { setConsultaAberta(false); if (!clienteEscolhido.current) onClose(); }}
        clients={clients.filter((c) => !c.isPadrao)}
        onSelect={escolherCliente}
        filtros={filtros}
        onFiltrosChange={setFiltros}
        selecionadoId={cliente?.id ?? null}
      />
    </>
  );
};

export default React.memo(ReceberContaModal);

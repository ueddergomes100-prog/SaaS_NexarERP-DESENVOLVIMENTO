import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { listarContasParaCheque, pagarContaComCheque, type ContaParaCheque } from '../../services/baixaFinanceiraService';
import { formatDateInputPtBr } from '../../utils/dateTime';
import { normalizeSearchText } from '../../utils/textSearch';
import './BaixaEmLote.css';

/**
 * CHEQUE DE CLIENTE PAGANDO UMA CONTA A PAGAR (28/11/2026, pedido do dono).
 * Em Financeiro > Cheques, na hora de compensar: em vez do banco, escolhe-se
 * uma conta a pagar de fornecedor e o cheque vai para ele. Mesmo visual da
 * baixa em lote do Contas a Pagar. A regra (e a trava) fica no servidor:
 * services/repasseCheques.js (repassarParaContaAPagar).
 *  - cheque do mesmo valor: a conta fica paga;
 *  - cheque menor: paga em parte, o resto continua em aberto;
 *  - conta menor que o cheque: nao da' (o cheque nao paga mais que a conta).
 */

const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface ChequeParaPagarConta {
  id: string;
  numeroCheque: string;
  clienteNome: string;
  centavos: number;
}

const PagarContaComChequeModal: React.FC<{
  cheque: ChequeParaPagarConta;
  tenantId: string;
  onFechar: () => void;
  /** Depois de pagar: mensagem para a tela mostrar. */
  onPago: (mensagem: string) => void;
}> = ({ cheque, tenantId, onFechar, onPago }) => {
  const [contas, setContas] = useState<ContaParaCheque[] | null>(null);
  const [erroLista, setErroLista] = useState('');
  const [busca, setBusca] = useState('');
  const [escolhida, setEscolhida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelado = false;
    listarContasParaCheque({ tenantId })
      .then((r) => { if (!cancelado) setContas(r.contas); })
      .catch((e) => { if (!cancelado) { setContas([]); setErroLista(e instanceof Error ? e.message : 'Não foi possível carregar as contas a pagar. Tente de novo.'); } });
    buscaRef.current?.focus();
    return () => { cancelado = true; };
  }, [tenantId]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enviando) onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [enviando, onFechar]);

  const visiveis = useMemo(() => {
    const termo = normalizeSearchText(busca);
    return (contas || []).filter((c) => !termo || normalizeSearchText(`${c.fornecedorNome} ${c.descricao} ${c.categoria}`).includes(termo));
  }, [contas, busca]);
  const conta = (contas || []).find((c) => c.id === escolhida) || null;

  const confirmar = async () => {
    if (!conta) { setErro('Escolha a conta que o cheque vai pagar.'); return; }
    setErro('');
    setEnviando(true);
    try {
      const r = await pagarContaComCheque({ transacaoId: cheque.id, contaPagarId: conta.id, tenantId });
      onPago(r.parcial
        ? `Conta "${r.descricao}" paga em parte com o cheque (${reais(r.valorCentavos)}). Fica em aberto ${reais(r.restanteCentavos)} para pagar com outra forma.`
        : `Conta "${r.descricao}" paga com o cheque. O cheque saiu da carteira como repassado a ${r.fornecedorNome || 'fornecedor'}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível pagar a conta com o cheque. Tente de novo.');
      setEnviando(false);
    }
  };

  return (
    <div className="lote-fundo lote-tom-saida" onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onFechar(); }}>
      <div className="lote-janela" role="dialog" aria-modal="true" aria-labelledby="cheque-conta-titulo">
        <div className="lote-cabecalho">
          <div>
            <p className="lote-sobretitulo">Cheques · pagar conta a pagar</p>
            <h2 className="lote-titulo" id="cheque-conta-titulo">Usar o cheque para pagar uma conta</h2>
          </div>
          <button type="button" className="lote-fechar" onClick={onFechar} disabled={enviando} aria-label="Fechar">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="lote-corpo">
          <div className="lote-formulario">
            <div className="lote-campo">
              <span className="lote-rotulo">Cheque</span>
              <strong style={{ fontSize: '15px' }}>Nº {cheque.numeroCheque || '-'}{cheque.clienteNome ? ` · ${cheque.clienteNome}` : ''}</strong>
              <strong className="lote-numero" style={{ fontSize: '22px' }}>{reais(cheque.centavos)}</strong>
            </div>
            <div className="lote-campo">
              <label htmlFor="cheque-conta-busca">Procurar conta</label>
              <div style={{ position: 'relative' }}>
                <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="cheque-conta-busca"
                  ref={buscaRef}
                  type="text"
                  value={busca}
                  disabled={enviando}
                  onChange={(e) => setBusca(e.target.value)}
                  style={{ paddingLeft: '36px' }}
                />
              </div>
              <span className="lote-ajuda">Fornecedor, descrição ou categoria.</span>
            </div>
            <p className="lote-ajuda">
              O cheque sai da carteira como "repassado" ao fornecedor e a conta do cliente fica paga, sem entrar em banco.
              Cheque menor que a conta paga em parte; o resto fica em aberto. O cheque não paga conta menor que ele.
            </p>
            <p className="lote-aviso-fora">Estornar o pagamento da conta no Contas a Pagar devolve o cheque para a carteira.</p>
          </div>

          <div className="lote-bordero">
            <div className="lote-bordero-folha">
              {contas === null ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '24px', color: 'var(--text-muted)' }}>
                  <Loader2 size={18} className="lote-girando" aria-hidden="true" /> Carregando as contas a pagar...
                </div>
              ) : erroLista ? (
                <p className="lote-alerta" style={{ padding: '24px' }}>{erroLista}</p>
              ) : visiveis.length === 0 ? (
                <p style={{ padding: '24px', color: 'var(--text-muted)' }}>
                  {contas.length === 0 ? 'Nenhuma conta a pagar em aberto.' : 'Nenhuma conta com esse nome.'}
                </p>
              ) : (
                <table style={{ minWidth: 0 }}>
                  <caption className="lote-so-leitor">Contas a pagar em aberto</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="lote-seq"><span className="lote-so-leitor">Escolher</span></th>
                      <th scope="col">Vencimento</th>
                      <th scope="col">Fornecedor</th>
                      <th scope="col" className="lote-direita">Valor</th>
                      <th scope="col" className="lote-direita">Depois do cheque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((c) => {
                      const menor = c.centavos < cheque.centavos;
                      const marcada = escolhida === c.id;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => { if (!menor && !enviando) { setEscolhida(c.id); setErro(''); } }}
                          style={{ cursor: menor ? 'not-allowed' : 'pointer', opacity: menor ? 0.5 : 1, backgroundColor: marcada ? 'var(--lote-tom-suave)' : undefined }}
                          title={menor ? 'Esta conta é menor que o cheque: o cheque não pode pagar mais que a conta.' : undefined}
                        >
                          <td className="lote-seq">
                            <input
                              type="radio"
                              name="cheque-conta"
                              checked={marcada}
                              disabled={menor || enviando}
                              onChange={() => { setEscolhida(c.id); setErro(''); }}
                              aria-label={`Pagar ${c.descricao}`}
                            />
                          </td>
                          <td className="lote-numero">{c.vencimento ? formatDateInputPtBr(c.vencimento) : '-'}</td>
                          <td>
                            <span className="lote-nome">{c.fornecedorNome || c.descricao}</span>
                            {c.fornecedorNome && <span className="lote-descricao">{c.descricao}</span>}
                          </td>
                          <td className="lote-direita lote-numero">{reais(c.centavos)}</td>
                          <td className="lote-direita lote-numero">
                            {menor ? 'Menor que o cheque' : c.centavos === cheque.centavos ? 'Quitada' : `Fica ${reais(c.centavos - cheque.centavos)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="lote-rodape">
          <span className="lote-alerta" role="alert">{erro}</span>
          <div style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
            <button type="button" className="lote-botao lote-botao-discreto" onClick={onFechar} disabled={enviando}>Cancelar</button>
            <button type="button" className="lote-botao lote-botao-principal" onClick={() => void confirmar()} disabled={enviando || !conta}>
              {enviando ? 'Pagando...' : conta ? `Pagar ${reais(Math.min(conta.centavos, cheque.centavos))} com o cheque` : 'Pagar conta com o cheque'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PagarContaComChequeModal;

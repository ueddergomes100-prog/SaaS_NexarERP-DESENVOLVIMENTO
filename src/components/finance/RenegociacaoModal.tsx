import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Handshake, Loader2, X } from 'lucide-react';
import { renegociarParcelas } from '../../services/baixaFinanceiraService';
import {
  FORMAS_RENEGOCIACAO,
  LIMITE_PARCELAS_RENEGOCIACAO,
  MOTIVO_RENEGOCIACAO_MAXIMO,
  dividirEmParcelas,
  somarDias,
  validarFormaRenegociacao,
  validarMotivoRenegociacao,
  validarParcelasNovas,
  type ParcelaNova,
} from '../../utils/renegociacaoDomain';
import { centavosDoValorDigitado } from '../../utils/totalDigitadoDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import './BaixaEmLote.css';

/**
 * RENEGOCIACAO (Contas a Receber, 15/10/2026): parcelas em aberto de um
 * cliente viram um documento novo, em 1 ou mais parcelas. Regras em
 * utils/renegociacaoDomain.ts; quem grava e confere de novo e' o servidor
 * (/api/financeiro/renegociar). Mesmo visual da baixa em lote.
 */

export interface ParcelaParaRenegociar {
  id: string;
  descricao: string;
  /** AAAA-MM-DD ('' se nao houver). */
  vencimento: string;
  valorCentavos: number;
}

const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (dia: string) => (dia ? dia.split('-').reverse().join('/') : '—');
const textoDeReais = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');

const RenegociacaoModal: React.FC<{
  clienteNome: string;
  titulos: ParcelaParaRenegociar[];
  tenantId: string;
  /** Fecha a janela; `renegociou` verdadeiro quando gravou. */
  onFechar: (renegociou: boolean) => void;
}> = ({ clienteNome, titulos, tenantId, onFechar }) => {
  const hoje = getDateInputInTimeZone();
  const totalOrigemCentavos = useMemo(() => titulos.reduce((soma, t) => soma + t.valorCentavos, 0), [titulos]);

  const [totalTexto, setTotalTexto] = useState(textoDeReais(totalOrigemCentavos));
  const [quantidade, setQuantidade] = useState(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState(somarDias(hoje, 30));
  const [intervaloDias, setIntervaloDias] = useState(30);
  const [forma, setForma] = useState('');
  const [motivo, setMotivo] = useState('');
  const [parcelas, setParcelas] = useState<ParcelaNova[]>([]);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const primeiroCampo = useRef<HTMLInputElement>(null);

  const totalDigitadoCentavos = centavosDoValorDigitado(totalTexto);

  // Total, quantidade, 1o vencimento ou intervalo mudou: refaz as parcelas
  // iguais (os ajustes feitos a mao na tabela sao refeitos junto).
  useEffect(() => {
    setParcelas(dividirEmParcelas({
      totalCentavos: Number.isFinite(totalDigitadoCentavos) ? totalDigitadoCentavos : 0,
      quantidade,
      primeiroVencimento,
      intervaloDias,
    }));
  }, [totalDigitadoCentavos, quantidade, primeiroVencimento, intervaloDias]);

  useEffect(() => { primeiroCampo.current?.focus(); }, []);

  const somaParcelas = parcelas.reduce((soma, p) => soma + (Number.isFinite(p.valorCentavos) ? p.valorCentavos : 0), 0);
  const diferenca = somaParcelas - totalOrigemCentavos;

  const mudarParcela = (indice: number, campo: 'valor' | 'vencimento', valor: string) => {
    setErro('');
    setParcelas((atual) => atual.map((p, i) => {
      if (i !== indice) return p;
      return campo === 'valor'
        ? { ...p, valorCentavos: centavosDoValorDigitado(valor) }
        : { ...p, vencimento: valor };
    }));
  };

  const fechar = () => { if (!enviando) onFechar(false); };

  const confirmar = async () => {
    const erroTotal = !Number.isFinite(totalDigitadoCentavos) || totalDigitadoCentavos <= 0
      ? 'Informe o total combinado com o cliente, em reais.'
      : '';
    const erroSoma = !erroTotal && somaParcelas !== totalDigitadoCentavos
      ? `A soma das parcelas (${reais(somaParcelas)}) está diferente do total combinado (${reais(totalDigitadoCentavos)}). Ajuste os valores das parcelas.`
      : '';
    const problema = erroTotal || erroSoma
      || validarParcelasNovas(parcelas, totalOrigemCentavos, hoje)
      || validarFormaRenegociacao(forma)
      || validarMotivoRenegociacao(motivo);
    if (problema) { setErro(problema); return; }

    setEnviando(true);
    setErro('');
    try {
      await renegociarParcelas({
        transacaoIds: titulos.map((t) => t.id),
        parcelas,
        formaPagamento: forma,
        motivo: motivo.trim(),
        tenantId,
      });
      onFechar(true);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível renegociar. Tente de novo.');
      setEnviando(false);
    }
  };

  return (
    <div className="lote-fundo lote-tom-entrada" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div className="lote-janela" role="dialog" aria-modal="true" aria-labelledby="renegociacao-titulo">
        <div className="lote-cabecalho">
          <div>
            <p className="lote-sobretitulo">Renegociação · {clienteNome}</p>
            <h2 className="lote-titulo" id="renegociacao-titulo">
              {titulos.length === 1 ? 'Renegociar 1 parcela' : `Renegociar ${titulos.length} parcelas`}
            </h2>
          </div>
          <button type="button" className="lote-fechar" onClick={fechar} disabled={enviando} aria-label="Fechar">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="lote-corpo">
          <div className="lote-formulario">
            <div className="lote-campo">
              <label htmlFor="reneg-total">Total combinado com o cliente (R$)</label>
              <input
                id="reneg-total"
                ref={primeiroCampo}
                type="text"
                inputMode="decimal"
                value={totalTexto}
                disabled={enviando}
                onChange={(e) => { setTotalTexto(e.target.value); setErro(''); }}
              />
              <span className="lote-ajuda">
                Devia {reais(totalOrigemCentavos)}.
                {Number.isFinite(totalDigitadoCentavos) && totalDigitadoCentavos > 0 && totalDigitadoCentavos !== totalOrigemCentavos && (
                  totalDigitadoCentavos < totalOrigemCentavos
                    ? ` Desconto de ${reais(totalOrigemCentavos - totalDigitadoCentavos)}.`
                    : ` Acréscimo de ${reais(totalDigitadoCentavos - totalOrigemCentavos)}.`
                )}
              </span>
            </div>

            <div className="lote-campo">
              <label htmlFor="reneg-quantidade">Em quantas parcelas</label>
              <input
                id="reneg-quantidade"
                type="number"
                min={1}
                max={LIMITE_PARCELAS_RENEGOCIACAO}
                value={quantidade}
                disabled={enviando}
                onChange={(e) => setQuantidade(Math.max(1, Math.min(LIMITE_PARCELAS_RENEGOCIACAO, Number(e.target.value) || 1)))}
              />
            </div>

            <div className="lote-campo">
              <label htmlFor="reneg-vencimento">{quantidade > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}</label>
              <input
                id="reneg-vencimento"
                type="date"
                min={hoje}
                value={primeiroVencimento}
                disabled={enviando}
                onChange={(e) => setPrimeiroVencimento(e.target.value)}
              />
            </div>

            {quantidade > 1 && (
              <div className="lote-campo">
                <label htmlFor="reneg-intervalo">Dias entre as parcelas</label>
                <input
                  id="reneg-intervalo"
                  type="number"
                  min={1}
                  value={intervaloDias}
                  disabled={enviando}
                  onChange={(e) => setIntervaloDias(Math.max(1, Number(e.target.value) || 30))}
                />
              </div>
            )}

            <div className="lote-campo">
              <label htmlFor="reneg-forma">Cobrar as parcelas novas em</label>
              <select id="reneg-forma" value={forma} disabled={enviando} onChange={(e) => { setForma(e.target.value); setErro(''); }}>
                <option value="">Escolha a forma</option>
                {FORMAS_RENEGOCIACAO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              {forma === 'Boleto' && <span className="lote-ajuda">As parcelas vão para Financeiro › Boletos, aba "Aguardando emissão".</span>}
            </div>

            <div className="lote-campo">
              <label htmlFor="reneg-motivo">Motivo da renegociação</label>
              <textarea
                id="reneg-motivo"
                rows={3}
                maxLength={MOTIVO_RENEGOCIACAO_MAXIMO}
                value={motivo}
                disabled={enviando}
                title="Escreva o que foi combinado com o cliente"
                onChange={(e) => { setMotivo(e.target.value); setErro(''); }}
              />
            </div>

            <p className="lote-aviso-fora">
              As parcelas antigas saem do "em aberto" e ficam como renegociadas. As vendas de origem só ficam quitadas quando a última parcela nova for recebida. Dá para desfazer pelo botão "Desfazer renegociação" de qualquer parcela nova.
            </p>
          </div>

          <div className="lote-bordero">
            <div className="lote-bordero-folha">
              <table>
                <caption className="lote-so-leitor">Parcelas antigas e parcelas novas da renegociação</caption>
                <thead>
                  <tr>
                    <th scope="col" className="lote-seq">Nº</th>
                    <th scope="col" className="lote-col-vencimento">Vencimento</th>
                    <th scope="col">Parcela</th>
                    <th scope="col" className="lote-direita">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {titulos.map((t, indice) => (
                    <tr key={t.id}>
                      <td className="lote-seq lote-numero">{indice + 1}</td>
                      <td className="lote-col-vencimento lote-numero">{dataBr(t.vencimento)}</td>
                      <td><span className="lote-descricao">{t.descricao}</span></td>
                      <td className="lote-direita lote-numero">{reais(t.valorCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lote-bordero-total">
              <div>Parcelas antigas<strong className="lote-numero">{titulos.length}</strong></div>
              <div className="lote-total-geral">Devia<strong className="lote-numero">{reais(totalOrigemCentavos)}</strong></div>
            </div>

            <div className="lote-bordero-folha" style={{ marginTop: '12px' }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="lote-seq">Nova</th>
                    <th scope="col" className="lote-col-vencimento">Vencimento</th>
                    <th scope="col" className="lote-direita">Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p, indice) => (
                    <tr key={indice}>
                      <td className="lote-seq lote-numero">{indice + 1}/{parcelas.length}</td>
                      <td className="lote-col-vencimento">
                        <input
                          type="date"
                          min={hoje}
                          value={p.vencimento}
                          disabled={enviando}
                          aria-label={`Vencimento da parcela nova ${indice + 1}`}
                          onChange={(e) => mudarParcela(indice, 'vencimento', e.target.value)}
                        />
                      </td>
                      <td className="lote-direita">
                        <input
                          type="text"
                          inputMode="decimal"
                          key={`${indice}-${p.valorCentavos}-${parcelas.length}`}
                          defaultValue={Number.isFinite(p.valorCentavos) ? textoDeReais(p.valorCentavos) : ''}
                          disabled={enviando}
                          aria-label={`Valor da parcela nova ${indice + 1}`}
                          onBlur={(e) => mudarParcela(indice, 'valor', e.target.value)}
                          style={{ width: '110px', textAlign: 'right' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lote-bordero-total">
              <div>Parcelas novas<strong className="lote-numero">{parcelas.length}</strong></div>
              <div>{diferenca < 0 ? 'Desconto' : diferenca > 0 ? 'Acréscimo' : 'Diferença'}<strong className="lote-numero">{reais(Math.abs(diferenca))}</strong></div>
              <div className="lote-total-geral">Fica<strong className="lote-numero">{reais(somaParcelas)}</strong></div>
            </div>
          </div>
        </div>

        <div className="lote-rodape">
          {erro ? <span className="lote-alerta" role="alert">{erro}</span> : <span />}
          <div className="lote-barra-acoes">
            <button type="button" className="lote-botao lote-botao-discreto" onClick={fechar} disabled={enviando}>Cancelar</button>
            <button type="button" className="lote-botao lote-botao-principal" onClick={() => void confirmar()} disabled={enviando}>
              {enviando ? (
                <span className="lote-progresso"><Loader2 size={18} className="lote-girando" aria-hidden="true" /> Renegociando...</span>
              ) : (
                <><Handshake size={18} aria-hidden="true" /> Renegociar<span className="lote-cta-total"> · <span className="lote-numero">{reais(somaParcelas)}</span></span></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RenegociacaoModal;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { db } from '../../services/firebase';
import { registrarBaixaEmLote, type ResultadoBaixaEmLote } from '../../services/baixaFinanceiraService';
import { validarDataBaixa } from '../../utils/baixaFinanceiraDomain';
import {
  centavosDoCampo,
  erroDosAjustes,
  ROTULO_PERMISSAO_DESCONTO_NA_BAIXA,
  SEM_AJUSTES,
  textoDoCampo,
  valorPagoDaBaixa,
  type AjustesDaBaixa,
} from '../../utils/ajustesDaBaixaDomain';
import {
  baixaEmLoteExigeBanco,
  FORMAS_DA_BAIXA_EM_LOTE,
  resumoDoLote,
  type TipoDoLote,
} from '../../utils/baixaEmLoteDomain';
import { differenceInCalendarDays, getDateInputInTimeZone } from '../../utils/dateTime';
import './BaixaEmLote.css';

/**
 * BAIXA EM LOTE (Contas a Pagar / Contas a Receber, 2026-10-14).
 * Regras em utils/baixaEmLoteDomain.ts; a gravação é do servidor, conta por
 * conta, igual à baixa individual (/api/financeiro/baixa-lote).
 */

const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (dia: string) => (dia ? dia.split('-').reverse().join('/') : '—');

// ---------------------------------------------------------------------------
// Caixa de seleção com o estado "alguns marcados"
// ---------------------------------------------------------------------------

export const CaixaDeSelecao: React.FC<{
  estado: 'nenhum' | 'alguns' | 'todos';
  rotulo: string;
  onAlternar: (marcar: boolean) => void;
  desabilitada?: boolean;
}> = ({ estado, rotulo, onAlternar, desabilitada }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = estado === 'alguns';
  }, [estado]);
  return (
    // O label amplia a área de toque; o clique não abre/fecha a linha do grupo.
    <label className="lote-caixa-alvo" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="checkbox"
        className="lote-caixa"
        aria-label={rotulo}
        title={rotulo}
        checked={estado === 'todos'}
        disabled={desabilitada}
        onChange={() => onAlternar(estado !== 'todos')}
      />
    </label>
  );
};

// ---------------------------------------------------------------------------
// Barra fixa com o que está marcado
// ---------------------------------------------------------------------------

export const BarraDeSelecaoLote: React.FC<{
  tipo: TipoDoLote;
  quantidade: number;
  totalCentavos: number;
  onLimpar: () => void;
  onDarBaixa: () => void;
  /** Botao a mais (ex.: "Renegociar", no Contas a Receber). */
  acaoExtra?: { texto: string; onClick: () => void; titulo?: string };
}> = ({ tipo, quantidade, totalCentavos, onLimpar, onDarBaixa, acaoExtra }) => {
  if (quantidade === 0) return null;
  const contas = quantidade === 1 ? '1 conta selecionada' : `${quantidade} contas selecionadas`;
  return (
    <div className={`lote-barra lote-tom-${tipo}`} role="region" aria-label="Contas selecionadas para baixa">
      <div className="lote-barra-resumo" aria-live="polite">
        <strong>{contas}</strong>
        <span className="lote-barra-total lote-numero">{reais(totalCentavos)}</span>
      </div>
      <div className="lote-barra-acoes">
        <button type="button" className="lote-botao lote-botao-discreto" onClick={onLimpar}>Limpar seleção</button>
        {acaoExtra && (
          <button type="button" className="lote-botao lote-botao-discreto" onClick={acaoExtra.onClick} title={acaoExtra.titulo}>
            {acaoExtra.texto}
          </button>
        )}
        <button type="button" className="lote-botao lote-botao-principal" onClick={onDarBaixa}>
          <CheckCircle2 size={18} aria-hidden="true" />
          {tipo === 'entrada' ? `Receber ${quantidade}` : `Dar baixa em ${quantidade}`}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Janela da baixa em lote, com o borderô
// ---------------------------------------------------------------------------

export interface ItemDoLote {
  id: string;
  /** Cliente (Receber) ou fornecedor/categoria (Pagar). */
  nome: string;
  descricao: string;
  /** Vencimento, AAAA-MM-DD ('' se não houver). */
  vencimento: string;
  valorCentavos: number;
  /** Forma prevista no título (para sugerir quando todas são iguais). */
  formaPrevista?: string;
  /** Juros e multa calculados pelos parâmetros da filial (Receber em atraso). */
  jurosSugeridoCentavos?: number;
  multaSugeridaCentavos?: number;
}

/** O que a pessoa digitou em cada conta (texto do campo, em reais). */
interface CamposDaConta { juros: string; multa: string; desconto: string }

const camposSugeridos = (item: ItemDoLote, cobrar: boolean): CamposDaConta => ({
  juros: cobrar ? textoDoCampo(Math.max(0, item.jurosSugeridoCentavos || 0)) : '',
  multa: cobrar ? textoDoCampo(Math.max(0, item.multaSugeridaCentavos || 0)) : '',
  desconto: '',
});

/** Texto dos campos em centavos; null = algum valor digitado errado. */
const ajustesDosCampos = (c: CamposDaConta | undefined): AjustesDaBaixa | null => {
  if (!c) return SEM_AJUSTES;
  const juros = centavosDoCampo(c.juros);
  const multa = centavosDoCampo(c.multa);
  const desconto = centavosDoCampo(c.desconto);
  return juros === null || multa === null || desconto === null ? null : { jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto };
};

const TEXTOS: Record<TipoDoLote, {
  sobretitulo: string;
  titulo: (n: number) => string;
  forma: string;
  semForma: string;
  data: string;
  banco: string;
  semBanco: string;
  confirmar: (n: number) => string;
  foraDoLote: string;
}> = {
  entrada: {
    sobretitulo: 'Contas a receber · baixa em lote',
    titulo: (n) => (n === 1 ? 'Receber 1 conta' : `Receber ${n} contas`),
    forma: 'Como foi recebido?',
    semForma: 'Escolha como foi recebido.',
    data: 'Data do recebimento',
    banco: 'Em qual banco caiu?',
    semBanco: 'Escolha em qual banco caiu.',
    confirmar: (n) => (n === 1 ? 'Confirmar recebimento' : `Confirmar recebimento de ${n} contas`),
    foraDoLote: 'Cheque e crédito de devolução não entram no lote: para usar, dê baixa na conta sozinha, pelo botão Dar Baixa dela.',
  },
  saida: {
    sobretitulo: 'Contas a pagar · baixa em lote',
    titulo: (n) => (n === 1 ? 'Dar baixa em 1 conta' : `Dar baixa em ${n} contas`),
    forma: 'Como foi pago?',
    semForma: 'Escolha como foi pago.',
    data: 'Data do pagamento',
    banco: 'De qual banco saiu?',
    semBanco: 'Escolha de qual banco saiu.',
    confirmar: (n) => (n === 1 ? 'Confirmar pagamento' : `Confirmar pagamento de ${n} contas`),
    foraDoLote: 'Cheque emitido não entra no lote: a baixa dele sai na compensação, em Financeiro › Cheques.',
  },
};

type Etapa = 'preencher' | 'enviando' | 'resultado';

export const BaixaEmLoteModal: React.FC<{
  tipo: TipoDoLote;
  itens: ItemDoLote[];
  tenantId: string;
  /** Desconto por conta so' com a permissao propria (15/10/2026). */
  podeDescontar: boolean;
  /** Fecha a janela; recebe os ids que foram baixados (vazio se cancelou). */
  onFechar: (idsBaixados: string[]) => void;
}> = ({ tipo, itens, tenantId, podeDescontar, onFechar }) => {
  const textos = TEXTOS[tipo];
  const hoje = getDateInputInTimeZone();
  const formas = FORMAS_DA_BAIXA_EM_LOTE[tipo];
  const formaComum = (() => {
    const previstas = new Set(itens.map((i) => i.formaPrevista || ''));
    const unica = previstas.size === 1 ? [...previstas][0] : '';
    return unica && formas.includes(unica) ? unica : '';
  })();

  const [forma, setForma] = useState(formaComum);
  const [data, setData] = useState(hoje);
  const [bancoId, setBancoId] = useState('');
  const [bancos, setBancos] = useState<Array<{ id: string; nome: string }> | null>(null);
  // Juros e multa calculados pela filial (Receber em atraso): a caixa liga/desliga o calculado.
  const temSugestao = itens.some((i) => (i.jurosSugeridoCentavos || 0) + (i.multaSugeridaCentavos || 0) > 0);
  const [cobrarAcrescimo, setCobrarAcrescimo] = useState(true);
  const [campos, setCampos] = useState<Record<string, CamposDaConta>>(() => Object.fromEntries(itens.map((i) => [i.id, camposSugeridos(i, true)])));
  const mudarCampo = (id: string, campo: keyof CamposDaConta, valor: string) => {
    setCampos((atual) => ({ ...atual, [id]: { ...(atual[id] || { juros: '', multa: '', desconto: '' }), [campo]: valor } }));
  };
  const alternarCobranca = (cobrar: boolean) => {
    setCobrarAcrescimo(cobrar);
    setCampos((atual) => Object.fromEntries(itens.map((i) => {
      const sugerido = camposSugeridos(i, cobrar);
      return [i.id, { ...(atual[i.id] || sugerido), juros: sugerido.juros, multa: sugerido.multa }];
    })));
  };
  const [erros, setErros] = useState<{ forma?: string; data?: string; banco?: string }>({});
  const [erroGeral, setErroGeral] = useState('');
  const [etapa, setEtapa] = useState<Etapa>('preencher');
  const [resultados, setResultados] = useState<Map<string, ResultadoBaixaEmLote>>(new Map());
  const primeiroCampo = useRef<HTMLSelectElement>(null);
  const tituloId = `lote-titulo-${tipo}`;

  const precisaBanco = Boolean(forma) && baixaEmLoteExigeBanco(tipo, forma);
  const resumo = resumoDoLote(itens.map((i) => ({ valorCentavos: i.valorCentavos, ajustes: ajustesDosCampos(campos[i.id]) || SEM_AJUSTES })));
  const baixados = useMemo(() => [...resultados.values()].filter((r) => r.ok).map((r) => r.transacaoId), [resultados]);

  useEffect(() => {
    primeiroCampo.current?.focus();
  }, []);

  // Bancos ativos da empresa: lista curta, lida uma vez ao abrir.
  useEffect(() => {
    let cancelado = false;
    getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)))
      .then((snap) => {
        if (cancelado) return;
        const lista = snap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || 'Banco sem nome') }));
        lista.sort((a, b) => a.nome.localeCompare(b.nome));
        setBancos(lista);
        if (lista.length === 1) setBancoId(lista[0].id);
      })
      .catch((erro) => {
        console.error('Baixa em lote: erro ao carregar bancos:', erro);
        if (!cancelado) setBancos([]);
      });
    return () => { cancelado = true; };
  }, [tenantId]);

  const fechar = () => {
    if (etapa === 'enviando') return;
    onFechar(baixados);
  };

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  });

  const confirmar = async () => {
    const novosErros: typeof erros = {};
    if (!forma) novosErros.forma = textos.semForma;
    const erroData = validarDataBaixa(data, hoje);
    if (erroData) novosErros.data = erroData;
    if (precisaBanco && !bancoId) novosErros.banco = bancos && bancos.length === 0
      ? 'Nenhum banco ativo. Cadastre em Cadastros › Bancos antes de continuar.'
      : textos.semBanco;
    setErros(novosErros);
    setErroGeral('');
    if (Object.keys(novosErros).length > 0) return;

    // Juros, multa e desconto de cada conta: mesma regra da baixa individual.
    const ajustesPorConta = new Map<string, AjustesDaBaixa>();
    for (const item of itens) {
      const ajustes = ajustesDosCampos(campos[item.id]);
      const erroDaConta = ajustes === null
        ? 'juros, multa ou desconto com valor digitado errado (use reais com vírgula, ex.: 12,50).'
        : erroDosAjustes(item.valorCentavos, ajustes, { podeDescontar });
      if (erroDaConta) {
        setErroGeral(`${item.nome} (${reais(item.valorCentavos)}): ${erroDaConta}`);
        return;
      }
      ajustesPorConta.set(item.id, ajustes as AjustesDaBaixa);
    }

    setEtapa('enviando');
    try {
      const lista = await registrarBaixaEmLote({
        tipo,
        formaPagamento: forma,
        dataPagamento: data,
        ...(precisaBanco ? { bancoId } : {}),
        tenantId,
        titulos: itens.map((item) => ({ transacaoId: item.id, ajustes: ajustesPorConta.get(item.id) || SEM_AJUSTES })),
      });
      setResultados(new Map(lista.map((r) => [r.transacaoId, r])));
      setEtapa('resultado');
    } catch (erro) {
      setErroGeral(erro instanceof Error ? erro.message : 'Não foi possível dar baixa. Tente de novo.');
      setEtapa('preencher');
    }
  };

  const falhas = itens.length - baixados.length;
  const tituloResultado = falhas === 0
    ? (baixados.length === 1 ? '1 conta baixada' : `${baixados.length} contas baixadas`)
    : `${baixados.length} de ${itens.length} contas baixadas`;

  const bloqueado = etapa !== 'preencher';

  return (
    <div className={`lote-fundo lote-tom-${tipo}`} onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div className="lote-janela" role="dialog" aria-modal="true" aria-labelledby={tituloId}>
        <div className="lote-cabecalho">
          <div>
            <p className="lote-sobretitulo">{textos.sobretitulo}</p>
            <h2 className="lote-titulo" id={tituloId}>
              {etapa === 'resultado' ? tituloResultado : textos.titulo(itens.length)}
            </h2>
          </div>
          <button type="button" className="lote-fechar" onClick={fechar} disabled={etapa === 'enviando'} aria-label="Fechar">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="lote-corpo">
          <div className="lote-formulario">
            <div className="lote-campo" data-erro={Boolean(erros.forma)}>
              <label htmlFor="lote-forma">{textos.forma}</label>
              <select
                id="lote-forma"
                ref={primeiroCampo}
                value={forma}
                disabled={bloqueado}
                aria-invalid={Boolean(erros.forma)}
                aria-describedby={erros.forma ? 'lote-forma-erro' : undefined}
                onChange={(e) => { setForma(e.target.value); setErros((atual) => ({ ...atual, forma: undefined, banco: undefined })); }}
              >
                <option value="">Escolha a forma</option>
                {formas.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              {erros.forma && <span id="lote-forma-erro" className="lote-erro-campo">{erros.forma}</span>}
            </div>

            <div className="lote-campo" data-erro={Boolean(erros.data)}>
              <label htmlFor="lote-data">{textos.data}</label>
              <input
                id="lote-data"
                type="date"
                value={data}
                max={hoje}
                disabled={bloqueado}
                aria-invalid={Boolean(erros.data)}
                aria-describedby={erros.data ? 'lote-data-erro' : 'lote-data-ajuda'}
                onChange={(e) => { setData(e.target.value); setErros((atual) => ({ ...atual, data: undefined })); }}
              />
              {erros.data
                ? <span id="lote-data-erro" className="lote-erro-campo">{erros.data}</span>
                : <span id="lote-data-ajuda" className="lote-ajuda">Vale para todas as contas. Foi em outro dia? Troque aqui; a data entra no Fluxo de Caixa e nos relatórios.</span>}
            </div>

            {precisaBanco && (
              <div className="lote-campo" data-erro={Boolean(erros.banco)}>
                <label htmlFor="lote-banco">{textos.banco}</label>
                <select
                  id="lote-banco"
                  value={bancoId}
                  disabled={bloqueado || bancos === null}
                  aria-invalid={Boolean(erros.banco)}
                  aria-describedby={erros.banco ? 'lote-banco-erro' : undefined}
                  onChange={(e) => { setBancoId(e.target.value); setErros((atual) => ({ ...atual, banco: undefined })); }}
                >
                  <option value="">{bancos === null ? 'Carregando bancos...' : 'Escolha o banco'}</option>
                  {(bancos || []).map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                </select>
                {erros.banco && <span id="lote-banco-erro" className="lote-erro-campo">{erros.banco}</span>}
              </div>
            )}

            {temSugestao && (
              <label className="lote-opcao">
                <input
                  type="checkbox"
                  className="lote-caixa"
                  checked={cobrarAcrescimo}
                  disabled={bloqueado}
                  onChange={(e) => alternarCobranca(e.target.checked)}
                />
                <span>
                  <strong>Cobrar juros e multa das atrasadas</strong>
                  <br />
                  Calculado conta por conta pelos parâmetros da filial; dá para mudar no borderô. Entra como lançamento "Juros e multa" junto de cada baixa.
                </span>
              </label>
            )}

            <p className="lote-ajuda">
              Juros, multa e desconto são por conta, no borderô. A conta fica quitada pelo valor cheio; os ajustes entram como lançamentos próprios.
              {!podeDescontar && ` Desconto: só com a permissão "${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}".`}
            </p>

            <p className="lote-aviso-fora">{textos.foraDoLote}</p>
          </div>

          <div className="lote-bordero">
            <div className="lote-bordero-folha">
              <table>
                <caption className="lote-so-leitor">Borderô das contas da baixa em lote</caption>
                <thead>
                  <tr>
                    <th scope="col" className="lote-seq">Nº</th>
                    <th scope="col" className="lote-col-vencimento">Vencimento</th>
                    <th scope="col">{tipo === 'entrada' ? 'Cliente' : 'Fornecedor'}</th>
                    <th scope="col" className="lote-direita">Valor</th>
                    <th scope="col" className="lote-direita">Juros</th>
                    <th scope="col" className="lote-direita">Multa</th>
                    <th scope="col" className="lote-direita">Desconto</th>
                    <th scope="col" className="lote-direita">{tipo === 'entrada' ? 'Recebido' : 'Pago'}</th>
                    {etapa === 'resultado' && <th scope="col">Resultado</th>}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item, indice) => {
                    const atraso = item.vencimento ? (differenceInCalendarDays(item.vencimento, hoje) ?? 0) : 0;
                    const resultado = resultados.get(item.id);
                    const daConta = campos[item.id] || { juros: '', multa: '', desconto: '' };
                    const ajustes = ajustesDosCampos(daConta);
                    const campoDeValor = (campo: keyof CamposDaConta, rotulo: string, desabilitado = false) => (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="lote-campo-valor"
                        value={daConta[campo]}
                        disabled={bloqueado || desabilitado}
                        aria-label={`${rotulo} de ${item.nome}, em reais`}
                        title={desabilitado ? `Precisa da permissão ${ROTULO_PERMISSAO_DESCONTO_NA_BAIXA}` : undefined}
                        aria-invalid={centavosDoCampo(daConta[campo]) === null}
                        onChange={(e) => mudarCampo(item.id, campo, e.target.value)}
                      />
                    );
                    return (
                      <tr key={item.id}>
                        <td className="lote-seq lote-numero">{indice + 1}</td>
                        <td className="lote-col-vencimento lote-numero">
                          {dataBr(item.vencimento)}
                          {atraso > 0 && <span className="lote-atraso"> · {atraso}d</span>}
                        </td>
                        <td>
                          <span className="lote-nome">{item.nome}</span>
                          <span className="lote-descricao">{item.descricao}</span>
                        </td>
                        <td className="lote-direita lote-numero">{reais(item.valorCentavos)}</td>
                        <td className="lote-direita">{campoDeValor('juros', 'Juros')}</td>
                        <td className="lote-direita">{campoDeValor('multa', 'Multa')}</td>
                        <td className="lote-direita">{campoDeValor('desconto', 'Desconto', !podeDescontar)}</td>
                        <td className="lote-direita lote-numero">{ajustes ? reais(valorPagoDaBaixa(item.valorCentavos, ajustes)) : '—'}</td>
                        {etapa === 'resultado' && (
                          <td>
                            {resultado?.ok ? (
                              <span className="lote-resultado-ok"><CheckCircle2 size={14} aria-hidden="true" /> Baixada</span>
                            ) : (
                              <span className="lote-resultado-falha">
                                <XCircle size={14} aria-hidden="true" /> Não baixada
                                <span className="lote-resultado-motivo">{resultado?.erro || 'O servidor não devolveu o resultado desta conta. Confira na lista antes de repetir.'}</span>
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="lote-bordero-total">
              <div>Contas<strong className="lote-numero">{resumo.quantidade}</strong></div>
              <div>Valor<strong className="lote-numero">{reais(resumo.valorCentavos)}</strong></div>
              {resumo.acrescimoCentavos > 0 && <div>Juros e multa<strong className="lote-numero">{reais(resumo.acrescimoCentavos)}</strong></div>}
              {resumo.descontoCentavos > 0 && <div>Desconto<strong className="lote-numero">− {reais(resumo.descontoCentavos)}</strong></div>}
              <div className="lote-total-geral">Total<strong className="lote-numero">{reais(resumo.totalCentavos)}</strong></div>
            </div>
          </div>
        </div>

        <div className="lote-rodape">
          {erroGeral ? (
            <span className="lote-alerta" role="alert">{erroGeral}</span>
          ) : etapa === 'resultado' && falhas > 0 ? (
            <span className="lote-alerta" role="status">As não baixadas continuam em aberto e marcadas. Veja o motivo de cada uma no borderô.</span>
          ) : etapa === 'resultado' && tipo === 'entrada' ? (
            <span className="lote-ajuda" role="status">O recibo de cada conta fica no botão Recibo dela, na lista de recebidas.</span>
          ) : <span />}

          {etapa === 'resultado' ? (
            <button type="button" className="lote-botao lote-botao-principal" onClick={fechar}>Concluir</button>
          ) : (
            <div className="lote-barra-acoes">
              <button type="button" className="lote-botao lote-botao-discreto" onClick={fechar} disabled={etapa === 'enviando'}>Cancelar</button>
              <button type="button" className="lote-botao lote-botao-principal" onClick={() => void confirmar()} disabled={etapa === 'enviando'}>
                {etapa === 'enviando' ? (
                  <span className="lote-progresso"><Loader2 size={18} className="lote-girando" aria-hidden="true" /> Registrando as baixas...</span>
                ) : (
                  <>{textos.confirmar(itens.length)}<span className="lote-cta-total"> · <span className="lote-numero">{reais(resumo.totalCentavos)}</span></span></>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

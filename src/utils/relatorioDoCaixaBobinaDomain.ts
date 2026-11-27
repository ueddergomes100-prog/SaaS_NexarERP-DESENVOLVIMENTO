/*
 * RELATORIO DO CAIXA NA BOBINA (26/11/2026, pedido do dono).
 *
 * Palavras do dono: "se ele quiser tirar um relatorio durante o dia do que
 * passou, do que ele fez de sangria, so' das movimentacao... sem ter que
 * fechar o caixa... Quando fecha o caixa, ai' tem que sair o relatorio de tudo
 * que passou no dia certinho. Para entregar ao administrador".
 *
 * Dois papeis, na mesma impressora do cupom (bobina de 80 ou 58 mm):
 *  - PARCIAL: a qualquer hora, com o caixa aberto (botao "Relatorio" e F10 na
 *    Frente de Caixa). Nao fecha nada, nao grava nada.
 *  - FECHAMENTO: sai sozinho quando o caixa fecha, com o contado, a sobra ou
 *    falta e o que foi ao COFRE, e linhas para as assinaturas.
 *
 * O que entra: vendas (quantas e quanto), total por forma de pagamento, a
 * conta do dinheiro (saldo inicial + vendas em dinheiro - sangrias), cada
 * sangria e, se pedido, cada venda. Venda cancelada fica fora dos totais e
 * aparece contada a parte.
 *
 * O ESPERADO e' o mesmo do fechamento (services/fechamentoCaixaPdvService):
 * com "dinheiro das vendas na gaveta" ligado e um caixa so' aberto, e' o saldo
 * da gaveta -- o papel mostra as duas contas e a frase que explica.
 *
 * Regra pura: sem tela e sem Firestore. Quem le e imprime e'
 * src/pages/PDV/relatorioDoCaixa.ts.
 */
import { fromCents } from './financeDomain';
import type { LarguraDaBobina } from './cupomDoCaixaDomain';

export type TipoDoRelatorioDoCaixa = 'parcial' | 'fechamento';

/** Um titulo (colecao `transacoes`) gerado por uma venda deste caixa. */
export interface LancamentoDoCaixa {
  id: string;
  /** Venda de origem; vazio quando o titulo nao tem (conta como venda propria). */
  pedidoId: string;
  /** Qual pagamento da venda (cartao parcelado gera um titulo por parcela com o mesmo indice). */
  paymentIndex: number | null;
  descricao: string;
  clienteNome: string;
  formaPagamento: string;
  valorCentavos: number;
  criadoEm: Date | null;
  /** Venda cancelada/estornada: fora dos totais. */
  cancelado: boolean;
  /** Entrou dinheiro na gaveta. */
  dinheiro: boolean;
  /** Notinha (Contas a Receber) recebida neste caixa (28/11/2026): nao e' venda. */
  recebimento?: boolean;
}

export interface RecebimentoNoRelatorio {
  quando: Date | null;
  descricao: string;
  clienteNome: string;
  forma: string;
  valorCentavos: number;
}

export interface SangriaDoCaixa {
  valorCentavos: number;
  motivo: string;
  registradoEm: Date | null;
  registradoPorNome: string;
  /** Sangria para deposito: o banco que recebeu. */
  bancoNome: string;
}

export interface EsperadoDoCaixa {
  saldoEsperadoCentavos: number;
  modo: 'sessao' | 'gaveta';
  explicacao: string;
}

export interface FechamentoDoCaixa {
  fechadoEm: Date;
  contadoCentavos: number;
  diferencaCentavos: number;
  /** Gaveta ligada: o que ficou de troco; null quando nao se aplica. */
  trocoCentavos: number | null;
  /** Gaveta ligada: o que foi ao COFRE; null quando nao foi (ou falhou). */
  paraCofreCentavos: number | null;
}

export interface DadosDoRelatorioDoCaixa {
  tipo: TipoDoRelatorioDoCaixa;
  empresa: { nome: string; cnpj: string };
  operadorNome: string;
  /** Quem pediu o papel (pode ser outra pessoa, pela tela Caixa (Sessoes PDV)). */
  impressoPorNome: string;
  abertoEm: Date | null;
  emitidoEm: Date;
  saldoInicialCentavos: number;
  lancamentos: ReadonlyArray<LancamentoDoCaixa>;
  sangrias: ReadonlyArray<SangriaDoCaixa>;
  /** Suprimentos (27/11/2026): dinheiro colocado na gaveta sem ser venda. Ausente = nenhum. */
  suprimentos?: ReadonlyArray<SangriaDoCaixa>;
  /** O esperado do fechamento; null quando nao deu para calcular (o papel sai com a conta do caixa). */
  esperado: EsperadoDoCaixa | null;
  /** So' no papel do fechamento. */
  fechamento: FechamentoDoCaixa | null;
  /** Lista cada venda (sempre no fechamento; no parcial, se a pessoa marcar). */
  listarVendas: boolean;
}

export interface FormaNoRelatorio {
  forma: string;
  /** Quantos pagamentos nesta forma (parcelas do mesmo cartao contam uma vez). */
  pagamentos: number;
  valorCentavos: number;
}

export interface VendaNoRelatorio {
  numero: string;
  quando: Date | null;
  clienteNome: string;
  formas: string;
  totalCentavos: number;
  cancelada: boolean;
}

export interface RelatorioDoCaixa {
  tipo: TipoDoRelatorioDoCaixa;
  titulo: string;
  empresa: { nome: string; cnpj: string };
  operadorNome: string;
  impressoPorNome: string;
  abertoEm: Date | null;
  emitidoEm: Date;
  vendas: number;
  totalVendidoCentavos: number;
  canceladas: number;
  totalCanceladoCentavos: number;
  /** Notinhas recebidas no caixa (sem as estornadas). */
  recebimentos: RecebimentoNoRelatorio[];
  totalRecebidoCentavos: number;
  /** Tudo que entrou, por forma: vendas e notinhas recebidas. */
  porForma: FormaNoRelatorio[];
  dinheiro: {
    saldoInicialCentavos: number;
    vendasCentavos: number;
    /** Notinhas recebidas em dinheiro. */
    recebimentosCentavos: number;
    suprimentosCentavos: number;
    sangriasCentavos: number;
    /** Saldo inicial + vendas em dinheiro + notinhas em dinheiro + suprimentos - sangrias. */
    contaDoCaixaCentavos: number;
  };
  esperado: EsperadoDoCaixa | null;
  sangrias: SangriaDoCaixa[];
  suprimentos: SangriaDoCaixa[];
  fechamento: FechamentoDoCaixa | null;
  /** Vazia quando a pessoa nao pediu a lista. */
  listaDeVendas: VendaNoRelatorio[];
}

const inteiro = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? v : 0;
};

const texto = (v: unknown): string => String(v ?? '').trim();

/** "PDV #1234 - Dinheiro" -> "1234". Sem numero na descricao, a propria descricao. */
export const numeroDaVendaNoLancamento = (descricao: string): string => {
  const achado = /#\s*([\w.\-/]+)/.exec(descricao || '');
  return achado ? achado[1] : texto(descricao);
};

const chaveDaVenda = (l: LancamentoDoCaixa): string => texto(l.pedidoId) || `lanc:${l.id}`;

const porHorario = (a: { quando: Date | null }, b: { quando: Date | null }): number => (
  (a.quando?.getTime() || 0) - (b.quando?.getTime() || 0)
);

export const montarRelatorioDoCaixa = (dados: DadosDoRelatorioDoCaixa): RelatorioDoCaixa => {
  // Notinhas recebidas no caixa ficam a parte: nao sao venda (28/11/2026).
  const lancamentos = dados.lancamentos.filter((l) => !l.recebimento);
  const validos = lancamentos.filter((l) => !l.cancelado);
  const recebidas = dados.lancamentos.filter((l) => l.recebimento && !l.cancelado);

  // Vendas: agrupa os titulos pela venda de origem.
  const grupos = new Map<string, LancamentoDoCaixa[]>();
  lancamentos.forEach((l) => {
    const chave = chaveDaVenda(l);
    grupos.set(chave, [...(grupos.get(chave) || []), l]);
  });
  const listaCompleta: VendaNoRelatorio[] = [...grupos.values()].map((titulos) => {
    const cancelada = titulos.every((t) => t.cancelado);
    const contam = cancelada ? titulos : titulos.filter((t) => !t.cancelado);
    const formas = [...new Set(contam.map((t) => texto(t.formaPagamento) || 'Sem forma'))].join(', ');
    const quando = titulos.reduce<Date | null>((menor, t) => (t.criadoEm && (!menor || t.criadoEm < menor) ? t.criadoEm : menor), null);
    return {
      numero: numeroDaVendaNoLancamento(titulos[0].descricao),
      quando,
      // Consumidor final nao identifica ninguem: a linha fica so' com a forma.
      clienteNome: ((nome) => (nome.toUpperCase() === 'CONSUMIDOR FINAL' ? '' : nome))(texto(titulos.find((t) => texto(t.clienteNome))?.clienteNome)),
      formas,
      totalCentavos: contam.reduce((soma, t) => soma + inteiro(t.valorCentavos), 0),
      cancelada,
    };
  }).sort(porHorario);
  const vendasValidas = listaCompleta.filter((v) => !v.cancelada);
  const vendasCanceladas = listaCompleta.filter((v) => v.cancelada);

  // Total por forma: parcelas do mesmo pagamento contam como um pagamento.
  const formas = new Map<string, { forma: string; chaves: Set<string>; valorCentavos: number }>();
  validos.forEach((l) => {
    const forma = texto(l.formaPagamento) || 'Sem forma';
    const atual = formas.get(forma) || { forma, chaves: new Set<string>(), valorCentavos: 0 };
    atual.chaves.add(`${chaveDaVenda(l)}:${l.paymentIndex ?? l.id}`);
    atual.valorCentavos += inteiro(l.valorCentavos);
    formas.set(forma, atual);
  });
  recebidas.forEach((l) => {
    const forma = texto(l.formaPagamento) || 'Sem forma';
    const atual = formas.get(forma) || { forma, chaves: new Set<string>(), valorCentavos: 0 };
    atual.chaves.add(`rec:${l.id}`);
    atual.valorCentavos += inteiro(l.valorCentavos);
    formas.set(forma, atual);
  });
  const porForma: FormaNoRelatorio[] = [...formas.values()]
    .map((f) => ({ forma: f.forma, pagamentos: f.chaves.size, valorCentavos: f.valorCentavos }))
    .sort((a, b) => b.valorCentavos - a.valorCentavos || a.forma.localeCompare(b.forma, 'pt-BR'));

  const sangrias = [...dados.sangrias].sort((a, b) => (a.registradoEm?.getTime() || 0) - (b.registradoEm?.getTime() || 0));
  const sangriasCentavos = sangrias.reduce((soma, s) => soma + inteiro(s.valorCentavos), 0);
  const suprimentos = [...(dados.suprimentos || [])].sort((a, b) => (a.registradoEm?.getTime() || 0) - (b.registradoEm?.getTime() || 0));
  const suprimentosCentavos = suprimentos.reduce((soma, s) => soma + inteiro(s.valorCentavos), 0);
  const vendasEmDinheiro = validos.filter((l) => l.dinheiro).reduce((soma, l) => soma + inteiro(l.valorCentavos), 0);
  const recebidoEmDinheiro = recebidas.filter((l) => l.dinheiro).reduce((soma, l) => soma + inteiro(l.valorCentavos), 0);
  const saldoInicial = inteiro(dados.saldoInicialCentavos);
  const listaDeRecebimentos: RecebimentoNoRelatorio[] = recebidas
    .map((l) => ({
      quando: l.criadoEm,
      descricao: texto(l.descricao),
      clienteNome: texto(l.clienteNome),
      forma: texto(l.formaPagamento) || 'Sem forma',
      valorCentavos: inteiro(l.valorCentavos),
    }))
    .sort(porHorario);

  return {
    tipo: dados.tipo,
    titulo: dados.tipo === 'fechamento' ? 'FECHAMENTO DO CAIXA' : 'RELATÓRIO PARCIAL DO CAIXA',
    empresa: { nome: texto(dados.empresa.nome) || 'EMPRESA', cnpj: texto(dados.empresa.cnpj) },
    operadorNome: texto(dados.operadorNome),
    impressoPorNome: texto(dados.impressoPorNome),
    abertoEm: dados.abertoEm,
    emitidoEm: dados.emitidoEm,
    vendas: vendasValidas.length,
    totalVendidoCentavos: validos.reduce((soma, l) => soma + inteiro(l.valorCentavos), 0),
    canceladas: vendasCanceladas.length,
    totalCanceladoCentavos: vendasCanceladas.reduce((soma, v) => soma + v.totalCentavos, 0),
    recebimentos: listaDeRecebimentos,
    totalRecebidoCentavos: listaDeRecebimentos.reduce((soma, r) => soma + r.valorCentavos, 0),
    porForma,
    dinheiro: {
      saldoInicialCentavos: saldoInicial,
      vendasCentavos: vendasEmDinheiro,
      recebimentosCentavos: recebidoEmDinheiro,
      suprimentosCentavos,
      sangriasCentavos,
      contaDoCaixaCentavos: saldoInicial + vendasEmDinheiro + recebidoEmDinheiro + suprimentosCentavos - sangriasCentavos,
    },
    esperado: dados.esperado,
    sangrias,
    suprimentos,
    fechamento: dados.tipo === 'fechamento' ? dados.fechamento : null,
    listaDeVendas: dados.listarVendas || dados.tipo === 'fechamento' ? listaCompleta : [],
  };
};

// ---------------------------------------------------------------------------
// Papel (HTML para a impressora termica) -- o mesmo jeito do cupom nao fiscal
// ---------------------------------------------------------------------------

const escapar = (valor: string): string => valor
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const reais = (centavos: number): string => {
  const valor = fromCents(Math.abs(centavos)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return centavos < 0 ? `-${valor}` : valor;
};

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

/** "dd/mm/aaaa hh:mm" no fuso do computador do caixa. */
export const dataHoraDoRelatorio = (quando: Date | null): string => (
  quando
    ? `${doisDigitos(quando.getDate())}/${doisDigitos(quando.getMonth() + 1)}/${quando.getFullYear()} ${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())}`
    : '- - -'
);

const hora = (quando: Date | null): string => (quando ? `${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())}` : '--:--');

const mesmoDia = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Caixa aberto em mais de um dia (esquecido aberto): cada linha leva o dia junto da hora. */
const horarioNaLinha = (quando: Date | null, variosDias: boolean): string => (
  quando && variosDias ? `${doisDigitos(quando.getDate())}/${doisDigitos(quando.getMonth() + 1)} ${hora(quando)}` : hora(quando)
);

/** "Conferido", "Sobrou R$ X" ou "Faltou R$ X". */
export const resultadoNoPapel = (diferencaCentavos: number): string => {
  if (diferencaCentavos === 0) return 'Conferido (sem diferença)';
  return diferencaCentavos > 0 ? `Sobrou R$ ${reais(diferencaCentavos)}` : `Faltou R$ ${reais(Math.abs(diferencaCentavos))}`;
};

export const htmlDoRelatorioDoCaixa = (relatorio: RelatorioDoCaixa, largura: LarguraDaBobina = 80): string => {
  const e = (v: string) => escapar(v);
  const linha = (rotulo: string, valor: string, classe = '') => (
    `<div class="lin ${classe}"><span>${rotulo}</span><span>${valor}</span></div>`
  );
  const r = relatorio;
  const fechamento = r.fechamento;
  const gaveta = r.esperado?.modo === 'gaveta';
  const fim = fechamento ? fechamento.fechadoEm : r.emitidoEm;
  const variosDias = Boolean(r.abertoEm && !mesmoDia(r.abertoEm, fim));

  const formas = r.porForma.length > 0
    ? r.porForma.map((f) => linha(`${e(f.forma)} (${f.pagamentos})`, reais(f.valorCentavos))).join('')
    : '<p class="peq">Nenhuma venda ainda.</p>';

  const sangrias = r.sangrias.length > 0
    ? r.sangrias.map((s) => `
      <div class="item">
        ${linha(`${horarioNaLinha(s.registradoEm, variosDias)} ${e(s.motivo || 'Sangria')}`, reais(s.valorCentavos))}
        ${s.bancoNome || s.registradoPorNome ? `<div class="peq">${s.bancoNome ? `Depósito em ${e(s.bancoNome)}` : ''}${s.bancoNome && s.registradoPorNome ? ' · ' : ''}${s.registradoPorNome ? `por ${e(s.registradoPorNome)}` : ''}</div>` : ''}
      </div>`).join('')
    : '<p class="peq">Nenhuma sangria.</p>';

  const vendas = r.listaDeVendas.map((v) => `
      <div class="item${v.cancelada ? ' cancelada' : ''}">
        ${linha(`${horarioNaLinha(v.quando, variosDias)} Nº ${e(v.numero)}${v.cancelada ? ' CANCELADA' : ''}`, reais(v.totalCentavos))}
        <div class="peq">${e(v.formas)}${v.clienteNome ? ` · ${e(v.clienteNome)}` : ''}</div>
      </div>`).join('');

  // Notinhas recebidas no caixa (28/11/2026): sempre listadas (sao poucas e o administrador confere).
  const recebimentos = r.recebimentos.length > 0 ? `
  <div class="sep"></div>
  <div class="centro forte">NOTINHAS RECEBIDAS (${r.recebimentos.length})</div>
  ${r.recebimentos.map((x) => `
      <div class="item">
        ${linha(`${horarioNaLinha(x.quando, variosDias)} ${e(x.clienteNome || x.descricao)}`, reais(x.valorCentavos))}
        <div class="peq">${e(x.forma)}${x.clienteNome ? ` · ${e(x.descricao)}` : ''}</div>
      </div>`).join('')}
  ${linha('Total recebido', reais(r.totalRecebidoCentavos), 'soma')}` : '';

  const blocoDoFechamento = fechamento ? `
  <div class="sep"></div>
  <div class="centro forte">CONFERÊNCIA</div>
  ${linha('Esperado em dinheiro', reais(r.esperado ? r.esperado.saldoEsperadoCentavos : r.dinheiro.contaDoCaixaCentavos))}
  ${linha('Contado no caixa', reais(fechamento.contadoCentavos))}
  ${linha('Resultado', e(resultadoNoPapel(fechamento.diferencaCentavos)), 'total')}
  ${fechamento.trocoCentavos !== null ? linha('Ficou de troco na gaveta', reais(fechamento.trocoCentavos)) : ''}
  ${fechamento.paraCofreCentavos !== null ? linha('Foi para o COFRE', reais(fechamento.paraCofreCentavos)) : ''}` : '';

  const assinaturas = fechamento ? `
  <div class="sep"></div>
  <div class="assina">Operador do caixa</div>
  <div class="assina">Conferido por (administrador)</div>` : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${e(r.titulo)}</title>
<style>
  @page { size: ${largura}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${largura}mm; padding: 3mm ${largura === 58 ? 2 : 3.5}mm 8mm; font-family: Arial, Helvetica, sans-serif; font-size: ${largura === 58 ? 9.5 : 11}px; line-height: 1.25; }
  .centro { text-align: center; }
  .forte { font-weight: 700; }
  .peq { font-size: 0.85em; }
  .sep { border-top: 1px dashed #000; margin: 5px 0; }
  .empresa { font-size: 1.3em; }
  .titulo { font-size: 1.25em; font-weight: 700; margin: 2px 0; }
  .lin { display: flex; justify-content: space-between; gap: 6px; }
  .lin span:last-child { white-space: nowrap; text-align: right; }
  .lin.total { font-size: 1.3em; font-weight: 700; margin-top: 2px; }
  .lin.soma { font-weight: 700; border-top: 1px solid #000; margin-top: 2px; padding-top: 1px; }
  .item { margin: 2px 0; }
  .cancelada { text-decoration: line-through; }
  .assina { margin-top: 26px; border-top: 1px solid #000; text-align: center; font-size: 0.85em; padding-top: 2px; }
  p { margin: 0; }
</style></head>
<body>
  <div class="centro empresa forte">${e(r.empresa.nome)}</div>
  ${r.empresa.cnpj ? `<div class="centro">CNPJ ${e(r.empresa.cnpj)}</div>` : ''}
  <div class="sep"></div>
  <div class="centro titulo">${e(r.titulo)}</div>
  ${r.tipo === 'parcial' ? '<div class="centro peq">O caixa continua aberto. Não é o fechamento.</div>' : ''}
  ${linha('Caixa de', e(r.operadorNome || '- - -'))}
  ${linha('Aberto em', dataHoraDoRelatorio(r.abertoEm))}
  ${linha(r.tipo === 'fechamento' && fechamento ? 'Fechado em' : 'Tirado em', dataHoraDoRelatorio(fechamento ? fechamento.fechadoEm : r.emitidoEm))}
  <div class="sep"></div>
  <div class="centro forte">VENDAS</div>
  ${linha('Vendas', String(r.vendas))}
  ${linha('TOTAL VENDIDO R$', reais(r.totalVendidoCentavos), 'total')}
  ${r.canceladas > 0 ? linha(`Canceladas (${r.canceladas}), fora do total`, reais(r.totalCanceladoCentavos), 'peq') : ''}
  ${recebimentos}
  <div class="sep"></div>
  <div class="centro forte">${r.recebimentos.length > 0 ? 'ENTRADAS POR FORMA (VENDAS E NOTINHAS)' : 'POR FORMA DE PAGAMENTO'}</div>
  ${formas}
  <div class="sep"></div>
  <div class="centro forte">DINHEIRO NO CAIXA</div>
  ${linha('Saldo inicial (troco)', reais(r.dinheiro.saldoInicialCentavos))}
  ${linha('+ Vendas em dinheiro', reais(r.dinheiro.vendasCentavos))}
  ${r.dinheiro.recebimentosCentavos > 0 ? linha('+ Notinhas recebidas em dinheiro', reais(r.dinheiro.recebimentosCentavos)) : ''}
  ${r.dinheiro.suprimentosCentavos > 0 ? linha('+ Suprimentos', reais(r.dinheiro.suprimentosCentavos)) : ''}
  ${linha('- Sangrias', reais(r.dinheiro.sangriasCentavos))}
  ${linha('= Dinheiro deste caixa', reais(r.dinheiro.contaDoCaixaCentavos), 'soma')}
  ${gaveta && r.esperado ? `${linha('Esperado na gaveta', reais(r.esperado.saldoEsperadoCentavos), 'forte')}<p class="peq">${e(r.esperado.explicacao)}</p>` : ''}
  ${blocoDoFechamento}
  <div class="sep"></div>
  <div class="centro forte">SANGRIAS (${r.sangrias.length})</div>
  ${sangrias}
  ${r.sangrias.length > 0 ? linha('Total das sangrias', reais(r.dinheiro.sangriasCentavos), 'soma') : ''}
  ${r.suprimentos.length > 0 ? `
  <div class="sep"></div>
  <div class="centro forte">SUPRIMENTOS (${r.suprimentos.length})</div>
  ${r.suprimentos.map((x) => `
      <div class="item">
        ${linha(`${horarioNaLinha(x.registradoEm, variosDias)} ${e(x.motivo || 'Suprimento')}`, reais(x.valorCentavos))}
        ${x.registradoPorNome ? `<div class="peq">por ${e(x.registradoPorNome)}</div>` : ''}
      </div>`).join('')}
  ${linha('Total dos suprimentos', reais(r.dinheiro.suprimentosCentavos), 'soma')}` : ''}
  ${r.listaDeVendas.length > 0 ? `
  <div class="sep"></div>
  <div class="centro forte">CADA VENDA (${r.listaDeVendas.length})</div>
  ${vendas}` : ''}
  ${assinaturas}
  <div class="sep"></div>
  <div class="centro peq">Impresso em ${dataHoraDoRelatorio(r.emitidoEm)}${r.impressoPorNome ? ` por ${e(r.impressoPorNome)}` : ''}</div>
  <div class="centro peq forte">DOCUMENTO SEM VALOR FISCAL</div>
</body></html>`;
};

// ---------------------------------------------------------------------------
// Comprovante de notinha recebida no caixa (28/11/2026): vai para o cliente.
// ---------------------------------------------------------------------------

export interface ComprovanteDeRecebimento {
  empresa: { nome: string; cnpj: string };
  clienteNome: string;
  operadorNome: string;
  emitidoEm: Date;
  forma: string;
  itens: Array<{ descricao: string; vencimento: string; valorCentavos: number; acrescimoCentavos: number }>;
  /** Dinheiro: quanto o cliente entregou (para o troco); 0 = nao informado. */
  entregueCentavos: number;
}

const dataCurta = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso);

export const totalDoComprovante = (c: ComprovanteDeRecebimento): number => (
  c.itens.reduce((soma, i) => soma + inteiro(i.valorCentavos) + inteiro(i.acrescimoCentavos), 0)
);

export const htmlDoComprovanteDeRecebimento = (c: ComprovanteDeRecebimento, largura: LarguraDaBobina = 80): string => {
  const e = (v: string) => escapar(v);
  const linha = (rotulo: string, valor: string, classe = '') => `<div class="lin ${classe}"><span>${rotulo}</span><span>${valor}</span></div>`;
  const total = totalDoComprovante(c);
  const troco = c.forma === 'Dinheiro' && c.entregueCentavos > total ? c.entregueCentavos - total : 0;
  const itens = c.itens.map((i) => `
    <div class="item">
      ${linha(e(i.descricao), reais(i.valorCentavos + i.acrescimoCentavos))}
      <div class="peq">Venc. ${e(dataCurta(i.vencimento))}${i.acrescimoCentavos > 0 ? ` · com ${reais(i.acrescimoCentavos)} de juros e multa` : ''}</div>
    </div>`).join('');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante de recebimento</title>
<style>
  @page { size: ${largura}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${largura}mm; padding: 3mm ${largura === 58 ? 2 : 3.5}mm 8mm; font-family: Arial, Helvetica, sans-serif; font-size: ${largura === 58 ? 9.5 : 11}px; line-height: 1.25; }
  .centro { text-align: center; } .forte { font-weight: 700; } .peq { font-size: 0.85em; }
  .sep { border-top: 1px dashed #000; margin: 5px 0; }
  .lin { display: flex; justify-content: space-between; gap: 6px; }
  .lin span:last-child { white-space: nowrap; text-align: right; }
  .lin.total { font-size: 1.3em; font-weight: 700; margin-top: 2px; }
  .item { margin: 3px 0; }
  .assina { margin-top: 26px; border-top: 1px solid #000; text-align: center; font-size: 0.85em; padding-top: 2px; }
</style></head>
<body>
  <div class="centro forte" style="font-size:1.3em">${e(c.empresa.nome || 'EMPRESA')}</div>
  ${c.empresa.cnpj ? `<div class="centro">CNPJ ${e(c.empresa.cnpj)}</div>` : ''}
  <div class="sep"></div>
  <div class="centro forte" style="font-size:1.2em">COMPROVANTE DE RECEBIMENTO</div>
  <div class="centro peq">Contas pagas no caixa</div>
  <div class="sep"></div>
  ${linha('Cliente', e(c.clienteNome || '- - -'))}
  ${linha('Data', dataHoraDoRelatorio(c.emitidoEm))}
  <div class="sep"></div>
  ${itens}
  <div class="sep"></div>
  ${linha('TOTAL PAGO R$', reais(total), 'total')}
  ${linha('Forma', e(c.forma))}
  ${c.forma === 'Dinheiro' && c.entregueCentavos > 0 ? `${linha('Valor entregue', reais(c.entregueCentavos))}${linha('Troco', reais(troco), 'forte')}` : ''}
  <div class="assina">Recebido por ${e(c.operadorNome || 'caixa')}</div>
  <div class="sep"></div>
  <div class="centro peq forte">DOCUMENTO SEM VALOR FISCAL</div>
</body></html>`;
};

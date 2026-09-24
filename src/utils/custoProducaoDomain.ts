import { chaveComponente, type ComponenteComposicao, type OrigemComponente } from './producaoDomain';
import { margemMarkup } from './precificacaoDomain';

/*
 * CUSTO DO PRODUTO ACABADO ACOMPANHA A MATERIA-PRIMA (pedido do dono, 2026-09-24).
 *
 * Antes: o custo de um produto produzido internamente era calculado so' dentro
 * do cadastro do produto e so' era gravado quando alguem abria e salvava aquele
 * produto. Materia-prima subia de preco e o custo gravado (que alimenta
 * Precificacao, relatorios e margem) ficava velho -- sem aviso.
 *
 * Agora: sempre que o custo de um componente muda (nota de entrada, cadastro,
 * importacao, nota avulsa) ou a receita muda, o custo de todo produto que usa
 * aquele componente e' RECALCULADO -- inclusive em cadeia (semiacabado dentro
 * de outro produto).
 *
 * REGRA DE PRODUTO (a mesma da Precificacao): so o CUSTO e' recalculado. O
 * PRECO DE VENDA nunca e' mexido aqui. O sistema mostra o impacto na margem e
 * quem decide reajustar e' a pessoa.
 *
 * Regra pura: sem tela, sem Firestore.
 */

/** Casas do custo gravado. 4 casas guardam 0,125 kg x R$ 10,50 sem perder centavo de fracao. */
export const CASAS_DO_CUSTO = 4;
/** Diferenca abaixo disto nao e' mudanca (ruido de ponto flutuante). */
export const TOLERANCIA_DO_CUSTO = 0.00005;

export const arredondarCusto = (valor: number): number => {
  const fator = 10 ** CASAS_DO_CUSTO;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * fator) / fator : 0;
};

export type ChaveComponente = string;

/** Item da receita, so' o que importa para o custo. */
export type ItemDaReceita = Pick<ComponenteComposicao, 'origem' | 'componenteId' | 'quantidade'> & { componenteNome?: string };

export interface ReceitaDoProduto {
  produtoId: string;
  itens: ItemDaReceita[];
}

export interface ProdutoParaCusto {
  id: string;
  nome: string;
  codigo?: string;
  /** Custo gravado hoje no cadastro. */
  precoCusto: number;
  precoVenda: number;
  /** So produto produzido internamente tem o custo vindo da receita. */
  produzidoInternamente: boolean;
}

/** Um componente cujo custo mudou (ou vai mudar) -- o gatilho do recalculo. */
export interface MudancaDeCusto {
  origem: OrigemComponente;
  id: string;
  nome: string;
  custoAnterior: number;
  custoNovo: number;
}

/**
 * Custo de UMA unidade do produto acabado: soma de quantidade x custo de cada
 * componente. Componente sem custo entra como zero -- `componentesSemCusto`
 * (ver planejarRecalculoDeCustos) existe para a tela avisar isso.
 */
export const calcularCustoDaReceita = (
  itens: ItemDaReceita[],
  custoDoComponente: (origem: OrigemComponente, id: string) => number,
): number => arredondarCusto(itens.reduce(
  (soma, item) => soma + (Number(item.quantidade) || 0) * (Number(custoDoComponente(item.origem, item.componenteId)) || 0),
  0,
));

/** O produto tem custo vindo da receita? Mesma regra do cadastro do produto. */
export const custoVemDaReceita = (produto: Pick<ProdutoParaCusto, 'produzidoInternamente'>, receita: ReceitaDoProduto | undefined): boolean => (
  produto.produzidoInternamente === true && Boolean(receita) && (receita?.itens.length ?? 0) > 0
);

export interface ComponenteQueMudou {
  nome: string;
  custoAnterior: number;
  custoNovo: number;
}

export interface ImpactoNoProduto {
  produtoId: string;
  nome: string;
  codigo: string;
  custoAnterior: number;
  custoNovo: number;
  /** Variacao percentual do custo (custoNovo sobre custoAnterior). null quando nao havia custo antes. */
  variacaoPercentual: number | null;
  precoVenda: number;
  /** Margem (markup sobre o custo) que o MESMO preco de venda tinha / passa a ter. null sem preco. */
  margemAntes: number | null;
  margemDepois: number | null;
  /** Preco de venda ficou ABAIXO do novo custo: vende com prejuizo. */
  vendeAbaixoDoCusto: boolean;
  /** Componentes cujo custo mudou e explicam este resultado (diretos, na ordem em que apareceram). */
  causas: ComponenteQueMudou[];
  /** Componentes da receita que estao sem custo cadastrado: o custo calculado esta subestimado. */
  componentesSemCusto: string[];
}

export interface ResultadoDoRecalculo {
  impactos: ImpactoNoProduto[];
  /** Produtos cuja receita forma um ciclo (A usa B, B usa A): nao da para calcular. */
  emCiclo: string[];
  /** Mesmos produtos de `emCiclo`, por id -- o servico nao grava custo deles. */
  idsEmCiclo: string[];
  /** Quantos produtos com receita foram conferidos. */
  produtosConferidos: number;
  /**
   * Produtos que tinham composicao mas nao estavam marcados como "Produzido
   * internamente" e foram marcados agora (decisao do dono, 2026-09-24: quem
   * tem receita e' produzido aqui). Preenchido pelo servico, que e' quem grava.
   */
  marcadosComoProduzidos: { id: string; nome: string }[];
}

export interface EntradaDoPlanejamento {
  /** Custo mudou em componentes especificos. Vazio + `todos` = conferir tudo. */
  mudancas: MudancaDeCusto[];
  /** Produtos cuja RECEITA mudou (recalcula mesmo sem mudanca de custo). */
  receitasAlteradas?: string[];
  /** Conferir todas as receitas (importacao, botao "recalcular tudo"). */
  todos?: boolean;
  receitas: ReceitaDoProduto[];
  produtos: ProdutoParaCusto[];
  /** Custo atual de cada componente, ANTES das mudancas. */
  custosAtuais: Map<ChaveComponente, number>;
  /** Nome dos componentes, para o aviso de "sem custo". */
  nomesDosComponentes?: Map<ChaveComponente, string>;
}

const MAXIMO_DE_RODADAS = 25;

/**
 * Descobre quais produtos acabados mudam de custo, ja considerando a cadeia
 * (semiacabado que entra em outro produto). Nao grava nada.
 */
export const planejarRecalculoDeCustos = (entrada: EntradaDoPlanejamento): ResultadoDoRecalculo => {
  const custos = new Map(entrada.custosAtuais);
  const chaveDoProduto = (id: string) => chaveComponente('estoque', id);
  const causasPorProduto = new Map<string, ComponenteQueMudou[]>();
  const nomeDoComponente = new Map(entrada.nomesDosComponentes ?? []);

  const sujos = new Set<ChaveComponente>();
  entrada.mudancas.forEach((m) => {
    const chave = chaveComponente(m.origem, m.id);
    custos.set(chave, m.custoNovo);
    nomeDoComponente.set(chave, m.nome);
    if (Math.abs(m.custoNovo - m.custoAnterior) >= TOLERANCIA_DO_CUSTO) sujos.add(chave);
  });

  const produtoPorId = new Map(entrada.produtos.map((p) => [p.id, p]));
  const nomeDe = (item: ItemDaReceita): string => (
    nomeDoComponente.get(chaveComponente(item.origem, item.componenteId))
    || (item.origem === 'estoque' ? produtoPorId.get(item.componenteId)?.nome : undefined)
    || item.componenteNome
    || 'componente'
  );
  const receitaPorProduto = new Map(entrada.receitas.map((r) => [r.produtoId, r]));
  const forcados = new Set(entrada.receitasAlteradas ?? []);

  const custoInicial = new Map<string, number>();
  const custoFinal = new Map<string, number>();
  let dirty = sujos;
  let primeiraRodada = true;
  let rodada = 0;

  while (rodada < MAXIMO_DE_RODADAS) {
    const proximoDirty = new Set<ChaveComponente>();
    let mudouAlgo = false;

    entrada.receitas.forEach((receita) => {
      const produto = produtoPorId.get(receita.produtoId);
      if (!produto || !custoVemDaReceita(produto, receita)) return;
      const afetada = (primeiraRodada && (entrada.todos || forcados.has(receita.produtoId)))
        || receita.itens.some((item) => dirty.has(chaveComponente(item.origem, item.componenteId)));
      if (!afetada) return;

      const chaveProduto = chaveDoProduto(produto.id);
      const atual = custos.get(chaveProduto) ?? produto.precoCusto;
      const novo = calcularCustoDaReceita(receita.itens, (origem, id) => custos.get(chaveComponente(origem, id)) ?? 0);
      if (Math.abs(novo - atual) < TOLERANCIA_DO_CUSTO) return;

      if (!custoInicial.has(produto.id)) custoInicial.set(produto.id, atual);
      custoFinal.set(produto.id, novo);
      custos.set(chaveProduto, novo);
      proximoDirty.add(chaveProduto);
      mudouAlgo = true;

      // Causas: componentes DIRETOS desta receita que mudaram de custo.
      const causas = causasPorProduto.get(produto.id) ?? [];
      receita.itens.forEach((item) => {
        const chave = chaveComponente(item.origem, item.componenteId);
        if (!dirty.has(chave)) return;
        const mudanca = entrada.mudancas.find((m) => chaveComponente(m.origem, m.id) === chave);
        const anterior = mudanca
          ? mudanca.custoAnterior
          : ((item.origem === 'estoque' ? custoInicial.get(item.componenteId) : undefined) ?? entrada.custosAtuais.get(chave) ?? 0);
        const atualDoComponente = custos.get(chave) ?? 0;
        const nome = nomeDe(item);
        if (!causas.some((c) => c.nome === nome)) causas.push({ nome, custoAnterior: anterior, custoNovo: atualDoComponente });
        else {
          const existente = causas.find((c) => c.nome === nome);
          if (existente) existente.custoNovo = atualDoComponente;
        }
      });
      causasPorProduto.set(produto.id, causas);
    });

    primeiraRodada = false;
    rodada += 1;
    if (!mudouAlgo) break;
    dirty = proximoDirty;
  }

  const emCiclo: string[] = [];
  const idsEmCiclo: string[] = [];
  if (rodada >= MAXIMO_DE_RODADAS) {
    // Ainda mudando depois de todas as rodadas: a cadeia se referencia.
    entrada.receitas.forEach((receita) => {
      const produto = produtoPorId.get(receita.produtoId);
      if (produto && dirty.has(chaveDoProduto(produto.id))) {
        emCiclo.push(produto.nome);
        idsEmCiclo.push(produto.id);
      }
    });
  }

  const impactos: ImpactoNoProduto[] = [];
  custoFinal.forEach((custoNovo, produtoId) => {
    const produto = produtoPorId.get(produtoId);
    if (!produto) return;
    const custoAnterior = custoInicial.get(produtoId) ?? produto.precoCusto;
    const receita = receitaPorProduto.get(produtoId);
    const semCusto = (receita?.itens ?? [])
      .filter((item) => !((custos.get(chaveComponente(item.origem, item.componenteId)) ?? 0) > 0))
      .map((item) => nomeDe(item));
    const temPreco = produto.precoVenda > 0;
    impactos.push({
      produtoId,
      nome: produto.nome,
      codigo: produto.codigo || '',
      custoAnterior,
      custoNovo,
      variacaoPercentual: custoAnterior > 0 ? ((custoNovo - custoAnterior) / custoAnterior) * 100 : null,
      precoVenda: produto.precoVenda,
      margemAntes: temPreco && custoAnterior > 0 ? margemMarkup(produto.precoVenda, custoAnterior) : null,
      margemDepois: temPreco && custoNovo > 0 ? margemMarkup(produto.precoVenda, custoNovo) : null,
      vendeAbaixoDoCusto: temPreco && custoNovo > 0 && produto.precoVenda < custoNovo,
      causas: causasPorProduto.get(produtoId) ?? [],
      componentesSemCusto: semCusto,
    });
  });

  // Quem perdeu mais margem primeiro: e' o que a pessoa precisa ver antes.
  const impactosValidos = impactos.filter((i) => !idsEmCiclo.includes(i.produtoId));
  impactosValidos.sort((a, b) => Number(b.vendeAbaixoDoCusto) - Number(a.vendeAbaixoDoCusto)
    || Math.abs(b.variacaoPercentual ?? 0) - Math.abs(a.variacaoPercentual ?? 0)
    || a.nome.localeCompare(b.nome, 'pt-BR'));

  const produtosConferidos = entrada.receitas.filter((r) => {
    const p = produtoPorId.get(r.produtoId);
    return p && custoVemDaReceita(p, r);
  }).length;

  return { impactos: impactosValidos, emCiclo, idsEmCiclo, produtosConferidos, marcadosComoProduzidos: [] };
};

// ---------------------------------------------------------------------------
// Historico gravado no produto (aba "Historico de Precos")
// ---------------------------------------------------------------------------

export interface EntradaDeHistoricoDeCusto {
  precoAnterior: number;
  precoNovo: number;
  custoAnterior: number;
  custoNovo: number;
  alteradoEm: string;
  usuarioId?: string;
  /** Por que o custo mudou, em portugues, para a aba Historico mostrar. */
  motivo: string;
}

const moeda = (valor: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

/** Texto do motivo: quem mudou, de quanto para quanto, e a origem da mudanca. */
export const descricaoDoMotivo = (causas: ComponenteQueMudou[], origemDaMudanca: string): string => {
  if (causas.length === 0) return `Custo recalculado pela composição (${origemDaMudanca}).`;
  const partes = causas.slice(0, 3).map((c) => `${c.nome} ${moeda(c.custoAnterior)} → ${moeda(c.custoNovo)}`);
  const resto = causas.length > 3 ? ` e mais ${causas.length - 3}` : '';
  return `Custo recalculado: ${partes.join('; ')}${resto} (${origemDaMudanca}).`;
};

/** O preco de venda NAO muda: precoAnterior == precoNovo, so o custo se move. */
export const entradaDeHistorico = (
  impacto: ImpactoNoProduto,
  origemDaMudanca: string,
  usuarioId: string | undefined,
  agora: Date = new Date(),
): EntradaDeHistoricoDeCusto => ({
  precoAnterior: impacto.precoVenda,
  precoNovo: impacto.precoVenda,
  custoAnterior: impacto.custoAnterior,
  custoNovo: impacto.custoNovo,
  alteradoEm: agora.toISOString(),
  ...(usuarioId ? { usuarioId } : {}),
  motivo: descricaoDoMotivo(impacto.causas, origemDaMudanca),
});

// ---------------------------------------------------------------------------
// Aviso ao usuario
// ---------------------------------------------------------------------------

export const escaparHtml = (texto: string): string => String(texto)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const percentual = (valor: number | null): string => (
  valor === null ? '—' : `${valor.toFixed(1).replace('.', ',')}%`
);

export interface ResumoDoImpacto {
  total: number;
  /** Ganharam custo pela primeira vez (antes estavam com custo zero). */
  primeiraVez: number;
  subiram: number;
  cairam: number;
  abaixoDoCusto: number;
  semCusto: number;
}

export const resumirImpacto = (resultado: ResultadoDoRecalculo): ResumoDoImpacto => ({
  total: resultado.impactos.length,
  primeiraVez: resultado.impactos.filter((i) => i.custoAnterior <= 0).length,
  subiram: resultado.impactos.filter((i) => i.custoAnterior > 0 && i.custoNovo > i.custoAnterior).length,
  cairam: resultado.impactos.filter((i) => i.custoNovo < i.custoAnterior).length,
  abaixoDoCusto: resultado.impactos.filter((i) => i.vendeAbaixoDoCusto).length,
  semCusto: resultado.impactos.filter((i) => i.componentesSemCusto.length > 0).length,
});

/**
 * HTML do quadro de impacto: o que mudou, quanto, e o que isso faz com a
 * margem. Texto de produto/componente e' escapado (vem de cadastro livre).
 * `limite` corta a tabela para a janela nao virar uma parede de linhas.
 */
export const htmlDoImpactoDeCusto = (resultado: ResultadoDoRecalculo, limite = 25): string => {
  if (resultado.impactos.length === 0 && resultado.emCiclo.length === 0 && resultado.marcadosComoProduzidos.length === 0) return '';
  const resumo = resumirImpacto(resultado);
  const mostrados = resultado.impactos.slice(0, limite);
  const escondidos = resultado.impactos.length - mostrados.length;

  const linhas = mostrados.map((i) => {
    const subiu = i.custoNovo > i.custoAnterior;
    const corCusto = subiu ? '#ef4444' : '#10b981';
    const causa = i.causas.length > 0
      ? `<div style="font-size:11px;opacity:.75">por: ${i.causas.slice(0, 2).map((c) => `${escaparHtml(c.nome)} (${escaparHtml(moeda(c.custoAnterior))} → ${escaparHtml(moeda(c.custoNovo))})`).join('; ')}${i.causas.length > 2 ? ` e mais ${i.causas.length - 2}` : ''}</div>`
      : '';
    const alerta = i.vendeAbaixoDoCusto
      ? '<div style="font-size:11px;color:#ef4444;font-weight:700">Preço de venda abaixo do custo!</div>'
      : '';
    const semCusto = i.componentesSemCusto.length > 0
      ? `<div style="font-size:11px;color:#f59e0b">Sem custo cadastrado: ${i.componentesSemCusto.slice(0, 3).map(escaparHtml).join(', ')}. O custo está subestimado.</div>`
      : '';
    return `<tr style="border-top:1px solid rgba(128,128,128,.25)">
      <td style="padding:8px 6px;text-align:left">${escaparHtml(i.nome)}${causa}${alerta}${semCusto}</td>
      <td style="padding:8px 6px;white-space:nowrap">${escaparHtml(moeda(i.custoAnterior))} → <strong style="color:${corCusto}">${escaparHtml(moeda(i.custoNovo))}</strong>
        <div style="font-size:11px;color:${corCusto}">${i.variacaoPercentual === null ? '' : `${subiu ? '▲' : '▼'} ${escaparHtml(percentual(Math.abs(i.variacaoPercentual)))}`}</div></td>
      <td style="padding:8px 6px;white-space:nowrap">${i.precoVenda > 0 ? escaparHtml(moeda(i.precoVenda)) : '<span style="opacity:.7">sem preço</span>'}</td>
      <td style="padding:8px 6px;white-space:nowrap">${i.precoVenda > 0 ? `${escaparHtml(percentual(i.margemAntes))} → ` : ''}<strong style="color:${i.vendeAbaixoDoCusto ? '#ef4444' : 'inherit'}">${i.precoVenda > 0 ? escaparHtml(percentual(i.margemDepois)) : '—'}</strong></td>
    </tr>`;
  }).join('');

  const titulo = `O custo mudou em <strong>${resumo.total}</strong> produto(s) acabado(s)`
    + (resumo.primeiraVez > 0 ? ` — <span>${resumo.primeiraVez} passaram a ter custo (antes estavam zerados)</span>` : '')
    + (resumo.subiram > 0 ? ` — <span style="color:#ef4444">${resumo.subiram} ficaram mais caros</span>` : '')
    + (resumo.cairam > 0 ? ` — <span style="color:#10b981">${resumo.cairam} ficaram mais baratos</span>` : '');

  const ciclo = resultado.emCiclo.length > 0
    ? `<p style="color:#ef4444;font-size:12px;margin:8px 0 0">Atenção: a composição de ${resultado.emCiclo.slice(0, 3).map(escaparHtml).join(', ')} se refere a si mesma (um produto usa o outro). Corrija a composição; o custo desses produtos não foi calculado.</p>`
    : '';

  const semMarcacao = resultado.marcadosComoProduzidos.length > 0
    ? `<p style="font-size:12px;margin:10px 0 0;opacity:.9"><strong>${resultado.marcadosComoProduzidos.length} produto(s) foram marcados como "Produzido internamente"</strong> porque têm composição cadastrada. A partir de agora o custo deles vem da receita: ${resultado.marcadosComoProduzidos.slice(0, 5).map((p) => escaparHtml(p.nome)).join(', ')}${resultado.marcadosComoProduzidos.length > 5 ? '…' : ''}.</p>`
    : '';
  const cabecalho = resultado.impactos.length > 0
    ? `<div style="margin-bottom:8px">${titulo}.</div>`
    : `<div style="margin-bottom:8px">Conferi ${resultado.produtosConferidos} produto(s) com composição: o custo de todos já está correto.</div>`;

  return `<div style="text-align:left;font-size:13px;margin-top:14px">
    ${cabecalho}
    ${resumo.abaixoDoCusto > 0 ? `<div style="color:#ef4444;font-weight:700;margin-bottom:6px">${resumo.abaixoDoCusto} produto(s) agora estão sendo vendidos abaixo do custo.</div>` : ''}
    <div style="max-height:320px;overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="text-align:left;opacity:.7">
          <th style="padding:6px">Produto</th><th style="padding:6px">Custo</th><th style="padding:6px">Preço de venda</th><th style="padding:6px">Margem</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    ${escondidos > 0 ? `<div style="font-size:12px;opacity:.75;margin-top:6px">…e mais ${escondidos} produto(s). Veja todos na tela de Precificação.</div>` : ''}
    <div style="margin-top:10px;font-size:12px;opacity:.85">O <strong>preço de venda não foi alterado</strong>. Escolha abaixo se mantém os preços ou reajusta (ou ajuste depois em Estoque › Precificação). O histórico de cada produto guarda esta mudança.</div>
    ${ciclo}
    ${semMarcacao}
  </div>`;
};

// ---------------------------------------------------------------------------
// Reajuste de preco ESCOLHIDO pela pessoa (2026-09-24)
// ---------------------------------------------------------------------------
//
// O sistema nunca reajusta preco sozinho. Depois do aviso de custo, a pessoa
// escolhe: manter os precos ou reajustar produto a produto. O valor sugerido
// mantem a margem (markup) que o produto tinha antes; ela pode digitar outro.

const arredondar2 = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;

/** Preco que devolve ao produto a margem de antes, com o custo novo. null sem preco/margem de referencia. */
export const precoManterMargem = (impacto: Pick<ImpactoNoProduto, 'precoVenda' | 'margemAntes' | 'custoNovo'>): number | null => (
  impacto.precoVenda > 0 && impacto.margemAntes !== null && impacto.custoNovo > 0
    ? arredondar2(impacto.custoNovo * (1 + impacto.margemAntes / 100))
    : null
);

export interface ProdutoParaReajuste {
  precoVenda: number;
  precoCusto: number;
  historicoPrecos: unknown[];
  /** O documento tem o objeto legado `precos`? So' entao os espelhos dele sao atualizados. */
  temPrecos: boolean;
}

/**
 * Campos do `update` para gravar um preco de venda escolhido pela pessoa.
 * Devolve null quando o preco e' invalido ou nao muda nada. Reescreve
 * `custoNaUltimaPrecificacao` (o preco foi definido AGORA, com o custo de hoje)
 * e registra no historico com o motivo.
 */
export const montarAtualizacaoDePreco = (
  produto: ProdutoParaReajuste,
  precoNovo: number,
  usuarioId: string | undefined,
  motivo: string,
  agora: Date = new Date(),
): Record<string, unknown> | null => {
  const preco = arredondar2(Number(precoNovo));
  if (!Number.isFinite(preco) || preco <= 0 || preco === arredondar2(produto.precoVenda)) return null;
  const margem = produto.precoCusto > 0 ? margemMarkup(preco, produto.precoCusto) : 0;
  const lucro = preco - produto.precoCusto;
  const iso = agora.toISOString();
  const entrada = {
    precoAnterior: produto.precoVenda,
    precoNovo: preco,
    custoAnterior: produto.precoCusto,
    custoNovo: produto.precoCusto,
    alteradoEm: iso,
    ...(usuarioId ? { usuarioId } : {}),
    motivo,
  };
  return {
    precoVenda: preco,
    margemLucro: margem,
    lucroEstimado: lucro,
    custoNaUltimaPrecificacao: produto.precoCusto,
    ultimaAlteracaoPreco: iso,
    historicoPrecos: [entrada, ...produto.historicoPrecos].slice(0, 200),
    ...(produto.temPrecos
      ? { 'precos.venda': preco, 'precos.margemLucro': margem, 'precos.lucroEstimado': lucro, 'precos.ultimaAlteracaoPreco': iso }
      : {}),
  };
};

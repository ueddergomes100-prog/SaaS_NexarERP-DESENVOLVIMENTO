/**
 * NF-e DE DEVOLUCAO DE VENDA (2026-09-21).
 *
 * Quando o cliente devolve mercadoria vendida com NF-e, a empresa emite uma
 * NF-e de ENTRADA (tpNF=0) com finalidade "devolucao" (finNFe=4), CFOP 1.2xx
 * (dentro do estado) ou 2.2xx (fora), referenciando a nota original.
 *
 * ---------------------------------------------------------------------------
 * REGRAS (Spedy OpenAPI v1 + NT 2025.002-RTC, em vigor em 01/09/2026)
 * ---------------------------------------------------------------------------
 *  - `purposeType: "devolution"` + `operationType: "incoming"`.
 *  - Cada ITEM referencia o item da nota de origem em
 *    `items[].sourceDocument = { accessKey, itemNumber }`. O antigo
 *    `referencedDocuments` (referencia na nota inteira) DEIXOU de ser aceito
 *    para devolucao -- por isso a nota original precisa ter guardado os itens
 *    que foram enviados (`itensFiscais`): o numero do item e' a posicao dele.
 *  - Sem pagamento: `payments = [{ method: "noPayment", amount: 0 }]`.
 *  - Tributacao ESPELHA a nota original, proporcional a quantidade devolvida
 *    (base e valor dos impostos escalados; CST e aliquotas mantidos).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO RODA NO SERVIDOR
 * ---------------------------------------------------------------------------
 * A nota e' montada AQUI a partir do que esta gravado (devolucao, pedido, nota
 * original e cadastro do cliente) e nao a partir de um corpo enviado pela
 * tela: assim ninguem consegue, pelo DevTools, emitir devolucao de item que
 * nao foi vendido, com valor inflado ou referenciando nota alheia.
 *
 * Tudo aqui e' funcao pura (sem Firestore nem HTTP) pra ser testada.
 */

// CFOP da venda -> CFOP da devolucao (Ajuste SINIEF 07/01, tabela de CFOP).
const CFOP_DEVOLUCAO_POR_ORIGEM = {
  5101: 1201, 6101: 2201, // producao do estabelecimento
  5102: 1202, 6102: 2202, // mercadoria adquirida ou recebida de terceiros
  5401: 1410, 6401: 2410, // producao do estabelecimento, sujeita a ST
  5403: 1411, 6403: 2411, // de terceiros, ST, contribuinte substituto
  5405: 1411, 6404: 2411, // de terceiros, ST, contribuinte substituido
};

const STATUS_NOTA_MORTA = ['rejected', 'denied', 'canceled'];
/** Uma reserva sem nota por mais que isso e' de uma tentativa que morreu no meio. */
const VALIDADE_RESERVA_MS = 5 * 60 * 1000;

/** CFOPs de devolucao que o usuario pode escolher quando o da origem nao tem mapa automatico. */
const CFOPS_DEVOLUCAO_PERMITIDOS = [1201, 1202, 1410, 1411, 2201, 2202, 2410, 2411];

const PRAZO_CANCELAMENTO_HORAS = 24;

const arredondar = (valor, casas) => {
  const fator = 10 ** casas;
  return Math.round((Number(valor) + Number.EPSILON) * fator) / fator;
};

const somenteDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** CFOP de devolucao pro CFOP da venda, ou null se nao ha mapa automatico. */
const cfopDeDevolucao = (cfopOriginal) => CFOP_DEVOLUCAO_POR_ORIGEM[Number(cfopOriginal)] ?? null;

/** CFOP 1.xxx = dentro do estado; 2.xxx = fora do estado. */
const destinoDoCfop = (cfopDevolucao) => (String(cfopDevolucao).startsWith('1') ? 'internal' : 'interstate');

/**
 * Escala os valores de um bloco de impostos pela proporcao devolvida. So' mexe
 * em BASE e VALOR (baseTax*, amount, *Amount); CST, aliquotas, origem, reducao
 * de base e modalidade ficam como estao.
 */
const escalarImpostos = (taxes, razao) => {
  if (!taxes || typeof taxes !== 'object') return taxes;
  const escalar = (chave) => (
    (/^baseTax/i.test(chave) || /amount/i.test(chave))
    && !/reduction|rate|modality/i.test(chave)
  );
  const copia = {};
  for (const [bloco, dados] of Object.entries(taxes)) {
    if (!dados || typeof dados !== 'object') { copia[bloco] = dados; continue; }
    copia[bloco] = {};
    for (const [chave, valor] of Object.entries(dados)) {
      copia[bloco][chave] = (typeof valor === 'number' && escalar(chave)) ? arredondar(valor * razao, 2) : valor;
    }
  }
  return copia;
};

/** Horas desde a emissao e se ainda esta dentro do prazo geral de cancelamento. */
const prazoDeCancelamento = (emitidaEmIso, agora = new Date()) => {
  const emitida = new Date(emitidaEmIso);
  if (Number.isNaN(emitida.getTime())) return { conhecido: false, dentroDoPrazo: false, horas: null };
  const horas = (agora.getTime() - emitida.getTime()) / 3_600_000;
  return { conhecido: true, dentroDoPrazo: horas >= 0 && horas < PRAZO_CANCELAMENTO_HORAS, horas: Math.floor(Math.max(0, horas)) };
};

/**
 * A devolucao ja tem NF-e de devolucao valendo (em andamento ou autorizada)?
 * Decide pela NOTA de verdade -- rejeitada, negada ou cancelada nao conta (da'
 * pra reemitir) -- e por uma reserva recente (tentativa em curso).
 * @param {{ id: string, notaFiscalDevolucao?: { status?: string, reservadoEmMs?: number } }} devolucao
 * @param {object[]} notas notas fiscais do pedido (ou a nota ja ligada a devolucao)
 */
const notaVigenteDaDevolucao = (devolucao, notas, agoraMs = Date.now()) => {
  const nota = (notas || []).find((n) => (
    n.finalidade === 'devolucao' && n.devolucaoId === devolucao.id && !STATUS_NOTA_MORTA.includes(n.status)
  ));
  if (nota) return { notaId: nota.id, status: nota.status, numero: nota.number ?? null };
  const reserva = devolucao.notaFiscalDevolucao;
  if (reserva?.status === 'reservada' && agoraMs - Number(reserva.reservadoEmMs || 0) < VALIDADE_RESERVA_MS) {
    return { notaId: null, status: 'reservada', numero: null };
  }
  return null;
};

/**
 * Escolhe a nota original do pedido entre as autorizadas (NF-e ou NFC-e, que
 * nao sejam devolucao). Uma so': usa ela. Varias: exige que a tela diga qual
 * (`notaOriginalId`) -- nunca adivinha.
 * @returns {{ nota?: object, candidatas: object[], erro?: string }}
 */
const escolherNotaOriginal = (notas, notaOriginalId) => {
  const candidatas = (notas || []).filter((n) => (
    n.status === 'authorized' && ['NF-e', 'NFC-e'].includes(n.tipo) && n.finalidade !== 'devolucao'
  ));
  if (candidatas.length === 0) {
    return { candidatas, erro: 'Este pedido não tem NF-e ou NFC-e autorizada para ser devolvida. Sem nota autorizada não existe devolução fiscal a emitir.' };
  }
  if (notaOriginalId) {
    const escolhida = candidatas.find((n) => n.id === notaOriginalId);
    return escolhida
      ? { nota: escolhida, candidatas }
      : { candidatas, erro: 'A nota escolhida não é uma nota autorizada deste pedido.' };
  }
  if (candidatas.length === 1) return { nota: candidatas[0], candidatas };
  return { candidatas, erro: 'Este pedido tem mais de uma nota autorizada. Escolha qual delas está sendo devolvida.' };
};

/**
 * Casa cada item devolvido com o item da nota original (e com seu numero).
 * @returns {{ casados: object[], erros: string[] }}
 */
const casarItens = ({ itensDevolvidos, itensPedido, itensNota }) => {
  const erros = [];
  const casados = [];
  const usados = new Set();

  for (const dev of itensDevolvidos || []) {
    const nome = dev.nome || 'item sem nome';
    const itemPedido = (itensPedido || []).find((i) => i.id === dev.id && i.nome === dev.nome)
      || (itensPedido || []).find((i) => i.id === dev.id);
    if (!itemPedido) {
      erros.push(`O item "${nome}" da devolução não foi encontrado no pedido.`);
      continue;
    }

    // NF-e emitida pela tela de Notas Fiscais usa o codigo do cadastro (codigoProduto)
    // no `code`; a NFC-e emitida na venda usa o id do produto.
    const codigos = itemPedido.id === 'avulso'
      ? ['AVULSO']
      : [itemPedido.codigoProduto, itemPedido.id].filter(Boolean).map(String);
    const indices = (itensNota || []).map((_, i) => i).filter((i) => !usados.has(i));
    const candidatos = indices.filter((i) => codigos.includes(String(itensNota[i].code)));
    let indice = candidatos.find((i) => itensNota[i].description === itemPedido.nome);
    if (indice === undefined) [indice] = candidatos;
    if (indice === undefined) {
      indice = indices.find((i) => itensNota[i].description === itemPedido.nome);
    }
    if (indice === undefined) {
      erros.push(`O item "${nome}" não consta na nota fiscal original. Ele pode ter sido incluído no pedido depois da emissão da nota.`);
      continue;
    }
    usados.add(indice);

    const vendida = Number(itemPedido.quantidade || 0);
    const devolvida = Number(dev.quantidadeDevolvida || 0);
    if (!(vendida > 0) || !(devolvida > 0)) {
      erros.push(`A quantidade do item "${nome}" é inválida (vendida ${vendida}, devolvida ${devolvida}).`);
      continue;
    }
    if (devolvida > vendida) {
      erros.push(`A quantidade devolvida de "${nome}" (${devolvida}) é maior que a vendida (${vendida}).`);
      continue;
    }
    casados.push({ dev, itemPedido, notaItem: itensNota[indice], itemNumber: indice + 1, razao: devolvida / vendida });
  }
  return { casados, erros };
};

/**
 * Monta os itens da nota de devolucao.
 * @param {object} p
 * @param {object[]} p.casados saida de casarItens
 * @param {string} p.chaveOriginal chave de acesso da nota original
 * @param {Record<number, number>} [p.cfopEscolhido] itemNumber -> CFOP escolhido pelo usuario
 * @returns {{ itens: object[], erros: string[], precisaCfop: object[] }}
 */
const montarItensDevolucao = ({ casados, chaveOriginal, cfopEscolhido = {} }) => {
  const erros = [];
  const precisaCfop = [];
  const itens = [];

  for (const c of casados) {
    const n = c.notaItem;
    const nome = c.dev.nome || n.description || 'item';
    let cfop = cfopDeDevolucao(n.cfop);
    const escolhido = Number(cfopEscolhido[c.itemNumber]);
    if (escolhido) {
      if (CFOPS_DEVOLUCAO_PERMITIDOS.includes(escolhido)) cfop = escolhido;
      else erros.push(`O CFOP ${escolhido} escolhido para "${nome}" não é um CFOP de devolução de venda aceito.`);
    }
    if (!cfop) {
      precisaCfop.push({ itemNumber: c.itemNumber, nome, cfopOriginal: n.cfop ?? null });
      continue;
    }

    const razao = c.razao;
    const item = {
      code: n.code,
      ...(n.gtinCode ? { gtinCode: n.gtinCode } : {}),
      description: n.description,
      ncm: n.ncm,
      ...(n.cest ? { cest: n.cest } : {}),
      cfop,
      unit: n.unit,
      quantity: arredondar(Number(n.quantity) * razao, 4),
      unitAmount: n.unitAmount,
      totalAmount: arredondar(Number(n.totalAmount) * razao, 2),
      unitTax: n.unitTax ?? n.unit,
      quantityTax: arredondar(Number(n.quantityTax ?? n.quantity) * razao, 4),
      unitTaxAmount: n.unitTaxAmount ?? n.unitAmount,
      makeupTotal: true,
      taxes: escalarImpostos(n.taxes, razao),
      sourceDocument: { accessKey: chaveOriginal, itemNumber: c.itemNumber },
    };
    if (!(item.totalAmount > 0)) {
      erros.push(`O valor do item "${nome}" na devolução ficou zerado.`);
      continue;
    }
    itens.push(item);
  }

  const destinos = new Set(itens.map((i) => destinoDoCfop(i.cfop)));
  if (destinos.size > 1) {
    erros.push('Os itens têm CFOPs de dentro e de fora do estado na mesma devolução. Emita devoluções separadas para cada grupo.');
  }
  return { itens, erros, precisaCfop };
};

/**
 * Destinatario (quem devolve) a partir do cadastro do cliente. Nao adivinha:
 * dado que falta vira mensagem dizendo onde cadastrar.
 * @returns {{ receiver?: object, erros: string[] }}
 */
const montarDestinatario = (cliente) => {
  const erros = [];
  const nome = String(cliente?.nome || '').trim();
  const quem = nome ? `O cliente "${nome}"` : 'O cliente do pedido';
  if (!cliente) {
    return { erros: ['O cliente do pedido não foi encontrado no cadastro. A nota de devolução precisa identificar quem devolveu.'] };
  }

  const documento = somenteDigitos(cliente.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    erros.push(`${quem} não tem CPF/CNPJ válido cadastrado. A nota de devolução precisa identificar quem devolveu: complete em Cadastros → Clientes.`);
  }

  const faltando = [];
  if (!String(cliente.endereco || '').trim()) faltando.push('endereço');
  if (!String(cliente.numero || '').trim()) faltando.push('número');
  if (!String(cliente.bairro || '').trim()) faltando.push('bairro');
  if (somenteDigitos(cliente.cep).length !== 8) faltando.push('CEP');
  if (!String(cliente.cidade || '').trim()) faltando.push('cidade');
  if (String(cliente.estado || '').trim().length !== 2) faltando.push('estado');
  if (somenteDigitos(cliente.codigoIbge).length !== 7) faltando.push('código IBGE da cidade');
  if (faltando.length > 0) {
    erros.push(`${quem} está sem ${faltando.join(', ')} no cadastro. Complete em Cadastros → Clientes antes de emitir a devolução.`);
  }

  // IE (so' pessoa juridica) -- mesma regra de src/utils/destinatarioFiscalDomain.ts
  let stateTaxNumber;
  if (documento.length === 14) {
    const bruto = String(cliente.identidade || '').trim();
    const digitos = somenteDigitos(bruto);
    if (/^isento$/i.test(bruto)) stateTaxNumber = 'ISENTO';
    else if (digitos.length >= 5 && digitos.length <= 14) stateTaxNumber = digitos;
    else {
      erros.push(bruto
        ? `${quem} é pessoa jurídica e a Inscrição Estadual cadastrada ("${bruto}") não parece válida. Corrija em Cadastros → Clientes ou informe "ISENTO", se for isento.`
        : `${quem} é pessoa jurídica e não tem Inscrição Estadual cadastrada. Informe em Cadastros → Clientes ou escreva "ISENTO", se for isento.`);
    }
  }

  if (erros.length > 0) return { erros };
  const email = String(cliente.emailNfe || cliente.email || '').trim();
  return {
    erros,
    receiver: {
      name: nome,
      federalTaxNumber: documento,
      ...(stateTaxNumber ? { stateTaxNumber } : {}),
      ...(email ? { email } : {}),
      address: {
        street: String(cliente.endereco).trim(),
        number: String(cliente.numero).trim(),
        district: String(cliente.bairro).trim(),
        postalCode: somenteDigitos(cliente.cep),
        city: {
          code: somenteDigitos(cliente.codigoIbge),
          name: String(cliente.cidade).trim(),
          state: String(cliente.estado).trim().toUpperCase(),
        },
      },
    },
  };
};

/** Data da nota original pra texto (dd/mm/aaaa). */
const dataCurta = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/** Corpo do POST /product-invoices da Spedy. */
const montarPayloadDevolucao = ({ integrationId, receiver, itens, notaOriginal }) => {
  const total = arredondar(itens.reduce((soma, i) => soma + i.totalAmount, 0), 2);
  const numero = notaOriginal.number ? ` Nº ${notaOriginal.number}` : '';
  const data = dataCurta(notaOriginal.data);
  return {
    integrationId,
    isFinalCustomer: true,
    operationType: 'incoming',
    purposeType: 'devolution',
    destination: destinoDoCfop(itens[0].cfop),
    presenceType: 'none',
    operationNature: 'Devolução de Venda',
    additionalInformation: `Devolução referente à ${notaOriginal.tipo}${numero}${data ? ` de ${data}` : ''}. Chave de acesso: ${notaOriginal.accessKey}.`,
    sendEmailToCustomer: Boolean(receiver.email),
    receiver,
    items: itens,
    payments: [{ method: 'noPayment', amount: 0 }],
    total: { invoiceAmount: total, productAmount: total },
  };
};

/**
 * Tudo junto: recebe os documentos ja lidos do banco e devolve a previa (ou os
 * erros que impedem). Nao le nem grava nada.
 */
const prepararDevolucao = ({ devolucao, pedido, notas, cliente, notaOriginalId, cfopEscolhido, agora = new Date() }) => {
  const erros = [];
  const avisos = [];

  const escolha = escolherNotaOriginal(notas, notaOriginalId);
  const candidatas = escolha.candidatas.map((n) => ({ id: n.id, tipo: n.tipo, numero: n.number ?? null, data: n.data ?? null }));
  if (escolha.erro) return { ok: false, erros: [escolha.erro], avisos, candidatas };
  const nota = escolha.nota;

  if (!nota.accessKey) {
    erros.push('A nota original não tem a chave de acesso gravada. Consulte a nota na Spedy (Notas Fiscais → Consultar na Spedy) e tente de novo.');
  }
  const itensNota = Array.isArray(nota.itensFiscais) ? nota.itensFiscais : [];
  if (itensNota.length === 0) {
    erros.push(`A ${nota.tipo}${nota.number ? ` Nº ${nota.number}` : ''} não guardou os itens que foram enviados à SEFAZ (foi emitida antes deste recurso). Sem eles não dá para referenciar cada item da nota original, que é exigido na devolução desde 01/09/2026.`);
  }
  if (erros.length > 0) return { ok: false, erros, avisos, candidatas };

  const { casados, erros: errosCasamento } = casarItens({
    itensDevolvidos: devolucao.itensDevolvidos,
    itensPedido: pedido.itens,
    itensNota,
  });
  erros.push(...errosCasamento);

  const montagem = montarItensDevolucao({ casados, chaveOriginal: nota.accessKey, cfopEscolhido });
  erros.push(...montagem.erros);

  const destinatario = montarDestinatario(cliente);
  erros.push(...destinatario.erros);

  const prazo = prazoDeCancelamento(nota.data, agora);
  if (prazo.conhecido && prazo.dentroDoPrazo) {
    avisos.push(`A nota original foi emitida há ${prazo.horas} hora(s), ainda dentro do prazo geral de cancelamento (${PRAZO_CANCELAMENTO_HORAS}h, varia por estado). Se a venda inteira foi desfeita, costuma ser mais simples cancelar a nota em Notas Fiscais. Se a devolução é parcial, siga com a devolução.`);
  }

  const notaOriginalResumo = {
    id: nota.id, tipo: nota.tipo, numero: nota.number ?? null, chave: nota.accessKey ?? null, data: nota.data ?? null,
  };
  const base = { avisos, candidatas, notaOriginal: notaOriginalResumo, precisaCfop: montagem.precisaCfop };
  if (montagem.precisaCfop.length > 0 && erros.length === 0) {
    return { ok: false, erros: [], ...base, itens: montagem.itens };
  }
  if (erros.length > 0 || montagem.itens.length === 0) {
    return { ok: false, erros: erros.length ? erros : ['Nenhum item da devolução pôde ser montado.'], ...base, itens: montagem.itens };
  }

  const total = arredondar(montagem.itens.reduce((soma, i) => soma + i.totalAmount, 0), 2);
  return {
    ok: true,
    erros: [],
    ...base,
    itens: montagem.itens,
    valorTotal: total,
    receiver: destinatario.receiver,
    notaOriginalCompleta: nota,
  };
};

module.exports = {
  CFOP_DEVOLUCAO_POR_ORIGEM,
  CFOPS_DEVOLUCAO_PERMITIDOS,
  PRAZO_CANCELAMENTO_HORAS,
  cfopDeDevolucao,
  destinoDoCfop,
  escalarImpostos,
  prazoDeCancelamento,
  notaVigenteDaDevolucao,
  escolherNotaOriginal,
  casarItens,
  montarItensDevolucao,
  montarDestinatario,
  montarPayloadDevolucao,
  prepararDevolucao,
};

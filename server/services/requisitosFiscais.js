/**
 * REQUISITOS PARA EMITIR NOTA FISCAL (2026-09-21).
 *
 * Nasceu de uma rejeicao real em producao: "Nao foi possivel encontrar as
 * definicoes do servico Authorization, Estado:MG, Ambiente:0,
 * Modelo:ProductInvoice". Ambiente 0 = a NF-e da empresa estava SEM ambiente
 * definido na Spedy. O sistema so' mandava serie e proximo numero, nunca o
 * ambiente, e ninguem via a falta ate' a nota voltar rejeitada.
 *
 * Esta e' a lista do que a empresa PRECISA ter antes de emitir. Cada item diz
 * o que falta e ONDE resolver, em portugues, pro cliente se resolver sozinho.
 * Pendencia de gravidade `bloqueio` impede a emissao; `aviso` so' informa.
 *
 * Duas fontes: as configuracoes da empresa NA SPEDY (GET /companies/{id}/
 * settings e /certificates, lidos com a chave da propria empresa) e o cadastro
 * da empresa aqui no sistema. Quando a Spedy nao pode ser lida (empresa
 * cadastrada sem id, Spedy fora do ar), os itens que dependem dela ficam
 * `desconhecido` -- nunca `bloqueio`: nao se trava emissao por falha da
 * propria conferencia.
 */

const AMBIENTES_NOTA_SEFAZ = ['production', 'development'];

const ROTULO_AMBIENTE = {
  production: 'Produção',
  development: 'Homologação (testes)',
  simulation: 'Simulação',
};

const DIAS_AVISO_CERTIFICADO = 30;

const formatarDataBR = (data) => {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

const item = (id, situacao, gravidade, mensagem, comoResolver) => ({
  id, situacao, gravidade, mensagem, comoResolver,
});

const ok = (id, mensagem) => item(id, 'ok', 'ok', mensagem, '');
const falta = (id, mensagem, comoResolver) => item(id, 'pendente', 'bloqueio', mensagem, comoResolver);
const aviso = (id, mensagem, comoResolver) => item(id, 'atencao', 'aviso', mensagem, comoResolver);
const desconhecido = (id, mensagem, comoResolver) => item(id, 'desconhecido', 'aviso', mensagem, comoResolver);

/** Certificado A1: precisa existir um ativo e dentro da validade. */
const avaliarCertificado = (certificados, agora) => {
  if (!Array.isArray(certificados)) {
    return desconhecido(
      'certificado',
      'Não foi possível conferir o certificado digital na Spedy agora.',
      'Tente de novo em instantes. Se persistir, confira em Configurações → Nota Fiscal (Spedy) ou no painel da Spedy.',
    );
  }
  const ativo = certificados.find((c) => c && c.isActive);
  if (!ativo) {
    return falta(
      'certificado',
      'A empresa não tem certificado digital A1 ativo na Spedy.',
      'Envie o certificado A1 (arquivo .pfx e senha) no painel da Spedy, em Empresas → Certificados. Sem ele a NF-e e a NFC-e não são assinadas.',
    );
  }
  const validade = new Date(ativo.expirationAt);
  if (!Number.isNaN(validade.getTime())) {
    if (validade.getTime() < agora.getTime()) {
      return falta(
        'certificado',
        `O certificado digital A1 venceu em ${formatarDataBR(validade)}.`,
        'Compre a renovação do certificado A1 e envie o novo arquivo no painel da Spedy, em Empresas → Certificados.',
      );
    }
    const dias = Math.ceil((validade.getTime() - agora.getTime()) / 86400000);
    if (dias <= DIAS_AVISO_CERTIFICADO) {
      return aviso(
        'certificado',
        `O certificado digital A1 vence em ${dias} dia(s), em ${formatarDataBR(validade)}.`,
        'Providencie a renovação antes do vencimento e envie o novo arquivo no painel da Spedy.',
      );
    }
  }
  return ok('certificado', 'Certificado digital A1 ativo e dentro da validade.');
};

const avaliarAmbiente = (id, rotulo, bloco, ambienteSpedy) => {
  if (!bloco) {
    return desconhecido(
      id,
      `Não foi possível ler o ambiente da ${rotulo} na Spedy agora.`,
      'Tente de novo em instantes.',
    );
  }
  const ambiente = bloco.environmentType;
  if (!AMBIENTES_NOTA_SEFAZ.includes(ambiente)) {
    return falta(
      id,
      `O ambiente da ${rotulo} não está definido na Spedy (a Spedy enxerga "Ambiente: 0"). Sem ele a nota é rejeitada.`,
      `Em Configurações → Nota Fiscal (Spedy), escolha o ambiente da ${rotulo} (Homologação ou Produção) e salve.`,
    );
  }
  if (ambienteSpedy === 'production' && ambiente === 'development') {
    return aviso(
      id,
      `A ${rotulo} está em Homologação: as notas saem SEM validade fiscal, mesmo com a empresa em Produção na Spedy.`,
      `Se já é para valer, troque o ambiente da ${rotulo} para Produção em Configurações → Nota Fiscal (Spedy).`,
    );
  }
  if (ambienteSpedy !== 'production' && ambiente === 'production') {
    return aviso(
      id,
      `A ${rotulo} está em Produção, mas a integração com a Spedy está no ambiente de testes (sandbox).`,
      'Confira os dois ambientes em Configurações → Nota Fiscal (Spedy) para não emitir nota fiscal real por engano.',
    );
  }
  return ok(id, `Ambiente da ${rotulo}: ${ROTULO_AMBIENTE[ambiente]}.`);
};

const avaliarNumeracao = (id, rotulo, bloco) => {
  if (!bloco) {
    return desconhecido(id, `Não foi possível ler a numeração da ${rotulo} na Spedy agora.`, 'Tente de novo em instantes.');
  }
  const serie = String(bloco.series ?? '').trim();
  const proximo = Number(bloco.nextNumber);
  if (!serie || !Number.isFinite(proximo) || proximo < 1) {
    return falta(
      id,
      `A série e o próximo número da ${rotulo} não estão definidos.`,
      `Em Configurações → Nota Fiscal (Spedy), informe a série e o próximo número da ${rotulo}. Se a empresa já emitiu notas em outro sistema, continue a numeração de onde parou.`,
    );
  }
  return ok(id, `Série ${serie}, próximo número ${proximo}.`);
};

const avaliarCsc = (bloco) => {
  if (!bloco) {
    return desconhecido('nfce_csc', 'Não foi possível ler o CSC da NFC-e na Spedy agora.', 'Tente de novo em instantes.');
  }
  if (!String(bloco.csc || '').trim() || !String(bloco.tokenId || '').trim()) {
    return falta(
      'nfce_csc',
      'O CSC e o Id do CSC da NFC-e não estão informados. Sem eles o cupom não gera o QR Code e não é autorizado.',
      'Gere o CSC no portal da SEFAZ do seu estado e informe o código e o Id em Configurações → Nota Fiscal (Spedy).',
    );
  }
  return ok('nfce_csc', 'CSC e Id do CSC informados.');
};

/** Requisitos que vem do cadastro da empresa no proprio sistema. */
const avaliarEmpresa = (config) => {
  const itens = [];
  const cnpj = String((config && config.cnpj) || '').replace(/\D/g, '');
  itens.push(cnpj.length === 14
    ? ok('empresa_cnpj', 'CNPJ da empresa cadastrado.')
    : falta(
      'empresa_cnpj',
      'O CNPJ da empresa não está cadastrado ou está incompleto.',
      'Informe o CNPJ com 14 dígitos em Configurações → Dados da Empresa.',
    ));

  const ie = String((config && config.inscricaoEstadual) || '').trim();
  itens.push(ie
    ? ok('empresa_ie', 'Inscrição Estadual informada.')
    : aviso(
      'empresa_ie',
      'A Inscrição Estadual da empresa não está informada.',
      'Empresa contribuinte de ICMS precisa da IE (ou "ISENTO", se for o caso) em Configurações → Dados da Empresa; sem ela a SEFAZ costuma rejeitar a NF-e.',
    ));
  return itens;
};

const fechar = (checks) => ({
  pronto: !checks.some((c) => c.gravidade === 'bloqueio'),
  checks,
});

/**
 * @param {object} p
 * @param {object} p.config      configuracoes/{tenant} (nosso cadastro)
 * @param {object|null} p.settings  GET /companies/{id}/settings (ou null)
 * @param {Array|null} p.certificados  GET /companies/{id}/certificates (ou null)
 * @param {Date} [p.agora]
 */
const avaliarRequisitos = ({ config, settings, certificados, agora = new Date() }) => {
  const ambienteSpedy = config && config.spedyEnvironment === 'production' ? 'production' : 'sandbox';
  const empresa = avaliarEmpresa(config);
  const certificado = avaliarCertificado(certificados, agora);
  const produto = settings ? (settings.productInvoice || {}) : null;
  const consumidor = settings ? (settings.consumerInvoice || {}) : null;

  return {
    ambienteSpedy,
    ambientes: {
      nfe: produto ? (produto.environmentType || null) : null,
      nfce: consumidor ? (consumidor.environmentType || null) : null,
    },
    nfe: fechar([
      ...empresa,
      certificado,
      avaliarAmbiente('nfe_ambiente', 'NF-e', produto, ambienteSpedy),
      avaliarNumeracao('nfe_numeracao', 'NF-e', produto),
    ]),
    nfce: fechar([
      ...empresa,
      certificado,
      avaliarAmbiente('nfce_ambiente', 'NFC-e', consumidor, ambienteSpedy),
      avaliarNumeracao('nfce_numeracao', 'NFC-e', consumidor),
      avaliarCsc(consumidor),
    ]),
  };
};

/** Mensagem unica, em portugues, com so' o que BLOQUEIA a emissao. */
const mensagemBloqueio = (avaliacao) => {
  const bloqueios = (avaliacao && avaliacao.checks ? avaliacao.checks : []).filter((c) => c.gravidade === 'bloqueio');
  if (bloqueios.length === 0) return '';
  return bloqueios.map((c) => `• ${c.mensagem} ${c.comoResolver}`.trim()).join('\n');
};

const validarAmbienteEnviado = (valor) => valor === undefined || AMBIENTES_NOTA_SEFAZ.includes(valor);

module.exports = {
  AMBIENTES_NOTA_SEFAZ,
  avaliarRequisitos,
  avaliarCertificado,
  avaliarAmbiente,
  avaliarNumeracao,
  mensagemBloqueio,
  validarAmbienteEnviado,
};

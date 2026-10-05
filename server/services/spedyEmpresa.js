/**
 * Dados cadastrais da EMPRESA na Spedy (nome, razao social, CNPJ, IE,
 * endereco, regime) montados a partir de configuracoes/{tenantId}. Usado no
 * cadastro inicial pela plataforma (spedyCompanies.routes.js) e na
 * sincronizacao feita pela propria empresa ao salvar Configuracoes
 * (spedy.routes.js, POST /empresa/sincronizar).
 *
 * E' daqui que sai o nome do EMITENTE impresso na DANFE (xNome = legalName):
 * ate 2026-09-30 ia o "Nome Fantasia" do sistema (nomeOficina) -- na Sol Life
 * a DANFE saia como "sol natus" em vez de "SOL LIFE PRODUTOS NATURAIS LTDA".
 */
// Regime tributario do Hennder (src/utils/fiscalDomain.ts) -> TaxRegime da
// Spedy. So simples_nacional tem equivalente direto; lucro_presumido e
// lucro_real caem em "regimeNormal" (aproximacao -- a Spedy nao distingue
// os dois na criacao da empresa, so no calculo de imposto por nota).
const TAX_REGIME_MAP = {
  simples_nacional: 'simplesNacional',
  lucro_presumido: 'regimeNormal',
  lucro_real: 'regimeNormal',
};

/** Monta o corpo de criacao de empresa a partir do que ja esta salvo em
 * configuracoes/{tenantId} -- nao pede nada de novo pro admin da
 * plataforma alem do CNPJ da empresa (que ja esta la). Endereco e cidade
 * IBGE reaproveitam os mesmos campos que a tela de Configuracoes do
 * tenant ja preenche pra NFS-e (nfseCidadeCodigo/Nome/Estado). */
// O elemento <IE> da NFe (tipo TIe do schema da Sefaz) so aceita digitos --
// achado ao vivo (2026-09-11): "002131194.00-14" (formato que o usuario
// digitou em Configuracoes) foi rejeitado com "The Pattern constraint
// failed". "ISENTO" (texto livre no campo, convencao ja usada na tela pra
// empresa sem IE) fica de fora dessa limpeza -- so os numeros/pontuacao
// digitados por engano no meio de uma IE numerica sao removidos.
const sanitizarInscricaoEstadual = (valor) => {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  if (/^isento$/i.test(raw)) return raw.toUpperCase();
  return raw.replace(/\D/g, '');
};

const buildCompanyPayload = (config) => {
  const nome = String(config.nomeOficina || '').trim();
  // Razao social (Receita) no nome legal; fantasia no nome curto. So' cai no
  // nome do sistema quando a empresa nao tem esses campos.
  const razaoSocial = String(config.razaoSocial || '').trim() || nome;
  // Fantasia = o "Nome Fantasia da Empresa" de Configuracoes (nomeOficina), o
  // que a pessoa ve e edita; o nomeFantasia da Receita so' se ele estiver vazio.
  const nomeFantasia = nome || String(config.nomeFantasia || '').trim();
  const cnpj = String(config.cnpj || '').replace(/\D/g, '');
  const inscricaoEstadual = sanitizarInscricaoEstadual(config.inscricaoEstadual);

  return {
    name: nomeFantasia,
    legalName: razaoSocial,
    federalTaxNumber: cnpj,
    ...(inscricaoEstadual ? { stateTaxNumber: inscricaoEstadual } : {}),
    ...(config.email ? { email: String(config.email).trim() } : {}),
    // Campo "phone" DESLIGADO de proposito (2026-09-11). A doc da Spedy so
    // diz "string, max 15 caracteres" -- sem regex nem exemplo. Ja testamos
    // formatado ("(27) 3735-5002") e so digitos ("27373550028"), os dois
    // deram "The field Phone is invalid". Telefone e opcional no cadastro
    // de empresa, entao ficou de fora ate confirmar o formato certo com o
    // suporte da Spedy -- nao vale travar o cadastro chutando de novo.
    // Reativar preenchendo aqui quando o formato for confirmado.
    address: {
      ...(config.rua || config.endereco ? { street: String(config.rua || config.endereco).trim() } : {}),
      ...(config.numero ? { number: String(config.numero).trim() } : {}),
      ...(config.bairro ? { district: String(config.bairro).trim() } : {}),
      ...(config.cep ? { postalCode: String(config.cep).replace(/\D/g, '') } : {}),
      ...(config.nfseCidadeCodigo ? {
        city: {
          code: config.nfseCidadeCodigo,
          name: config.nfseCidadeNome || undefined,
          state: (config.nfseCidadeEstado || '').toLowerCase() || undefined,
        },
      } : {}),
    },
    taxRegime: TAX_REGIME_MAP[config.regimeTributario] || 'simplesNacional',
  };
};

module.exports = { TAX_REGIME_MAP, sanitizarInscricaoEstadual, buildCompanyPayload };

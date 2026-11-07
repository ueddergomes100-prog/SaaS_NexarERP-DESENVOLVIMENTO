/*
 * PREENCHER OS DADOS DA EMPRESA PELO CNPJ (Configuracoes da filial, 07/11/2026).
 *
 * Pedido do dono configurando o sistema num cliente: "quando preencher o CNPJ,
 * ja' buscar tudo e preencher automatico". A consulta e' a mesma do cadastro de
 * cliente (Receita Federal pelo servidor, documentoService.consultarCnpj); aqui
 * fica a parte pura: o que vai para cada campo e o que precisa de confirmacao
 * porque ja' estava preenchido com outro valor.
 */

export interface DadosDaReceita {
  encontrado?: boolean;
  razaoSocial?: string;
  nomeFantasia?: string;
  situacao?: string;
  ativo?: boolean;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  telefone?: string;
  email?: string;
  /** Optante pelo Simples Nacional (quando a Receita informa). */
  simplesNacional?: boolean | null;
}

/** Campos da tela de Configuracoes que a Receita preenche. */
export interface CamposDaEmpresa {
  razaoSocial: string;
  nomeOficina: string;
  rua: string;
  numero: string;
  bairro: string;
  cep: string;
  telefone: string;
  email: string;
}

export const ROTULO_CAMPO_EMPRESA: Record<keyof CamposDaEmpresa, string> = {
  razaoSocial: 'Razão social',
  nomeOficina: 'Nome fantasia',
  rua: 'Rua',
  numero: 'Número',
  bairro: 'Bairro',
  cep: 'CEP',
  telefone: 'Telefone',
  email: 'E-mail',
};

const limpar = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export const formatarCep = (cep: unknown): string => {
  const d = limpar(cep).replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** "3133334444 / 31999998888" da Receita vira "(31) 3333-4444"; mais de um, fica o primeiro. */
export const formatarTelefone = (telefone: unknown): string => {
  const primeiro = limpar(telefone).split('/')[0] || '';
  const d = primeiro.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return primeiro.trim();
};

/** So' os campos que a Receita trouxe (vazio nao apaga o que a pessoa tem). Razao e fantasia em caixa alta, como o cartao CNPJ. */
export const camposDaReceita = (d: DadosDaReceita): Partial<CamposDaEmpresa> => {
  const saida: Partial<CamposDaEmpresa> = {};
  const razao = limpar(d.razaoSocial).toUpperCase();
  const fantasia = limpar(d.nomeFantasia).toUpperCase();
  if (razao) saida.razaoSocial = razao;
  // Empresa sem nome fantasia na Receita usa a razao social.
  if (fantasia || razao) saida.nomeOficina = fantasia || razao;
  if (limpar(d.logradouro)) saida.rua = limpar(d.logradouro).toUpperCase();
  if (limpar(d.numero)) saida.numero = limpar(d.numero).toUpperCase();
  if (limpar(d.bairro)) saida.bairro = limpar(d.bairro).toUpperCase();
  if (formatarCep(d.cep)) saida.cep = formatarCep(d.cep);
  if (formatarTelefone(d.telefone)) saida.telefone = formatarTelefone(d.telefone);
  if (limpar(d.email)) saida.email = limpar(d.email).toLowerCase();
  return saida;
};

export interface CampoSobrescrito {
  campo: keyof CamposDaEmpresa;
  rotulo: string;
  de: string;
  para: string;
}

export interface PreenchimentoPelaReceita {
  /** O que vai para o formulario (tudo o que a Receita trouxe). */
  novos: Partial<CamposDaEmpresa>;
  /** Campos que ja' tinham outro valor: a pessoa confirma antes de trocar. */
  sobrescritos: CampoSobrescrito[];
}

const iguais = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export const preenchimentoPelaReceita = (atual: CamposDaEmpresa, dados: DadosDaReceita): PreenchimentoPelaReceita => {
  const novos = camposDaReceita(dados);
  const sobrescritos: CampoSobrescrito[] = [];
  (Object.keys(novos) as Array<keyof CamposDaEmpresa>).forEach((campo) => {
    const de = limpar(atual[campo]);
    const para = novos[campo] as string;
    if (de && !iguais(de, para)) sobrescritos.push({ campo, rotulo: ROTULO_CAMPO_EMPRESA[campo], de, para });
  });
  return { novos, sobrescritos };
};

/** Sem os campos que ja' tinham valor: para quando a pessoa escolhe "so' os vazios". */
export const soOsVazios = (atual: CamposDaEmpresa, novos: Partial<CamposDaEmpresa>): Partial<CamposDaEmpresa> => (
  Object.fromEntries((Object.entries(novos) as Array<[keyof CamposDaEmpresa, string]>).filter(([campo]) => !limpar(atual[campo]))) as Partial<CamposDaEmpresa>
);

/** Aviso quando a situacao cadastral nao esta' ativa (a pessoa decide se segue). */
export const avisoDaSituacao = (d: DadosDaReceita): string | null => {
  if (d.ativo !== false) return null;
  const situacao = limpar(d.situacao) || 'não informada';
  return `A Receita Federal mostra este CNPJ com situação "${situacao}". Os dados foram preenchidos mesmo assim; confira se é a empresa certa.`;
};

/** Regime tributario sugerido pela Receita (so' quando ela informa que e' do Simples). */
export const regimeSugerido = (d: DadosDaReceita): 'simples_nacional' | null => (d.simplesNacional === true ? 'simples_nacional' : null);

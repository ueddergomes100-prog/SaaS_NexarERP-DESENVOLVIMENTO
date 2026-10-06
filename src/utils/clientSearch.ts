import { normalizeSearchText, splitSearchTerms } from './textSearch';

/**
 * Campos do cadastro que a busca de cliente usa. Todos opcionais: as telas
 * carregam o documento inteiro do Firestore, mas cliente antigo pode nao ter
 * cidade, fantasia etc. -- e a busca nao pode quebrar por isso.
 */
export interface SearchableClient {
  nome?: string | null;
  codigo?: string | null;
  // Sem `null` de proposito: os tipos de cliente das telas (ex.: o
  // ClienteConfirmavel do app Vendas) declaram estes campos como string opcional.
  fantasia?: string;
  documento?: string;
  telefone?: string;
  celular?: string;
  cidade?: string;
  estado?: string;
  bairro?: string;
  endereco?: string;
  /** `false` = inativo (lista de Clientes). Sem o campo = ativo. */
  ativo?: boolean;
}

/** Curinga "listar tudo", o mesmo da busca de produto (productSearch.ts): "#" mostra a lista inteira e "#ana" filtra por "ana". */
export const LISTAR_TUDO_CLIENTES = '#';

// ---------------------------------------------------------------------------
// FILTROS DA CONSULTA DE CLIENTES (2026-10-06)
//
// Pedido do dono, com print da "Consulta de Clientes" do ERP antigo (Integra):
// na hora de escolher o cliente (Pedido, PDV, OS, Orcamento, app Vendas...),
// ter os mesmos filtros de la':
//   - Procura exata / avancada  -> modo "Comeca com" / "Contem"
//   - Consulta por Nome, Fantasia, CPF, Fone, Endereco, Bairro -> "Buscar em"
//     (com "Tudo", o padrao, que procura em todos de uma vez)
//   - Cidade e Estado
//   - Situacao (ativos / inativos / todos)
//
// Cidade e estado sao comparados sem acento e sem caixa: "Itaguaçu" e
// "ITAGUACU" sao a mesma cidade. Cliente sem cidade fica numa opcao propria
// ("Sem cidade no cadastro"), que tambem serve para achar e corrigir esses
// cadastros.
// ---------------------------------------------------------------------------

export interface FiltroLocalCliente {
  /** Sigla do estado em maiusculas ("ES"), ou null para todos. */
  uf: string | null;
  /** Chave de chaveCidadeDoCliente (cidade normalizada + UF), SEM_CIDADE, ou null para todas. */
  cidade: string | null;
}

export type SituacaoCliente = 'ativos' | 'inativos' | 'todos';
export type CampoBuscaCliente = 'tudo' | 'nome' | 'fantasia' | 'documento' | 'telefone' | 'endereco' | 'bairro';
export type ModoBuscaCliente = 'contem' | 'comeca';

export interface FiltrosConsultaCliente extends FiltroLocalCliente {
  situacao: SituacaoCliente;
  campo: CampoBuscaCliente;
  modo: ModoBuscaCliente;
}

export const FILTRO_LOCAL_VAZIO: FiltroLocalCliente = { uf: null, cidade: null };

/**
 * Padrao das telas de venda: clientes ATIVOS, procurando em tudo, "contem".
 * Mesmo padrao das listas de cadastro (FiltroSituacao): inativo nao aparece
 * para escolher, a nao ser que a pessoa peca.
 */
export const FILTROS_CONSULTA_PADRAO: FiltrosConsultaCliente = {
  uf: null,
  cidade: null,
  situacao: 'ativos',
  campo: 'tudo',
  modo: 'contem',
};

export const CAMPOS_BUSCA_CLIENTE: Array<{ valor: CampoBuscaCliente; rotulo: string }> = [
  { valor: 'tudo', rotulo: 'Tudo' },
  { valor: 'nome', rotulo: 'Nome' },
  { valor: 'fantasia', rotulo: 'Fantasia' },
  { valor: 'documento', rotulo: 'CPF/CNPJ' },
  { valor: 'telefone', rotulo: 'Telefone' },
  { valor: 'endereco', rotulo: 'Endereço' },
  { valor: 'bairro', rotulo: 'Bairro' },
];

/** Chave da opcao "cliente sem cidade no cadastro". */
export const SEM_CIDADE = '__sem_cidade__';

export const clienteEstaAtivo = (cliente: SearchableClient): boolean => cliente.ativo !== false;

export const ufDoCliente = (cliente: SearchableClient): string => normalizeSearchText(cliente.estado).toUpperCase();

export const chaveCidadeDoCliente = (cliente: SearchableClient): string => {
  const cidade = normalizeSearchText(cliente.cidade);
  return cidade ? `${cidade}|${ufDoCliente(cliente)}` : SEM_CIDADE;
};

export const filtroLocalAtivo = (filtro: Partial<FiltroLocalCliente> | null | undefined): boolean => Boolean(filtro?.uf || filtro?.cidade);

export const passaNoFiltroLocal = (cliente: SearchableClient, filtro: Partial<FiltroLocalCliente> | null | undefined): boolean => {
  if (!filtro) return true;
  // A chave da cidade ja' carrega o estado.
  if (filtro.cidade) return chaveCidadeDoCliente(cliente) === filtro.cidade;
  if (filtro.uf) return ufDoCliente(cliente) === filtro.uf;
  return true;
};

export const passaNaSituacaoCliente = (cliente: SearchableClient, situacao: SituacaoCliente | undefined): boolean => {
  if (!situacao || situacao === 'todos') return true;
  return situacao === 'ativos' ? clienteEstaAtivo(cliente) : !clienteEstaAtivo(cliente);
};

/** Quantos filtros estao diferentes do padrao (para o "+2" da etiqueta). */
export const contarFiltrosAtivos = (filtros: FiltrosConsultaCliente): number => (
  (filtroLocalAtivo(filtros) ? 1 : 0)
  + (filtros.situacao !== FILTROS_CONSULTA_PADRAO.situacao ? 1 : 0)
  + (filtros.campo !== FILTROS_CONSULTA_PADRAO.campo ? 1 : 0)
  + (filtros.modo !== FILTROS_CONSULTA_PADRAO.modo ? 1 : 0)
);

export interface CidadeDosClientes {
  chave: string;
  /** Como aparece na tela: a grafia mais usada nos cadastros, em maiusculas. */
  cidade: string;
  uf: string;
  total: number;
}

export interface LocaisDosClientes {
  ufs: Array<{ uf: string; total: number }>;
  cidades: CidadeDosClientes[];
  semCidade: number;
}

/** Cidades e estados que existem nos cadastros, com quantos clientes em cada. */
export const listarLocaisDosClientes = (clientes: SearchableClient[]): LocaisDosClientes => {
  const porChave = new Map<string, { grafias: Map<string, number>; uf: string; total: number }>();
  const porUf = new Map<string, number>();
  let semCidade = 0;

  for (const cliente of clientes) {
    const uf = ufDoCliente(cliente);
    if (uf) porUf.set(uf, (porUf.get(uf) || 0) + 1);
    const chave = chaveCidadeDoCliente(cliente);
    if (chave === SEM_CIDADE) {
      semCidade += 1;
      continue;
    }
    const grafia = String(cliente.cidade ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    const atual = porChave.get(chave) || { grafias: new Map<string, number>(), uf, total: 0 };
    atual.total += 1;
    atual.grafias.set(grafia, (atual.grafias.get(grafia) || 0) + 1);
    porChave.set(chave, atual);
  }

  const cidades = [...porChave.entries()].map(([chave, dados]) => {
    const [cidade] = [...dados.grafias.entries()].sort((a, b) => b[1] - a[1])[0];
    return { chave, cidade, uf: dados.uf, total: dados.total };
  }).sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR') || a.uf.localeCompare(b.uf));

  const ufs = [...porUf.entries()]
    .map(([uf, total]) => ({ uf, total }))
    .sort((a, b) => a.uf.localeCompare(b.uf));

  return { ufs, cidades, semCidade };
};

/** Texto curto do filtro de local, para o botao e o resumo da lista ("SERRA · ES"). Vazio = sem filtro. */
export const rotuloFiltroLocal = (filtro: Partial<FiltroLocalCliente> | null | undefined, locais: LocaisDosClientes): string => {
  if (!filtro) return '';
  if (filtro.cidade === SEM_CIDADE) return 'Sem cidade no cadastro';
  if (filtro.cidade) {
    const cidade = locais.cidades.find((c) => c.chave === filtro.cidade);
    if (!cidade) return 'Cidade';
    return cidade.uf ? `${cidade.cidade} · ${cidade.uf}` : cidade.cidade;
  }
  if (filtro.uf) return `Estado ${filtro.uf}`;
  return '';
};

/**
 * Resumo dos filtros ligados, para a etiqueta do campo de cliente: o mais
 * importante por extenso e o resto como "+N" ("SERRA · ES +1"). Vazio = so'
 * o padrao.
 */
export const resumoDosFiltros = (filtros: FiltrosConsultaCliente, locais: LocaisDosClientes): string => {
  const partes: string[] = [];
  if (filtroLocalAtivo(filtros)) partes.push(rotuloFiltroLocal(filtros, locais));
  if (filtros.situacao === 'inativos') partes.push('Só inativos');
  if (filtros.situacao === 'todos') partes.push('Ativos e inativos');
  if (filtros.campo !== 'tudo') partes.push(`Em ${CAMPOS_BUSCA_CLIENTE.find((c) => c.valor === filtros.campo)?.rotulo ?? filtros.campo}`);
  if (filtros.modo === 'comeca') partes.push('Começa com');
  if (partes.length === 0) return '';
  return partes.length === 1 ? partes[0] : `${partes[0]} +${partes.length - 1}`;
};

// ---------------------------------------------------------------------------
// BUSCA
// ---------------------------------------------------------------------------

interface IndiceDoCliente {
  nome: string;
  fantasia: string;
  codigo: string;
  documento: string;
  documentoDigitos: string;
  telefones: string[];
  telefonesDigitos: string[];
  endereco: string;
  bairro: string;
  cidade: string;
}

const soDigitos = (valor: unknown): string => String(valor ?? '').replace(/\D/g, '');

// A lista de clientes e' a mesma entre uma tecla e outra: indexa uma vez so'.
const indices = new WeakMap<object, IndiceDoCliente>();

const indexar = (cliente: SearchableClient): IndiceDoCliente => {
  const pronto = indices.get(cliente);
  if (pronto) return pronto;
  const telefones = [cliente.telefone, cliente.celular];
  const indice: IndiceDoCliente = {
    nome: normalizeSearchText(cliente.nome),
    fantasia: normalizeSearchText(cliente.fantasia),
    codigo: normalizeSearchText(cliente.codigo),
    documento: normalizeSearchText(cliente.documento),
    documentoDigitos: soDigitos(cliente.documento),
    telefones: telefones.map(normalizeSearchText).filter(Boolean),
    telefonesDigitos: telefones.map(soDigitos).filter(Boolean),
    endereco: normalizeSearchText(cliente.endereco),
    bairro: normalizeSearchText(cliente.bairro),
    cidade: normalizeSearchText(cliente.cidade),
  };
  indices.set(cliente, indice);
  return indice;
};

// Termo que e' "numero com pontuacao" (CPF, CNPJ, telefone) tambem e'
// comparado so' pelos digitos. Minimo de 3 digitos: "2" nao pode casar com
// todo telefone que tenha um 2.
const PARECE_NUMERO = /^[\d\s().\-/]+$/;

interface TermoDaBusca {
  texto: string;
  digitos: string;
  comeca: boolean;
}

const casaTexto = (valor: string, termo: TermoDaBusca): boolean => (
  valor !== '' && (termo.comeca ? valor.startsWith(termo.texto) : valor.includes(termo.texto))
);

const casaDigitos = (valor: string, termo: TermoDaBusca): boolean => (
  termo.digitos.length >= 3 && valor !== ''
  && (termo.comeca ? valor.startsWith(termo.digitos) : valor.includes(termo.digitos))
);

/** 'identidade' = nome/fantasia/codigo/documento/telefone; 'local' = endereco/bairro/cidade; null = nao casou. */
const ondeCasou = (indice: IndiceDoCliente, termo: TermoDaBusca, campo: CampoBuscaCliente): 'identidade' | 'local' | null => {
  switch (campo) {
    case 'nome':
      return casaTexto(indice.nome, termo) || (indice.codigo !== '' && indice.codigo === termo.texto) ? 'identidade' : null;
    case 'fantasia':
      return casaTexto(indice.fantasia, termo) ? 'identidade' : null;
    case 'documento':
      return casaDigitos(indice.documentoDigitos, termo) || casaTexto(indice.documento, termo) ? 'identidade' : null;
    case 'telefone':
      return indice.telefonesDigitos.some((t) => casaDigitos(t, termo)) || indice.telefones.some((t) => casaTexto(t, termo))
        ? 'identidade' : null;
    case 'endereco':
      return casaTexto(indice.endereco, termo) ? 'local' : null;
    case 'bairro':
      return casaTexto(indice.bairro, termo) ? 'local' : null;
    default: {
      const naIdentidade = casaTexto(indice.nome, termo)
        || casaTexto(indice.fantasia, termo)
        || casaTexto(indice.codigo, termo)
        || casaTexto(indice.documento, termo)
        || casaDigitos(indice.documentoDigitos, termo)
        || indice.telefones.some((t) => casaTexto(t, termo))
        || indice.telefonesDigitos.some((t) => casaDigitos(t, termo));
      if (naIdentidade) return 'identidade';
      return casaTexto(indice.endereco, termo) || casaTexto(indice.bairro, termo) || casaTexto(indice.cidade, termo)
        ? 'local' : null;
    }
  }
};

/**
 * Busca de cliente compartilhada (Pedido de Venda, OS, Orcamento, PDV,
 * Condicional, Trocas, app Vendas...). Sem filtros, casa por nome, fantasia,
 * codigo, CPF/CNPJ e telefone (com ou sem pontuacao), e tambem por endereco,
 * bairro e cidade. Acento e caixa nao contam; "+" separa termos obrigatorios
 * em qualquer ordem, como na busca de produto ("maria+serra").
 *
 * `filtros` (opcional) aplica cidade/estado, situacao, "buscar em" e o modo
 * "comeca com" (so' o primeiro termo precisa comecar; os outros, com "+",
 * continuam "contem"). Sem `situacao`, nao filtra por ativo/inativo -- quem
 * chama sem filtros continua vendo a lista inteira, como antes.
 *
 * Ordem: codigo exato primeiro, depois nome que comeca com o que foi
 * digitado, depois o resto que casou pelo nome/documento/telefone, e por
 * ultimo quem so' casou pelo endereco. Termo vazio (ou so' "#") devolve a
 * lista inteira, ja' com os filtros aplicados.
 */
export const searchClients = <T extends SearchableClient>(
  clients: T[],
  term: string,
  filtros: Partial<FiltrosConsultaCliente> | null = null,
): T[] => {
  const bruto = String(term ?? '').trim();
  const semCuringa = bruto.startsWith(LISTAR_TUDO_CLIENTES) ? bruto.slice(1) : bruto;
  const campo = filtros?.campo ?? 'tudo';
  const comecaCom = filtros?.modo === 'comeca';
  const filtrados = (filtroLocalAtivo(filtros) || (filtros?.situacao && filtros.situacao !== 'todos'))
    ? clients.filter((c) => passaNoFiltroLocal(c, filtros) && passaNaSituacaoCliente(c, filtros?.situacao))
    : clients;

  const termos: TermoDaBusca[] = splitSearchTerms(semCuringa)
    .map((parte, indice) => ({
      texto: normalizeSearchText(parte),
      digitos: PARECE_NUMERO.test(parte) ? soDigitos(parte) : '',
      comeca: comecaCom && indice === 0,
    }))
    .filter((parte) => parte.texto !== '');
  if (termos.length === 0) return filtrados;

  const termoInteiro = normalizeSearchText(semCuringa);
  const ranqueados: Array<{ cliente: T; nivel: number; ordem: number }> = [];

  filtrados.forEach((cliente, ordem) => {
    const indice = indexar(cliente);
    let soPeloEndereco = false;
    for (const termo of termos) {
      const onde = ondeCasou(indice, termo, campo);
      if (!onde) return;
      if (onde === 'local') soPeloEndereco = true;
    }
    let nivel = 2;
    if (indice.codigo && indice.codigo === termoInteiro && (campo === 'tudo' || campo === 'nome')) nivel = 0;
    else if (indice.nome.startsWith(termos[0].texto) && !soPeloEndereco) nivel = 1;
    else if (soPeloEndereco && campo === 'tudo') nivel = 3;
    ranqueados.push({ cliente, nivel, ordem });
  });

  return ranqueados
    .sort((a, b) => a.nivel - b.nivel || a.ordem - b.ordem)
    .map((item) => item.cliente);
};

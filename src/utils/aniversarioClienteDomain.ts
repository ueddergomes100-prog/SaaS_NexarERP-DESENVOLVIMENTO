/**
 * DATA DE NASCIMENTO, APELIDO E ANIVERSARIO DO CLIENTE (21/11/2026).
 *
 * Pedido do dono: o cadastro do cliente (completo e o popup das telas de
 * venda) ganha data de nascimento e apelido, e o sistema avisa quando chega o
 * dia do aniversario -- no sino do topo e numa janela, uma vez por dia, ao
 * abrir o sistema.
 *
 * Como o aviso acha os aniversariantes sem ler o cadastro inteiro: alem da
 * data (`dataNascimento`, "AAAA-MM-DD"), o cliente guarda so' o mes e o dia
 * (`aniversario`, "MM-DD"). O sino pergunta ao banco "quem faz aniversario em
 * 11-21" -- igualdade simples, sem indice novo.
 *
 * Nascido em 29 de fevereiro: em ano que nao e' bissexto o aviso sai no dia
 * 28 (chavesDeAniversarioNoDia).
 *
 * Os dois campos sao opcionais e nunca ficam `undefined` no banco: sem data,
 * os dois vao vazios (CLAUDE.md, regra 3).
 */

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Antes disso e' erro de digitacao do ano ("0990", "190"). */
const ANO_MINIMO = 1900;

const ehBissexto = (ano: number): boolean => (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;

const diasNoMes = (ano: number, mes: number): number => [31, ehBissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];

interface DataSeparada {
  ano: number;
  mes: number;
  dia: number;
}

/** "AAAA-MM-DD" de verdade (o dia existe naquele mes); senao null. */
const separarData = (valor: unknown): DataSeparada | null => {
  const encontrado = FORMATO_DATA.exec(String(valor ?? '').trim());
  if (!encontrado) return null;
  const ano = Number(encontrado[1]);
  const mes = Number(encontrado[2]);
  const dia = Number(encontrado[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return { ano, mes, dia };
};

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** "MM-DD" da data de nascimento; vazio quando a data nao e' valida. */
export const chaveDoAniversario = (dataNascimento: unknown): string => {
  const data = separarData(dataNascimento);
  return data ? `${doisDigitos(data.mes)}-${doisDigitos(data.dia)}` : '';
};

/**
 * Confere a data digitada. Vazio e' valido (o campo e' opcional). Devolve a
 * mensagem para a tela, ou null.
 */
export const erroDaDataDeNascimento = (dataNascimento: unknown, hoje: string): string | null => {
  const texto = String(dataNascimento ?? '').trim();
  if (!texto) return null;
  const data = separarData(texto);
  if (!data) return 'A data de nascimento está incompleta ou não existe. Confira o dia, o mês e o ano, ou deixe o campo em branco.';
  if (data.ano < ANO_MINIMO) return `Confira o ano da data de nascimento: ${texto.slice(0, 4)} parece digitado errado.`;
  if (texto > hoje) return 'A data de nascimento não pode ser depois de hoje. Confira o ano digitado.';
  return null;
};

/** Os dois campos que vao para o banco: a data e a chave do aniversario. */
export const camposDeNascimentoParaGravar = (dataNascimento: unknown): { dataNascimento: string; aniversario: string } => {
  const data = separarData(dataNascimento);
  if (!data) return { dataNascimento: '', aniversario: '' };
  return {
    dataNascimento: `${data.ano}-${doisDigitos(data.mes)}-${doisDigitos(data.dia)}`,
    aniversario: `${doisDigitos(data.mes)}-${doisDigitos(data.dia)}`,
  };
};

/**
 * Chaves de aniversario que valem HOJE. Normalmente uma so' ("11-21"); no dia
 * 28 de fevereiro de ano nao bissexto, tambem a de quem nasceu em 29.
 */
export const chavesDeAniversarioNoDia = (hoje: string): string[] => {
  const data = separarData(hoje);
  if (!data) return [];
  const chave = `${doisDigitos(data.mes)}-${doisDigitos(data.dia)}`;
  return chave === '02-28' && !ehBissexto(data.ano) ? ['02-28', '02-29'] : [chave];
};

/** Quantos anos a pessoa faz no ano de `hoje`; null sem data valida. */
export const idadeQueCompleta = (dataNascimento: unknown, hoje: string): number | null => {
  const nascimento = separarData(dataNascimento);
  const dia = separarData(hoje);
  if (!nascimento || !dia) return null;
  const idade = dia.ano - nascimento.ano;
  return idade > 0 ? idade : null;
};

/** "FABIANO BERNARDO (FABINHO)" -- o apelido so' quando existe e nao repete o nome. */
export const nomeComApelido = (cliente: { nome?: unknown; apelido?: unknown }): string => {
  const nome = String(cliente.nome ?? '').trim();
  const apelido = String(cliente.apelido ?? '').trim();
  if (!apelido || apelido.toUpperCase() === nome.toUpperCase()) return nome;
  return nome ? `${nome} (${apelido})` : apelido;
};

export interface ClienteParaAniversario {
  id: string;
  nome?: unknown;
  apelido?: unknown;
  dataNascimento?: unknown;
  aniversario?: unknown;
  telefone?: unknown;
  celular?: unknown;
  codigo?: unknown;
  ativo?: unknown;
}

export interface Aniversariante {
  id: string;
  codigo: string;
  /** Nome com o apelido entre parenteses. */
  rotulo: string;
  /** Celular, senao o telefone, como esta' no cadastro. */
  telefone: string;
  idade: number | null;
}

/**
 * Os clientes que fazem aniversario hoje, em ordem alfabetica. Cliente
 * inativo fica de fora. Confere a chave de novo (a consulta ja' filtra, mas a
 * leitura de reserva pode trazer o cadastro inteiro).
 */
export const aniversariantesDoDia = (clientes: ClienteParaAniversario[], hoje: string): Aniversariante[] => {
  const chaves = chavesDeAniversarioNoDia(hoje);
  return clientes
    .filter((c) => c.ativo !== false)
    .filter((c) => chaves.includes(String(c.aniversario || chaveDoAniversario(c.dataNascimento))))
    .map((c) => ({
      id: c.id,
      codigo: String(c.codigo ?? '').trim(),
      rotulo: nomeComApelido(c),
      telefone: String(c.celular || c.telefone || '').trim(),
      idade: idadeQueCompleta(c.dataNascimento, hoje),
    }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { sensitivity: 'base' }));
};

/**
 * A janela de aniversariantes abre uma vez por dia para cada usuario, na
 * primeira vez que o sistema e' aberto. `ultimoDiaAvisado` e' o que ficou
 * guardado no navegador (ou vazio).
 */
export const deveAbrirJanelaDeAniversario = (ultimoDiaAvisado: unknown, hoje: string, quantos: number): boolean => (
  quantos > 0 && String(ultimoDiaAvisado ?? '') !== hoje
);

/** Frase do aviso: "faz 35 anos" (sem a data, so' o que importa no balcao). */
export const fraseDaIdade = (idade: number | null): string => (idade === null ? '' : `faz ${idade} ${idade === 1 ? 'ano' : 'anos'}`);

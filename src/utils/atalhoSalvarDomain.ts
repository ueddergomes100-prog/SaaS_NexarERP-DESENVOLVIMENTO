/*
 * F6 SALVA (18/11/2026).
 *
 * Pedido do dono: os botoes de gravar do sistema (salvar produto, fornecedor,
 * cliente...) atendem pelo F6.
 *
 * Um atalho so', na area logada inteira (useAtalhoSalvar.ts, ligado no
 * AppLayout): o F6 CLICA no botao de salvar da tela -- nao tem acao propria.
 * Assim a validacao, a permissao, o "desabilitado" e o que o salvar faz
 * continuam vindo de um lugar so' (a tela).
 *
 * Aqui mora so' a regra de QUAL botao e' "o de salvar" entre os botoes da
 * tela (ou da janela aberta por cima dela).
 *
 * ONDE O F6 NAO SALVA, de proposito (decisao do dono, 18/11/2026):
 *  - Pedido de Venda e OS: F6 continua levando para o Pagamento, como quem ja'
 *    usa esta' acostumado. Essas telas tem data-atalho-salvar="nao" na raiz.
 *  - Listas: sem botao de salvar na tela, o F6 segue o que a lista ja' fazia
 *    (abrir "Novo" em Marcas, Categorias, Bancos...).
 *
 * Para apontar o botao certo numa tela onde a regra nao acha (ou acha errado),
 * marque o botao com data-atalho-salvar="sim"; para tirar um botao (ou a tela
 * inteira, na raiz), data-atalho-salvar="nao".
 */

export const TECLA_DE_SALVAR = 'F6';

export interface BotaoCandidato {
  /** O que esta' escrito no botao. */
  texto: string;
  /** Esta' no cabecalho da tela (onde mora o salvar dos cadastros). */
  noCabecalho: boolean;
  /** E' o botao de enviar de um formulario (type="submit"). */
  enviaFormulario: boolean;
  /** Tem o icone de disquete (lucide Save). */
  temIconeSalvar: boolean;
  /** Valor de data-atalho-salvar no botao, se tiver. */
  marca?: string | null;
}

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

const normalizar = (texto: string): string => semAcento((texto || '').replace(/\s+/g, ' ').trim()).toLowerCase();

/** "Salvar Produto", "Gravar Item" -- e o mesmo botao enquanto salva ("Salvando..."). */
const TEXTO_DE_SALVAR = /^(salvar|gravar|salvando|gravando)(\s|\.|$)/;
/** Em botao de enviar formulario, "Cadastrar filial" tambem e' gravar. */
const TEXTO_DE_ENVIAR = /^(salvar|gravar|salvando|gravando|cadastrar|cadastrando)(\s|\.|$)/;

export const ehBotaoDeSalvar = (botao: BotaoCandidato): boolean => {
  if (botao.marca === 'nao') return false;
  if (botao.marca === 'sim') return true;
  // O botao do cabecalho com o disquete e' o gravar da tela, mesmo com outro nome
  // ("Lancar Nota Avulsa", "Criar Ordem"). E' nele que aparece o "F6" (atalhoSalvar.css).
  if (botao.noCabecalho && botao.temIconeSalvar) return true;
  const texto = normalizar(botao.texto);
  return botao.enviaFormulario ? TEXTO_DE_ENVIAR.test(texto) : TEXTO_DE_SALVAR.test(texto);
};

/**
 * Qual dos botoes o F6 aciona. Devolve a posicao na lista, ou -1 quando nao
 * ha' botao de salvar ou quando ha' mais de um e nao da' para saber qual a
 * pessoa quer -- na duvida o F6 nao faz nada, nunca salva a coisa errada.
 *
 * Ordem: o marcado com "sim"; o do cabecalho da tela ("Salvar Produto" vence
 * "Salvar Composicao" la' embaixo); o unico da tela; o unico que envia
 * formulario ("Salvar Funcionario" vence os "Salvar senha" do meio da tela).
 */
export const escolherBotaoDeSalvar = (botoes: BotaoCandidato[]): number => {
  const candidatos = botoes
    .map((botao, posicao) => ({ botao, posicao }))
    .filter(({ botao }) => ehBotaoDeSalvar(botao));
  if (!candidatos.length) return -1;

  const marcado = candidatos.find(({ botao }) => botao.marca === 'sim');
  if (marcado) return marcado.posicao;

  const doCabecalho = candidatos.filter(({ botao }) => botao.noCabecalho);
  if (doCabecalho.length === 1) return doCabecalho[0].posicao;
  if (doCabecalho.length > 1) return -1;

  if (candidatos.length === 1) return candidatos[0].posicao;

  const deFormulario = candidatos.filter(({ botao }) => botao.enviaFormulario);
  return deFormulario.length === 1 ? deFormulario[0].posicao : -1;
};

/*
 * ATALHO DE CADASTRAR QUE ACOMPANHA A ROLAGEM (18/11/2026).
 *
 * Reclamacao de cliente, trazida pelo dono: na lista de produtos, quem desceu
 * a tela e quer cadastrar um item novo tem de subir tudo de novo ate' o botao
 * "Novo Produto". Vale para toda lista do sistema.
 *
 * A barra (BarraDeAcaoRapida.tsx) repete o botao de CADASTRAR do cabecalho da
 * tela quando ele some na rolagem. Aqui mora so' a regra de QUAL botao do
 * cabecalho e' "de cadastrar" -- o resto (Salvar, Gerar relatorio, Imprimir)
 * fica de fora de proposito: o pedido foi o atalho para cadastrar.
 *
 * Convencao que o sistema ja' segue: botao de cadastrar leva o icone "+" ou
 * comeca com "Novo/Nova/Lancar/Adicionar/Cadastrar/Incluir".
 *
 * Para forcar ou tirar um botao da barra sem depender da convencao, marque o
 * proprio botao com data-acao-rapida="sim" ou data-acao-rapida="nao".
 */

export interface BotaoDoCabecalho {
  /** O que esta' escrito no botao. */
  texto: string;
  /** Tem o icone "+" (lucide Plus). */
  temIconeMais: boolean;
  /** Abre um menu em vez de agir (aria-haspopup): o menu abriria la' em cima, fora da vista. */
  abreMenu: boolean;
  /** Valor de data-acao-rapida, se o botao tiver. */
  marca?: string | null;
}

const COMECO_DE_CADASTRO = /^(nov[oa]|lancar|adicionar|cadastrar|incluir)(\s|$)/;

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Texto do botao como a pessoa le: sem espacos sobrando nem quebras de linha. */
export const textoDoBotao = (bruto: string | null | undefined): string => (bruto || '').replace(/\s+/g, ' ').trim();

export const ehAcaoDeCadastro = (botao: BotaoDoCabecalho): boolean => {
  const texto = textoDoBotao(botao.texto);
  // Botao so' de icone nao tem o que escrever na barra.
  if (!texto) return false;
  if (botao.marca === 'nao') return false;
  if (botao.abreMenu) return false;
  if (botao.marca === 'sim') return true;
  return botao.temIconeMais || COMECO_DE_CADASTRO.test(semAcento(texto).toLowerCase());
};

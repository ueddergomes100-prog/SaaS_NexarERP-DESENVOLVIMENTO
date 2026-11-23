/**
 * Envio do orcamento ao cliente pelo WhatsApp (23/11/2026, pedido do dono):
 * a mensagem sai em nome da EMPRESA (antes dizia "da Hennder ERP" na lista e
 * "da Sistema Nexus" na tela do orcamento) e o PDF do orcamento vai junto.
 */

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

/** Nome da empresa no documento: nome no cadastro, senao razao social. Vazio quando nao ha nenhum. */
export const nomeDaEmpresaNoDocumento = (config: Record<string, unknown> | null | undefined): string =>
  texto(config?.nomeOficina) || texto(config?.nomeFantasia) || texto(config?.razaoSocial);

const reais = (valor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(valor) ? valor : 0);

export const numeroDoOrcamentoParaTexto = (numero: unknown): string => {
  const n = String(numero ?? '').trim();
  return /^\d+$/.test(n) ? n.padStart(4, '0') : n;
};

/**
 * Texto que acompanha o PDF. Sem nome de empresa cadastrado, nao cita empresa
 * nenhuma (nunca "Hennder ERP"). Com `link` (23/11/2026), o PDF vai como link
 * na propria mensagem -- o link do WhatsApp nao aceita anexo.
 */
export const mensagemDoOrcamentoParaCliente = (args: { numero: unknown; empresa: string; total: number; link?: string }): string => {
  const numero = numeroDoOrcamentoParaTexto(args.numero);
  const empresa = args.empresa.trim();
  const titulo = `Olá! Segue o orçamento${numero ? ` nº ${numero}` : ''}${empresa ? ` da *${empresa}*` : ''}.`;
  const link = String(args.link || '').trim();
  const pdf = link
    ? `Orçamento completo em PDF:\n${link}`
    : 'O PDF com todos os detalhes vai em anexo.';
  return `${titulo}\n\n*Total:* ${reais(args.total)}\n\n${pdf}\n\nAguardamos sua aprovação!`;
};

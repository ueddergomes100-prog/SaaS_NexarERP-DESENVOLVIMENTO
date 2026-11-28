/*
 * CLIENTE A CADASTRAR (27/11/2026, Ivan da Embala Minas: "um cliente a
 * cadastrar ... coloco o nome nele na hora, ou a cidade ... vai pagar a vista";
 * "o que eu nao gosto e' do sistema aceitar fechar a venda de um cliente sem
 * cadastrar no prazo"). Decisoes do dono: no Pedido de Venda / pre-venda e no
 * app Vendas; nome, cidade e telefone.
 *
 * O pedido continua sendo do CONSUMIDOR FINAL (clienteId do cadastro padrao,
 * clienteNome 'CONSUMIDOR FINAL'): todas as travas de quem nao tem cadastro
 * continuam valendo -- sem Boleto e sem Pagamento a Prazo, sem credito, sem
 * cashback. So' ganha `clienteSemCadastro` ({ nome, cidade?, telefone? }), que
 * sai no papel, na minuta, no romaneio e nas listas no lugar de "CONSUMIDOR
 * FINAL". Nao cria cadastro.
 */

export const CAMPO_CLIENTE_SEM_CADASTRO = 'clienteSemCadastro';
export const NOME_SEM_CADASTRO_MAX = 60;
export const CIDADE_SEM_CADASTRO_MAX = 40;
export const FORMAS_PROIBIDAS_SEM_CADASTRO: readonly string[] = ['Boleto', 'Pagamento a Prazo'];

export interface ClienteSemCadastro {
  nome: string;
  cidade?: string;
  telefone?: string;
}

const limpo = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Le o que veio da tela ou do banco. null = nao ha' (ou sem nome). Nunca grava chave vazia. */
export const lerClienteSemCadastro = (valor: unknown): ClienteSemCadastro | null => {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const nome = limpo(v.nome, NOME_SEM_CADASTRO_MAX).toUpperCase();
  if (nome.length < 2) return null;
  const cidade = limpo(v.cidade, CIDADE_SEM_CADASTRO_MAX).toUpperCase();
  const telefone = String(v.telefone ?? '').replace(/\D/g, '').slice(0, 13);
  return {
    nome,
    ...(cidade ? { cidade } : {}),
    ...(telefone.length >= 8 ? { telefone } : {}),
  };
};

/**
 * Os 3 campos preenchidos (28/11/2026, dono: "quando digitar os 3 campos, nome
 * cidade e telefone ele fechar em dropdown"): no app o bloco se fecha numa linha
 * para a lista de produtos nao descer. Mesmo criterio do que e' gravado.
 */
export const clienteSemCadastroCompleto = (valor: unknown): boolean => {
  const lido = lerClienteSemCadastro(valor);
  return Boolean(lido && lido.cidade && lido.telefone);
};

/** Resumo de uma linha do bloco fechado: "JOAO · CARATINGA · (33) 99999-0000". */
export const resumoDoClienteSemCadastro = (valor: unknown): string => {
  const lido = lerClienteSemCadastro(valor);
  if (!lido) return '';
  return [lido.nome, lido.cidade, lido.telefone ? telefoneFormatado(lido.telefone) : ''].filter(Boolean).join(' · ');
};

/** Telefone para o papel: (33) 99999-0000. */
export const telefoneFormatado = (digitos: string): string => {
  const d = String(digitos || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};

/** Nome que sai no papel e nas listas: o do cliente a cadastrar, ou o do pedido. */
export const nomeDoClienteDoPedido = (pedido: { clienteNome?: unknown; [CAMPO_CLIENTE_SEM_CADASTRO]?: unknown } | null | undefined, padrao = 'Consumidor Final'): string => {
  const semCadastro = lerClienteSemCadastro(pedido?.[CAMPO_CLIENTE_SEM_CADASTRO]);
  if (semCadastro) return semCadastro.nome;
  return String(pedido?.clienteNome ?? '').trim() || padrao;
};

/** Linha de complemento no papel: "Cliente a cadastrar · MANHUACU · (33) 99999-0000". */
export const complementoDoClienteSemCadastro = (pedido: { clienteNome?: unknown; [CAMPO_CLIENTE_SEM_CADASTRO]?: unknown } | null | undefined): string => {
  const c = lerClienteSemCadastro(pedido?.[CAMPO_CLIENTE_SEM_CADASTRO]);
  if (!c) return '';
  return ['Cliente a cadastrar', c.cidade || '', c.telefone ? telefoneFormatado(c.telefone) : ''].filter(Boolean).join(' · ');
};

/** Por que a venda nao pode sair com estas formas, ou null. */
export const erroDasFormasSemCadastro = (formas: unknown[], semCadastro: ClienteSemCadastro | null): string | null => {
  if (!semCadastro) return null;
  const proibida = formas.map((f) => String(f ?? '').trim()).find((f) => FORMAS_PROIBIDAS_SEM_CADASTRO.includes(f));
  if (!proibida) return null;
  return `"${semCadastro.nome}" não tem cadastro: não dá para vender em ${proibida}. Receba à vista (dinheiro, Pix ou cartão) ou cadastre o cliente e escolha ele no pedido.`;
};

/**
 * DEBITOS DO CLIENTE NA HORA DE VENDER (app Vendas, 23/11/2026, pedido do dono
 * no treinamento da Embala Minas): ao confirmar o cliente, o vendedor ve o que
 * ele deve antes de montar o pedido.
 *
 * O numero vem de situacaoEmAbertoDoCliente (contasReceberQuery.ts), a mesma
 * conta do limite de credito e da Consulta de Cliente do app: titulos
 * pendentes, sem as formas que nao entram no saldo, e o maior atraso. Com
 * filiais, o servidor soma o grupo.
 *
 * Aqui so' a decisao do QUE mostrar, em portugues. Nao bloqueia nada: quem
 * barra venda por atraso ou limite continua sendo o faturamento.
 */

export type NivelDosDebitos = 'sem-debito' | 'em-aberto' | 'atrasado';

export interface ResumoDosDebitos {
  nivel: NivelDosDebitos;
  titulo: string;
  detalhe: string;
}

const formatarReais = (centavos: number): string => (
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

export const resumoDosDebitos = (situacao: { saldoCentavos: number; maiorAtrasoDias: number }): ResumoDosDebitos => {
  const saldo = Math.max(0, Math.round(Number(situacao.saldoCentavos) || 0));
  const atraso = Math.max(0, Math.trunc(Number(situacao.maiorAtrasoDias) || 0));
  if (saldo <= 0) {
    return { nivel: 'sem-debito', titulo: 'Sem débitos em aberto', detalhe: '' };
  }
  if (atraso > 0) {
    return {
      nivel: 'atrasado',
      titulo: `Débitos em aberto: ${formatarReais(saldo)}`,
      detalhe: `Tem conta vencida há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}. Confira com o financeiro antes de vender a prazo.`,
    };
  }
  return {
    nivel: 'em-aberto',
    titulo: `Débitos em aberto: ${formatarReais(saldo)}`,
    detalhe: 'Nenhuma conta vencida.',
  };
};

export const MENSAGEM_DEBITOS_INDISPONIVEIS = 'Não foi possível consultar os débitos agora. Confira na Consulta de Cliente ou com o financeiro.';

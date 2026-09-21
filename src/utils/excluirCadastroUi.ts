import { excluirCadastro, type ColecaoCadastro } from '../services/cadastroService';
import { NexusSwal, showError, showSuccess } from './alerts';

/**
 * Pergunta e exclui um cadastro pelo servidor (2026-09-19).
 *
 * Excluir so' funciona pra cadastro SEM movimentacao -- quem decide e' o
 * servidor (server/services/cadastroIntegridade.js), que responde com a
 * lista do que impede ("ja' tem vendas, titulos...") e manda inativar. Por
 * isso a confirmacao aqui ja' avisa que com historico nao da'.
 *
 * Devolve true quando excluiu.
 */
export const confirmarEExcluirCadastro = async (
  colecao: ColecaoCadastro,
  id: string,
  nome: string,
  rotulo: string,
): Promise<boolean> => {
  const confirma = await NexusSwal.fire({
    title: `Excluir "${nome}"?`,
    text: `Só é possível excluir ${rotulo} que nunca teve movimentação. Se já houver histórico (vendas, notas, títulos, ajustes...), o sistema vai recusar e você pode inativar em vez de excluir. A exclusão não pode ser desfeita.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, excluir',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#ef4444',
    reverseButtons: true,
  });
  if (!confirma.isConfirmed) return false;

  try {
    await excluirCadastro(colecao, id);
    showSuccess(`"${nome}" excluído.`);
    return true;
  } catch (erro) {
    showError('Não foi possível excluir', (erro as Error).message || 'Tente novamente mais tarde.');
    return false;
  }
};

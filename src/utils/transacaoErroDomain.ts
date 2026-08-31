// Traducao de erro de INFRAESTRUTURA do Firestore para recado de tela, em
// portugues (regra 2 do CLAUDE.md). Funcao pura, sem Firestore, pra poder
// ser testada como o resto do dominio -- firestoreAtomic.ts reexporta.
//
// O que motivou: com varios vendedores fechando venda no mesmo segundo, a
// transacao pode esgotar as tentativas e estourar 'aborted'. O pedido NAO
// foi gravado e basta repetir, mas a tela mostrava "Transaction failed:
// ABORTED", que nao diz isso a ninguem.

/** Codigo do erro, venha ele como `code` (FirebaseError) ou embutido na
 * mensagem. Alguns caminhos do SDK embrulham o erro original e so o texto
 * sobrevive, por isso os dois lugares sao consultados. */
const extrairCodigo = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code.trim()) return code.toLowerCase();

  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message.toLowerCase() : '';
};

/**
 * Devolve `null` quando o erro NAO e' de infraestrutura -- ai quem chamou
 * deve manter a propria mensagem de negocio ("Estoque insuficiente para
 * X", "limite de credito" etc.), sempre mais especifica do que qualquer
 * coisa que daria pra dizer aqui.
 */
export const describeTransactionError = (error: unknown): string | null => {
  const codigo = extrairCodigo(error);
  if (!codigo) return null;

  if (codigo.includes('aborted')) {
    return 'O sistema estava gravando outra operação neste exato momento e não conseguiu concluir esta. Nada foi gravado: tente novamente.';
  }
  if (codigo.includes('unavailable') || codigo.includes('deadline-exceeded') || codigo.includes('deadline exceeded')) {
    return 'A conexão com o servidor falhou no meio da gravação. Confira a internet e tente novamente.';
  }
  if (codigo.includes('permission-denied') || codigo.includes('insufficient permissions')) {
    // Duas causas MUITO diferentes caem neste mesmo codigo, e a mensagem
    // precisa servir pras duas: (a) o usuario realmente nao tem a permissao
    // -- resolve com o administrador da empresa; (b) a regra de acesso do
    // Firestore ainda nao foi publicada depois de uma funcionalidade nova --
    // e ai NAO ha nada que o administrador possa fazer sozinho. Mandar so
    // "revise suas permissoes" deixava o proprio administrador rodando em
    // circulo, que foi o que aconteceu na OS em 31/08/2026.
    return 'O sistema recusou esta operação por falta de permissão. Se você não é administrador da empresa, peça a ele para revisar seus acessos. Se já é, avise o suporte dizendo em qual tela isso aconteceu — provavelmente é uma regra de acesso do sistema que ainda não foi publicada.';
  }
  if (codigo.includes('failed-precondition')) {
    return 'O sistema não conseguiu concluir a gravação porque uma consulta interna não está pronta. Avise o suporte informando em qual tela isso aconteceu.';
  }
  if (codigo.includes('resource-exhausted')) {
    return 'O sistema atingiu o limite de operações do plano contratado. Avise o suporte.';
  }

  return null;
};

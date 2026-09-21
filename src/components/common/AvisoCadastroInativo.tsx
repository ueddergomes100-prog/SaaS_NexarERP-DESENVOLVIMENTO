import React from 'react';

interface AvisoCadastroInativoProps {
  /** Como o usuario chama o cadastro: "Cliente", "Fornecedor", "Serviço"... */
  tipo: string;
  /** Nome da lista onde ele reativa: "Clientes", "Fornecedores"... */
  lista: string;
  /** Cadastro feminino ("inativa", "reative-a"): serviço, categoria, marca... */
  feminino?: boolean;
}

/**
 * Faixa de "somente consulta" dos formularios de cadastro inativo.
 *
 * Cadastro inativo nao se altera (firestore.rules: registro com ativo=false so'
 * aceita movimento de saldo) -- entao o formulario abre travado e diz por que,
 * em vez de deixar o usuario digitar e tomar um erro de permissao ao salvar.
 * O caminho e' reativar na lista. Vale o mesmo padrao do Produto e da
 * Matéria-prima (EstoqueForm, MateriaPrimaForm).
 */
const AvisoCadastroInativo: React.FC<AvisoCadastroInativoProps> = ({ tipo, lista, feminino = false }) => (
  <div
    role="status"
    style={{
      padding: '14px 18px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(245,158,11,0.1)',
      border: '1px solid rgba(245,158,11,0.4)', color: 'var(--text-primary)', fontSize: '14px', maxWidth: '800px',
    }}
  >
    <strong style={{ color: '#f59e0b' }}>{tipo} {feminino ? 'inativa' : 'inativo'} — somente consulta.</strong>{' '}
    Para alterar qualquer dado, reative-{feminino ? 'a' : 'o'} na lista de {lista} (botão de ativar da linha).
  </div>
);

export default AvisoCadastroInativo;

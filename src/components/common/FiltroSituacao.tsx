import React from 'react';
import { Filter } from 'lucide-react';

/**
 * FILTRO ATIVOS / INATIVOS / TODOS DOS CADASTROS (2026-09-19).
 *
 * Todo cadastro que pode ser inativado tem este filtro, no mesmo lugar (ao
 * lado da busca) e com o mesmo padrao: abre em "Ativos", que e' o que se usa
 * no dia a dia. Nasceu da tela de Produtos -- sem ele, achar os itens
 * inativos de Materia-Prima era procurar um por um.
 *
 * Cada tela diz o que e' "ativo" pra ela (a mesma regra do selo de status da
 * linha): a maioria trata campo ausente como ativo, mas Bancos e Bandeiras
 * tratam ausente como inativo, e Usuarios usa `status: 'Ativo'`. Por isso
 * `passaNaSituacao` recebe o booleano ja' resolvido, e nao o registro.
 */
export type Situacao = 'ativos' | 'inativos' | 'todos';

export const SITUACAO_PADRAO: Situacao = 'ativos';

export const passaNaSituacao = (ativo: boolean, situacao: Situacao): boolean => (
  situacao === 'todos' || (situacao === 'ativos' ? ativo : !ativo)
);

interface FiltroSituacaoProps {
  valor: Situacao;
  onChange: (situacao: Situacao) => void;
}

const FiltroSituacao: React.FC<FiltroSituacaoProps> = ({ valor, onChange }) => (
  <label
    className="btn-secondary filter-btn"
    title="Filtrar por situação do cadastro"
    style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
  >
    <Filter size={18} />
    <select
      aria-label="Situação do cadastro"
      value={valor}
      onChange={(event) => onChange(event.target.value as Situacao)}
      style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
    >
      <option value="ativos">Ativos</option>
      <option value="inativos">Inativos</option>
      <option value="todos">Todos</option>
    </select>
  </label>
);

export default FiltroSituacao;

import React from 'react';
import { splitSearchTerms } from '../../utils/textSearch';

/**
 * Rodape das listas com limite (useListaPaginada): "Ver mais" e, quando a
 * busca foi so' no banco, o atalho para procurar em qualquer parte do nome.
 */
const RodapeListaPaginada: React.FC<{
  carregando: boolean;
  temMais: boolean;
  onVerMais: () => void;
  buscaNoBanco: boolean;
  termoBusca: string;
  onBuscarEmTudo: () => void;
  oQueMais?: string;
}> = ({ carregando, temMais, onVerMais, buscaNoBanco, termoBusca, onBuscarEmTudo, oQueMais = 'registros' }) => {
  if (carregando) return null;
  return (
    <>
      {buscaNoBanco && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>
          <span>Mostrando o que começa com &quot;{splitSearchTerms(termoBusca)[0]}&quot; ou tem exatamente esse código ou documento.</span>
          <button type="button" className="btn-secondary" onClick={onBuscarEmTudo}>
            Procurar em qualquer parte do nome
          </button>
        </div>
      )}
      {temMais && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px' }}>
          <button type="button" className="btn-secondary" onClick={onVerMais}>
            Ver mais {oQueMais}
          </button>
        </div>
      )}
    </>
  );
};

export default RodapeListaPaginada;

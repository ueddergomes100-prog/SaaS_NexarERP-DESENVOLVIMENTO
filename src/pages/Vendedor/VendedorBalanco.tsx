import React from 'react';
import { useNavigate } from 'react-router-dom';
import ContagemBalanco from '../../components/balanco/ContagemBalanco';
import VendedorHeader from './VendedorHeader';

/** Balanco no app (21/10/2026): a mesma tela de contar do computador (components/balanco). */
const VendedorBalanco: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="app-tela" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <VendedorHeader titulo="Balanço" subtitulo="Conte só os itens da sua lista" aoVoltar={() => navigate('/vendedor')} />
      {/* A casca do app (VendedorShell) tem altura fixa com overflow hidden:
          sem esta area de rolagem a lista parava no 6o item e nao descia
          (video do dono no cliente, 22/10/2026). Mesmo desenho das outras
          telas do app (ex.: Liberacoes). O rodape "Concluir" segue sticky
          dentro desta area. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ContagemBalanco />
      </div>
    </div>
  );
};

export default VendedorBalanco;

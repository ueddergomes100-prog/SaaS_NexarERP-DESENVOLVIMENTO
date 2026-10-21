import React from 'react';
import { useNavigate } from 'react-router-dom';
import ContagemBalanco from '../../components/balanco/ContagemBalanco';
import VendedorHeader from './VendedorHeader';

/** Balanco no app (21/10/2026): a mesma tela de contar do computador (components/balanco). */
const VendedorBalanco: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="app-tela" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <VendedorHeader titulo="Balanço" subtitulo="Conte só os itens da sua lista" aoVoltar={() => navigate('/vendedor')} />
      <ContagemBalanco />
    </div>
  );
};

export default VendedorBalanco;

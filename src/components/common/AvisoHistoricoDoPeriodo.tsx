import React from 'react';

/**
 * Aviso de lista que mostra o historico so' do periodo recente (otimizacao de
 * leituras, 2026-10-14), com o botao que traz todo o periodo e volta. O texto
 * diz o que esta na tela; o botao diz o que acontece ao clicar.
 */
interface AvisoHistoricoDoPeriodoProps {
  todoPeriodo: boolean;
  onAlternar: () => void;
  /** Ex.: "Aguardando de qualquer data; entregues, só as deste mês." */
  textoRecente: string;
  textoTodo?: string;
  botaoTodo?: string;
  botaoRecente?: string;
}

const AvisoHistoricoDoPeriodo: React.FC<AvisoHistoricoDoPeriodoProps> = ({
  todoPeriodo,
  onAlternar,
  textoRecente,
  textoTodo = 'Mostrando todo o período.',
  botaoTodo = 'Ver todo o período',
  botaoRecente = 'Ver só os deste mês',
}) => (
  <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
    {todoPeriodo ? textoTodo : textoRecente}
    <button type="button" className="btn-secondary" onClick={onAlternar} style={{ padding: '4px 10px', fontSize: '12px' }}>
      {todoPeriodo ? botaoRecente : botaoTodo}
    </button>
  </p>
);

export default AvisoHistoricoDoPeriodo;

import React from 'react';
import { formatarCodigoCfop, type Cfop } from '../../utils/cfopDomain';

/*
 * FAIXA "CFOP DE ENTRADA PARA TODOS OS ITENS" (Entrada de XML, 07/11/2026).
 *
 * Pedido do dono lancando uma nota de importacao com 141 itens: o CFOP do
 * fornecedor nao tinha equivalente, todos vinham sem CFOP de entrada e era um a
 * um. Aqui a pessoa escolhe uma vez e aplica em todos, ou so' nos que ainda
 * estao sem; o seletor de cada item continua para ajustar o que for diferente.
 * Componente so' de tela: quem aplica (e confirma a troca) e' a Entrada de XML.
 */

interface Props {
  cfops: readonly string[];
  opcoes: readonly Cfop[];
  valor: string;
  onValor: (codigo: string) => void;
  onAplicar: (modo: 'todos' | 'so_vazios') => void;
}

const CfopParaTodosItens: React.FC<Props> = ({ cfops, opcoes, valor, onValor, onAplicar }) => {
  const semCfop = cfops.filter((c) => !c).length;
  return (
    <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', backgroundColor: 'var(--bg-tertiary)' }}>
      <label htmlFor="cfop-entrada-todos" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>CFOP de entrada para todos os itens</label>
      <select
        id="cfop-entrada-todos"
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        className="form-select"
        style={{ padding: '6px 10px', fontSize: '13px', maxWidth: '420px' }}
        title="Escolha uma vez e aplique em todos os itens; depois troque a mão o item que for diferente"
      >
        {!valor && <option value="">Escolha o CFOP de entrada</option>}
        {opcoes.map((c) => <option key={c.codigo} value={c.codigo}>{formatarCodigoCfop(c.codigo)} - {c.descricao}</option>)}
      </select>
      <button type="button" className="btn-primary" style={{ fontSize: '12.5px', padding: '6px 12px' }} onClick={() => onAplicar('todos')}>
        Aplicar em todos ({cfops.length})
      </button>
      {semCfop > 0 && semCfop < cfops.length && (
        <button type="button" className="btn-secondary" style={{ fontSize: '12.5px', padding: '6px 12px' }} onClick={() => onAplicar('so_vazios')}>
          Só nos sem CFOP ({semCfop})
        </button>
      )}
      <span style={{ fontSize: '12.5px', color: semCfop > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
        {semCfop > 0 ? `${semCfop} item(ns) ainda sem CFOP de entrada` : 'Todos os itens têm CFOP de entrada'}
      </span>
    </div>
  );
};

export default CfopParaTodosItens;

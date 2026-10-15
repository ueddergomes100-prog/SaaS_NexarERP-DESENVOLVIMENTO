import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/*
 * FILTRO POR COLUNA, estilo planilha (nasceu em Pedidos de Venda; virou
 * comum em 15/10/2026 para a coluna Imp. das Trocas usar o mesmo).
 */

/**
 * Pequeno dropdown de filtro por coluna, estilo planilha: seta no
 * cabecalho, painel com as opcoes por baixo. Fecha ao clicar fora.
 */
export const FiltroColuna: React.FC<{ ativo: boolean; children: (fechar: () => void) => React.ReactNode }> = ({ ativo, children }) => {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicarFora = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  return (
    <span ref={containerRef} style={{ position: 'relative', display: 'inline-block', marginLeft: '4px', verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setAberto((atual) => !atual); }}
        title="Filtrar"
        aria-label="Filtrar por esta coluna"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'inline-flex',
          color: ativo ? 'var(--accent-purple)' : 'var(--text-muted)',
        }}
      >
        <ChevronDown size={14} />
      </button>
      {aberto && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            zIndex: 30,
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '8px',
            minWidth: '200px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            textTransform: 'none',
            fontWeight: 400,
            fontSize: '13px',
          }}
        >
          {children(() => setAberto(false))}
        </div>
      )}
    </span>
  );
};

export const itemOpcaoStyle = (selecionado: boolean): React.CSSProperties => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  cursor: 'pointer',
  backgroundColor: selecionado ? 'var(--accent-purple)' : 'transparent',
  color: selecionado ? 'white' : 'var(--text-primary)',
  fontWeight: selecionado ? 600 : 400,
});

/** Lista simples de opcoes com "Todos" pra limpar -- usada por Vendedor,
 * Forma de Pagamento e Conferencia, que sao filtros de igualdade exata. */
export const OpcoesFiltro: React.FC<{
  opcoes: string[];
  valorSelecionado: string;
  onSelecionar: (valor: string, fechar: () => void) => void;
  fechar: () => void;
  rotuloTodos?: string;
  formatarRotulo?: (valor: string) => string;
}> = ({ opcoes, valorSelecionado, onSelecionar, fechar, rotuloTodos = 'Todos', formatarRotulo }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '240px', overflowY: 'auto' }}>
    <button type="button" style={itemOpcaoStyle(valorSelecionado === '')} onClick={() => onSelecionar('', fechar)}>
      {rotuloTodos}
    </button>
    {opcoes.map((opcao) => (
      <button key={opcao} type="button" style={itemOpcaoStyle(valorSelecionado === opcao)} onClick={() => onSelecionar(opcao, fechar)}>
        {formatarRotulo ? formatarRotulo(opcao) : opcao}
      </button>
    ))}
  </div>
);

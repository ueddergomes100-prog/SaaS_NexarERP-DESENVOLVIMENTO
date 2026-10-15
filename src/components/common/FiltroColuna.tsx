import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

/*
 * FILTRO POR COLUNA, estilo planilha (nasceu em Pedidos de Venda; virou
 * comum em 15/10/2026 para a coluna Imp. das Trocas usar o mesmo).
 */

const LARGURA_MINIMA = 220;
const FOLGA = 8;

/**
 * Pequeno dropdown de filtro por coluna, estilo planilha: seta no
 * cabecalho, painel com as opcoes por baixo. Fecha ao clicar fora.
 *
 * O painel abre POR CIMA de tudo (camada de cima do navegador, posicao
 * calculada pela seta -- 15/10/2026): tabela dentro de caixa com rolagem
 * (ex.: Adicionar pedidos do Romaneio) cortava o painel.
 */
export const FiltroColuna: React.FC<{ ativo: boolean; children: (fechar: () => void) => React.ReactNode }> = ({ ativo, children }) => {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicarFora = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  // Posiciona embaixo da seta (ou em cima, sem espaco) e acompanha rolagem/redimensionamento.
  useLayoutEffect(() => {
    if (!aberto) return undefined;
    const painel = painelRef.current;
    const botao = botaoRef.current;
    if (!painel || !botao) return undefined;
    try {
      if (typeof painel.showPopover === 'function' && !painel.matches(':popover-open')) painel.showPopover();
    } catch {
      // sem "popover": fica com position fixed e z-index alto
    }
    const posicionar = () => {
      const r = botao.getBoundingClientRect();
      const largura = painel.offsetWidth;
      const altura = painel.offsetHeight;
      let topo = r.bottom + 4;
      if (topo + altura > window.innerHeight - FOLGA && r.top - 4 - altura >= FOLGA) topo = r.top - 4 - altura;
      const esquerda = Math.max(FOLGA, Math.min(r.left, window.innerWidth - largura - FOLGA));
      painel.style.top = `${Math.max(FOLGA, topo)}px`;
      painel.style.left = `${esquerda}px`;
    };
    posicionar();
    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', posicionar, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', posicionar);
      window.removeEventListener('scroll', posicionar, { capture: true });
      try {
        if (painel.matches(':popover-open')) painel.hidePopover();
      } catch {
        // painel ja' saiu da tela
      }
    };
  }, [aberto]);

  return (
    <span ref={containerRef} style={{ position: 'relative', display: 'inline-block', marginLeft: '4px', verticalAlign: 'middle' }}>
      <button
        ref={botaoRef}
        type="button"
        onClick={(event) => { event.stopPropagation(); setAberto((atual) => !atual); }}
        title="Filtrar"
        aria-label="Filtrar por esta coluna"
        aria-expanded={aberto}
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
          ref={painelRef}
          // Camada de cima do navegador: nada corta o painel (caixa com rolagem, janela).
          {...{ popover: 'manual' }}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            inset: 'auto',
            margin: 0,
            zIndex: 100000,
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '8px',
            minWidth: `${LARGURA_MINIMA}px`,
            maxWidth: 'min(320px, calc(100vw - 16px))',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            textTransform: 'none',
            fontWeight: 400,
            fontSize: '13px',
            textAlign: 'left',
            letterSpacing: 'normal',
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

export interface OpcaoComContagem {
  valor: string;
  rotulo?: string;
  /** Quantas linhas tem esse valor (aparece ao lado). */
  quantidade?: number;
}

/**
 * Varias opcoes de uma vez, com caixinha (15/10/2026, Romaneio: montar a rota
 * com duas ou tres cidades vizinhas). Nada marcado = todos. Com muitas
 * opcoes, aparece uma busca no topo. O painel fica aberto enquanto a pessoa
 * marca; fecha clicando fora.
 */
export const OpcoesFiltroMultiplo: React.FC<{
  opcoes: OpcaoComContagem[];
  selecionados: string[];
  onMudar: (selecionados: string[]) => void;
  rotuloTodos?: string;
}> = ({ opcoes, selecionados, onMudar, rotuloTodos = 'Todos' }) => {
  const [busca, setBusca] = useState('');
  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(
    () => (termo ? opcoes.filter((o) => (o.rotulo || o.valor).toLowerCase().includes(termo)) : opcoes),
    [opcoes, termo],
  );
  const marcados = new Set(selecionados);
  const alternar = (valor: string) => onMudar(marcados.has(valor) ? selecionados.filter((v) => v !== valor) : [...selecionados, valor]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {opcoes.length > 8 && (
        <label style={{ position: 'relative', display: 'block' }}>
          <Search size={14} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar na lista"
            autoFocus
            style={{ width: '100%', padding: '7px 8px 7px 28px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px' }}
          />
        </label>
      )}
      <button type="button" style={itemOpcaoStyle(selecionados.length === 0)} onClick={() => onMudar([])}>
        {rotuloTodos}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '240px', overflowY: 'auto' }}>
        {filtradas.map((opcao) => {
          const marcado = marcados.has(opcao.valor);
          return (
            <label key={opcao.valor} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', backgroundColor: marcado ? 'var(--brand-soft)' : 'transparent' }}>
              <input type="checkbox" checked={marcado} onChange={() => alternar(opcao.valor)} style={{ accentColor: 'var(--accent-purple)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontWeight: marcado ? 600 : 400 }}>{opcao.rotulo || opcao.valor}</span>
              {opcao.quantidade !== undefined && <span style={{ color: 'var(--text-muted)', fontSize: '12px', flex: 'none' }}>{opcao.quantidade}</span>}
            </label>
          );
        })}
        {filtradas.length === 0 && <span style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>Nada encontrado.</span>}
      </div>
    </div>
  );
};

/** Opcoes de uma coluna a partir das linhas: valores distintos, com quantas vezes aparecem. */
export const opcoesDaColuna = <T,>(
  linhas: T[],
  valorDe: (linha: T) => string,
  opcoes: { rotuloDe?: (valor: string) => string; ordenar?: (a: string, b: string) => number } = {},
): OpcaoComContagem[] => {
  const contagem = new Map<string, number>();
  for (const linha of linhas) {
    const valor = valorDe(linha);
    contagem.set(valor, (contagem.get(valor) || 0) + 1);
  }
  return [...contagem.entries()]
    .sort(([a], [b]) => (opcoes.ordenar ? opcoes.ordenar(a, b) : a.localeCompare(b, 'pt-BR', { numeric: true })))
    .map(([valor, quantidade]) => ({ valor, rotulo: opcoes.rotuloDe ? opcoes.rotuloDe(valor) : valor, quantidade }));
};

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

/**
 * Botao "Mais opcoes" com menu suspenso, para o topo das telas nao virar uma
 * fileira de botoes (pedido do dono, 2026-10-02: "esconde isso em um dropdown
 * de mais opcoes ... igual fizemos na tela de pedidos de venda").
 *
 * Regra de uso: fica a vista so' a acao principal da tela (o "Novo ...") e,
 * no maximo, uma de uso diario. Importacoes, padronizacoes, relatorios e
 * ajustes de exibicao vao para ca. Acao destrutiva vai por ultimo, com
 * `perigo` e `separadorAntes`.
 *
 * Item `oculto` (sem permissao) some do menu; menu sem nenhum item visivel nao
 * renderiza o botao.
 */
export interface ItemMenuMaisOpcoes {
  texto: string;
  onClick: () => void;
  Icone?: React.FC<{ size?: number }>;
  /** Explica o que o item faz (tooltip). Em item desabilitado, diga o porque. */
  titulo?: string;
  desabilitado?: boolean;
  oculto?: boolean;
  perigo?: boolean;
  separadorAntes?: boolean;
}

interface MenuMaisOpcoesProps {
  itens: ItemMenuMaisOpcoes[];
  rotulo?: string;
}

const MenuMaisOpcoes: React.FC<MenuMaisOpcoesProps> = ({ itens, rotulo = 'Mais opções' }) => {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const visiveis = itens.filter((item) => !item.oculto);

  useEffect(() => {
    if (!aberto) return;
    const fecharFora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const fecharEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharEsc);
    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharEsc);
    };
  }, [aberto]);

  if (visiveis.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn-secondary"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <MoreHorizontal size={18} /> {rotulo} <ChevronDown size={16} />
      </button>
      {aberto && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', minWidth: '250px', zIndex: 50,
            backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.35)', padding: '6px 0',
          }}
        >
          {visiveis.map((item) => (
            <React.Fragment key={item.texto}>
              {item.separadorAntes && <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '6px 0' }} />}
              <button
                type="button"
                role="menuitem"
                disabled={item.desabilitado}
                title={item.titulo}
                onClick={() => { setAberto(false); item.onClick(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px',
                  background: 'none', border: 'none', textAlign: 'left', fontSize: '14px',
                  color: item.desabilitado ? 'var(--text-muted)' : (item.perigo ? '#ef4444' : 'var(--text-primary)'),
                  cursor: item.desabilitado ? 'not-allowed' : 'pointer',
                }}
                onMouseOver={(e) => { if (!item.desabilitado) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {item.Icone && <item.Icone size={16} />} {item.texto}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

export default MenuMaisOpcoes;

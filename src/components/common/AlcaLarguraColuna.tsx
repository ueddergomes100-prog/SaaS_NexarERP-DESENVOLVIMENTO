import React, { useCallback, useRef, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';

/*
 * COLUNA COM LARGURA AJUSTAVEL (pedido de cliente em video, 21/10/2026: "queria
 * uma setinha que eu conseguisse arrastar pra ver o nome do cliente maior").
 *
 * useLarguraColuna guarda a largura escolhida NESTE computador (localStorage --
 * e' conveniencia de quem usa a tela, nao dado da empresa). AlcaLarguraColuna e'
 * a alca na borda direita do cabecalho: arrastar alarga/estreita, dois cliques
 * voltam ao tamanho padrao. Funciona com mouse, caneta e toque (pointer events).
 */

const ler = (chave: string, padrao: number, min: number, max: number): number => {
  try {
    const salvo = Number(window.localStorage.getItem(chave));
    return Number.isFinite(salvo) && salvo >= min && salvo <= max ? salvo : padrao;
  } catch {
    return padrao;
  }
};

const gravar = (chave: string, valor: number | null) => {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, String(Math.round(valor)));
  } catch {
    // Navegador sem armazenamento (janela anonima): vale so' enquanto a tela estiver aberta.
  }
};

export interface LarguraColuna {
  largura: number;
  definir: (px: number) => void;
  restaurar: () => void;
  min: number;
  max: number;
  padrao: number;
}

export const useLarguraColuna = (chave: string, padrao: number, min = 120, max = 720): LarguraColuna => {
  const [largura, setLargura] = useState(() => ler(chave, padrao, min, max));
  const definir = useCallback((px: number) => {
    const valor = Math.min(max, Math.max(min, Math.round(px)));
    setLargura(valor);
    gravar(chave, valor);
  }, [chave, min, max]);
  const restaurar = useCallback(() => {
    setLargura(padrao);
    gravar(chave, null);
  }, [chave, padrao]);
  return { largura, definir, restaurar, min, max, padrao };
};

const AlcaLarguraColuna: React.FC<{ coluna: LarguraColuna; rotulo: string }> = ({ coluna, rotulo }) => {
  const inicio = useRef<{ x: number; largura: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const aoApertar = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = { x: e.clientX, largura: coluna.largura };
    setArrastando(true);
  };
  const aoMover = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!inicio.current) return;
    coluna.definir(inicio.current.largura + (e.clientX - inicio.current.x));
  };
  const aoSoltar = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    inicio.current = null;
    setArrastando(false);
  };
  const aoTeclar = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); coluna.definir(coluna.largura + 20); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); coluna.definir(coluna.largura - 20); }
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largura da coluna ${rotulo}`}
      aria-valuenow={coluna.largura}
      aria-valuemin={coluna.min}
      aria-valuemax={coluna.max}
      tabIndex={0}
      title={`Arraste para alargar ou estreitar a coluna ${rotulo}. Dois cliques voltam ao tamanho padrão.`}
      onPointerDown={aoApertar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoSoltar}
      onDoubleClick={(e) => { e.stopPropagation(); coluna.restaurar(); }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={aoTeclar}
      style={{
        position: 'absolute', top: 0, bottom: 0, right: '-6px', width: '18px', zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'col-resize', touchAction: 'none', userSelect: 'none',
        color: arrastando ? 'var(--accent-purple)' : 'var(--text-muted)',
      }}
    >
      <MoveHorizontal size={14} aria-hidden="true" />
    </span>
  );
};

export default AlcaLarguraColuna;

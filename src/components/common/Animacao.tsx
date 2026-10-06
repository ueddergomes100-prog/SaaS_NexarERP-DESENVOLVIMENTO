import React, { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import { prefereMenosMovimento, tocarAnimacao, type AnimacaoNome } from '../../utils/animacoes';

interface AnimacaoProps {
  animacao: AnimacaoNome;
  loop?: boolean;
  /** Lado do quadrado, em px (ou qualquer medida CSS). */
  tamanho?: number | string;
  /** O que mostrar enquanto o player carrega e para quem prefere menos movimento (ex.: um icone). */
  fallback?: React.ReactNode;
  aoTerminar?: () => void;
  /** Texto para leitor de tela. Sem ele a animacao e' decorativa (aria-hidden). */
  rotulo?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Animacao Lottie para as telas (ver src/utils/animacoes.ts). Mostra o
 * `fallback` ate' o player chegar e, se a pessoa prefere menos movimento, so'
 * o fallback -- a tela nunca fica com um buraco esperando animacao.
 */
const Animacao: React.FC<AnimacaoProps> = ({ animacao, loop = false, tamanho = 64, fallback = null, aoTerminar, rotulo, style, className }) => {
  const alvo = useRef<HTMLSpanElement>(null);
  const aoTerminarRef = useRef(aoTerminar);
  const [pronta, setPronta] = useState(false);
  const semMovimento = prefereMenosMovimento();

  useEffect(() => { aoTerminarRef.current = aoTerminar; }, [aoTerminar]);

  useEffect(() => {
    if (semMovimento || !alvo.current) return undefined;
    let ativo = true;
    let item: AnimationItem | null = null;
    void tocarAnimacao(alvo.current, animacao, { loop, aoTerminar: () => aoTerminarRef.current?.() }).then((resultado) => {
      if (!ativo) { resultado?.destroy(); return; }
      item = resultado;
      setPronta(Boolean(resultado));
    });
    return () => {
      ativo = false;
      item?.destroy();
      setPronta(false);
    };
  }, [animacao, loop, semMovimento]);

  if (semMovimento) return <>{fallback}</>;

  const lado = typeof tamanho === 'number' ? `${tamanho}px` : tamanho;
  return (
    <span
      className={className}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      style={{ position: 'relative', display: 'inline-block', width: lado, height: lado, flexShrink: 0, ...style }}
    >
      {!pronta && fallback && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fallback}</span>
      )}
      <span ref={alvo} style={{ position: 'absolute', inset: 0, display: 'block', opacity: pronta ? 1 : 0, transition: 'opacity 0.25s ease' }} />
    </span>
  );
};

export default Animacao;

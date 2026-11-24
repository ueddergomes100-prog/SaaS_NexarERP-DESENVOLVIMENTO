import React, { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { ofereceMostrarTudo, textoMostrarMais } from '../../utils/linhasEmBlocosDomain';

/**
 * Rodape das listas desenhadas em blocos (useLinhasEmBlocos): "Mostrar mais
 * (N restantes)" e, quando falta mais de um bloco, "Mostrar tudo". Some
 * sozinho quando a lista inteira ja' esta' na tela.
 *
 * Imprimir a tela pelo navegador (Ctrl+P ou botao que chama window.print)
 * traz a lista inteira antes: papel nunca sai cortado no primeiro bloco.
 */
const MostrarMaisLinhas: React.FC<{
  blocos: { restam: number; mostrarMais: () => void; mostrarTudo: () => void };
  /** Enquanto a lista carrega o rodape nao aparece. */
  carregando?: boolean;
}> = ({ blocos, carregando = false }) => {
  const raizRef = useRef<HTMLDivElement>(null);
  const { restam, mostrarMais, mostrarTudo } = blocos;
  const aparece = !carregando && restam > 0;

  useEffect(() => {
    if (!aparece) return undefined;
    const antesDeImprimir = () => {
      // So' a lista da aba que esta' na frente (as outras abas seguem montadas, escondidas).
      if (raizRef.current?.getClientRects().length) flushSync(mostrarTudo);
    };
    window.addEventListener('beforeprint', antesDeImprimir);
    return () => window.removeEventListener('beforeprint', antesDeImprimir);
  }, [aparece, mostrarTudo]);

  if (!aparece) return null;
  return (
    <div ref={raizRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px' }}>
      <button type="button" className="btn-secondary" onClick={mostrarMais}>
        {textoMostrarMais(restam)}
      </button>
      {ofereceMostrarTudo(restam) && (
        <button type="button" className="btn-secondary" onClick={mostrarTudo}>
          Mostrar tudo
        </button>
      )}
    </div>
  );
};

export default MostrarMaisLinhas;

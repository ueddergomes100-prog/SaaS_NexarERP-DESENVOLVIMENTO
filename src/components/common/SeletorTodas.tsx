import React from 'react';
import { CheckSquare, MinusSquare, Square } from 'lucide-react';

/**
 * Seletor "marcar/desmarcar todas" de uma lista de toggles.
 *
 * Tres estados, porque dois nao dao conta: com parte da lista marcada, um
 * seletor que so' soubesse "ligado/desligado" teria de mentir num dos dois
 * lados. O estado `parcial` mostra o quadrado com o traco (o mesmo desenho que
 * o checkbox indeterminado do HTML usa) e, ao clicar, MARCA o que falta --
 * quem clica no meio do caminho quer completar, nao zerar o que ja escolheu.
 *
 * Usado no popup de permissoes (Usuarios) e na aba Permissao de Usuarios
 * (Configuracoes), que mostram o mesmo catalogo em layouts diferentes.
 */
interface SeletorTodasProps {
  estado: 'todas' | 'nenhuma' | 'parcial';
  /** `true` = marcar o que falta; `false` = desmarcar tudo que esta visivel. */
  onAlternar: (marcar: boolean) => void;
  rotulo?: string;
  desabilitado?: boolean;
}

const SeletorTodas: React.FC<SeletorTodasProps> = ({ estado, onAlternar, rotulo = 'Todas', desabilitado = false }) => {
  const Icone = estado === 'todas' ? CheckSquare : estado === 'parcial' ? MinusSquare : Square;
  const cor = estado === 'nenhuma' ? 'var(--text-muted)' : 'var(--accent-purple)';

  return (
    <button
      type="button"
      disabled={desabilitado}
      onClick={() => onAlternar(estado !== 'todas')}
      title={estado === 'todas' ? 'Desmarcar todas as que estão na tela' : 'Marcar todas as que estão na tela'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
        background: 'none', border: 'none', padding: '4px 2px',
        color: desabilitado ? 'var(--text-muted)' : cor,
        fontSize: '12.5px', fontWeight: 600, fontFamily: 'inherit',
        cursor: desabilitado ? 'not-allowed' : 'pointer',
        opacity: desabilitado ? 0.5 : 1,
      }}
    >
      <Icone size={16} />
      {estado === 'todas' ? `Desmarcar ${rotulo.toLowerCase()}` : rotulo}
    </button>
  );
};

export default SeletorTodas;

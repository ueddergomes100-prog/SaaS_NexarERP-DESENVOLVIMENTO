import React from 'react';
import { Minus, Plus } from 'lucide-react';
import type { UnidadeParaEscolherNoApp } from '../../utils/estoqueUnidadesDeVendaDomain';
import './VendedorUnidadesDoProduto.css';

/*
 * UNIDADES DO PRODUTO NO APP VENDAS (28/11/2026, dono: "no mobile nao mostra os
 * valores do fd nem a prazo nem a vista igual ta' no desktop ... legiveis e
 * bonitas e facil de entender").
 *
 * Cada unidade que a tela oferece (PCT, FD...) vira uma linha com a sigla, a
 * equivalencia, o disponivel e os precos a prazo e a vista. A linha e' o
 * proprio seletor: tocar escolhe a unidade (e marca o produto, se ainda nao
 * estava). Substitui o <select> "FD(1,000)" -- a escolha continua a mesma,
 * so' mudou o jeito de mostrar.
 */

const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantidade = (valor: number, casas: number) => valor.toLocaleString('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: Math.max(0, Math.min(casas, 4)),
});

interface PropsUnidades {
  nomeDoProduto: string;
  unidades: UnidadeParaEscolherNoApp[];
  /** Unidade escolhida; null enquanto o produto nao esta' marcado. */
  escolhida: string | null;
  onEscolher: (embalagemId: string) => void;
  mostrarValores: boolean;
  /** "Valor atacado: R$ 21,00 a partir de 10 PCT" (a primeira faixa), quando houver. */
  atacado?: string;
}

export const VendedorUnidadesDoProduto: React.FC<PropsUnidades> = ({ nomeDoProduto, unidades, escolhida, onEscolher, mostrarValores, atacado }) => (
  <div className="app-unidades" role="radiogroup" aria-label={`Unidade de ${nomeDoProduto}`} onClick={(e) => e.stopPropagation()}>
    {unidades.map((unidade) => {
      const ativa = escolhida !== null && escolhida === unidade.embalagemId;
      const disponivel = `${quantidade(Math.max(0, unidade.disponivel), unidade.casasDecimais)} ${unidade.disponivel === 1 ? 'disponível' : 'disponíveis'}`;
      return (
        <button
          key={unidade.embalagemId || 'base'}
          type="button"
          role="radio"
          aria-checked={ativa}
          className={`app-unidade${ativa ? ' is-ativa' : ''}`}
          onClick={() => onEscolher(unidade.embalagemId)}
          title={unidade.descricao || undefined}
        >
          <span className="app-unidade__sigla">{unidade.sigla}</span>
          <span className="app-unidade__info">
            {unidade.equivalencia && <span className="app-unidade__equivalencia">{unidade.equivalencia}</span>}
            <span className="app-unidade__disponivel">{disponivel}</span>
          </span>
          {mostrarValores && (
            <span className="app-unidade__precos">
              {unidade.vista > 0 ? (
                <>
                  <span className="app-unidade__preco"><small>a prazo</small>{moeda(unidade.venda)}</span>
                  <span className="app-unidade__preco app-unidade__preco--vista"><small>à vista</small>{moeda(unidade.vista)}</span>
                </>
              ) : (
                <span className="app-unidade__preco">{moeda(unidade.venda)}</span>
              )}
            </span>
          )}
        </button>
      );
    })}
    {mostrarValores && atacado && <span className="app-unidades__atacado">{atacado}</span>}
  </div>
);

interface PropsQuantidade {
  nomeDoProduto: string;
  sigla: string;
  valor: string;
  onChange: (valor: string) => void;
}

/** Quantidade do produto marcado, com - e + do tamanho do dedo. */
export const VendedorQuantidadeDoProduto: React.FC<PropsQuantidade> = ({ nomeDoProduto, sigla, valor, onChange }) => {
  const numero = Number(String(valor).replace(',', '.')) || 0;
  const passo = (delta: number) => {
    const proximo = Math.max(1, Math.floor(numero) + delta);
    onChange(String(proximo));
  };
  return (
    <div className="app-quantidade" onClick={(e) => e.stopPropagation()}>
      <span className="app-quantidade__rotulo">Quantidade <b>{sigla}</b></span>
      <div className="app-quantidade__controle">
        <button type="button" className="app-quantidade__botao" onClick={() => passo(-1)} disabled={numero <= 1} aria-label={`Diminuir quantidade de ${nomeDoProduto}`}>
          <Minus size={18} strokeWidth={2.5} />
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Quantidade de ${nomeDoProduto} em ${sigla}`}
          className="app-quantidade__campo"
        />
        <button type="button" className="app-quantidade__botao" onClick={() => passo(1)} aria-label={`Aumentar quantidade de ${nomeDoProduto}`}>
          <Plus size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

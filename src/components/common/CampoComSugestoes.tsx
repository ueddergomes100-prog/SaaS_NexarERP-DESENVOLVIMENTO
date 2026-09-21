import React, { useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import './ClientAutocomplete.css';

/**
 * CAMPO DE TEXTO COM SUGESTOES DO SISTEMA (2026-09-19).
 *
 * Substitui o `<datalist>` nos campos que se escolhe de uma lista cadastrada
 * (categoria, marca, fornecedor, unidade...). O datalist e' desenhado pelo
 * NAVEGADOR -- cada um de um jeito -- e ainda vem misturado com o
 * preenchimento automatico dele ("As informacoes foram salvas", no Edge),
 * que sugere o que a pessoa ja digitou em qualquer site, nao o que existe
 * no cadastro da empresa.
 *
 * Aqui a lista e' do sistema, com o mesmo visual da busca de cliente da
 * venda (ClientAutocomplete.css). Seta cima/baixo move, Enter escolhe, Esc
 * fecha. Continua aceitando texto novo: categoria ou marca que ainda nao
 * existe e' digitada normalmente.
 *
 * Por fora, se comporta como um `<input>` comum: recebe `name`, `value`,
 * `onChange`, `style`... e repassa o evento de verdade. Escolher uma
 * sugestao tambem dispara um evento de input no proprio campo, entao o
 * `handleChange` dos formularios (que aplica a caixa alta a partir do
 * elemento) roda igual a quando a pessoa digita.
 */
export interface CampoComSugestoesProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> {
  value: string;
  opcoes: readonly string[];
  /** Quantas sugestoes mostrar de uma vez (padrao 50). */
  maximo?: number;
}

const normalizar = (valor: string): string => valor
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toUpperCase()
  .trim();

/** Muda o valor do input como se a pessoa tivesse digitado: o React so' ve
 * o evento se o valor passar pelo setter nativo do elemento. */
const definirValorComoDigitado = (input: HTMLInputElement, valor: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const CampoComSugestoes: React.FC<CampoComSugestoesProps> = ({
  opcoes, maximo = 50, value, onFocus, onBlur, onKeyDown, onChange, ...propsInput
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);

  const sugestoes = useMemo(() => {
    const termo = normalizar(value || '');
    const unicas = Array.from(new Set(opcoes.map((o) => String(o || '').trim()).filter(Boolean)));
    const filtradas = termo
      ? unicas.filter((o) => normalizar(o).includes(termo))
      : unicas;
    // Quem comeca com o que foi digitado vem antes de quem so' contem.
    return filtradas
      .sort((a, b) => {
        const na = normalizar(a).startsWith(termo) ? 0 : 1;
        const nb = normalizar(b).startsWith(termo) ? 0 : 1;
        return na - nb || a.localeCompare(b, 'pt-BR');
      })
      .slice(0, maximo);
  }, [opcoes, value, maximo]);

  // O valor ja' escolhido nao precisa aparecer sozinho como sugestao.
  const mostrar = aberto && sugestoes.length > 0
    && !(sugestoes.length === 1 && normalizar(sugestoes[0]) === normalizar(value || ''));

  const escolher = (opcao: string) => {
    if (inputRef.current) definirValorComoDigitado(inputRef.current, opcao);
    setAberto(false);
  };

  return (
    <div className="client-autocomplete">
      <input
        {...propsInput}
        ref={inputRef}
        value={value}
        // Sem isso o navegador abre a lista dele por cima da nossa.
        autoComplete="off"
        role="combobox"
        aria-expanded={mostrar}
        aria-autocomplete="list"
        onChange={(event) => {
          setAberto(true);
          setDestaque(0);
          onChange?.(event);
        }}
        onFocus={(event) => {
          setAberto(true);
          setDestaque(0);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setAberto(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!aberto) setAberto(true);
            else setDestaque((atual) => Math.min(atual + 1, sugestoes.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setDestaque((atual) => Math.max(atual - 1, 0));
          } else if (event.key === 'Enter' && mostrar) {
            // Enter com a lista aberta escolhe -- nao envia o formulario.
            event.preventDefault();
            escolher(sugestoes[destaque] ?? sugestoes[0]);
          } else if (event.key === 'Escape' && mostrar) {
            // Fecha so' a lista; nao pode fechar a aba/janela por tras.
            event.stopPropagation();
            setAberto(false);
          }
          onKeyDown?.(event);
        }}
      />
      {mostrar && (
        <div className="client-autocomplete__panel" role="listbox">
          {sugestoes.map((opcao, indice) => (
            <button
              key={opcao}
              type="button"
              role="option"
              aria-selected={indice === destaque}
              className={`client-autocomplete__option${indice === destaque ? ' is-highlighted' : ''}`}
              // mousedown: escolhe antes do blur do input fechar a lista
              onMouseDown={(event) => {
                event.preventDefault();
                escolher(opcao);
              }}
              onMouseEnter={() => setDestaque(indice)}
            >
              {opcao}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CampoComSugestoes;

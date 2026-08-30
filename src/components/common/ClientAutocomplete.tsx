import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { searchClients, type SearchableClient } from '../../utils/clientSearch';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import './ClientAutocomplete.css';

export interface ClientAutocompleteProps<T extends SearchableClient & { id: string }> {
  value: string;
  onChange: (value: string) => void;
  clients: T[];
  onSelect: (client: T) => void;
  renderItem: (client: T, highlighted: boolean) => React.ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  emptyHint?: React.ReactNode;
  className?: string;
  /** Roda ao sair do campo, alem do fechamento do dropdown -- usado pra
   * validar o nome digitado (bloquear/perguntar) na hora, sem esperar o
   * usuario terminar a venda/OS/orcamento inteiro pra descobrir que o
   * cliente nao esta cadastrado. */
  onBlur?: () => void;
}

/**
 * Autocomplete de cliente compartilhado por Pedido de Venda, OS e
 * Orcamento (bugfix pos-Fase-1: as tres telas tinham dropdowns de
 * cliente independentes, sem nenhuma navegacao por teclado). Busca via
 * src/utils/clientSearch.ts. Seta cima/baixo move o destaque, Enter
 * seleciona, Esc fecha, e Tab seleciona o cliente destacado antes de
 * mover o foco para o proximo campo (nao faz preventDefault).
 */
function ClientAutocompleteInner<T extends SearchableClient & { id: string }>({
  value,
  onChange,
  clients,
  onSelect,
  renderItem,
  placeholder,
  ariaLabel,
  disabled,
  inputRef,
  emptyHint,
  className,
  onBlur,
}: ClientAutocompleteProps<T>) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputRef = inputRef || internalRef;
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Depois de selecionado, o campo trava (so' o "x" remove) -- ninguem
  // apaga o cliente sem querer digitando/dando backspace em cima do nome
  // no meio da venda. Comeca travado se ja' vier com valor (edicao de
  // pedido/OS/orcamento existente).
  const [locked, setLocked] = useState(() => value.trim().length > 0);

  const results = useMemo(() => searchClients(clients, value), [clients, value]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, clients]);

  // Rede de seguranca: se o valor for limpo por fora (reset de formulario,
  // outro fluxo que zera o nome), destrava tambem -- senao o campo fica
  // vazio mas travado, sem chance de digitar de novo.
  useEffect(() => {
    if (!value.trim()) setLocked(false);
  }, [value]);

  useEscapeLayer(isOpen, () => setIsOpen(false));

  const confirmSelect = (client: T) => {
    onSelect(client);
    setLocked(true);
    setIsOpen(false);
  };

  const selectHighlighted = (): boolean => {
    const client = results[highlightedIndex] || results[0];
    if (!client) return false;
    confirmSelect(client);
    return true;
  };

  const clearSelection = () => {
    onChange('');
    setLocked(false);
    resolvedInputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (results.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      if (!isOpen || results.length === 0) return;
      event.preventDefault();
      selectHighlighted();
    } else if (event.key === 'Tab') {
      if (isOpen && results.length > 0) selectHighlighted();
    }
  };

  const trimmedValue = value.trim();
  const showResults = isOpen && results.length > 0;

  return (
    <div className={`client-autocomplete${className ? ` ${className}` : ''}`}>
      <input
        ref={resolvedInputRef}
        type="text"
        value={value}
        disabled={disabled}
        readOnly={locked}
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => { if (!locked) setIsOpen(true); }}
        onBlur={() => {
          setIsOpen(false);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
        style={{ textTransform: 'uppercase' }}
        className={`client-autocomplete__input${locked ? ' client-autocomplete__input--locked' : ''}`}
      />

      {locked && !disabled && (
        <button
          type="button"
          className="client-autocomplete__clear"
          aria-label="Remover cliente selecionado"
          title="Remover cliente selecionado"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearSelection}
        >
          <X size={16} />
        </button>
      )}

      {showResults && (
        <div className="client-autocomplete__panel" role="listbox">
          {results.map((client, index) => (
            <button
              key={client.id}
              type="button"
              role="option"
              aria-selected={highlightedIndex === index}
              className={
                highlightedIndex === index
                  ? 'client-autocomplete__option is-highlighted'
                  : 'client-autocomplete__option'
              }
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => confirmSelect(client)}
            >
              {renderItem(client, highlightedIndex === index)}
            </button>
          ))}
        </div>
      )}

      {isOpen && trimmedValue.length > 0 && results.length === 0 && emptyHint !== undefined && (
        <div className="client-autocomplete__empty">{emptyHint}</div>
      )}
    </div>
  );
}

const ClientAutocomplete = React.memo(ClientAutocompleteInner) as typeof ClientAutocompleteInner;

export default ClientAutocomplete;

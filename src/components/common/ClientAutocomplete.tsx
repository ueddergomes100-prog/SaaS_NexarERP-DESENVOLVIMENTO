import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  FILTROS_CONSULTA_PADRAO,
  contarFiltrosAtivos,
  listarLocaisDosClientes,
  resumoDosFiltros,
  searchClients,
  type FiltrosConsultaCliente,
  type SearchableClient,
} from '../../utils/clientSearch';
import type { ClienteComAlerta } from '../../utils/clienteAlertaDomain';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import ConsultaClientesModal from './ConsultaClientesModal';
import LinhaCliente from './LinhaCliente';
import { mostrarAlertaDoCliente } from './AlertaDoCliente';
import './ClientAutocomplete.css';

export interface ClientAutocompleteProps<T extends SearchableClient & { id: string }> {
  value: string;
  onChange: (value: string) => void;
  clients: T[];
  onSelect: (client: T) => void;
  /** Sem isto, usa a linha padrao de cliente (nome, documento, telefone e cidade). */
  renderItem?: (client: T, highlighted: boolean) => React.ReactNode;
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
  /**
   * Campo de CLIENTE de verdade (2026-10-06): liga o botao "Filtros" (Consulta
   * de clientes com cidade, estado, situacao, buscar em e comeca/contem),
   * esconde inativos por padrao e mostra o ALERTA DO CLIENTE ao escolher.
   * Desligado nas buscas de fornecedor/transportadora que reusam o componente.
   */
  buscaDeCliente?: boolean;
}

/**
 * Autocomplete de cliente compartilhado por Pedido de Venda, OS,
 * Orcamento, Condicional, Trocas e app Vendas. Busca via
 * src/utils/clientSearch.ts (nome, fantasia, codigo, CPF/CNPJ, telefone e
 * endereco). Seta cima/baixo move o destaque, Enter seleciona, Esc fecha,
 * Tab seleciona o cliente destacado antes de mover o foco para o proximo
 * campo (nao faz preventDefault) e F9 abre a Consulta de clientes.
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
  buscaDeCliente = false,
}: ClientAutocompleteProps<T>) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputRef = inputRef || internalRef;
  const raizRef = useRef<HTMLDivElement | null>(null);
  const filtroRef = useRef<HTMLDivElement | null>(null);
  const consultaAbertaRef = useRef(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Depois de selecionado, o campo trava (so' o "x" remove) -- ninguem
  // apaga o cliente sem querer digitando/dando backspace em cima do nome
  // no meio da venda. Comeca travado se ja' vier com valor (edicao de
  // pedido/OS/orcamento existente).
  const [locked, setLocked] = useState(() => value.trim().length > 0);
  // Filtros valem enquanto a tela estiver aberta: o vendedor costuma atender
  // a mesma cidade varias vezes seguidas.
  const [filtros, setFiltros] = useState<FiltrosConsultaCliente>(FILTROS_CONSULTA_PADRAO);
  const [consultaAberta, setConsultaAberta] = useState(false);
  const [larguraFiltro, setLarguraFiltro] = useState(0);

  const filtrosValendo = buscaDeCliente ? filtros : null;
  const locais = useMemo(
    () => (buscaDeCliente ? listarLocaisDosClientes(clients) : null),
    [buscaDeCliente, clients],
  );
  const filtrosLigados = buscaDeCliente && contarFiltrosAtivos(filtros) > 0;
  const resumo = filtrosLigados && locais ? resumoDosFiltros(filtros, locais) : '';
  const mostrarBotaoFiltros = buscaDeCliente && !locked && !disabled;

  const results = useMemo(
    () => searchClients(clients, value, filtrosValendo),
    [clients, value, filtrosValendo],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, clients, filtros]);

  // Rede de seguranca: se o valor for limpo por fora (reset de formulario,
  // outro fluxo que zera o nome), destrava tambem -- senao o campo fica
  // vazio mas travado, sem chance de digitar de novo.
  useEffect(() => {
    if (!value.trim()) setLocked(false);
  }, [value]);

  // O texto digitado nao pode correr por baixo do botao "Filtros"/etiqueta.
  useLayoutEffect(() => {
    const elemento = filtroRef.current;
    if (!mostrarBotaoFiltros || !elemento) { setLarguraFiltro(0); return undefined; }
    const medir = () => setLarguraFiltro(elemento.offsetWidth);
    medir();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [mostrarBotaoFiltros, resumo]);

  useEscapeLayer(isOpen, () => setIsOpen(false));

  const confirmSelect = (client: T) => {
    onSelect(client);
    setLocked(true);
    setIsOpen(false);
    if (buscaDeCliente) mostrarAlertaDoCliente(client as unknown as ClienteComAlerta);
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

  const abrirConsulta = () => {
    consultaAbertaRef.current = true;
    setIsOpen(false);
    setConsultaAberta(true);
  };

  const fecharConsulta = () => {
    setConsultaAberta(false);
    // Volta para o campo (com a lista ja' filtrada) antes de liberar a
    // validacao de "cliente nao cadastrado" do sair-do-campo.
    setTimeout(() => {
      resolvedInputRef.current?.focus();
      consultaAbertaRef.current = false;
    }, 0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'F9' && buscaDeCliente && !locked) {
      event.preventDefault();
      event.stopPropagation();
      abrirConsulta();
    } else if (event.key === 'ArrowDown') {
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

  // Sair do componente fecha a lista e roda a validacao da tela. Abrir a
  // Consulta de clientes NAO conta como sair: senao a tela perguntaria
  // "cliente nao cadastrado" no meio da busca.
  const aoSairDoComponente = (event: React.FocusEvent<HTMLDivElement>) => {
    if (consultaAbertaRef.current) return;
    const destino = event.relatedTarget as Node | null;
    if (destino && raizRef.current?.contains(destino)) return;
    setIsOpen(false);
    onBlur?.();
  };

  const trimmedValue = value.trim();
  const showResults = isOpen && results.length > 0;
  // Nada achado so' por causa da situacao "Ativos": avisa e oferece mostrar.
  const inativosQueCasam = useMemo(() => {
    if (!buscaDeCliente || !isOpen || results.length > 0 || !trimmedValue || filtros.situacao !== 'ativos') return 0;
    return searchClients(clients, value, { ...filtros, situacao: 'inativos' }).length;
  }, [buscaDeCliente, isOpen, results.length, trimmedValue, filtros, clients, value]);
  const mostrarVazio = isOpen && results.length === 0
    && (filtrosLigados || inativosQueCasam > 0 || (trimmedValue.length > 0 && emptyHint !== undefined));
  const desenharLinha = renderItem ?? ((cliente: T) => <LinhaCliente cliente={cliente} />);

  return (
    <div
      ref={raizRef}
      className={`client-autocomplete${className ? ` ${className}` : ''}`}
      onBlur={aoSairDoComponente}
    >
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
        onKeyDown={handleKeyDown}
        style={{
          textTransform: 'uppercase',
          ...(larguraFiltro > 0 ? { paddingRight: `${larguraFiltro + 14}px` } : {}),
        }}
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

      {mostrarBotaoFiltros && (
        <div className="client-autocomplete__filtro" ref={filtroRef}>
          {resumo ? (
            <span className="client-autocomplete__etiqueta">
              <button
                type="button"
                className="client-autocomplete__etiqueta-texto"
                title={`Filtros ligados: ${resumo}. Clique para mudar (F9).`}
                aria-label={`Filtros ligados: ${resumo}. Abrir a consulta de clientes`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={abrirConsulta}
              >
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span>{resumo}</span>
              </button>
              <button
                type="button"
                className="client-autocomplete__etiqueta-limpar"
                title="Tirar os filtros"
                aria-label="Tirar os filtros da busca de cliente"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setFiltros(FILTROS_CONSULTA_PADRAO)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="client-autocomplete__botao-filtros"
              title="Consulta de clientes: cidade, estado, situação e mais (F9)"
              aria-label="Abrir a consulta de clientes com filtros"
              onMouseDown={(event) => event.preventDefault()}
              onClick={abrirConsulta}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span className="client-autocomplete__botao-filtros-texto">Filtros</span>
            </button>
          )}
        </div>
      )}

      {showResults && (
        <div className="client-autocomplete__panel" role="listbox">
          {filtrosLigados && (
            <div className="client-autocomplete__resumo" aria-live="polite">
              {results.length} {results.length === 1 ? 'cliente' : 'clientes'} · {resumo}
            </div>
          )}
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
              {desenharLinha(client, highlightedIndex === index)}
            </button>
          ))}
        </div>
      )}

      {mostrarVazio && (
        <div className="client-autocomplete__empty" onMouseDown={(event) => event.preventDefault()}>
          {inativosQueCasam > 0 && !filtrosLigados ? (
            <>
              <div>
                {inativosQueCasam === 1 ? 'Há 1 cliente inativo' : `Há ${inativosQueCasam} clientes inativos`} com esse nome.
              </div>
              <button
                type="button"
                className="client-autocomplete__todas-cidades"
                onClick={() => setFiltros({ ...filtros, situacao: 'todos' })}
              >
                Mostrar inativos também
              </button>
              {emptyHint !== undefined && <div className="client-autocomplete__dica">{emptyHint}</div>}
            </>
          ) : filtrosLigados ? (
            <>
              <div>
                {trimmedValue ? 'Nenhum cliente com esse nome' : 'Nenhum cliente'} com os filtros: {resumo}.
              </div>
              <button
                type="button"
                className="client-autocomplete__todas-cidades"
                onClick={() => { setFiltros(FILTROS_CONSULTA_PADRAO); resolvedInputRef.current?.focus(); }}
              >
                Tirar os filtros
              </button>
              {trimmedValue && emptyHint !== undefined && <div className="client-autocomplete__dica">{emptyHint}</div>}
            </>
          ) : emptyHint}
        </div>
      )}

      {buscaDeCliente && (
        <ConsultaClientesModal
          open={consultaAberta}
          onClose={fecharConsulta}
          clients={clients}
          onSelect={(cliente) => {
            onChange(String(cliente.nome || ''));
            confirmSelect(cliente);
          }}
          filtros={filtros}
          onFiltrosChange={setFiltros}
          initialQuery={value}
        />
      )}
    </div>
  );
}

const ClientAutocomplete = React.memo(ClientAutocompleteInner) as typeof ClientAutocompleteInner;

export default ClientAutocomplete;

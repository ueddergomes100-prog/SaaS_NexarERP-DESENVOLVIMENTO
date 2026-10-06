import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, MapPin, Phone, Search, Smartphone, TriangleAlert, X } from 'lucide-react';
import {
  CAMPOS_BUSCA_CLIENTE,
  FILTROS_CONSULTA_PADRAO,
  SEM_CIDADE,
  clienteEstaAtivo,
  contarFiltrosAtivos,
  listarLocaisDosClientes,
  searchClients,
  type CampoBuscaCliente,
  type FiltrosConsultaCliente,
  type SearchableClient,
  type SituacaoCliente,
} from '../../utils/clientSearch';
import { alertaDoCliente, type ClienteComAlerta } from '../../utils/clienteAlertaDomain';
import { formatarDocumento } from '../../utils/documentoValidacao';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import FiltroCidadeCliente from './FiltroCidadeCliente';
import EstadoVazio from './EstadoVazio';
import './ConsultaClientesModal.css';

export type ClienteDaConsulta = SearchableClient & ClienteComAlerta & {
  id: string;
  email?: string;
  numero?: string;
};

export interface ConsultaClientesModalProps<T extends SearchableClient & { id: string }> {
  open: boolean;
  onClose: () => void;
  clients: T[];
  onSelect: (client: T) => void;
  filtros: FiltrosConsultaCliente;
  onFiltrosChange: (filtros: FiltrosConsultaCliente) => void;
  /** O que ja' estava digitado no campo de cliente. */
  initialQuery?: string;
  /** Cliente ja' escolhido (PDV): comeca destacado. */
  selecionadoId?: string | null;
  /** Botoes extras no rodape, a esquerda (PDV: consumidor final, cadastrar). */
  acoesExtras?: React.ReactNode;
}

// Mostra no maximo isto de uma vez; os filtros afunilam o resto.
const LIMITE_NA_TELA = 200;

const PLACEHOLDER_POR_CAMPO: Record<CampoBuscaCliente, string> = {
  tudo: 'Nome, fantasia, CPF/CNPJ, telefone, código ou endereço',
  nome: 'Nome ou código do cliente',
  fantasia: 'Nome fantasia',
  documento: 'CPF ou CNPJ, com ou sem pontuação',
  telefone: 'Telefone ou celular',
  endereco: 'Rua ou avenida',
  bairro: 'Bairro',
};

const SITUACOES: Array<{ valor: SituacaoCliente; rotulo: string }> = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'inativos', rotulo: 'Inativos' },
  { valor: 'todos', rotulo: 'Todos' },
];

interface SegmentadoProps<V extends string> {
  rotulo: string;
  opcoes: Array<{ valor: V; rotulo: string }>;
  valor: V;
  onChange: (valor: V) => void;
  className?: string;
}

function Segmentado<V extends string>({ rotulo, opcoes, valor, onChange, className }: SegmentadoProps<V>) {
  return (
    <div className={`consulta-clientes__segmentado${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={rotulo}>
      {opcoes.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          role="radio"
          aria-checked={valor === opcao.valor}
          className={valor === opcao.valor ? 'is-ativo' : ''}
          onClick={() => onChange(opcao.valor)}
        >
          {opcao.rotulo}
        </button>
      ))}
    </div>
  );
}

const textoLocal = (cliente: SearchableClient): string => {
  const cidade = String(cliente.cidade || '').trim().toUpperCase();
  const uf = String(cliente.estado || '').trim().toUpperCase();
  return cidade && uf ? `${cidade} · ${uf}` : cidade || uf;
};

/**
 * CONSULTA DE CLIENTES (2026-10-06) -- os filtros da "Consulta de Clientes"
 * do Integra, que os clientes ja' conhecem, numa janela so':
 *   procura exata/avancada  -> "Contem" / "Comeca com"
 *   consulta por ...        -> "Buscar em" (Tudo, Nome, Fantasia, CPF/CNPJ...)
 *   cidade, estado, situacao
 * Lista em colunas (Nome, Fantasia, Cidade, CPF/CNPJ, Codigo) e, embaixo, a
 * ficha do cliente destacado (telefones, e-mail, endereco, alerta) para
 * conferir antes de escolher. Clique destaca; duplo clique ou "Escolher
 * cliente" escolhe. Setas e Enter funcionam direto da busca.
 *
 * Os filtros sao do campo de cliente que abriu a janela (controlados por
 * fora): fechar sem escolher mantem o filtro valendo na lista do campo.
 */
function ConsultaClientesModalInner<T extends SearchableClient & { id: string }>({
  open,
  onClose,
  clients,
  onSelect,
  filtros,
  onFiltrosChange,
  initialQuery = '',
  selecionadoId = null,
  acoesExtras,
}: ConsultaClientesModalProps<T>) {
  const [query, setQuery] = useState(initialQuery);
  const [destaque, setDestaque] = useState(0);
  const [cidadeAberta, setCidadeAberta] = useState(false);
  const buscaRef = useRef<HTMLInputElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery.replace(/^\s*#/, ''));
    setCidadeAberta(false);
  }, [open, initialQuery]);

  useEscapeLayer(open, onClose);

  const locais = useMemo(() => listarLocaisDosClientes(clients), [clients]);
  const encontrados = useMemo(() => searchClients(clients, query, filtros), [clients, query, filtros]);
  const naTela = encontrados.slice(0, LIMITE_NA_TELA);
  const filtrosLigados = contarFiltrosAtivos(filtros) > 0;

  // Destaque volta ao topo (ou ao cliente ja' escolhido) quando a lista muda.
  useEffect(() => {
    const indiceDoSelecionado = selecionadoId ? naTela.findIndex((c) => c.id === selecionadoId) : -1;
    setDestaque(indiceDoSelecionado >= 0 ? indiceDoSelecionado : 0);
  }, [encontrados, selecionadoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${destaque}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [destaque]);

  const destacado = naTela[destaque] ?? null;
  // Campos que so' a ficha usa (e-mail, numero, alerta): os tipos das telas nao precisam declarar.
  const ficha = destacado as unknown as ClienteDaConsulta | null;

  const mudar = (parcial: Partial<FiltrosConsultaCliente>) => onFiltrosChange({ ...filtros, ...parcial });

  const mudarEstado = (uf: string) => {
    const novoUf = uf || null;
    const ufDaCidade = filtros.cidade && filtros.cidade !== SEM_CIDADE ? filtros.cidade.split('|')[1] || null : null;
    // Cidade de outro estado (ou "sem cidade") nao combina com o estado novo.
    const manterCidade = filtros.cidade && novoUf && ufDaCidade === novoUf;
    mudar({ uf: novoUf, cidade: manterCidade ? filtros.cidade : null });
  };

  const escolher = (cliente: T | null) => {
    if (!cliente) return;
    onSelect(cliente);
    onClose();
  };

  const aoTeclar = (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setDestaque((i) => Math.min(i + 1, Math.max(naTela.length - 1, 0)));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setDestaque((i) => Math.max(0, i - 1));
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      escolher(destacado);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const alertaDestacado = ficha ? alertaDoCliente(ficha) : null;
  const enderecoDestacado = ficha
    ? [
      [ficha.endereco, ficha.numero].filter((p) => String(p || '').trim()).join(', '),
      ficha.bairro,
      textoLocal(ficha),
    ].map((p) => String(p || '').trim()).filter(Boolean).join(' — ')
    : '';

  return createPortal(
    <div className="consulta-clientes__fundo" onMouseDown={onClose}>
      <div
        className="consulta-clientes"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consulta-clientes-titulo"
        onMouseDown={(evento) => evento.stopPropagation()}
      >
        <header className="consulta-clientes__topo">
          <h3 id="consulta-clientes-titulo">Consulta de clientes</h3>
          <button type="button" className="consulta-clientes__fechar" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <div className="consulta-clientes__filtros">
          <div className="consulta-clientes__linha-busca">
            <label className="consulta-clientes__busca">
              <Search size={17} aria-hidden="true" />
              <input
                ref={buscaRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={aoTeclar}
                placeholder={PLACEHOLDER_POR_CAMPO[filtros.campo]}
                aria-label="Procurar cliente"
                autoComplete="off"
              />
            </label>
            <Segmentado
              rotulo="Como procurar"
              opcoes={[{ valor: 'contem', rotulo: 'Contém' }, { valor: 'comeca', rotulo: 'Começa com' }]}
              valor={filtros.modo}
              onChange={(modo) => mudar({ modo })}
            />
          </div>

          <div className="consulta-clientes__campo-busca">
            <span className="consulta-clientes__legenda">Buscar em</span>
            <Segmentado
              rotulo="Buscar em"
              opcoes={CAMPOS_BUSCA_CLIENTE}
              valor={filtros.campo}
              onChange={(campo) => { mudar({ campo }); buscaRef.current?.focus(); }}
              className="consulta-clientes__segmentado--rolavel"
            />
          </div>

          <div className="consulta-clientes__grade">
            <div className="consulta-clientes__item">
              <label className="consulta-clientes__legenda" htmlFor="consulta-clientes-cidade">Cidade</label>
              <FiltroCidadeCliente
                id="consulta-clientes-cidade"
                locais={locais}
                filtro={{ uf: filtros.uf, cidade: filtros.cidade }}
                onChange={(local) => mudar(local)}
                aberto={cidadeAberta}
                onAbertoChange={setCidadeAberta}
                onEscolheu={() => buscaRef.current?.focus()}
              />
            </div>
            <div className="consulta-clientes__item consulta-clientes__item--estado">
              <label className="consulta-clientes__legenda" htmlFor="consulta-clientes-estado">Estado</label>
              <select
                id="consulta-clientes-estado"
                className="consulta-clientes__select"
                value={filtros.uf ?? ''}
                onChange={(e) => mudarEstado(e.target.value)}
              >
                <option value="">Todos</option>
                {locais.ufs.map((u) => <option key={u.uf} value={u.uf}>{u.uf}</option>)}
              </select>
            </div>
            <div className="consulta-clientes__item">
              <span className="consulta-clientes__legenda">Situação</span>
              <Segmentado rotulo="Situação" opcoes={SITUACOES} valor={filtros.situacao} onChange={(situacao) => mudar({ situacao })} />
            </div>
          </div>
        </div>

        <div className="consulta-clientes__meta">
          <span aria-live="polite">
            {encontrados.length} {encontrados.length === 1 ? 'cliente' : 'clientes'}
            {encontrados.length > LIMITE_NA_TELA && ` · mostrando os primeiros ${LIMITE_NA_TELA}, use os filtros para afunilar`}
          </span>
          {filtrosLigados && (
            <button type="button" className="consulta-clientes__limpar" onClick={() => onFiltrosChange(FILTROS_CONSULTA_PADRAO)}>
              Limpar filtros
            </button>
          )}
        </div>

        <div className="consulta-clientes__tabela" role="listbox" aria-label="Clientes encontrados" ref={listaRef}>
          <div className="consulta-clientes__cabecalho" aria-hidden="true">
            <span>Nome</span>
            <span>Fantasia</span>
            <span>Cidade</span>
            <span>CPF / CNPJ</span>
            <span className="consulta-clientes__num">Código</span>
          </div>
          {naTela.map((cliente, indice) => {
            const temAlerta = Boolean(alertaDoCliente(cliente as unknown as ClienteDaConsulta));
            const inativo = !clienteEstaAtivo(cliente);
            return (
              <button
                key={cliente.id}
                type="button"
                role="option"
                tabIndex={-1}
                data-indice={indice}
                aria-selected={indice === destaque}
                className={`consulta-clientes__linha${indice === destaque ? ' is-destaque' : ''}${inativo ? ' is-inativo' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setDestaque(indice)}
                onDoubleClick={() => escolher(cliente)}
              >
                <span className="consulta-clientes__nome">
                  {temAlerta && <TriangleAlert size={13} className="consulta-clientes__icone-alerta" aria-label="Tem alerta no cadastro" />}
                  <span>{cliente.nome}</span>
                  {inativo && <span className="consulta-clientes__selo">Inativo</span>}
                </span>
                <span className="consulta-clientes__fantasia">{cliente.fantasia}</span>
                <span className="consulta-clientes__cidade">{textoLocal(cliente)}</span>
                <span className="consulta-clientes__doc">{cliente.documento ? formatarDocumento(String(cliente.documento)) : ''}</span>
                <span className="consulta-clientes__num">{cliente.codigo}</span>
              </button>
            );
          })}
          {naTela.length === 0 && (
            <EstadoVazio
              compacto
              titulo={clients.length === 0 ? 'Nenhum cliente cadastrado.' : 'Nenhum cliente com esses filtros.'}
              texto={clients.length === 0 ? undefined : 'Mude o que procurar, a cidade ou a situação, ou limpe os filtros.'}
            />
          )}
        </div>

        {ficha && (
          <div className="consulta-clientes__ficha" aria-live="polite">
            <div className="consulta-clientes__ficha-contatos">
              {ficha.telefone && <span><Phone size={13} aria-hidden="true" />{ficha.telefone}</span>}
              {ficha.celular && <span><Smartphone size={13} aria-hidden="true" />{ficha.celular}</span>}
              {ficha.email && <span><Mail size={13} aria-hidden="true" />{ficha.email}</span>}
              {!ficha.telefone && !ficha.celular && !ficha.email && <span className="consulta-clientes__ficha-vazio">Sem telefone nem e-mail no cadastro</span>}
            </div>
            <div className="consulta-clientes__ficha-endereco">
              <MapPin size={13} aria-hidden="true" />
              <span>{enderecoDestacado || 'Sem endereço no cadastro'}</span>
            </div>
            {alertaDestacado && (
              <div className="consulta-clientes__ficha-alerta">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{alertaDestacado}</span>
              </div>
            )}
          </div>
        )}

        <footer className="consulta-clientes__rodape">
          <div className="consulta-clientes__extras">{acoesExtras}</div>
          <div className="consulta-clientes__acoes">
            <button type="button" className="btn-secondary" onClick={onClose}>Fechar</button>
            <button type="button" className="btn-primary" disabled={!destacado} onClick={() => escolher(destacado)}>
              Escolher cliente
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const ConsultaClientesModal = React.memo(ConsultaClientesModalInner) as typeof ConsultaClientesModalInner;

export default ConsultaClientesModal;

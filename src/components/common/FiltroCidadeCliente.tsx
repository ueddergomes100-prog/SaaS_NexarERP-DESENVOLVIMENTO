import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import {
  SEM_CIDADE,
  rotuloFiltroLocal,
  type FiltroLocalCliente,
  type LocaisDosClientes,
} from '../../utils/clientSearch';
import { normalizeSearchText } from '../../utils/textSearch';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import './FiltroCidadeCliente.css';

interface FiltroCidadeClienteProps {
  locais: LocaisDosClientes;
  filtro: FiltroLocalCliente;
  onChange: (filtro: FiltroLocalCliente) => void;
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  /** Depois de escolher (ou fechar com Esc): devolve o foco para a busca. */
  onEscolheu?: () => void;
  id?: string;
}

interface Opcao {
  chave: string;
  rotulo: string;
  total: number;
  filtro: FiltroLocalCliente;
  ativa: boolean;
  discreta?: boolean;
}

/**
 * Campo "Cidade" da Consulta de clientes (2026-10-06). Parece um select, mas
 * abre uma lista com busca: so' as cidades que existem nos cadastros, com
 * quantos clientes em cada (empresa que atende 150 cidades nao rola um select
 * comum). Respeita o Estado escolhido ao lado: com "ES", lista so' cidades do
 * ES. "Sem cidade no cadastro" ajuda a achar cadastro incompleto para corrigir.
 */
const FiltroCidadeCliente: React.FC<FiltroCidadeClienteProps> = ({
  locais,
  filtro,
  onChange,
  aberto,
  onAbertoChange,
  onEscolheu,
  id,
}) => {
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const raizRef = useRef<HTMLDivElement | null>(null);
  const uf = filtro.uf;
  const temCidade = Boolean(filtro.cidade);
  const rotulo = temCidade ? rotuloFiltroLocal({ cidade: filtro.cidade, uf: null }, locais) : '';
  const variosEstados = locais.ufs.length > 1;

  useEffect(() => {
    if (!aberto) return;
    setBusca('');
    setDestaque(0);
  }, [aberto]);

  useEscapeLayer(aberto, () => onAbertoChange(false));

  // Clique fora do campo e da lista fecha a lista.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (evento: MouseEvent) => {
      if (raizRef.current && !raizRef.current.contains(evento.target as Node)) onAbertoChange(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto, onAbertoChange]);

  const opcoes = useMemo<Opcao[]>(() => {
    const termo = normalizeSearchText(busca);
    const lista: Opcao[] = [];
    if (!termo) {
      lista.push({
        chave: '__todas__',
        rotulo: uf ? `Todas as cidades de ${uf}` : 'Todas as cidades',
        total: uf
          ? (locais.ufs.find((u) => u.uf === uf)?.total ?? 0)
          : locais.cidades.reduce((soma, c) => soma + c.total, 0) + locais.semCidade,
        filtro: { uf, cidade: null },
        ativa: !temCidade,
        discreta: true,
      });
    }
    locais.cidades
      .filter((c) => (!uf || c.uf === uf) && (!termo || normalizeSearchText(c.cidade).includes(termo)))
      .forEach((c) => lista.push({
        chave: c.chave,
        rotulo: variosEstados && !uf && c.uf ? `${c.cidade} · ${c.uf}` : c.cidade,
        total: c.total,
        filtro: { uf: c.uf || null, cidade: c.chave },
        ativa: filtro.cidade === c.chave,
      }));
    if (!uf && locais.semCidade > 0 && (!termo || normalizeSearchText('sem cidade no cadastro').includes(termo))) {
      lista.push({
        chave: SEM_CIDADE,
        rotulo: 'Sem cidade no cadastro',
        total: locais.semCidade,
        filtro: { uf: null, cidade: SEM_CIDADE },
        ativa: filtro.cidade === SEM_CIDADE,
        discreta: true,
      });
    }
    return lista;
  }, [busca, uf, locais, filtro.cidade, temCidade, variosEstados]);

  useEffect(() => { setDestaque(0); }, [busca, uf]);

  useEffect(() => {
    // Mantem a opcao destacada visivel ao andar com as setas.
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${destaque}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [destaque]);

  const escolher = (opcao: Opcao) => {
    onChange(opcao.filtro);
    onAbertoChange(false);
    onEscolheu?.();
  };

  const aoTeclar = (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setDestaque((i) => Math.min(i + 1, opcoes.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setDestaque((i) => Math.max(0, i - 1));
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      const opcao = opcoes[destaque];
      if (opcao) escolher(opcao);
    } else if (evento.key === 'Escape') {
      // Fecha so' a lista: sem isto o Esc tambem fecharia a consulta inteira
      // (e, no PDV, a janela de cliente, que escuta a tecla na pagina toda).
      evento.preventDefault();
      evento.stopPropagation();
      onAbertoChange(false);
      onEscolheu?.();
    }
  };

  return (
    <div className="filtro-cidade" ref={raizRef}>
      <button
        id={id}
        type="button"
        className={`filtro-cidade__campo${temCidade ? ' is-ativo' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => onAbertoChange(!aberto)}
      >
        <MapPin size={15} aria-hidden="true" />
        <span className="filtro-cidade__valor">{temCidade ? rotulo : (uf ? `Todas de ${uf}` : 'Todas as cidades')}</span>
        <ChevronDown size={15} aria-hidden="true" className="filtro-cidade__seta" />
      </button>
      {temCidade && (
        <button
          type="button"
          className="filtro-cidade__limpar"
          title="Todas as cidades"
          aria-label="Tirar o filtro de cidade"
          onClick={() => onChange({ uf, cidade: null })}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}

      {aberto && (
        <div className="filtro-cidade__painel" role="dialog" aria-label="Escolher cidade">
          <label className="filtro-cidade__busca">
            <Search size={14} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Buscar cidade"
              aria-label="Buscar cidade"
              autoComplete="off"
            />
          </label>

          <div className="filtro-cidade__lista" role="listbox" ref={listaRef}>
            {opcoes.map((opcao, indice) => (
              <button
                key={opcao.chave}
                type="button"
                role="option"
                data-indice={indice}
                aria-selected={opcao.ativa}
                className={[
                  'filtro-cidade__opcao',
                  indice === destaque ? 'is-destaque' : '',
                  opcao.ativa ? 'is-ativa' : '',
                  opcao.discreta ? 'is-discreta' : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => setDestaque(indice)}
                onClick={() => escolher(opcao)}
              >
                <span className="filtro-cidade__opcao-nome">{opcao.rotulo}</span>
                <span className="filtro-cidade__opcao-total">{opcao.total}</span>
                <span className="filtro-cidade__opcao-marca" aria-hidden="true">{opcao.ativa && <Check size={14} />}</span>
              </button>
            ))}
            {opcoes.length === 0 && (
              <div className="filtro-cidade__vazio">Nenhum cliente cadastrado em cidade com esse nome.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FiltroCidadeCliente;

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { gruposQueCabem } from '../../utils/menuNoTopoDomain';
import hennderIcon from '../../assets/hennder-icon.webp';
import './menuTopo.css';

/*
 * MENU NO TOPO (Embala Minas, item 4 -- modelo 1 "Cartao com grupos", 25/11/2026).
 *
 * Os mesmos grupos e telas do menu lateral (o Sidebar continua decidindo o que
 * cada pessoa ve: permissao, modulo do plano, chaves da empresa), so' que na
 * barra de cima, ao lado da busca. Os grupos que cabem ficam a' vista; passar o
 * mouse (ou clicar) abre o cartao com as telas do grupo. O que nao cabe vai para
 * "Mais". Cores: as do sistema de hoje.
 *
 * A barra de cima (TopBar) reserva o lugar (#menu-topo-slot); este componente
 * entra nele por portal.
 */

export interface ItemDoMenuTopo {
  label: string;
  to: string;
  icon: React.ElementType;
  badge?: string;
}

export interface GrupoDoMenuTopo {
  id: string;
  label: string;
  icon: React.ElementType;
  items: ItemDoMenuTopo[];
}

interface Props {
  grupos: GrupoDoMenuTopo[];
  caminhoAtual: string;
  abrir: (to: string, label?: string) => void;
  irParaInicio: () => void;
}

const ID_DO_LUGAR = 'menu-topo-slot';
const MAIS = '__mais__';

const itemAtivo = (caminho: string, to: string) => caminho === to || caminho.startsWith(`${to}/`);

/** Espera a barra de cima montar o lugar do menu. */
const useLugarDoMenu = (): HTMLElement | null => {
  const [lugar, setLugar] = useState<HTMLElement | null>(() => document.getElementById(ID_DO_LUGAR));
  useEffect(() => {
    const procurar = () => {
      const achado = document.getElementById(ID_DO_LUGAR);
      setLugar((atual) => (atual === achado ? atual : achado));
    };
    procurar();
    const observador = new MutationObserver(procurar);
    observador.observe(document.body, { childList: true, subtree: true });
    return () => observador.disconnect();
  }, []);
  return lugar;
};

const MenuTopo: React.FC<Props> = ({ grupos, caminhoAtual, abrir, irParaInicio }) => {
  const lugar = useLugarDoMenu();
  const barraRef = useRef<HTMLDivElement>(null);
  const linhaRef = useRef<HTMLDivElement>(null);
  const medidorRef = useRef<HTMLDivElement>(null);
  const [visiveis, setVisiveis] = useState(grupos.length);
  const [aberto, setAberto] = useState<string | null>(null);
  const [posicaoDoCartao, setPosicaoDoCartao] = useState(0);
  const fechamento = useRef<number | null>(null);

  // Quantos grupos cabem: mede os botoes numa linha escondida e o espaco da barra.
  const medir = useCallback(() => {
    const linha = linhaRef.current;
    const medidor = medidorRef.current;
    if (!linha || !medidor) return;
    const botoes = Array.from(medidor.querySelectorAll<HTMLElement>('[data-medida="grupo"]'));
    const mais = medidor.querySelector<HTMLElement>('[data-medida="mais"]');
    const larguras = botoes.map((b) => b.getBoundingClientRect().width + 2);
    const cabem = gruposQueCabem(larguras, linha.clientWidth, (mais?.getBoundingClientRect().width ?? 80) + 2);
    setVisiveis((atual) => (atual === cabem ? atual : cabem));
  }, []);

  useLayoutEffect(() => {
    medir();
  }, [medir, grupos, lugar]);

  useEffect(() => {
    const linha = linhaRef.current;
    if (!linha || typeof ResizeObserver === 'undefined') return undefined;
    const observador = new ResizeObserver(() => medir());
    observador.observe(linha);
    // A largura dos botoes muda com a fonte carregando e com o tamanho da janela.
    if (medidorRef.current) observador.observe(medidorRef.current);
    return () => observador.disconnect();
  }, [medir, lugar]);

  const cancelarFechamento = () => {
    if (fechamento.current) window.clearTimeout(fechamento.current);
    fechamento.current = null;
  };
  const fecharDepois = () => {
    cancelarFechamento();
    fechamento.current = window.setTimeout(() => setAberto(null), 180);
  };

  const abrirCartao = (id: string, botao: HTMLElement) => {
    cancelarFechamento();
    const barra = barraRef.current;
    if (barra) setPosicaoDoCartao(botao.getBoundingClientRect().left - barra.getBoundingClientRect().left);
    setAberto(id);
  };

  // Esc e clique fora fecham o cartao.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (evento: MouseEvent) => {
      if (!barraRef.current?.contains(evento.target as Node)) setAberto(null);
    };
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') setAberto(null); };
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  // Trocou de tela: fecha o cartao.
  useEffect(() => { setAberto(null); }, [caminhoAtual]);
  useEffect(() => () => cancelarFechamento(), []);

  if (!lugar) return null;

  const aVista = grupos.slice(0, visiveis);
  const noMais = grupos.slice(visiveis);
  const grupoAberto = aberto && aberto !== MAIS ? grupos.find((g) => g.id === aberto) : null;
  const grupoAtivo = (g: GrupoDoMenuTopo) => g.items.some((i) => itemAtivo(caminhoAtual, i.to));

  const irPara = (item: ItemDoMenuTopo) => {
    setAberto(null);
    abrir(item.to, item.label);
  };

  const botaoDoGrupo = (g: GrupoDoMenuTopo, medida = false) => {
    const Icone = g.icon;
    const direto = g.items.length === 1;
    const ativo = grupoAtivo(g);
    return (
      <button
        key={g.id}
        type="button"
        className={`menu-topo__grupo${ativo ? ' ativo' : ''}${aberto === g.id ? ' aberto' : ''}`}
        data-medida={medida ? 'grupo' : undefined}
        tabIndex={medida ? -1 : undefined}
        aria-hidden={medida || undefined}
        aria-haspopup={direto ? undefined : 'menu'}
        aria-expanded={direto ? undefined : aberto === g.id}
        title={direto ? g.items[0].label : g.label}
        onMouseEnter={medida || direto ? undefined : (e) => abrirCartao(g.id, e.currentTarget)}
        onClick={medida ? undefined : (e) => {
          if (direto) { irPara(g.items[0]); return; }
          if (aberto === g.id) setAberto(null); else abrirCartao(g.id, e.currentTarget);
        }}
      >
        <Icone size={16} aria-hidden="true" />
        <span>{direto ? g.items[0].label : g.label}</span>
        {!direto && <ChevronDown size={13} className="menu-topo__seta" aria-hidden="true" />}
      </button>
    );
  };

  const listaDeItens = (g: GrupoDoMenuTopo) => g.items.map((item) => {
    const Icone = item.icon;
    const ativo = itemAtivo(caminhoAtual, item.to);
    return (
      <button
        key={item.to}
        type="button"
        role="menuitem"
        className={`menu-topo__item${ativo ? ' ativo' : ''}`}
        aria-current={ativo ? 'page' : undefined}
        onClick={() => irPara(item)}
      >
        <Icone size={15} aria-hidden="true" />
        <span>{item.label}</span>
        {item.badge && <small>{item.badge}</small>}
      </button>
    );
  });

  return createPortal(
    <div className="menu-topo" ref={barraRef} onMouseLeave={fecharDepois} onMouseEnter={cancelarFechamento}>
      <button type="button" className="menu-topo__logo" onClick={irParaInicio} title="Ir para o Dashboard" aria-label="Hennder Company - ir para o Dashboard">
        <img src={hennderIcon} alt="" />
      </button>

      <nav className="menu-topo__linha" ref={linhaRef} aria-label="Menu principal">
        {aVista.map((g) => botaoDoGrupo(g))}
        {noMais.length > 0 && (
          <button
            type="button"
            className={`menu-topo__grupo${noMais.some(grupoAtivo) ? ' ativo' : ''}${aberto === MAIS ? ' aberto' : ''}`}
            aria-haspopup="menu"
            aria-expanded={aberto === MAIS}
            onMouseEnter={(e) => abrirCartao(MAIS, e.currentTarget)}
            onClick={(e) => { if (aberto === MAIS) setAberto(null); else abrirCartao(MAIS, e.currentTarget); }}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
            <span>Mais</span>
            <ChevronDown size={13} className="menu-topo__seta" aria-hidden="true" />
          </button>
        )}
      </nav>

      {/* Linha escondida so' para medir a largura de cada botao. */}
      <div className="menu-topo__medidor" ref={medidorRef} aria-hidden="true">
        {grupos.map((g) => botaoDoGrupo(g, true))}
        <span className="menu-topo__grupo" data-medida="mais"><MoreHorizontal size={16} /><span>Mais</span><ChevronDown size={13} /></span>
      </div>

      {grupoAberto && (
        <div className="menu-topo__cartao" role="menu" aria-label={grupoAberto.label} style={{ left: posicaoDoCartao }}>
          <div className="menu-topo__titulo">{grupoAberto.label}</div>
          {listaDeItens(grupoAberto)}
        </div>
      )}

      {aberto === MAIS && noMais.length > 0 && (
        <div
          className="menu-topo__cartao menu-topo__cartao--mais"
          role="menu"
          aria-label="Mais grupos"
        >
          {noMais.map((g) => {
            const Icone = g.icon;
            return (
              <div key={g.id} className="menu-topo__bloco">
                <div className="menu-topo__titulo"><Icone size={14} aria-hidden="true" />{g.label}</div>
                {listaDeItens(g)}
              </div>
            );
          })}
        </div>
      )}
    </div>,
    lugar,
  );
};

export default MenuTopo;

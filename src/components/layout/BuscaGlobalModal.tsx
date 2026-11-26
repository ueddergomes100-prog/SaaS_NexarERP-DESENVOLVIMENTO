import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Loader2, Search, X } from 'lucide-react';
import { telasDaBusca, type GrupoDoMenuParaBusca } from '../../utils/buscaTelasDomain';
import { useBuscaGlobal, type ResultadoDaBusca, type TipoDoResultado } from '../../hooks/useBuscaGlobal';
import './buscaGlobal.css';

/*
 * JANELA DA LUPA (menu no topo, pedido do dono em 26/11/2026).
 *
 * Larga e legivel: telas do sistema (ir direto para a tela) e cadastros
 * (clientes, fornecedores, OS, produtos). So' aparece o que a pessoa pode abrir:
 * as telas vem do menu ja' filtrado (permissao, modulo do plano, chaves da
 * empresa), sem "Filiais" nem "Permissao de Usuarios" (buscaTelasDomain.ts); os
 * cadastros passam pela mesma regra das abas (useBuscaGlobal.ts).
 * Setas sobem e descem, Enter abre, Esc fecha. Cores: as do tema de hoje.
 */

interface Props {
  aberta: boolean;
  fechar: () => void;
  grupos: GrupoDoMenuParaBusca[];
  abrirTela: (to: string, label?: string) => void;
}

interface Linha {
  chave: string;
  secao: string;
  titulo: string;
  detalhe: string;
  abrir: () => void;
}

const SECAO_DO_TIPO: Record<TipoDoResultado, string> = {
  Cliente: 'Clientes',
  Fornecedor: 'Fornecedores',
  OS: 'Ordens de serviço',
  Produto: 'Produtos',
};
const ORDEM_DAS_SECOES = ['Telas', 'Clientes', 'Fornecedores', 'Ordens de serviço', 'Produtos'];

const BuscaGlobalModal: React.FC<Props> = ({ aberta, fechar, grupos, abrirTela }) => {
  const [termo, setTermo] = useState('');
  const [selecionada, setSelecionada] = useState(0);
  const campoRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const { resultados, buscando } = useBuscaGlobal(aberta ? termo : '', 15);

  useEffect(() => {
    if (!aberta) return;
    setTermo('');
    setSelecionada(0);
    requestAnimationFrame(() => campoRef.current?.focus());
  }, [aberta]);

  const linhas = useMemo<Linha[]>(() => {
    const irPara = (to: string, label?: string) => () => { fechar(); abrirTela(to, label); };
    const telas: Linha[] = telasDaBusca(grupos, termo).map((t) => ({
      chave: `tela:${t.to}`,
      secao: 'Telas',
      titulo: t.label,
      detalhe: t.grupo,
      abrir: irPara(t.to, t.label),
    }));
    const cadastros: Linha[] = resultados.map((r: ResultadoDaBusca) => ({
      chave: `${r.type}:${r.id}`,
      secao: SECAO_DO_TIPO[r.type],
      titulo: r.title,
      detalhe: r.subtitle,
      abrir: irPara(r.link),
    }));
    return [...telas, ...cadastros].sort((a, b) => ORDEM_DAS_SECOES.indexOf(a.secao) - ORDEM_DAS_SECOES.indexOf(b.secao));
  }, [grupos, termo, resultados, fechar, abrirTela]);

  useEffect(() => { setSelecionada(0); }, [termo]);
  useEffect(() => {
    if (selecionada >= linhas.length) setSelecionada(Math.max(0, linhas.length - 1));
  }, [linhas.length, selecionada]);
  useEffect(() => {
    listaRef.current?.querySelector('[data-selecionada="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selecionada]);

  if (!aberta) return null;

  const aoTeclar = (evento: React.KeyboardEvent) => {
    if (evento.key === 'Escape') { evento.preventDefault(); fechar(); return; }
    if (evento.key === 'ArrowDown') { evento.preventDefault(); setSelecionada((i) => Math.min(linhas.length - 1, i + 1)); return; }
    if (evento.key === 'ArrowUp') { evento.preventDefault(); setSelecionada((i) => Math.max(0, i - 1)); return; }
    if (evento.key === 'Enter' && linhas[selecionada]) { evento.preventDefault(); linhas[selecionada].abrir(); }
  };

  const curto = termo.trim().length < 2;
  let secaoAnterior = '';

  return createPortal(
    <div className="busca-global__fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div className="busca-global" role="dialog" aria-modal="true" aria-label="Buscar no sistema" onKeyDown={aoTeclar}>
        <div className="busca-global__topo">
          <Search size={20} aria-hidden="true" />
          <input
            ref={campoRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            className="busca-global__campo"
            aria-label="Buscar tela, cliente, fornecedor, OS ou produto"
            autoComplete="off"
          />
          {buscando && <Loader2 size={18} className="spin-animation" aria-hidden="true" />}
          <button type="button" className="busca-global__fechar" onClick={fechar} title="Fechar (Esc)" aria-label="Fechar a busca">
            <X size={18} />
          </button>
        </div>

        <div className="busca-global__lista" ref={listaRef} role="listbox" aria-label="Resultados">
          {!termo.trim() && (
            <p className="busca-global__dica">Digite o nome de uma tela (ex.: contas a receber), de um cliente ou fornecedor, o número da OS ou o código do produto.</p>
          )}
          {termo.trim() && linhas.length === 0 && !buscando && (
            <p className="busca-global__dica">
              {curto ? 'Nenhuma tela com esse nome. Para buscar clientes, fornecedores, OS e produtos, digite pelo menos 2 letras.' : `Nada encontrado para "${termo}".`}
            </p>
          )}
          {linhas.map((linha, indice) => {
            const cabecalho = linha.secao !== secaoAnterior ? linha.secao : '';
            secaoAnterior = linha.secao;
            return (
              <React.Fragment key={linha.chave}>
                {cabecalho && <div className="busca-global__secao">{cabecalho}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={indice === selecionada}
                  data-selecionada={indice === selecionada}
                  className={`busca-global__item${indice === selecionada ? ' selecionado' : ''}`}
                  onMouseMove={() => setSelecionada(indice)}
                  onClick={linha.abrir}
                >
                  <span className="busca-global__textos">
                    <strong>{linha.titulo}</strong>
                    {linha.detalhe && <small>{linha.detalhe}</small>}
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="busca-global__rodape">
          <span><kbd>↑</kbd> <kbd>↓</kbd> escolher</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> fechar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BuscaGlobalModal;

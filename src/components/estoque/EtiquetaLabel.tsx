import React, { useCallback, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import {
  resolverCodigoBarras,
  type CampoEtiquetaId,
  type ModeloEtiqueta,
  type ProdutoParaCodigoBarras,
} from '../../utils/etiquetaDomain';
import './EtiquetaLabel.css';

export interface ProdutoEtiquetaDados extends ProdutoParaCodigoBarras {
  nome: string;
  precoVenda: number;
  precoAVista?: number | null;
  precoAPrazo?: number | null;
  unidadeMedidaSigla: string;
}

interface EtiquetaLabelProps {
  produto: ProdutoEtiquetaDados;
  modelo: ModeloEtiqueta;
  /** Modo editor: cada campo ganha borda tracejada no hover e pode ser
   * arrastado. Sem isso (impressao e preview simples), a etiqueta e' so
   * leitura -- mesmo componente dos dois jeitos, pra nunca divergir do que
   * realmente sai impresso. */
  editable?: boolean;
  onMoverCampo?: (campo: CampoEtiquetaId, xMm: number, yMm: number) => void;
}

const formatBRL = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

/**
 * Desenha UMA etiqueta -- compartilhado entre o editor de layout, o preview
 * da tela de selecao (Etiquetas.tsx) e a folha de impressao
 * (EtiquetasPrint.tsx). Cada campo (nome, unidade, codigo de barras, preco)
 * e' posicionado livremente em mm a partir do canto superior-esquerdo,
 * conforme modelo.campos -- ver etiquetaDomain.ts.
 */
const EtiquetaLabel: React.FC<EtiquetaLabelProps> = ({ produto, modelo, editable, onMoverCampo }) => {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const codigo = resolverCodigoBarras(produto);
  const campoCodigoBarrasVisivel = modelo.campos.codigoBarras.visivel;

  useEffect(() => {
    if (!campoCodigoBarrasVisivel || !codigo || !barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, codigo, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 12,
        height: 32,
        margin: 0,
        width: 1.4,
      });
    } catch {
      // Codigo com caractere que o CODE128 nao aceita -- a etiqueta segue
      // sem barras em vez de travar a geracao do lote inteiro.
    }
  }, [codigo, campoCodigoBarrasVisivel]);

  /** Arraste de um campo: guarda a posicao do ponteiro no pointerdown, e a
   * cada pointermove converte o deslocamento de px pra mm usando o tamanho
   * REAL do container (getBoundingClientRect) -- funciona igual em
   * qualquer zoom/escala aplicada por fora via CSS (o editor amplia
   * visualmente com transform: scale, ver Etiquetas.tsx), sem essa conta
   * precisar saber desse fator.
   *
   * Listener em `window` (nao no proprio elemento) de proposito: arrastar
   * rapido tira o ponteiro por cima do elemento no meio do gesto, e sem
   * isso o movimento parava de ser capturado. */
  const iniciarArraste = useCallback((campo: CampoEtiquetaId) => (eventoInicial: React.PointerEvent) => {
    if (!editable || !onMoverCampo || !containerRef.current) return;
    eventoInicial.preventDefault();
    eventoInicial.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const pxPorMmX = rect.width / modelo.larguraMm;
    const pxPorMmY = rect.height / modelo.alturaMm;
    const posicaoInicial = modelo.campos[campo];
    const clienteXInicial = eventoInicial.clientX;
    const clienteYInicial = eventoInicial.clientY;

    const mover = (evento: PointerEvent) => {
      const deltaXMm = (evento.clientX - clienteXInicial) / pxPorMmX;
      const deltaYMm = (evento.clientY - clienteYInicial) / pxPorMmY;
      const novoX = Math.min(modelo.larguraMm, Math.max(0, posicaoInicial.xMm + deltaXMm));
      const novoY = Math.min(modelo.alturaMm, Math.max(0, posicaoInicial.yMm + deltaYMm));
      onMoverCampo(campo, novoX, novoY);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }, [editable, onMoverCampo, modelo]);

  const renderCampo = (id: CampoEtiquetaId, conteudo: React.ReactNode, estilo?: React.CSSProperties) => {
    const posicao = modelo.campos[id];
    if (!posicao.visivel) return null;
    return (
      <div
        key={id}
        className={`etiqueta-campo${editable ? ' etiqueta-campo--editavel' : ''}`}
        style={{ left: `${posicao.xMm}mm`, top: `${posicao.yMm}mm`, ...estilo }}
        onPointerDown={iniciarArraste(id)}
      >
        {conteudo}
      </div>
    );
  };

  const precoPrincipal = produto.precoAVista ?? produto.precoVenda;

  return (
    <div
      ref={containerRef}
      className="etiqueta-label"
      style={{ width: `${modelo.larguraMm}mm`, height: `${modelo.alturaMm}mm` }}
    >
      {renderCampo('nome', produto.nome, { fontSize: `${modelo.campos.nome.fontePt}pt`, fontWeight: 700 })}
      {renderCampo('unidade', produto.unidadeMedidaSigla, { fontSize: `${modelo.campos.unidade.fontePt}pt`, color: '#333333' })}
      {renderCampo(
        'codigoBarras',
        codigo
          ? <svg ref={barcodeRef} className="etiqueta-barcode" />
          : <span className="etiqueta-sem-codigo">Sem código de barras cadastrado</span>,
      )}
      {renderCampo('precoAVista', formatBRL(precoPrincipal), { fontSize: `${modelo.campos.precoAVista.fontePt}pt`, fontWeight: 700 })}
      {produto.precoAPrazo != null
        && renderCampo('precoAPrazo', `${formatBRL(produto.precoAPrazo)} a prazo`, { fontSize: `${modelo.campos.precoAPrazo.fontePt}pt`, color: '#444444' })}
    </div>
  );
};

export default EtiquetaLabel;

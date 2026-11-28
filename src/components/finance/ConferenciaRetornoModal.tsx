import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, FileCheck2, X } from 'lucide-react';
import type { ConferenciaDoRetorno } from '../../utils/conferenciaRetornoDomain';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';
import './ConferenciaRetornoModal.css';

/**
 * CONFERIR O RETORNO ANTES DA BAIXA (28/11/2026, pedido do dono): o que o
 * arquivo do banco vai baixar, documento por documento -- vencimento, dia do
 * pagamento, juros e multa de cada um e o total de juros e multa recebido.
 * Nada e' baixado ate' a pessoa confirmar. Conta em conferenciaRetornoDomain.ts.
 */

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

interface Props {
  conferencia: ConferenciaDoRetorno;
  nomeDoArquivo: string;
  /** Linhas do arquivo com outra ocorrencia (nao serao tocadas). */
  outrasOcorrencias: number;
  /** Confirmacoes de entrada / titulos em aberto (so' informam). */
  informativos: number;
  onConfirmar: () => void;
  onCancelar: () => void;
}

const ConferenciaRetornoModal: React.FC<Props> = ({ conferencia, nomeDoArquivo, outrasOcorrencias, informativos, onConfirmar, onCancelar }) => {
  const { mostrar } = useValoresOcultos();
  const reais = (c: number) => mostrar(moeda.format(c / 100));
  const confirmarRef = useRef<HTMLButtonElement | null>(null);
  const { aBaixar, jaPagos, naoEncontrados, totais } = conferencia;

  useEffect(() => {
    confirmarRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onCancelar]);

  const deFora = [
    jaPagos.length > 0 ? `${jaPagos.length} já ${jaPagos.length === 1 ? 'estava pago' : 'estavam pagos'} (não baixa de novo)` : '',
    naoEncontrados.length > 0 ? `${naoEncontrados.length} não ${naoEncontrados.length === 1 ? 'encontrado' : 'encontrados'} no sistema: ${naoEncontrados.slice(0, 6).join(', ')}${naoEncontrados.length > 6 ? '…' : ''}` : '',
    outrasOcorrencias > 0 ? `${outrasOcorrencias} com outra ocorrência do banco (não ${outrasOcorrencias === 1 ? 'é tocado' : 'são tocados'}; confira no banco)` : '',
    informativos > 0 ? `${informativos} só ${informativos === 1 ? 'informa' : 'informam'} (entrada confirmada / título em aberto)` : '',
  ].filter(Boolean);

  return createPortal(
    <div className="retorno-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="retorno-janela" role="dialog" aria-modal="true" aria-labelledby="retorno-titulo" aria-describedby="retorno-resumo">
        <header className="retorno-cabecalho">
          <div>
            <p className="retorno-sobretitulo"><FileCheck2 size={14} aria-hidden="true" /> Retorno do banco · {nomeDoArquivo}</p>
            <h2 id="retorno-titulo">Conferir antes de dar baixa</h2>
            <p className="retorno-subtitulo">Nada foi baixado ainda. Confira os pagamentos e confirme no fim.</p>
          </div>
          <button type="button" className="retorno-fechar" onClick={onCancelar} aria-label="Fechar sem dar baixa"><X size={20} /></button>
        </header>

        <div className="retorno-totais" id="retorno-resumo">
          <div className="retorno-total">
            <span>Boletos a baixar</span>
            <strong>{totais.quantidade}</strong>
          </div>
          <div className="retorno-total">
            <span>Pago pelos clientes</span>
            <strong>{reais(totais.pagoCentavos)}</strong>
            <small>boletos {reais(totais.valorBoletosCentavos)}</small>
          </div>
          <div className="retorno-total retorno-total--juros">
            <span>Juros e multa recebidos</span>
            <strong>{reais(totais.jurosMultaCentavos)}</strong>
            {totais.descontoCentavos > 0 && <small>descontos {reais(totais.descontoCentavos)}</small>}
          </div>
          <div className="retorno-total">
            <span>Entra no banco</span>
            <strong>{reais(totais.liquidoCentavos)}</strong>
            {totais.tarifaCentavos > 0 && <small className="retorno-tarifa">tarifas − {reais(totais.tarifaCentavos)}</small>}
          </div>
        </div>

        <div className="retorno-tabela-caixa">
          <table className="retorno-tabela">
            <caption className="retorno-so-leitor">Boletos que serão baixados</caption>
            <thead>
              <tr>
                <th scope="col">Cliente e documento</th>
                <th scope="col">Vencimento</th>
                <th scope="col">Pago em</th>
                <th scope="col" className="retorno-num">Boleto</th>
                <th scope="col" className="retorno-num">Juros e multa</th>
                <th scope="col" className="retorno-num">Pago</th>
              </tr>
            </thead>
            <tbody>
              {aBaixar.map((d) => (
                <tr key={d.tituloId}>
                  <td>
                    <div className="retorno-cliente">{d.cliente}</div>
                    <div className="retorno-doc">
                      {d.descricao}
                      <span> · nº {d.nossoNumero}</span>
                      {d.canceladoNoSistema && <em className="retorno-selo">cancelado no sistema</em>}
                    </div>
                  </td>
                  <td className="retorno-data">{dataBr(d.vencimento)}</td>
                  <td className="retorno-data">
                    {dataBr(d.dataPagamento)}
                    {d.diasDeAtraso > 0 && (
                      <span className="retorno-atraso"><CalendarClock size={12} aria-hidden="true" /> {d.diasDeAtraso} {d.diasDeAtraso === 1 ? 'dia' : 'dias'}</span>
                    )}
                  </td>
                  <td className="retorno-num">{reais(d.valorBoletoCentavos)}</td>
                  <td className="retorno-num">
                    {d.jurosMultaCentavos > 0 ? <strong className="retorno-juros">+ {reais(d.jurosMultaCentavos)}</strong> : <span className="retorno-zero">—</span>}
                    {d.descontoCentavos > 0 && <div className="retorno-desconto">− {reais(d.descontoCentavos)} desc.</div>}
                  </td>
                  <td className="retorno-num">
                    <strong>{reais(d.pagoCentavos)}</strong>
                    {d.tarifaCentavos > 0 && <div className="retorno-tarifa">tarifa − {reais(d.tarifaCentavos)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {deFora.length > 0 && (
          <ul className="retorno-de-fora" aria-label="O que fica de fora desta baixa">
            {deFora.map((texto) => <li key={texto}>{texto}</li>)}
          </ul>
        )}

        <footer className="retorno-rodape">
          <button type="button" className="retorno-botao retorno-botao--voltar" onClick={onCancelar}>Cancelar</button>
          <button type="button" ref={confirmarRef} className="retorno-botao retorno-botao--confirmar" onClick={onConfirmar}>
            Dar baixa em {totais.quantidade} {totais.quantidade === 1 ? 'boleto' : 'boletos'} · {reais(totais.pagoCentavos)}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};

export default ConferenciaRetornoModal;

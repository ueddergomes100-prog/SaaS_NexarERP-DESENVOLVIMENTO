import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, RotateCcw, X } from 'lucide-react';
import { NexusSwal, escaparHtml, showSuccess, showWarning } from '../../../utils/alerts';
import {
  MOTIVO_MINIMO_DEVOLUCAO,
  cfopDaDevolucaoDeCompra,
  lerPedidoDeDevolucaoCompra,
  planejarItensDaDevolucao,
  saldoParaDevolver,
  type ItemDaEntrada,
} from '../../../utils/devolucaoCompraDomain';
import {
  emitirNotaDaDevolucaoCompra,
  listarDevolucoesDaNota,
  registrarDevolucaoCompra,
  type DevolucaoCompraResumo,
} from '../../../services/devolucaoCompraService';

/**
 * Devolucao de compra ao fornecedor (21/10/2026): escolhe os itens e as
 * quantidades da nota de entrada, registra (estoque sai, a pagar e' abatido,
 * o que ja foi pago vira a receber do fornecedor) e emite a NF-e de devolucao.
 * Regra em devolucaoCompraDomain.ts; quem confere e grava e' o servidor.
 */

interface Props {
  aberto: boolean;
  nota: {
    id: string;
    numeroNF: string;
    fornecedorNome: string;
    itens: ItemDaEntrada[];
    devolvidoPorItem?: Record<string, number>;
  } | null;
  podeEmitir: boolean;
  onFechar: () => void;
  /** Depois de registrar: a lista recarrega a nota (saldo devolvido mudou). */
  onRegistrada: () => void;
}

const reais = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((centavos || 0) / 100);

const ROTULO_NOTA: Record<string, { texto: string; cor: string }> = {
  reservada: { texto: 'Enviando...', cor: '#f59e0b' },
  enqueued: { texto: 'Na fila da SEFAZ', cor: '#f59e0b' },
  processing: { texto: 'Processando', cor: '#f59e0b' },
  created: { texto: 'Processando', cor: '#f59e0b' },
  authorized: { texto: 'Autorizada', cor: '#10b981' },
  rejected: { texto: 'Rejeitada', cor: '#ef4444' },
  denied: { texto: 'Denegada', cor: '#ef4444' },
  canceled: { texto: 'Cancelada', cor: '#ef4444' },
};

const campo: React.CSSProperties = {
  padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '14px',
};

const DevolucaoCompraModal: React.FC<Props> = ({ aberto, nota, podeEmitir, onFechar, onRegistrada }) => {
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [emitindoId, setEmitindoId] = useState<string | null>(null);
  const [devolucoes, setDevolucoes] = useState<DevolucaoCompraResumo[]>([]);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    if (!nota) return;
    setCarregando(true);
    try {
      setDevolucoes(await listarDevolucoesDaNota(nota.id));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [nota]);

  useEffect(() => {
    if (!aberto) return;
    setQuantidades({});
    setMotivo('');
    setErro(null);
    void carregar();
  }, [aberto, carregar]);

  useEffect(() => {
    if (!aberto || gravando || emitindoId) return undefined;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, gravando, emitindoId, onFechar]);

  const pedidoItens = useMemo(() => Object.entries(quantidades)
    .map(([indice, q]) => ({ indice: Number(indice), quantidade: Number(String(q).replace(',', '.')) }))
    .filter((i) => i.quantidade > 0), [quantidades]);

  const previa = useMemo(() => (nota && pedidoItens.length > 0
    ? planejarItensDaDevolucao({ itens: nota.itens, pedido: pedidoItens, jaDevolvido: nota.devolvidoPorItem || {} })
    : null), [nota, pedidoItens]);

  if (!aberto || !nota) return null;

  const registrar = async () => {
    const lido = lerPedidoDeDevolucaoCompra({ notaEntradaId: nota.id, itens: pedidoItens, motivo });
    if ('erro' in lido) { setErro(lido.erro); return; }
    if (previa && 'erro' in previa) { setErro(previa.erro); return; }
    const total = previa && 'itens' in previa ? previa.totalCentavos : 0;
    const confirmacao = await NexusSwal.fire({
      icon: 'warning',
      title: 'Registrar a devolução?',
      html: `<p style="text-align:left;margin:0 0 8px">Devolver <strong>${reais(total)}</strong> a <strong>${escaparHtml(nota.fornecedorNome)}</strong>.</p>`
        + '<p style="text-align:left;margin:0">Os itens saem do estoque e o valor é abatido das parcelas em aberto desta nota; o que já foi pago vira uma conta a receber do fornecedor. Depois, emita a NF-e de devolução.</p>',
      showCancelButton: true,
      confirmButtonText: 'Registrar devolução',
      cancelButtonText: 'Voltar',
    });
    if (!confirmacao.isConfirmed) return;
    setErro(null);
    setGravando(true);
    try {
      const r = await registrarDevolucaoCompra(lido.pedido);
      showSuccess(r.aReceberCentavos > 0
        ? `Devolução registrada. ${reais(r.abatidoCentavos)} abatidos do a pagar e ${reais(r.aReceberCentavos)} a receber do fornecedor.`
        : `Devolução registrada. ${reais(r.abatidoCentavos)} abatidos do a pagar.`);
      setQuantidades({});
      setMotivo('');
      onRegistrada();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGravando(false);
    }
  };

  const emitir = async (d: DevolucaoCompraResumo) => {
    const confirmacao = await NexusSwal.fire({
      icon: 'question',
      title: 'Emitir a NF-e de devolução?',
      text: `A nota vai para a SEFAZ referenciando a NF-e nº ${nota.numeroNF} do fornecedor, no valor de ${reais(d.totalCentavos)}.`,
      showCancelButton: true,
      confirmButtonText: 'Emitir NF-e',
      cancelButtonText: 'Voltar',
    });
    if (!confirmacao.isConfirmed) return;
    setErro(null);
    setEmitindoId(d.id);
    try {
      const r = await emitirNotaDaDevolucaoCompra(d.id);
      if (r.status === 'rejected' || r.status === 'denied') showWarning(`A SEFAZ recusou a nota: ${r.mensagem || 'motivo não informado'}. Corrija e emita de novo.`);
      else showSuccess(`NF-e de devolução enviada${r.numero ? ` (nº ${r.numero})` : ''}. Acompanhe em Notas Fiscais.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEmitindoId(null);
    }
  };

  const totalPrevia = previa && 'itens' in previa ? previa.totalCentavos : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1250, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="dev-compra-titulo" className="card"
        style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '860px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <h2 id="dev-compra-titulo" style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>Devolver ao fornecedor — NF-e nº {nota.numeroNF}</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>{nota.fornecedorNome}</p>
          </div>
          <button type="button" onClick={onFechar} disabled={gravando || Boolean(emitindoId)} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '13px' }} data-sem-ajuste>
              <thead>
                <tr><th>Item</th><th style={{ textAlign: 'right' }}>Na nota</th><th style={{ textAlign: 'right' }}>Pode devolver</th><th style={{ width: '120px' }}>Devolver</th><th>CFOP</th></tr>
              </thead>
              <tbody>
                {nota.itens.map((item, indice) => {
                  const saldo = saldoParaDevolver(item, (nota.devolvidoPorItem || {})[String(indice)] || 0);
                  const cfop = cfopDaDevolucaoDeCompra(item.cfopEntrada, item.cfop);
                  const bloqueado = item.tipo === 'registro' || saldo <= 0 || !cfop;
                  const porque = item.tipo === 'registro' ? 'Entrou só como registro (sem estoque)'
                    : saldo <= 0 ? 'Já devolvido por inteiro'
                      : !cfop ? `CFOP ${item.cfopEntrada || item.cfop || '-'} não é de compra para revenda/industrialização` : '';
                  return (
                    <tr key={indice} style={{ opacity: bloqueado ? 0.6 : 1 }}>
                      <td>{item.descricaoXml || item.codigoXml}</td>
                      <td style={{ textAlign: 'right' }}>{item.quantidade} {item.unidadeNota || ''}</td>
                      <td style={{ textAlign: 'right' }}>{saldo}</td>
                      <td>
                        <input inputMode="decimal" aria-label={`Quantidade a devolver de ${item.descricaoXml || item.codigoXml}`}
                          value={quantidades[indice] ?? ''} disabled={bloqueado || gravando} title={porque || `Até ${saldo}`}
                          onChange={(e) => { setQuantidades((q) => ({ ...q, [indice]: e.target.value.replace(/[^\d.,]/g, '') })); setErro(null); }}
                          style={{ ...campo, width: '100%' }} />
                      </td>
                      <td style={{ color: cfop ? 'var(--text-primary)' : 'var(--text-muted)' }} title={porque}>{cfop || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <label htmlFor="dev-compra-motivo" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
              Motivo (mínimo {MOTIVO_MINIMO_DEVOLUCAO} caracteres)
            </label>
            <input id="dev-compra-motivo" value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(null); }} disabled={gravando}
              title='Ex.: "Mercadoria com defeito"' style={{ ...campo, width: '100%' }} />
          </div>

          {pedidoItens.length > 0 && (
            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
              Valor da devolução (com ST e IPI da nota): <strong>{reais(totalPrevia)}</strong>
            </div>
          )}

          {erro && (
            <div role="alert" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', color: 'var(--text-primary)', fontSize: '13px', lineHeight: 1.5 }}>{erro}</div>
          )}

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Devoluções desta nota</h3>
            {carregando ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Carregando...</p>
            ) : devolucoes.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Nenhuma devolução registrada.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {devolucoes.map((d) => {
                  const rotulo = d.notaFiscal ? ROTULO_NOTA[d.notaFiscal.status] || { texto: d.notaFiscal.status, cor: 'var(--text-muted)' } : { texto: 'Sem NF-e', cor: 'var(--text-muted)' };
                  const podeEmitirEsta = podeEmitir && (!d.notaFiscal || ['rejected', 'denied', 'canceled'].includes(d.notaFiscal.status));
                  return (
                    <li key={d.id} style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                          {d.data ? d.data.split('-').reverse().join('/') : ''} · {reais(d.totalCentavos)}
                        </strong>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: rotulo.cor }}>
                            {rotulo.texto}{d.notaFiscal?.numero ? ` nº ${d.notaFiscal.numero}` : ''}
                          </span>
                          {podeEmitirEsta && (
                            <button type="button" className="btn-primary" onClick={() => emitir(d)} disabled={Boolean(emitindoId)}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontSize: '12px' }}>
                              {emitindoId === d.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
                              {d.notaFiscal ? 'Emitir de novo' : 'Emitir NF-e'}
                            </button>
                          )}
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        {d.itens.map((i) => `${i.quantidade} ${i.unidade} ${i.nome}`).join('; ')} · {d.motivo}
                        {d.aReceberCentavos > 0 ? ` · ${reais(d.aReceberCentavos)} a receber do fornecedor` : ''}
                        {d.notaFiscal?.mensagem && ['rejected', 'denied'].includes(d.notaFiscal.status) ? ` · ${d.notaFiscal.mensagem}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-secondary" onClick={onFechar} disabled={gravando || Boolean(emitindoId)}>Fechar</button>
          <button type="button" className="btn-primary" onClick={registrar} disabled={gravando || pedidoItens.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {gravando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={16} />}
            {gravando ? 'Registrando...' : 'Registrar devolução'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DevolucaoCompraModal;

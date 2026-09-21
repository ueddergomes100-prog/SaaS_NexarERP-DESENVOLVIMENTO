import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { spedyService } from '../../services/spedyService';
import {
  devolucaoNfeService,
  type PreviaDevolucaoNfe,
} from '../../services/devolucaoNfeService';
import { useEmissaoAcompanhamento } from '../../hooks/useEmissaoAcompanhamento';
import { desfechoDoStatus } from '../../utils/emissaoProgressoDomain';
import EmissaoProgressoModal from './EmissaoProgressoModal';

/**
 * NF-e de devolucao de venda: mostra o que vai sair (itens, valores, CFOP, nota
 * original, avisos e o que impede), deixa escolher o que o sistema nao decide
 * sozinho (nota original quando ha mais de uma, CFOP sem mapa) e emite. A nota e'
 * montada no servidor -- ver server/services/devolucaoNfe.js.
 */

interface DevolucaoNfeModalProps {
  devolucaoId: string;
  numeroPedido?: string;
  onClose: () => void;
}

const moeda = (valor: number | null | undefined): string => (
  valor === null || valor === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
);

const formatarDocumento = (doc: string): string => {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
};

const formatarData = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('pt-BR');
};

const DevolucaoNfeModal: React.FC<DevolucaoNfeModalProps> = ({ devolucaoId, numeroPedido, onClose }) => {
  const { currentUser, tenantId } = useAuth();
  const [previa, setPrevia] = useState<PreviaDevolucaoNfe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [notaOriginalId, setNotaOriginalId] = useState('');
  const [cfopEscolhido, setCfopEscolhido] = useState<Record<number, number>>({});
  const [emitindo, setEmitindo] = useState(false);
  const [erroEmissao, setErroEmissao] = useState<string | null>(null);
  const { progresso, setProgresso, segundosEsperando, abrindoDanfe, fechar: fecharProgresso, abrirDanfe, acompanhar } = useEmissaoAcompanhamento();

  const chaveCfop = useMemo(() => JSON.stringify(cfopEscolhido), [cfopEscolhido]);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErroCarga(null);
    devolucaoNfeService.previa({ devolucaoId, notaOriginalId: notaOriginalId || undefined, cfopEscolhido })
      .then((resposta) => { if (!cancelado) setPrevia(resposta); })
      .catch((erro) => { if (!cancelado) setErroCarga((erro as Error).message); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
    // cfopEscolhido entra por `chaveCfop` (o objeto muda de identidade a cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devolucaoId, notaOriginalId, chaveCfop]);

  const emitir = async () => {
    if (!previa?.ok || emitindo) return;
    setErroEmissao(null);
    setEmitindo(true);
    const clienteNome = previa.destinatario?.nome ?? '';

    // Mesma conferencia da emissao normal: ambiente, serie, certificado...
    try {
      const requisitos = await spedyService.getRequisitos();
      const bloqueios = requisitos.nfe.checks.filter((c) => c.gravidade === 'bloqueio');
      if (bloqueios.length > 0) {
        setErroEmissao(`Faltam itens para emitir a NF-e:\n${bloqueios.map((c) => `• ${c.mensagem} ${c.comoResolver}`.trim()).join('\n')}`);
        setEmitindo(false);
        return;
      }
    } catch (erro) {
      console.error('Nao foi possivel conferir os requisitos fiscais (a emissao segue):', erro);
    }

    setProgresso({ tipo: 'NF-e', clienteNome, etapa: 'enviando', desfecho: null });
    try {
      const resultado = await devolucaoNfeService.emitir({ devolucaoId, notaOriginalId: notaOriginalId || undefined, cfopEscolhido });
      const desfechoImediato = desfechoDoStatus(resultado.nota.status);
      setProgresso({
        tipo: 'NF-e',
        clienteNome,
        etapa: 'transmitindo',
        desfecho: desfechoImediato,
        numero: resultado.nota.number,
        codigo: resultado.nota.processingDetail?.code ?? null,
        mensagem: resultado.nota.processingDetail?.message ?? null,
        spedyId: resultado.nota.id,
        transmitindoDesdeMs: Date.now(),
      });
      if (!desfechoImediato) {
        void acompanhar({
          docId: resultado.notaId,
          spedyId: resultado.nota.id,
          tipo: 'NF-e',
          statusInicial: resultado.nota.status,
          consultar: (tipo, spedyId) => spedyService.getInvoice(tipo === 'NFS-e' ? 'service' : tipo === 'NFC-e' ? 'consumer' : 'product', spedyId),
        });
      }
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser?.uid || '',
          usuarioEmail: currentUser?.email || '',
          modulo: 'fiscal',
          acao: 'emissao_devolucao',
          descricao: `NF-e de devolução enviada${numeroPedido ? ` para o pedido #${numeroPedido}` : ''} no valor de ${moeda(previa.valorTotal)}.`,
          registroRelacionadoId: resultado.notaId,
          status: 'sucesso',
          critical: true,
        });
      } catch {
        // auditoria nao pode derrubar a emissao
      }
    } catch (erro) {
      setProgresso((atual) => (atual ? { ...atual, desfecho: 'falha_envio', erroEnvio: (erro as Error).message } : atual));
    } finally {
      setEmitindo(false);
    }
  };

  const fecharTudo = () => {
    fecharProgresso();
    onClose();
  };

  // Enquanto o pop-up de acompanhamento esta na tela, a previa some.
  const previaVisivel = progresso === null;
  const temErros = (previa?.erros.length ?? 0) > 0;
  const precisaEscolherNota = (previa?.candidatas.length ?? 0) > 1 && !previa?.notaOriginal;
  const cfopPendente = (previa?.precisaCfop ?? []).some((item) => !cfopEscolhido[item.itemNumber]);

  return (
    <>
      {previaVisivel && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1250, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="devolucao-nfe-titulo"
            className="card"
            style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '760px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
          >
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div>
                <h2 id="devolucao-nfe-titulo" style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  NF-e de devolução{numeroPedido ? ` — Pedido #${numeroPedido}` : ''}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Nota de entrada que referencia a nota da venda, item por item.
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={emitindo} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>

            <div style={{ padding: '18px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {carregando && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '14px' }}>
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Conferindo a nota original e montando a devolução...
                </div>
              )}

              {erroCarga && (
                <div role="alert" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', color: 'var(--text-primary)', fontSize: '14px', lineHeight: 1.5 }}>
                  {erroCarga}
                </div>
              )}

              {previa && !carregando && (
                <>
                  {previa.notaOriginal && (
                    <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                      <div><strong>Nota original:</strong> {previa.notaOriginal.tipo}{previa.notaOriginal.numero ? ` Nº ${previa.notaOriginal.numero}` : ''}{previa.notaOriginal.data ? ` — ${formatarData(previa.notaOriginal.data)}` : ''}</div>
                      {previa.notaOriginal.chave && <div style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>Chave: {previa.notaOriginal.chave}</div>}
                      {previa.destinatario && <div><strong>Quem devolve:</strong> {previa.destinatario.nome} ({formatarDocumento(previa.destinatario.documento)})</div>}
                    </div>
                  )}

                  {precisaEscolherNota && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label htmlFor="nota-original" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Qual nota está sendo devolvida?</label>
                      <select id="nota-original" value={notaOriginalId} onChange={(e) => setNotaOriginalId(e.target.value)} style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
                        <option value="">Selecione...</option>
                        {previa.candidatas.map((n) => (
                          <option key={n.id} value={n.id}>{n.tipo}{n.numero ? ` Nº ${n.numero}` : ''}{n.data ? ` — ${formatarData(n.data)}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {previa.precisaCfop.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b' }}>
                      <strong style={{ fontSize: '13px', color: '#f59e0b' }}>Escolha o CFOP da devolução</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>O CFOP da venda destes itens não tem devolução automática. Confirme com seu contador qual usar.</span>
                      {previa.precisaCfop.map((item) => (
                        <div key={item.itemNumber} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '13px' }}>
                          <span style={{ flex: 1, minWidth: '180px', color: 'var(--text-primary)' }}>{item.nome} <span style={{ color: 'var(--text-muted)' }}>(venda CFOP {item.cfopOriginal ?? '—'})</span></span>
                          <select
                            value={cfopEscolhido[item.itemNumber] ?? ''}
                            onChange={(e) => setCfopEscolhido((atual) => {
                              const proximo = { ...atual };
                              if (e.target.value) proximo[item.itemNumber] = Number(e.target.value); else delete proximo[item.itemNumber];
                              return proximo;
                            })}
                            style={{ padding: '8px 10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                          >
                            <option value="">CFOP...</option>
                            {previa.cfopsPermitidos.map((cfop) => <option key={cfop} value={cfop}>{cfop}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  {temErros && (
                    <div role="alert" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <strong style={{ fontSize: '13px', color: '#ef4444' }}>{previa.erros.length > 1 ? 'O que impede a emissão' : 'Não dá para emitir ainda'}</strong>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                        {previa.erros.map((erro) => <li key={erro}>{erro}</li>)}
                      </ul>
                    </div>
                  )}

                  {previa.avisos.map((aviso) => (
                    <div key={aviso} style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', display: 'flex', gap: '10px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>{aviso}</span>
                    </div>
                  ))}

                  {previa.itens.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                            <th style={{ padding: '8px' }}>Item</th>
                            <th style={{ padding: '8px' }}>Descrição</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Qtd</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Valor</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>CFOP</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>ICMS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previa.itens.map((item) => (
                            <tr key={item.itemNumber} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                              <td style={{ padding: '8px' }}>{item.itemNumber}</td>
                              <td style={{ padding: '8px' }}>{item.descricao}</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>{item.quantidade} {item.unidade}</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>{moeda(item.valorTotal)}</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>{item.cfop}</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>{moeda(item.icmsValor)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                            <td colSpan={3} style={{ padding: '8px', textAlign: 'right' }}>Total da devolução</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{moeda(previa.valorTotal)}</td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                      <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        A tributação espelha a da nota original, proporcional à quantidade devolvida (mesmos CST e alíquotas). Se seu contador usa outro tratamento de PIS/COFINS na devolução, confirme com ele antes da primeira emissão.
                      </p>
                    </div>
                  )}

                  {erroEmissao && (
                    <div role="alert" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', color: 'var(--text-primary)', fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                      {erroEmissao}
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={emitindo}>Fechar</button>
              <button
                type="button"
                className="btn-primary"
                onClick={emitir}
                disabled={!previa?.ok || carregando || emitindo || cfopPendente}
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                {emitindo && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
                Emitir NF-e de devolução
              </button>
            </div>
          </div>
        </div>
      )}

      <EmissaoProgressoModal
        aberto={progresso !== null}
        tipo={progresso?.tipo ?? 'NF-e'}
        clienteNome={progresso?.clienteNome ?? ''}
        etapa={progresso?.etapa ?? 'validando'}
        desfecho={progresso?.desfecho ?? null}
        numero={progresso?.numero}
        codigo={progresso?.codigo}
        mensagem={progresso?.mensagem}
        erroEnvio={progresso?.erroEnvio}
        segundosEsperando={segundosEsperando}
        abrindoDanfe={abrindoDanfe}
        onAbrirDanfe={abrirDanfe}
        onFechar={fecharTudo}
      />
    </>
  );
};

export default DevolucaoNfeModal;

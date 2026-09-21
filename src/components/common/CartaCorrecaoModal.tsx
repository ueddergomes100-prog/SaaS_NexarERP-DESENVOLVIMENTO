import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileText, Loader2, X, XCircle } from 'lucide-react';
import {
  CARTA_MAX_CARACTERES,
  CARTA_MAX_POR_NOTA,
  CARTA_MIN_CARACTERES,
  CARTA_NAO_PODE_CORRIGIR,
  CARTA_PODE_CORRIGIR,
  cartasMaisNovasPrimeiro,
  erroDoTextoCarta,
  normalizarTextoCarta,
  type CartaEnviada,
} from '../../utils/cartaCorrecaoDomain';

/**
 * Carta de correcao (CC-e) de uma NF-e autorizada: explica o que pode e o que
 * nao pode ser corrigido, recebe o texto, envia e mostra o historico das
 * cartas da nota (com PDF/XML de cada uma). A regra esta em
 * cartaCorrecaoDomain.ts (e, valendo de verdade, no servidor).
 */

interface CartaCorrecaoModalProps {
  aberto: boolean;
  notaNumero: number | null;
  clienteNome: string;
  cartas: CartaEnviada[];
  /** Mensagem de por que a nota nao aceita mais carta (null = aceita). */
  impedimento: string | null;
  /** Envia o texto ja normalizado. Rejeita com Error de mensagem em portugues. */
  onEnviar: (texto: string) => Promise<void>;
  onBaixar: (eventId: string, tipo: 'pdf' | 'xml') => Promise<void>;
  onFechar: () => void;
}

const formatarDataHora = (iso: string): string => {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const CartaCorrecaoModal: React.FC<CartaCorrecaoModalProps> = ({
  aberto, notaNumero, clienteNome, cartas, impedimento, onEnviar, onBaixar, onFechar,
}) => {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setTexto('');
      setErro(null);
    }
  }, [aberto]);

  useEffect(() => {
    if (!aberto || enviando) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, enviando, onFechar]);

  if (!aberto) return null;

  const tamanho = normalizarTextoCarta(texto).length;
  const fora = tamanho > CARTA_MAX_CARACTERES;

  const enviar = async () => {
    const erroTexto = erroDoTextoCarta(texto);
    if (erroTexto) {
      setErro(erroTexto);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await onEnviar(normalizarTextoCarta(texto));
      setTexto('');
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível enviar a carta. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  };

  const baixar = async (eventId: string, tipo: 'pdf' | 'xml') => {
    setBaixando(`${eventId}-${tipo}`);
    try {
      await onBaixar(eventId, tipo);
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível baixar o arquivo da carta.');
    } finally {
      setBaixando(null);
    }
  };

  const lista = cartasMaisNovasPrimeiro(cartas);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1250, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="carta-correcao-titulo"
        className="card"
        style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '680px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
      >
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h2 id="carta-correcao-titulo" style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Carta de correção — NF-e{notaNumero ? ` Nº ${notaNumero}` : ''}
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>{clienteNome}</p>
          </div>
          <button type="button" onClick={onFechar} disabled={enviando} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '18px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(16,185,129,0.4)' }}>
              <strong style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={16} /> A carta pode corrigir</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                {CARTA_PODE_CORRIGIR.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(239,68,68,0.4)' }}>
              <strong style={{ fontSize: '13px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}><XCircle size={16} /> A carta NÃO pode corrigir</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                {CARTA_NAO_PODE_CORRIGIR.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Para o que a carta não corrige: cancele a nota (o prazo geral é de 24 horas após a autorização, e varia por estado) e emita outra, ou emita uma nota de devolução. Cada nota aceita até {CARTA_MAX_POR_NOTA} cartas, e uma carta enviada não pode ser apagada.
          </p>

          {impedimento ? (
            <div role="alert" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: 'var(--text-primary)', fontSize: '14px', lineHeight: 1.5 }}>
              {impedimento}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="carta-texto" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Texto da carta (de {CARTA_MIN_CARACTERES} a {CARTA_MAX_CARACTERES} caracteres)
              </label>
              <textarea
                id="carta-texto"
                value={texto}
                onChange={(evento) => { setTexto(evento.target.value); if (erro) setErro(null); }}
                rows={5}
                disabled={enviando}
                placeholder="Ex.: Onde se lê 'Transportadora Alfa', leia 'Transportadora Beta Ltda'. Demais dados permanecem inalterados."
                style={{ padding: '12px 14px', backgroundColor: 'var(--bg-tertiary)', border: `1px solid ${fora ? '#ef4444' : 'var(--border-color)'}`, borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '14px', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: fora ? '#ef4444' : 'var(--text-muted)' }}>
                <span>{tamanho < CARTA_MIN_CARACTERES ? `Faltam ${CARTA_MIN_CARACTERES - tamanho} caracteres para o mínimo` : 'Tamanho ok'}</span>
                <span>{tamanho}/{CARTA_MAX_CARACTERES}</span>
              </div>
            </div>
          )}

          {erro && (
            <div role="alert" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', color: 'var(--text-primary)', fontSize: '13px', lineHeight: 1.5 }}>
              {erro}
            </div>
          )}

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Cartas enviadas ({lista.length})</h3>
            {lista.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Nenhuma carta enviada para esta nota ainda.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {lista.map((carta, indice) => (
                  <li key={carta.eventId ?? `${carta.enviadaEm}-${indice}`} style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span>{formatarDataHora(carta.enviadaEm)}{carta.enviadaPorEmail ? ` · ${carta.enviadaPorEmail}` : ''}</span>
                      <span>Carta nº {lista.length - indice}</span>
                    </div>
                    <p style={{ margin: '6px 0', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{carta.texto}</p>
                    {carta.eventId && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {(['pdf', 'xml'] as const).map((tipo) => (
                          <button
                            key={tipo}
                            type="button"
                            className="btn-secondary"
                            onClick={() => baixar(carta.eventId as string, tipo)}
                            disabled={baixando !== null}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontSize: '12px' }}
                          >
                            {baixando === `${carta.eventId}-${tipo}` ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
                            {tipo.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-secondary" onClick={onFechar} disabled={enviando}>Fechar</button>
          {!impedimento && (
            <button type="button" className="btn-primary" onClick={enviar} disabled={enviando || tamanho === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {enviando && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
              {enviando ? 'Enviando...' : 'Enviar carta à SEFAZ'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CartaCorrecaoModal;

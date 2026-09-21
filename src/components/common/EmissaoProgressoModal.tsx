import React, { useEffect } from 'react';
import { CheckCircle2, Circle, ExternalLink, Loader2, XCircle } from 'lucide-react';
import {
  ETAPAS_EMISSAO,
  orgaoAutorizador,
  rotuloDaEtapa,
  situacaoDaEtapa,
  textoDoDesfecho,
  type DesfechoEmissao,
  type EtapaEmissao,
  type SituacaoEtapa,
} from '../../utils/emissaoProgressoDomain';

/**
 * Pop-up de acompanhamento da emissao de nota: mostra em que etapa a nota
 * esta (validando, enviando, transmitindo) e, no fim, se foi autorizada ou
 * rejeitada. A regra de etapas/textos esta em emissaoProgressoDomain.ts; quem
 * consulta a Spedy e' o NFE.tsx.
 */

interface EmissaoProgressoModalProps {
  aberto: boolean;
  tipo: string;
  clienteNome: string;
  etapa: EtapaEmissao;
  /** null enquanto a emissao ainda esta rodando. */
  desfecho: DesfechoEmissao | null;
  numero?: number | string | null;
  codigo?: string | null;
  mensagem?: string | null;
  erroEnvio?: string | null;
  /** Segundos esperando a SEFAZ -- so' aparece na etapa de transmissao. */
  segundosEsperando?: number;
  abrindoDanfe?: boolean;
  onAbrirDanfe?: () => void;
  onFechar: () => void;
}

const COR_SUCESSO = '#10b981';
const COR_ERRO = '#ef4444';
const COR_ALERTA = '#f59e0b';

const IconeEtapa: React.FC<{ situacao: SituacaoEtapa }> = ({ situacao }) => {
  if (situacao === 'feita') return <CheckCircle2 size={22} color={COR_SUCESSO} aria-hidden="true" />;
  if (situacao === 'erro') return <XCircle size={22} color={COR_ERRO} aria-hidden="true" />;
  if (situacao === 'andamento') {
    return <Loader2 size={22} color="var(--accent-purple, #8b5cf6)" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />;
  }
  return <Circle size={22} color="var(--text-muted)" aria-hidden="true" style={{ opacity: 0.5 }} />;
};

const EmissaoProgressoModal: React.FC<EmissaoProgressoModalProps> = ({
  aberto, tipo, clienteNome, etapa, desfecho, numero, codigo, mensagem, erroEnvio,
  segundosEsperando = 0, abrindoDanfe = false, onAbrirDanfe, onFechar,
}) => {
  const terminou = desfecho !== null;
  // Enviar pra Spedy nao da' pra cancelar no meio; esperar a SEFAZ da' (a nota
  // segue la e a lista atualiza sozinha).
  const podeFechar = terminou || etapa === 'transmitindo';

  useEffect(() => {
    if (!aberto || !podeFechar) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, podeFechar, onFechar]);

  if (!aberto) return null;

  const texto = terminou ? textoDoDesfecho({ desfecho, tipo, numero, codigo, mensagem, erroEnvio }) : null;
  const corDestaque = desfecho === 'autorizada' ? COR_SUCESSO
    : desfecho === 'demorando' ? COR_ALERTA
      : terminou ? COR_ERRO : 'var(--accent-purple, #8b5cf6)';

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1300,
        backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="emissao-progresso-titulo"
        className="card"
        style={{
          backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '460px',
          overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', border: `1px solid ${terminou ? corDestaque : 'var(--border-color)'}`,
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
          <h2 id="emissao-progresso-titulo" style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            {texto ? texto.titulo : `Emitindo ${tipo}`}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            {clienteNome}
          </p>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-live="polite">
            {ETAPAS_EMISSAO.map((item) => {
              const situacao = situacaoDaEtapa(item.id, etapa, desfecho);
              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px',
                    color: situacao === 'pendente' ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontWeight: situacao === 'andamento' || situacao === 'erro' ? 600 : 400,
                  }}
                >
                  <IconeEtapa situacao={situacao} />
                  <span>{rotuloDaEtapa(item.id, tipo)}</span>
                  {item.id === 'transmitindo' && situacao === 'andamento' && (
                    <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400 }}>
                      {segundosEsperando}s
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {!terminou && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {etapa === 'transmitindo'
                ? `A nota já foi enviada e está esperando a resposta da ${orgaoAutorizador(tipo)}. Costuma levar alguns segundos.`
                : 'Não feche esta janela nem emita de novo: estamos enviando a nota.'}
            </p>
          )}

          {texto && (
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: `1px solid ${corDestaque}`, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{texto.detalhe}</p>
              {texto.orientacao && (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{texto.orientacao}</p>
              )}
            </div>
          )}
        </div>

        {podeFechar && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: 'var(--bg-primary)' }}>
            {desfecho === 'autorizada' && onAbrirDanfe && (
              <button type="button" className="btn-secondary" onClick={onAbrirDanfe} disabled={abrindoDanfe} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {abrindoDanfe ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <ExternalLink size={16} />}
                Ver / Imprimir DANFE
              </button>
            )}
            <button type="button" className="btn-primary" onClick={onFechar} autoFocus>
              {terminou ? 'Fechar' : 'Fechar e acompanhar na lista'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmissaoProgressoModal;

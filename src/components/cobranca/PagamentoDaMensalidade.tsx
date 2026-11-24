import React from 'react';
import { Copy, ExternalLink, MessageCircle, Printer } from 'lucide-react';
import { showSuccess, showWarning } from '../../utils/alerts';
import { formatarData, formatarLinhaDigitavel, formatarMoeda, rotuloCompetencia, type ResumoDaCobranca } from '../../utils/mensalidadeDomain';

/**
 * Como pagar a mensalidade (24/11/2026): valor, vencimento e o boleto que o
 * suporte anexou (PDF para imprimir, linha digitavel, link e Pix), mais o
 * contato. Usado na janela do aviso e na tela de bloqueio.
 */

const copiar = async (texto: string, oQue: string) => {
  try {
    await navigator.clipboard.writeText(texto);
    showSuccess(`${oQue} copiada.`);
  } catch {
    showWarning(`Não foi possível copiar a ${oQue.toLowerCase()}`, 'Selecione o texto e copie com Ctrl+C.');
  }
};

const whatsappDoSuporte = (numero: string): string => (numero.startsWith('55') && numero.length >= 12 ? numero : `55${numero}`);

const botao: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' };

const PagamentoDaMensalidade: React.FC<{ resumo: ResumoDaCobranca }> = ({ resumo }) => {
  const { boleto, contato } = resumo;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'left' }}>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Valor{resumo.quantidadeEmAberto > 1 ? ' em aberto' : ''}</div>
          <div style={{ fontSize: '22px', fontWeight: 800 }}>{formatarMoeda(resumo.valorEmAberto)}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Vencimento</div>
          <div style={{ fontSize: '22px', fontWeight: 800 }}>{formatarData(resumo.vencimento)}</div>
        </div>
        {resumo.competencia && (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Referente a</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '4px', textTransform: 'capitalize' }}>{rotuloCompetencia(resumo.competencia)}</div>
          </div>
        )}
      </div>

      {boleto ? (
        <>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {boleto.pdfUrl && (
              <a className="btn-primary" href={boleto.pdfUrl} target="_blank" rel="noopener noreferrer" style={botao}>
                <Printer size={16} /> Imprimir boleto
              </a>
            )}
            {boleto.link && (
              <a className="btn-secondary" href={boleto.link} target="_blank" rel="noopener noreferrer" style={botao}>
                <ExternalLink size={16} /> Pagar pelo link
              </a>
            )}
          </div>
          {boleto.linhaDigitavel && (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>Linha digitável</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontSize: '14px', padding: '8px 10px', borderRadius: '6px', backgroundColor: 'var(--bg-tertiary)', userSelect: 'all', wordBreak: 'break-all' }}>
                  {formatarLinhaDigitavel(boleto.linhaDigitavel)}
                </code>
                <button type="button" className="btn-secondary" onClick={() => { void copiar(boleto.linhaDigitavel || '', 'Linha digitável'); }} style={botao}>
                  <Copy size={15} /> Copiar
                </button>
              </div>
            </div>
          )}
          {boleto.pixCopiaECola && (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>Pix copia e cola</div>
              <button type="button" className="btn-secondary" onClick={() => { void copiar(boleto.pixCopiaECola || '', 'Chave Pix'); }} style={botao}>
                <Copy size={15} /> Copiar o Pix
              </button>
            </div>
          )}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: '14px', color: '#f59e0b', fontWeight: 600 }}>
          O boleto desta mensalidade ainda não foi anexado. Fale com o suporte para recebê-lo.
        </p>
      )}

      {contato && (contato.whatsapp || contato.email) && (
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Já pagou ou tem dúvida? Fale com {contato.nome || 'o suporte'}:</span>
          {contato.whatsapp && (
            <a href={`https://wa.me/${whatsappDoSuporte(contato.whatsapp)}`} target="_blank" rel="noopener noreferrer" style={{ ...botao, color: '#10b981', fontWeight: 600 }}>
              <MessageCircle size={15} /> WhatsApp
            </a>
          )}
          {contato.email && <a href={`mailto:${contato.email}`} style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>{contato.email}</a>}
        </div>
      )}
    </div>
  );
};

export default PagamentoDaMensalidade;

import React, { useEffect, useState } from 'react';
import { FileCheck2, X } from 'lucide-react';
import { showError } from '../../utils/alerts';
import { buildChequeDetails, type ChequeDetails } from '../../utils/financeDomain';

/**
 * "Quadradinho" de digitação de cheque -- inspirado na tela "Digitação de
 * Cheque" do sistema antigo (Banco, Agência, Titular, Emitente, CPF/CNPJ,
 * Nº Cheque, Valor, Vencimento). Usado em três lugares: PaymentsEditor.tsx
 * (venda/OS), PDV/components/PaymentModal.tsx e ContasReceber.tsx (baixa
 * de título em cheque) -- mesmo componente, pra não ter três telas de
 * cheque com campos ligeiramente diferentes.
 *
 * A validação de verdade (banco emissor/número/data obrigatórios) é a
 * mesma de buildChequeDetails em financeDomain.ts -- chamada aqui pra dar
 * o erro na hora, em vez de só no fim da venda.
 */

export interface ChequeCaptureModalValores {
  bancoEmissor: string;
  agencia: string;
  titular: string;
  emitente: string;
  documentoEmitente: string;
  numeroCheque: string;
  dataCompensacao: string;
}

interface ChequeCaptureModalProps {
  aberto: boolean;
  valorSugerido: number;
  dataMinima: string;
  valoresIniciais?: Partial<ChequeCaptureModalValores>;
  onConfirmar: (dados: ChequeDetails) => void;
  onFechar: () => void;
}

const valoresVazios: ChequeCaptureModalValores = {
  bancoEmissor: '',
  agencia: '',
  titular: '',
  emitente: '',
  documentoEmitente: '',
  numeroCheque: '',
  dataCompensacao: '',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 14px',
  color: 'var(--text-primary)',
};

const ChequeCaptureModal: React.FC<ChequeCaptureModalProps> = ({
  aberto, valorSugerido, dataMinima, valoresIniciais, onConfirmar, onFechar,
}) => {
  const [valores, setValores] = useState<ChequeCaptureModalValores>({ ...valoresVazios, ...valoresIniciais });

  useEffect(() => {
    if (aberto) setValores({ ...valoresVazios, ...valoresIniciais, dataCompensacao: valoresIniciais?.dataCompensacao || dataMinima });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  if (!aberto) return null;

  const atualizar = (patch: Partial<ChequeCaptureModalValores>) => setValores((atual) => ({ ...atual, ...patch }));

  const confirmar = () => {
    try {
      const dados = buildChequeDetails({
        bancoEmissor: valores.bancoEmissor,
        numeroCheque: valores.numeroCheque,
        dataCompensacao: valores.dataCompensacao,
        agencia: valores.agencia,
        titular: valores.titular,
        emitente: valores.emitente,
        documentoEmitente: valores.documentoEmitente,
      });
      onConfirmar(dados);
    } catch (error) {
      showError('Dados do cheque incompletos', error instanceof Error ? error.message : 'Confira os dados do cheque.');
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}
    >
      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '540px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCheck2 size={20} color="var(--accent-purple)" />
            Digitação de Cheque
          </h2>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Banco emissor *</label>
              <input type="text" value={valores.bancoEmissor} onChange={(e) => atualizar({ bancoEmissor: e.target.value })} placeholder="Ex: Banco do Brasil" style={inputStyle} />
            </div>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Agência</label>
              <input type="text" value={valores.agencia} onChange={(e) => atualizar({ agencia: e.target.value })} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Titular</label>
              <input type="text" value={valores.titular} onChange={(e) => atualizar({ titular: e.target.value })} style={inputStyle} />
            </div>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Emitente</label>
              <input type="text" value={valores.emitente} onChange={(e) => atualizar({ emitente: e.target.value })} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CPF/CNPJ do emitente</label>
              <input type="text" value={valores.documentoEmitente} onChange={(e) => atualizar({ documentoEmitente: e.target.value.replace(/\D/g, '') })} style={inputStyle} />
            </div>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nº do cheque *</label>
              <input type="text" value={valores.numeroCheque} onChange={(e) => atualizar({ numeroCheque: e.target.value })} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor do cheque</label>
              <input type="text" value={`R$ ${valorSugerido.toFixed(2)}`} disabled style={{ ...inputStyle, opacity: 0.7 }} />
            </div>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data de compensação *</label>
              <input type="date" min={dataMinima} value={valores.dataCompensacao} onChange={(e) => atualizar({ dataCompensacao: e.target.value })} style={inputStyle} />
            </div>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            O valor só entra no saldo do banco quando o cheque for compensado, em Financeiro → Cheques -- não na hora da venda.
          </p>
        </div>

        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button className="btn-secondary" onClick={onFechar}>Cancelar</button>
          <button className="btn-primary" onClick={confirmar}>Confirmar cheque</button>
        </div>
      </div>
    </div>
  );
};

export default ChequeCaptureModal;

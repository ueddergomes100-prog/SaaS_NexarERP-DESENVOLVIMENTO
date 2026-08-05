import React, { useEffect, useState } from 'react';
import { Banknote, X } from 'lucide-react';
import { currency, fromCurrencyInput } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';

interface SangriaModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (valorCentavos: number, motivo: string) => void | Promise<void>;
}

const MOTIVOS_PADRAO = [
  'Sangria para depósito',
  'Troco para outro caixa',
  'Pagamento a fornecedor',
  'Retirada do proprietário',
  'Outro',
];

const SangriaModal: React.FC<SangriaModalProps> = ({ open, onClose, onConfirm }) => {
  const [value, setValue] = useState('');
  const [motivoSelecionado, setMotivoSelecionado] = useState(MOTIVOS_PADRAO[0]);
  const [motivoLivre, setMotivoLivre] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue('');
      setMotivoSelecionado(MOTIVOS_PADRAO[0]);
      setMotivoLivre('');
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const valorCentavos = fromCurrencyInput(value);
  const motivoFinal = motivoSelecionado === 'Outro' ? motivoLivre.trim() : motivoSelecionado;
  const podeConfirmar = valorCentavos > 0 && motivoFinal.length > 0 && !saving;

  const confirmar = async () => {
    if (!podeConfirmar) return;
    setSaving(true);
    await onConfirm(valorCentavos, motivoFinal);
    setSaving(false);
    onClose();
  };

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal pdv-small-modal" role="dialog" aria-modal="true" aria-label="Sangria de caixa">
        <div className="pdv-modal-header">
          <div>
            <h2>Sangria</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar">
            <X size={20} />
          </button>
        </div>

        <label className="pdv-modal-field">
          <span>Valor retirado</span>
          <input
            autoFocus
            value={value}
            inputMode="decimal"
            onChange={(event) => setValue(event.target.value)}
          />
        </label>

        <label className="pdv-modal-field">
          <span>Motivo</span>
          <select value={motivoSelecionado} onChange={(event) => setMotivoSelecionado(event.target.value)}>
            {MOTIVOS_PADRAO.map((motivo) => (
              <option key={motivo} value={motivo}>{motivo}</option>
            ))}
          </select>
        </label>

        {motivoSelecionado === 'Outro' && (
          <label className="pdv-modal-field">
            <span>Descreva o motivo</span>
            <input
              autoFocus
              value={motivoLivre}
              onChange={(event) => setMotivoLivre(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmar();
              }}
            />
          </label>
        )}

        <div className="pdv-discount-preview">
          <span>Valor da sangria</span>
          <strong>{currency.format(fromCents(valorCentavos))}</strong>
        </div>

        <button type="button" className="btn-primary pdv-modal-submit" disabled={!podeConfirmar} onClick={confirmar}>
          <Banknote size={18} />
          {saving ? 'Registrando...' : 'Confirmar sangria'}
        </button>
      </div>
    </div>
  );
};

export default React.memo(SangriaModal);

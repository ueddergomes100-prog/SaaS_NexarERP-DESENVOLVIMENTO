import React, { useEffect, useState } from 'react';
import { PlusCircle, X } from 'lucide-react';
import { currency, fromCurrencyInput } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';
import { aplicarCaixaAltaCadastro } from '../../../utils/textoCadastroDomain';

/**
 * SUPRIMENTO (27/11/2026, pedido do dono): dinheiro que ENTRA na gaveta sem ser
 * venda -- reforco de troco, dinheiro trazido do cofre. O contrario da sangria:
 * soma no esperado do fechamento e aparece nos relatorios do caixa.
 */
interface SuprimentoModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (valorCentavos: number, motivo: string) => void | Promise<void>;
}

const MOTIVOS_PADRAO = [
  'Reforço de troco',
  'Dinheiro do cofre',
  'Troco de outro caixa',
  'Outro',
];

const SuprimentoModal: React.FC<SuprimentoModalProps> = ({ open, onClose, onConfirm }) => {
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
      <div className="pdv-modal pdv-small-modal" role="dialog" aria-modal="true" aria-label="Suprimento de caixa">
        <div className="pdv-modal-header">
          <div>
            <h2>Suprimento</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar">
            <X size={20} />
          </button>
        </div>

        <label className="pdv-modal-field">
          <span>Valor colocado na gaveta</span>
          <input
            autoFocus
            value={value}
            inputMode="decimal"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && motivoSelecionado !== 'Outro') void confirmar(); }}
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
              onChange={(event) => setMotivoLivre(aplicarCaixaAltaCadastro(event.target, event.target.value))}
              onKeyDown={(event) => { if (event.key === 'Enter') void confirmar(); }}
            />
          </label>
        )}

        <div className="pdv-discount-preview">
          <span>Valor do suprimento</span>
          <strong>{currency.format(fromCents(valorCentavos))}</strong>
        </div>

        <button type="button" className="btn-primary pdv-modal-submit" disabled={!podeConfirmar} onClick={() => void confirmar()}>
          <PlusCircle size={18} />
          {saving ? 'Registrando...' : 'Confirmar suprimento'}
        </button>
      </div>
    </div>
  );
};

export default React.memo(SuprimentoModal);

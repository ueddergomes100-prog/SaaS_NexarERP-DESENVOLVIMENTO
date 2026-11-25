import React, { useState } from 'react';
import { FileCheck2, Loader2 } from 'lucide-react';
import { notaAvulsaChequesService, type ChequeDaCarteira } from '../../services/notaAvulsaChequesService';
import { showError } from '../../utils/alerts';

/*
 * "PAGAR COM CHEQUE DE CLIENTE" NA NOTA AVULSA (25/11/2026, Embala Minas).
 *
 * Lista os cheques recebidos que estao na carteira (Financeiro > Cheques) e a
 * pessoa marca quais vao para o fornecedor. Os cheques nao podem passar do
 * valor da nota (decisao do dono); o que faltar se paga com a forma de baixo.
 * Ao lancar a nota, o servidor repassa: cheque "Repassado a <fornecedor>",
 * titulo do cliente pago, sem entrar em banco.
 */

interface Props {
  escolhidos: ChequeDaCarteira[];
  onEscolhidos: (cheques: ChequeDaCarteira[]) => void;
  valorDaNota: number;
}

const moeda = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

const ChequesDeClienteNaNota: React.FC<Props> = ({ escolhidos, onEscolhidos, valorDaNota }) => {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [carteira, setCarteira] = useState<ChequeDaCarteira[]>([]);
  const totalCentavos = escolhidos.reduce((s, c) => s + c.centavos, 0);
  const passou = totalCentavos > Math.round(valorDaNota * 100);

  const abrir = async () => {
    setAberto(true);
    setCarregando(true);
    try {
      setCarteira((await notaAvulsaChequesService.naCarteira()).cheques);
    } catch (erro) {
      showError('Não foi possível listar os cheques da carteira', erro instanceof Error ? erro.message : 'Tente de novo.');
      setAberto(false);
    } finally {
      setCarregando(false);
    }
  };

  const alternar = (c: ChequeDaCarteira) => {
    onEscolhidos(escolhidos.some((x) => x.id === c.id) ? escolhidos.filter((x) => x.id !== c.id) : [...escolhidos, c]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}><FileCheck2 size={18} /> Cheques de clientes (carteira)</span>
        {!aberto && (
          <button type="button" className="btn-secondary" onClick={() => void abrir()} style={{ fontSize: '13px', padding: '6px 12px' }}>
            {escolhidos.length ? 'Mudar os cheques' : 'Pagar com cheque de cliente'}
          </button>
        )}
      </div>
      {aberto && (
        carregando ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}><Loader2 size={15} className="spin-icon" /> Buscando os cheques…</div>
        ) : carteira.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum cheque de cliente na carteira agora.</p>
        ) : (
          <div className="table-wrapper" style={{ maxHeight: '260px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th style={{ width: '36px' }} aria-label="Marcar" /><th>Nº</th><th>Cliente</th><th>Bom para</th><th style={{ textAlign: 'right' }}>Valor</th></tr>
              </thead>
              <tbody>
                {carteira.map((c) => (
                  <tr key={c.id} onClick={() => alternar(c)} style={{ cursor: 'pointer' }}>
                    <td><input type="checkbox" checked={escolhidos.some((x) => x.id === c.id)} onChange={() => alternar(c)} onClick={(e) => e.stopPropagation()} aria-label={`Usar o cheque ${c.numeroCheque}`} /></td>
                    <td>{c.numeroCheque || '—'}{c.bancoEmissor ? <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}> · banco {c.bancoEmissor}</span> : null}</td>
                    <td>{c.clienteNome || '—'}</td>
                    <td>{dataBr(c.bomPara)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(c.centavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {escolhidos.length > 0 && (
        <div style={{ fontSize: '13px', color: passou ? '#ef4444' : 'var(--text-secondary)', fontWeight: passou ? 600 : 400 }}>
          {escolhidos.length} cheque(s): {moeda(totalCentavos)}.{' '}
          {passou
            ? `Passa do valor da nota (${moeda(Math.round(valorDaNota * 100))}): desmarque algum cheque.`
            : `Falta pagar ${moeda(Math.round(valorDaNota * 100) - totalCentavos)} pela forma abaixo. Ao lançar, os cheques saem da carteira como repassados ao fornecedor.`}
        </div>
      )}
      {aberto && !carregando && (
        <button type="button" onClick={() => setAberto(false)} style={{ fontSize: '12px', color: 'var(--accent-purple)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, width: 'fit-content' }}>
          Fechar a lista
        </button>
      )}
    </div>
  );
};

export default ChequesDeClienteNaNota;

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { fromCents } from '../../utils/financeDomain';
import { formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import type { ComposicaoDaGaveta } from '../../utils/gavetaDinheiroDomain';

/**
 * O QUE COMPOE O "ESPERADO AGORA" (pedido do dono, 24/11/2026, Embala Minas):
 * "clicar na setinha do lado do Fechar caixa e aparecer as vendas ali, pra ver
 * certinho o que compoe o valor". Um bloco por dia (decisao do dono: separar
 * por dia); os dias anteriores comecam fechados, hoje aberto. A soma das
 * linhas e' o esperado.
 */

const moeda = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(centavos));

const hora = (iso: string): string => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
};

interface Props {
  composicao: ComposicaoDaGaveta;
  /** "Esperado agora" ou "Saldo da gaveta". */
  rotuloTotal: string;
  /** Frase curta abaixo do titulo (de onde vem a conta). */
  explicacao: string;
}

const ComposicaoDoEsperado: React.FC<Props> = ({ composicao, rotuloTotal, explicacao }) => {
  const hoje = getDateInputInTimeZone();
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const aberto = (data: string) => abertos[data] ?? (data === hoje || composicao.dias.length === 1);
  const alternar = (data: string) => setAbertos((atual) => ({ ...atual, [data]: !aberto(data) }));
  const celula: React.CSSProperties = { padding: '6px 8px' };

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '13px', fontWeight: 700 }}>
        <ListChecks size={16} color="#6366f1" /> O que compõe o {rotuloTotal.toLowerCase()}
      </div>
      <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>{explicacao}</p>
      <table className="data-table" style={{ width: '100%' }}>
        <tbody>
          {composicao.saldoAnteriorCentavos !== 0 && (
            <tr>
              <td colSpan={3} style={{ ...celula, fontWeight: 600 }}>Vinha de antes de {formatDateInputPtBr(composicao.inicio)}</td>
              <td style={{ ...celula, textAlign: 'right', fontWeight: 600 }}>{moeda(composicao.saldoAnteriorCentavos)}</td>
            </tr>
          )}
          {composicao.dias.map((dia) => (
            <React.Fragment key={dia.data}>
              <tr style={{ cursor: 'pointer', backgroundColor: 'var(--bg-secondary)' }} onClick={() => alternar(dia.data)}>
                <td colSpan={3} style={{ ...celula, fontWeight: 600 }}>
                  <button
                    type="button"
                    aria-expanded={aberto(dia.data)}
                    onClick={(e) => { e.stopPropagation(); alternar(dia.data); }}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {aberto(dia.data) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {dia.data === hoje ? `Hoje (${formatDateInputPtBr(dia.data)})` : `Veio de ${formatDateInputPtBr(dia.data)}`}
                  </button>
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '8px', fontSize: '12px' }}>
                    entrou {moeda(dia.entradasCentavos)} · saiu {moeda(dia.saidasCentavos)} · {dia.movimentos.length} {dia.movimentos.length === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                </td>
                <td style={{ ...celula, textAlign: 'right', fontWeight: 600 }}>{moeda(dia.liquidoCentavos)}</td>
              </tr>
              {aberto(dia.data) && dia.movimentos.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...celula, color: 'var(--text-muted)', width: '64px' }}>{hora(m.criadoEmIso)}</td>
                  <td style={celula}>{m.descricao}</td>
                  <td style={{ ...celula, color: 'var(--text-muted)' }}>{m.clienteNome || ''}</td>
                  <td style={{ ...celula, textAlign: 'right', color: m.direcao === 'credito' ? '#10b981' : '#ef4444', whiteSpace: 'nowrap' }}>
                    {m.direcao === 'credito' ? '+' : '−'} {moeda(m.valorCentavos)}
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          {composicao.dias.length === 0 && composicao.saldoAnteriorCentavos === 0 && (
            <tr><td colSpan={4} style={{ ...celula, color: 'var(--text-muted)' }}>Nenhum dinheiro entrou ou saiu ainda.</td></tr>
          )}
          <tr style={{ borderTop: '2px solid var(--border-color)' }}>
            <td colSpan={3} style={{ ...celula, fontWeight: 700 }}>{rotuloTotal}</td>
            <td style={{ ...celula, textAlign: 'right', fontWeight: 700 }}>{moeda(composicao.saldoCentavos)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default ComposicaoDoEsperado;

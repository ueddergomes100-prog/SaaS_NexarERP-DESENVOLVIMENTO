import React from 'react';
import { AlertTriangle, CheckCircle, Calculator } from 'lucide-react';
import type { NotaParseada } from '../../../utils/nfeXmlDomain';
import type { ConferenciaDaNota, OpcoesDeCustoDeEntrada } from '../../../utils/custoEntradaDomain';
import { cartaoStyle, grupoStyle, moeda, tituloDoCartaoStyle } from './estilos';

interface TotaisDaNotaCardProps {
  nota: NotaParseada;
  conferencia: ConferenciaDaNota;
  opcoes: OpcoesDeCustoDeEntrada;
  onOpcoes: (opcoes: OpcoesDeCustoDeEntrada) => void;
  rotuloDoRegime: string;
  divergenciaAceita: boolean;
  onAceitarDivergencia: (aceita: boolean) => void;
}

const Valor: React.FC<{ rotulo: string; valor: number; destaque?: boolean }> = ({ rotulo, valor, destaque }) => (
  <div style={{ minWidth: '120px' }}>
    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{rotulo}</div>
    <div style={{ fontSize: destaque ? '16px' : '13px', fontWeight: destaque ? 700 : 600, color: 'var(--text-primary)' }}>{moeda(valor)}</div>
  </div>
);

/** Totais da nota, conferencia (soma que fecha) e como os impostos entram no custo. */
const TotaisDaNotaCard: React.FC<TotaisDaNotaCardProps> = ({ nota, conferencia, opcoes, onOpcoes, rotuloDoRegime, divergenciaAceita, onAceitarDivergencia }) => {
  const t = nota.totais;
  return (
    <div className="card" style={cartaoStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <Calculator size={18} color="var(--accent-purple)" />
        <h3 style={tituloDoCartaoStyle}>Totais e conferência</h3>
        {conferencia.ok ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#10b981', fontWeight: 700 }}><CheckCircle size={14} /> Nota conferida: os valores fecham</span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#f59e0b', fontWeight: 700 }}><AlertTriangle size={14} /> Divergência</span>
        )}
      </div>

      <div style={{ ...grupoStyle, display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
        <Valor rotulo="Produtos" valor={t.produtos} />
        <Valor rotulo="Frete" valor={t.frete} />
        <Valor rotulo="Seguro" valor={t.seguro} />
        <Valor rotulo="Outras despesas" valor={t.outrasDespesas} />
        <Valor rotulo="Desconto" valor={t.desconto} />
        <Valor rotulo="IPI" valor={t.ipi} />
        <Valor rotulo="ICMS-ST" valor={t.st} />
        <Valor rotulo="Base ICMS" valor={t.baseIcms} />
        <Valor rotulo="ICMS" valor={t.icms} />
        <Valor rotulo="PIS" valor={t.pis} />
        <Valor rotulo="COFINS" valor={t.cofins} />
        <Valor rotulo="Total da nota" valor={t.total} destaque />
      </div>

      {!conferencia.ok && (
        <div role="alert" style={{ marginTop: '12px', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '13px', lineHeight: 1.5 }}>
          {conferencia.avisos.map((aviso) => <div key={aviso}>{aviso}</div>)}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={divergenciaAceita} onChange={(e) => onAceitarDivergencia(e.target.checked)} />
            Conferi e quero lançar mesmo assim
          </label>
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <div style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '6px' }}>Impostos no custo</div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
          O custo de cada item soma frete, seguro, outras despesas, IPI e ICMS-ST e desconta o desconto da nota. Impostos recuperáveis só saem do custo se a sua empresa os aproveita
          (regime atual: <strong>{rotuloDoRegime}</strong>). Em caso de dúvida, confirme com o seu contador.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={opcoes.creditarIcms} onChange={(e) => onOpcoes({ ...opcoes, creditarIcms: e.target.checked })} />
          Descontar o crédito de ICMS ({moeda(t.icms)}) do custo
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', marginTop: '4px' }}>
          <input type="checkbox" checked={opcoes.creditarPisCofins} onChange={(e) => onOpcoes({ ...opcoes, creditarPisCofins: e.target.checked })} />
          Descontar o crédito de PIS e COFINS ({moeda(t.pis + t.cofins)}) do custo
        </label>
      </div>
    </div>
  );
};

export default TotaisDaNotaCard;

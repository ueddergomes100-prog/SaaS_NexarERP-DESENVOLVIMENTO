import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ClientAutocomplete from '../common/ClientAutocomplete';
import CampoDecimal from '../common/CampoDecimal';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import {
  MODALIDADES_FRETE,
  ROTULO_MODALIDADE_FRETE,
  UFS_BRASIL,
  modalidadeEfetiva,
  normalizarPlaca,
  temTransporte,
  type ModalidadeFrete,
  type TransporteDoPedido,
} from '../../utils/transporteNotaDomain';

/**
 * TRANSPORTE DO PEDIDO (27/10/2026, pedido do dono): tudo o que a NF-e leva
 * no grupo de transporte -- modalidade do frete, transportadora (fornecedor do
 * tipo Transportadora), placa e volumes. Fica recolhido dentro de "Frete e
 * Encargos"; abre sozinho quando ja' tem algo preenchido. Regra em
 * src/utils/transporteNotaDomain.ts.
 */

interface Props {
  tenantId: string | null | undefined;
  transporte: TransporteDoPedido;
  frete: number;
  disabled?: boolean;
  onChange: (t: TransporteDoPedido) => void;
}

const campo: React.CSSProperties = {
  width: '100%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', fontSize: '13px',
};
const rotulo: React.CSSProperties = { fontSize: '12px', color: 'var(--text-secondary)' };

const TransporteDoPedidoPanel: React.FC<Props> = ({ tenantId, transporte, frete, disabled, onChange }) => {
  const [aberto, setAberto] = useState(() => temTransporte(transporte));
  const [busca, setBusca] = useState(transporte.transportadoraNome);
  const { items: fornecedores } = useTenantCollection<{ id: string; nome?: string; codigo?: string; tipo?: string; ativo?: boolean }>('fornecedores', aberto ? tenantId : null);
  const mudar = (m: Partial<TransporteDoPedido>) => onChange({ ...transporte, ...m });
  const mudarVolumes = (m: Partial<TransporteDoPedido['volumes']>) => onChange({ ...transporte, volumes: { ...transporte.volumes, ...m } });
  const numeroDe = (v: string) => {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const efetiva = modalidadeEfetiva(transporte, frete);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', padding: 0, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left' }}
        title="Modalidade do frete, transportadora, placa e volumes que vão para a nota fiscal"
      >
        {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Transporte (nota fiscal)
        {!aberto && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {ROTULO_MODALIDADE_FRETE[efetiva]}{transporte.transportadoraNome ? ` · ${transporte.transportadoraNome}` : ''}</span>}
      </button>

      {aberto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={rotulo}>Quem paga o frete</span>
            <select
              value={transporte.modalidade}
              disabled={disabled}
              onChange={(e) => mudar({ modalidade: e.target.value as ModalidadeFrete | '' })}
              style={campo}
            >
              <option value="">Automático — {ROTULO_MODALIDADE_FRETE[modalidadeEfetiva({ ...transporte, modalidade: '' }, frete)]}</option>
              {MODALIDADES_FRETE.map((m) => <option key={m} value={m}>{ROTULO_MODALIDADE_FRETE[m]}</option>)}
            </select>
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={rotulo}>Transportadora</span>
            {disabled ? (
              <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{transporte.transportadoraNome || '—'}</span>
            ) : (
              <ClientAutocomplete
                value={busca}
                onChange={(valor) => {
                  setBusca(valor);
                  if (!valor.trim()) mudar({ transportadoraId: '', transportadoraNome: '' });
                }}
                clients={fornecedores.filter((f) => f.ativo !== false)}
                onSelect={(f) => {
                  const nome = String(f.nome || '').trim();
                  mudar({ transportadoraId: f.id, transportadoraNome: nome });
                  setBusca(nome);
                }}
                renderItem={(f: { id: string; nome?: string; codigo?: string | null; tipo?: string }) => (
                  <span>
                    {f.codigo ? `${f.codigo} · ${f.nome}` : f.nome}
                    {f.tipo === 'Transportadora' && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--accent-purple)', fontWeight: 700 }}>TRANSPORTADORA</span>}
                  </span>
                )}
                placeholder="Buscar…"
                ariaLabel="Buscar transportadora"
                emptyHint={<span>Não achou? Cadastre em Cadastros &gt; Fornecedores com o tipo <strong>Transportadora</strong>.</span>}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '8px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Placa do veículo</span>
              <input value={transporte.placa} disabled={disabled} onChange={(e) => mudar({ placa: normalizarPlaca(e.target.value) })} title="ABC1234 ou ABC1D23 (opcional)" style={{ ...campo, textTransform: 'uppercase' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>UF</span>
              <select value={transporte.placaUf} disabled={disabled} onChange={(e) => mudar({ placaUf: e.target.value })} style={campo}>
                <option value="">—</option>
                {UFS_BRASIL.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Volumes (qtd.)</span>
              <input inputMode="numeric" value={transporte.volumes.quantidade || ''} disabled={disabled} onChange={(e) => mudarVolumes({ quantidade: Math.floor(numeroDe(e.target.value)) })} style={campo} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Espécie</span>
              <input value={transporte.volumes.especie} disabled={disabled} onChange={(e) => mudarVolumes({ especie: e.target.value.toUpperCase() })} title="Ex.: CAIXA, FARDO, SACO" style={campo} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Marca</span>
              <input value={transporte.volumes.marca} disabled={disabled} onChange={(e) => mudarVolumes({ marca: e.target.value.toUpperCase() })} style={campo} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Numeração</span>
              <input value={transporte.volumes.numeracao} disabled={disabled} onChange={(e) => mudarVolumes({ numeracao: e.target.value })} title="Ex.: 1 a 5" style={campo} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Peso bruto (kg)</span>
              <CampoDecimal valor={transporte.volumes.pesoBrutoKg} disabled={disabled} onValor={(n) => mudarVolumes({ pesoBrutoKg: n })} style={campo} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={rotulo}>Peso líquido (kg)</span>
              <CampoDecimal valor={transporte.volumes.pesoLiquidoKg} disabled={disabled} onValor={(n) => mudarVolumes({ pesoLiquidoKg: n })} style={campo} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransporteDoPedidoPanel;

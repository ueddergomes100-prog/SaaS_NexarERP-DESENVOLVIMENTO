import React, { useState } from 'react';
import { Blocks, Loader2, Save, X } from 'lucide-react';
import { MODULE_GROUPS, MODULO_PAI, moduleLabelMap, modulosBloqueadosEfetivos } from '../../utils/moduleCatalog';
import { salvarModulosBloqueados } from '../../services/plataformaService';
import { showError, showSuccess } from '../../utils/alerts';

interface Props {
  tenantId: string;
  tenantNome: string;
  bloqueados: string[];
  onSalvo: (bloqueados: string[]) => void;
  onFechar: () => void;
}

/**
 * Modulos do plano direto pelo SuperAdmin (28/10/2026, pedido do dono): antes
 * era preciso entrar no sistema da empresa e ir em Configuracoes. O servidor
 * grava na empresa e em todas as filiais dela.
 */
const ModulosDaEmpresaModal: React.FC<Props> = ({ tenantId, tenantNome, bloqueados, onSalvo, onFechar }) => {
  // Bloqueio com id fora do catalogo (ex.: "fiscal", "logs", de versoes antigas)
  // nao bloqueia tela nenhuma; sai ao salvar e a tela avisa.
  const antigos = bloqueados.filter((id) => !moduleLabelMap[id]);
  const [rascunho, setRascunho] = useState<string[]>(() => bloqueados.filter((id) => moduleLabelMap[id]));
  const [salvando, setSalvando] = useState(false);

  const alternar = (id: string) => setRascunho((atual) => (atual.includes(id) ? atual.filter((m) => m !== id) : [...atual, id]));

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarModulosBloqueados(tenantId, rascunho);
      onSalvo(r.modulosBloqueados);
      showSuccess(r.filiais > 0
        ? `Módulos de ${tenantNome} salvos, junto com ${r.filiais === 1 ? 'a filial' : `as ${r.filiais} filiais`}.`
        : `Módulos de ${tenantNome} salvos.`);
      onFechar();
    } catch (erro) {
      showError('Não foi possível salvar os módulos', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const total = MODULE_GROUPS.reduce((soma, g) => soma + g.items.length, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card" style={{ padding: 0, backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '980px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <Blocks size={20} color="var(--accent-purple)" />
            Módulos — {tenantNome}
          </h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Ligado = a empresa usa o módulo. Desligado bloqueia a tela para o dono e os funcionários, na matriz e nas filiais.
            {' '}<strong style={{ color: 'var(--text-primary)' }}>{total - modulosBloqueadosEfetivos(rascunho).length} de {total}</strong> ligados.
          </p>
          {antigos.length > 0 && (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              {antigos.length === 1
                ? `Esta empresa tem um bloqueio antigo (${antigos[0]}) que não bloqueia tela nenhuma. Ao salvar, ele sai da lista.`
                : `Esta empresa tem ${antigos.length} bloqueios antigos (${antigos.join(', ')}) que não bloqueiam tela nenhuma. Ao salvar, eles saem da lista.`}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            {MODULE_GROUPS.map((grupo) => (
              <div key={grupo.group} style={{ padding: '14px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--accent-purple)', textTransform: 'uppercase', fontWeight: 700 }}>{grupo.group}</h4>
                {grupo.items.map((item) => {
                  const pai = MODULO_PAI[item.id];
                  const paiBloqueado = Boolean(pai && rascunho.includes(pai));
                  const ligado = !rascunho.includes(item.id) && !paiBloqueado;
                  const travado = salvando || paiBloqueado;
                  return (
                    <label
                      key={item.id}
                      title={paiBloqueado ? `Desligado junto com "${moduleLabelMap[pai]}". Ligue aquele primeiro.` : undefined}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 0', paddingLeft: pai ? '14px' : 0, cursor: travado ? 'not-allowed' : 'pointer', borderTop: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <span style={{ fontSize: '13px', color: ligado ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: ligado ? 600 : 400 }}>
                        {pai ? '↳ ' : ''}{item.label}
                      </span>
                      <span style={{ position: 'relative', width: '40px', height: '22px', borderRadius: '999px', backgroundColor: ligado ? 'var(--accent-purple)' : 'var(--bg-primary)', border: `1px solid ${ligado ? 'var(--accent-purple)' : 'var(--border-color)'}`, flexShrink: 0, opacity: paiBloqueado ? 0.5 : 1 }}>
                        <span style={{ position: 'absolute', top: '2px', left: ligado ? '20px' : '2px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: ligado ? '#fff' : 'var(--text-muted)', transition: 'left 0.2s ease' }} />
                      </span>
                      <input type="checkbox" checked={ligado} disabled={travado} onChange={() => alternar(item.id)} style={{ display: 'none' }} />
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={() => { void salvar(); }} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: salvando ? 0.7 : 1 }}>
            {salvando ? <Loader2 size={16} className="spin-animation" /> : <Save size={16} />}
            {salvando ? 'Salvando...' : 'Salvar módulos'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModulosDaEmpresaModal;

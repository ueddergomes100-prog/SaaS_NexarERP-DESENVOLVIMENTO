import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ClipboardList, Tractor, UserRound, Wrench } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { useModoOficina } from '../../hooks/useModoOficina';
import { showError, showSuccess } from '../../utils/alerts';
import type { SearchableClient } from '../../utils/clientSearch';
import { validarIdentificacaoEquipamento } from '../../utils/oficinaDomain';
import { EQUIPAMENTO_CAMPO_VAZIO, descricaoDoEquipamento, equipamentoDoCadastro, type EquipamentoCampo } from '../../utils/osCampoDomain';
import { abrirOsNoCampo } from '../../services/osCampoService';
import VendedorHeader from './VendedorHeader';
import VendedorSeletorCliente from './VendedorSeletorCliente';
import type { ClienteConfirmavel } from './VendedorConfirmarClienteModal';
import { podeAbrirOsNoApp } from './vendedorPermissoes';

/*
 * NOVA OS NO CAMPO (app do tecnico, fase 3 -- 2026-10-08).
 *
 * Igual ao talao de papel: cliente, equipamento (um dos cadastrados do
 * cliente ou um novo digitado na hora) e a reclamacao. Abre a OS ja' "Em
 * atendimento" e cai direto na tela de atendimento. O equipamento novo
 * tambem entra no cadastro do cliente, para a proxima visita.
 */

interface ClienteVendedor extends SearchableClient, ClienteConfirmavel {
  id: string;
  nome: string;
  telefone?: string;
}

interface VeiculoDoCliente {
  id: string;
  clienteId?: string;
  placa?: string;
  modelo?: string;
  marca?: string;
  ano?: string;
  cor?: string;
  frota?: string;
  serie?: string;
  horimetro?: number;
  tipoEquipamento?: string;
  ativo?: boolean;
}

const cardStyle: React.CSSProperties = { padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' };
const tituloSecao: React.CSSProperties = { fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' };
const campo: React.CSSProperties = { width: '100%', height: '44px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '0 12px', boxSizing: 'border-box', fontSize: '15px' };
const rotulo: React.CSSProperties = { fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' };

const VendedorOsNova: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser, userNome, userPermissions, userRole, isOwner } = useAuth();
  const { modo, rotulos, configMaquinas } = useModoOficina();
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);
  const { items: veiculos } = useTenantCollection<VeiculoDoCliente>('veiculos', tenantId);
  const [cliente, setCliente] = useState<ClienteVendedor | null>(null);
  const [equipamentoId, setEquipamentoId] = useState<string>('');
  const [equipamento, setEquipamento] = useState<EquipamentoCampo>(EQUIPAMENTO_CAMPO_VAZIO);
  const [reclamacao, setReclamacao] = useState('');
  const [abrindo, setAbrindo] = useState(false);

  if (!podeAbrirOsNoApp(userRole, isOwner, userPermissions)) {
    return <Navigate to="/vendedor" replace />;
  }

  const clientesAtivos = clientes.filter((c) => (c as { ativo?: boolean }).ativo !== false);
  const equipamentosDoCliente = cliente ? veiculos.filter((v) => v.clienteId === cliente.id && v.ativo !== false) : [];
  const equipamentoNovo = equipamentoId === 'novo';
  const maquinas = modo === 'maquinas_pesadas';

  const escolherEquipamento = (v: VeiculoDoCliente) => {
    setEquipamentoId(v.id);
    setEquipamento(equipamentoDoCadastro(v));
  };

  const editar = (parte: Partial<EquipamentoCampo>) => setEquipamento((atual) => ({ ...atual, ...parte }));

  const abrir = async () => {
    if (!tenantId || !currentUser) return;
    if (!cliente) {
      showError('Escolha o cliente', 'Busque o cliente pelo nome ou código. Se ele ainda não existe, cadastre em Clientes antes de abrir a OS.');
      return;
    }
    if (!equipamentoId) {
      showError(`Escolha o ${rotulos.veiculo.toLowerCase()}`, `Toque em um ${rotulos.veiculo.toLowerCase()} do cliente ou em "Outro / novo" para digitar os dados.`);
      return;
    }
    if (equipamentoNovo && !equipamento.modelo.trim()) {
      showError('Modelo do equipamento', 'Informe pelo menos o modelo (ex.: TL75, D6, Strada).');
      return;
    }
    const identificacao = validarIdentificacaoEquipamento(modo, equipamento);
    if (!identificacao.ok) {
      showError(`Identificação do ${rotulos.veiculo.toLowerCase()}`, identificacao.erro);
      return;
    }
    if (!reclamacao.trim()) {
      showError('Reclamação do cliente', 'Escreva o que o cliente relatou — é isso que sai no talão e orienta o serviço.');
      return;
    }
    setAbrindo(true);
    try {
      const { id, numeroOS } = await abrirOsNoCampo({
        tenantId,
        usuario: { id: currentUser.uid, nome: userNome || currentUser.displayName || 'Técnico', email: currentUser.email || '' },
        cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone || cliente.celular || '' },
        equipamento: { ...equipamento, placa: equipamento.placa.toUpperCase(), serie: equipamento.serie.toUpperCase() },
        salvarEquipamentoNoCadastro: equipamentoNovo,
        reclamacao,
      });
      showSuccess(`OS #${numeroOS} aberta. Agora é só lançar o atendimento.`);
      navigate(`/vendedor/os/${id}/atender`, { replace: true });
    } catch (erro) {
      showError('Não foi possível abrir a OS', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setAbrindo(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Nova OS" aoVoltar={() => navigate('/vendedor/os')} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <section style={cardStyle}>
          <div style={tituloSecao}><UserRound size={15} /> Cliente</div>
          {cliente ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{cliente.nome}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{[cliente.codigo ? `cód. ${cliente.codigo}` : '', cliente.telefone || cliente.celular].filter(Boolean).join(' · ')}</div>
              </div>
              <button type="button" className="btn-secondary" onClick={() => { setCliente(null); setEquipamentoId(''); setEquipamento(EQUIPAMENTO_CAMPO_VAZIO); }} style={{ height: '38px' }}>Trocar</button>
            </div>
          ) : (
            <VendedorSeletorCliente clientes={clientesAtivos} onConfirmar={(c) => { setCliente(c); setEquipamentoId(''); setEquipamento(EQUIPAMENTO_CAMPO_VAZIO); }} />
          )}
        </section>

        {cliente && (
          <section style={cardStyle}>
            <div style={tituloSecao}>{maquinas ? <Tractor size={15} /> : <Wrench size={15} />} {rotulos.veiculo}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: equipamentoId ? '12px' : 0 }}>
              {equipamentosDoCliente.map((v) => {
                const ativo = equipamentoId === v.id;
                return (
                  <button key={v.id} type="button" onClick={() => escolherEquipamento(v)}
                    style={{ padding: '10px 14px', borderRadius: '12px', border: `1px solid ${ativo ? 'var(--brand-500, #7c3aed)' : 'var(--border-color)'}`, backgroundColor: ativo ? 'rgba(124,58,237,0.16)' : 'var(--bg-tertiary)', color: 'var(--text-primary)', fontWeight: 600, fontSize: '14px', textAlign: 'left' }}>
                    {descricaoDoEquipamento(modo, v)}
                  </button>
                );
              })}
              <button type="button" onClick={() => { setEquipamentoId('novo'); setEquipamento(EQUIPAMENTO_CAMPO_VAZIO); }}
                style={{ padding: '10px 14px', borderRadius: '12px', border: `1px dashed ${equipamentoNovo ? 'var(--brand-500, #7c3aed)' : 'var(--border-color)'}`, backgroundColor: equipamentoNovo ? 'rgba(124,58,237,0.16)' : 'transparent', color: 'var(--text-primary)', fontWeight: 600, fontSize: '14px' }}>
                {equipamentosDoCliente.length === 0 ? `Cadastrar ${rotulos.veiculo.toLowerCase()}` : 'Outro / novo'}
              </button>
            </div>
            {equipamentoId && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ flex: '1 1 100%' }}>
                  <label style={rotulo}>Modelo{equipamentoNovo ? ' *' : ''}</label>
                  <input type="text" value={equipamento.modelo} onChange={(e) => editar({ modelo: e.target.value })} readOnly={!equipamentoNovo} style={campo} />
                </div>
                <div style={{ flex: '1 1 45%' }}>
                  <label style={rotulo}>Marca</label>
                  <input type="text" value={equipamento.marca} onChange={(e) => editar({ marca: e.target.value })} readOnly={!equipamentoNovo} style={campo} />
                </div>
                <div style={{ flex: '1 1 45%' }}>
                  <label style={rotulo}>{maquinas ? rotulos.placa : 'Placa *'}</label>
                  <input type="text" value={equipamento.placa} onChange={(e) => editar({ placa: e.target.value.toUpperCase() })} readOnly={!equipamentoNovo} style={{ ...campo, textTransform: 'uppercase' }} />
                </div>
                {maquinas && (
                  <>
                    <div style={{ flex: '1 1 45%' }}>
                      <label style={rotulo}>Nº de frota</label>
                      <input type="text" value={equipamento.frota} onChange={(e) => editar({ frota: e.target.value })} readOnly={!equipamentoNovo} style={campo} />
                    </div>
                    <div style={{ flex: '1 1 45%' }}>
                      <label style={rotulo}>Série / Chassi</label>
                      <input type="text" value={equipamento.serie} onChange={(e) => editar({ serie: e.target.value.toUpperCase() })} readOnly={!equipamentoNovo} style={{ ...campo, textTransform: 'uppercase' }} />
                    </div>
                    <div style={{ flex: '1 1 45%' }}>
                      <label style={rotulo}>Tipo</label>
                      <select value={equipamento.tipoEquipamento} onChange={(e) => editar({ tipoEquipamento: e.target.value })} disabled={!equipamentoNovo} style={campo}>
                        <option value="">Não informado</option>
                        {configMaquinas.tiposEquipamento.map((t) => <option key={t} value={t}>{t}</option>)}
                        {equipamento.tipoEquipamento && !configMaquinas.tiposEquipamento.includes(equipamento.tipoEquipamento) && <option value={equipamento.tipoEquipamento}>{equipamento.tipoEquipamento}</option>}
                      </select>
                    </div>
                    <div style={{ flex: '1 1 45%' }}>
                      <label style={rotulo}>Horímetro (h)</label>
                      <input type="number" inputMode="decimal" step="0.1" min="0" value={equipamento.horimetro} onChange={(e) => editar({ horimetro: e.target.value })} style={campo} />
                    </div>
                  </>
                )}
                {!maquinas && (
                  <div>
                    <label style={rotulo}>Ano</label>
                    <input type="text" value={equipamento.ano} onChange={(e) => editar({ ano: e.target.value })} readOnly={!equipamentoNovo} style={campo} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section style={cardStyle}>
          <div style={tituloSecao}><ClipboardList size={15} /> {rotulos.defeito}</div>
          <textarea
            value={reclamacao}
            onChange={(e) => setReclamacao(e.target.value)}
            rows={4}
            placeholder={rotulos.defeitoPlaceholder}
            style={{ ...campo, height: 'auto', padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit' }}
          />
        </section>
      </div>
      <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button type="button" className="btn-primary" onClick={() => void abrir()} disabled={abrindo} style={{ width: '100%', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '16px' }}>
          <Wrench size={18} /> {abrindo ? 'Abrindo…' : 'Abrir OS e atender'}
        </button>
      </div>
    </div>
  );
};

export default VendedorOsNova;

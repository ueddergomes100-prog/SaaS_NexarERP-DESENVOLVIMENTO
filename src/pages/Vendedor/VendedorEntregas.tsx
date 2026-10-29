import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ChevronRight, Truck } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { podeUsarEntregasNoApp } from './vendedorPermissoes';
import { lerRomaneio } from '../../services/romaneioService';
import { resumoDoRomaneio, type Romaneio } from '../../utils/romaneioDomain';
import { comOrigem, useVoltarPara } from './navegacaoApp';
import { rotaEhDoMotorista, useMotoristaVinculado, veTodasAsRotas } from './entregasDoMotorista';

/*
 * ENTREGAS NO APP DO MOTORISTA (2026-10-08): as rotas EM ANDAMENTO.
 *
 * "Minhas" = rotas em que o motorista e' este usuario (o cadastro do
 * motorista e' motoristas/{uid}, criado por "Este funcionario e' motorista"
 * no usuario). "Todas" = as outras rotas em andamento da empresa, so' para
 * dono e gestor (28/10/2026: motorista ve so' as dele, igual as vendas do
 * app -- entregasDoMotorista.ts). A rota fechada pela loja some daqui.
 *
 * onSnapshot de proposito: com o cache persistente do app, a lista abre sem
 * sinal e atualiza sozinha quando a loja libera uma rota nova.
 */

export type RotaDoApp = Romaneio & { id: string };

export const tituloDaRota = (rota: Pick<Romaneio, 'numero' | 'nome'>): string => (
  `Rota ${String(rota.numero || '').padStart(2, '0')}${rota.nome ? ` · ${rota.nome}` : ''}`
);

export const dataCurta = (iso: string): string => {
  const [ano, mes, dia] = String(iso || '').split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : '';
};

const formatarMoeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorEntregas: React.FC = () => {
  const navigate = useNavigate();
  const voltarPara = useVoltarPara();
  const { tenantId, currentUser, userRole, isOwner, userPermissions } = useAuth();
  const pode = podeUsarEntregasNoApp(userRole, isOwner, userPermissions);
  const [aba, setAba] = useState<'minhas' | 'todas'>('minhas');
  const [rotas, setRotas] = useState<RotaDoApp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  // Motorista ja' cadastrado vinculado ao login (26/10/2026): as rotas dele usam o
  // id do cadastro de motorista, gravado em usuarios/{uid}.motoristaId.
  const { motoristaVinculado, carregado: vinculoCarregado } = useMotoristaVinculado(currentUser?.uid);
  // 28/10/2026 (dono): cada motorista ve so' as dele; "Todas" so' para dono e gestor.
  const veTodas = veTodasAsRotas(userRole, isOwner);
  const uid = currentUser?.uid || '';

  useEffect(() => {
    if (!tenantId || !pode) return;
    // 29/10/2026: as rules so' entregam ao motorista as rotas dele, entao a consulta
    // dele vai por motoristaId (o login e o motorista vinculado); dono e gestor leem todas.
    if (!veTodas && !vinculoCarregado) return;
    const base = [where('tenantId', '==', tenantId), where('status', '==', 'em_rota')];
    const consultas = veTodas
      ? [query(collection(db, 'romaneios'), ...base)]
      : [...new Set([uid, motoristaVinculado].filter(Boolean))]
        .map((motoristaId) => query(collection(db, 'romaneios'), ...base, where('motoristaId', '==', motoristaId)));
    if (consultas.length === 0) {
      setRotas([]);
      setCarregando(false);
      return;
    }
    const porConsulta: RotaDoApp[][] = consultas.map(() => []);
    const recebidas = new Set<number>();
    const juntar = () => {
      if (recebidas.size < consultas.length) return;
      const lista = [...new Map(porConsulta.flat().map((r) => [r.id, r])).values()];
      lista.sort((a, b) => b.dataSaida.localeCompare(a.dataSaida) || b.numero - a.numero);
      setRotas(lista);
      setErro('');
      setCarregando(false);
    };
    const paradas = consultas.map((q, i) => onSnapshot(q, (snap) => {
      porConsulta[i] = snap.docs.map((d) => ({ id: d.id, ...lerRomaneio(d.data()) }));
      recebidas.add(i);
      juntar();
    }, (e) => {
      console.error('Erro ao carregar as rotas em andamento:', e);
      setErro('Não foi possível carregar as rotas. Verifique a internet e tente de novo.');
      setCarregando(false);
    }));
    return () => paradas.forEach((parar) => parar());
  }, [tenantId, pode, veTodas, vinculoCarregado, uid, motoristaVinculado]);

  const minhas = useMemo(() => rotas.filter((r) => rotaEhDoMotorista(r.motoristaId, currentUser?.uid, motoristaVinculado)),
    [rotas, currentUser?.uid, motoristaVinculado]);
  const lista = aba === 'todas' && veTodas ? rotas : minhas;

  if (!pode) return <Navigate to="/vendedor" replace />;

  const abaBotao = (chave: 'minhas' | 'todas', rotulo: string, quantidade: number) => (
    <button
      type="button"
      onClick={() => setAba(chave)}
      style={{
        flex: 1, height: '40px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
        border: '1px solid var(--border-color)',
        backgroundColor: aba === chave ? 'var(--brand-500)' : 'var(--bg-elevated)',
        color: aba === chave ? '#fff' : 'var(--text-primary)',
      }}
    >
      {rotulo} ({quantidade})
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <VendedorHeader titulo="Entregas" aoVoltar={() => voltarPara('/vendedor')} />

      {veTodas && (
        <div style={{ padding: '14px 20px 0', display: 'flex', gap: '8px' }}>
          {abaBotao('minhas', 'Minhas rotas', minhas.length)}
          {abaBotao('todas', 'Todas', rotas.length)}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>{erro}</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
            {aba === 'minhas' || !veTodas
              ? 'Nenhuma rota sua em andamento. A loja libera a rota no Romaneio de Entrega e ela aparece aqui.'
              : 'Nenhuma rota em andamento na empresa.'}
          </div>
        ) : lista.map((rota) => {
          const resumo = resumoDoRomaneio(rota);
          return (
            <button
              key={rota.id}
              type="button"
              onClick={() => navigate(`/vendedor/entregas/${rota.id}`, comOrigem('/vendedor/entregas'))}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: 'var(--app-raio-linha)',
                backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', textAlign: 'left', cursor: 'pointer', width: '100%',
              }}
            >
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Truck size={22} color="var(--brand-400)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tituloDaRota(rota)}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Saída {dataCurta(rota.dataSaida)}{rota.horarioSaida ? ` ${rota.horarioSaida}` : ''} · {rota.motoristaNome || 'Sem motorista'}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '3px', color: resumo.pendentes > 0 ? 'var(--brand-400)' : '#22c55e' }}>
                  {resumo.pendentes > 0 ? `Faltam ${resumo.pendentes} de ${resumo.totalEntregas}` : `Todas as ${resumo.totalEntregas} resolvidas`} · {formatarMoeda(resumo.valorTotalCentavos)}
                </div>
              </div>
              <ChevronRight size={18} color="var(--text-muted)" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default VendedorEntregas;

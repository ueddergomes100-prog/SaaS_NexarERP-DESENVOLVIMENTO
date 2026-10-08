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

/*
 * ENTREGAS NO APP DO MOTORISTA (2026-10-08): as rotas EM ANDAMENTO.
 *
 * "Minhas" = rotas em que o motorista e' este usuario (o cadastro do
 * motorista e' motoristas/{uid}, criado por "Este funcionario e' motorista"
 * no usuario). "Todas" = as outras rotas em andamento da empresa, para o
 * gestor acompanhar ou para um motorista que saiu no lugar de outro. A rota
 * fechada pela loja some daqui.
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
  const { tenantId, currentUser, userRole, isOwner, userPermissions } = useAuth();
  const pode = podeUsarEntregasNoApp(userRole, isOwner, userPermissions);
  const [aba, setAba] = useState<'minhas' | 'todas'>('minhas');
  const [rotas, setRotas] = useState<RotaDoApp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!tenantId || !pode) return;
    const q = query(collection(db, 'romaneios'), where('tenantId', '==', tenantId), where('status', '==', 'em_rota'));
    const parar = onSnapshot(q, (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...lerRomaneio(d.data()) }));
      lista.sort((a, b) => b.dataSaida.localeCompare(a.dataSaida) || b.numero - a.numero);
      setRotas(lista);
      setErro('');
      setCarregando(false);
    }, (e) => {
      console.error('Erro ao carregar as rotas em andamento:', e);
      setErro('Não foi possível carregar as rotas. Verifique a internet e tente de novo.');
      setCarregando(false);
    });
    return parar;
  }, [tenantId, pode]);

  const minhas = useMemo(() => rotas.filter((r) => r.motoristaId === currentUser?.uid), [rotas, currentUser?.uid]);
  const lista = aba === 'minhas' ? minhas : rotas;

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
      <VendedorHeader titulo="Entregas" aoVoltar={() => navigate('/vendedor')} />

      <div style={{ padding: '14px 20px 0', display: 'flex', gap: '8px' }}>
        {abaBotao('minhas', 'Minhas rotas', minhas.length)}
        {abaBotao('todas', 'Todas', rotas.length)}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>{erro}</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
            {aba === 'minhas'
              ? 'Nenhuma rota sua em andamento. A loja libera a rota no Romaneio de Entrega e ela aparece aqui.'
              : 'Nenhuma rota em andamento na empresa.'}
          </div>
        ) : lista.map((rota) => {
          const resumo = resumoDoRomaneio(rota);
          return (
            <button
              key={rota.id}
              type="button"
              onClick={() => navigate(`/vendedor/entregas/${rota.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: '14px',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', textAlign: 'left', cursor: 'pointer', width: '100%',
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

import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_MOSTRAR_VALOR_LISTA_OS, parseMostrarValorListaOS } from '../../utils/osListaValorDomain';
import { normalizeSearchText } from '../../utils/textSearch';
import VendedorHeader from './VendedorHeader';

/**
 * Consulta de Ordens de Servico da empresa -- so leitura.
 *
 * Diferente de Meus Pedidos, NAO filtra por pessoa: OS nao tem vendedor, so'
 * `mecanicoId` (o responsavel pelo servico). Entao e' uma consulta geral,
 * igual Consultar Cliente/Preco, liberada pela permissao `mecanica.os`.
 * Mesma leitura de OSList.tsx (so `tenantId`, ordenado no cliente pra nao
 * exigir indice composto).
 */

interface OsResumo {
  id: string;
  numeroOS: string;
  status: string;
  statusColor?: string;
  clienteNome: string;
  placa: string;
  modelo: string;
  valorTotal: number;
  criadoEmSegundos: number;
}

const LIMITE_SEM_BUSCA = 30;

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const normalizar = normalizeSearchText;

const VendedorOrdensServico: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, userPermissions } = useAuth();
  const [ordens, setOrdens] = useState<OsResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [mostrarValor, setMostrarValor] = useState(DEFAULT_MOSTRAR_VALOR_LISTA_OS);

  useEffect(() => {
    if (!tenantId) return;
    let cancelado = false;

    getDocs(query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId)))
      .then((snap) => {
        if (cancelado) return;
        const lista = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            numeroOS: data.numeroOS || d.id.substring(0, 6).toUpperCase(),
            status: data.status || '',
            statusColor: data.statusColor,
            clienteNome: data.clienteNome || '',
            placa: (data.placa || '').toUpperCase(),
            modelo: data.modelo || '',
            valorTotal: Number(data.valorTotal || 0),
            criadoEmSegundos: data.createdAt?.seconds || 0,
          };
        });
        lista.sort((a, b) => b.criadoEmSegundos - a.criadoEmSegundos);
        setOrdens(lista);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar as ordens de serviço. Verifique a internet e tente de novo.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    // Configuracoes -> Ordem de Servico: mostrar o valor na lista (mesma
    // chave que OSList.tsx respeita no desktop).
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => { if (!cancelado) setMostrarValor(parseMostrarValorListaOS(snap.exists() ? snap.data().mostrarValorListaOS : undefined)); })
      .catch(() => {});

    return () => { cancelado = true; };
  }, [tenantId]);

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return ordens.slice(0, LIMITE_SEM_BUSCA);
    const termoPlaca = termo.replace(/[^a-z0-9]/g, '');
    return ordens.filter((os) => (
      normalizar(os.clienteNome).includes(termo)
      || normalizar(String(os.numeroOS)).includes(termo)
      || normalizar(os.modelo).includes(termo)
      || (termoPlaca.length > 0 && normalizar(os.placa).replace(/[^a-z0-9]/g, '').includes(termoPlaca))
    ));
  }, [ordens, busca]);

  if (!userPermissions.includes('mecanica.os')) {
    return <Navigate to="/vendedor" replace />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Ordens de Serviço" />

      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ position: 'relative' }}>
          <Search size={17} color="var(--text-muted)" style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Cliente, placa, veículo ou nº da OS"
            aria-label="Buscar ordem de serviço"
            style={{
              width: '100%', height: '46px', borderRadius: '12px', border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 14px 0 38px',
              boxSizing: 'border-box', textTransform: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>{erro}</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            {busca.trim() ? 'Nenhuma ordem de serviço encontrada.' : 'Nenhuma ordem de serviço cadastrada.'}
          </div>
        ) : (
          <>
            {!busca.trim() && ordens.length > LIMITE_SEM_BUSCA && (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Mostrando as {LIMITE_SEM_BUSCA} mais recentes. Use a busca para encontrar as outras.
              </div>
            )}
            {filtradas.map((os) => (
              <button
                key={os.id}
                type="button"
                onClick={() => navigate(`/vendedor/os/${os.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: '14px',
                  backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', textAlign: 'left', cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {os.clienteNome || 'Sem cliente'}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    OS #{os.numeroOS}{os.placa ? ` · ${os.placa}` : ''}{os.modelo ? ` · ${os.modelo}` : ''}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '3px', color: os.statusColor || 'var(--brand-400)' }}>{os.status}</div>
                </div>
                {mostrarValor && (
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(os.valorTotal)}</div>
                )}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorOrdensServico;

import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Camera, CheckCircle, CloudOff, MapPin, Phone, XCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { podeUsarEntregasNoApp } from './vendedorPermissoes';
import { lerRomaneio } from '../../services/romaneioService';
import {
  ROTULO_STATUS_ENTREGA,
  diferencaDoRecebido,
  linkDoMapa,
  precisaJustificarValor,
  resumoDoRomaneio,
  separarEntregas,
  textoDaDiferenca,
  type EntregaRomaneio,
} from '../../utils/romaneioDomain';
import { canhotosPendentesDaRota } from '../../utils/offlineDomain';
import { assinarFilaOffline, listarPendencias, type PendenciaGuardada } from '../../utils/filaOffline';
import { dataCurta, tituloDaRota, type RotaDoApp } from './VendedorEntregas';

/*
 * UMA ROTA NO APP DO MOTORISTA (2026-10-08): "Faltam entregar" e "Feitas",
 * na ordem que a loja montou. Cada entrega tem o endereco com atalho pro
 * mapa, o telefone pra ligar, o valor do pedido (o motorista precisa saber
 * quanto cobrar) e o botao Registrar/Alterar. O canhoto que ainda esta' no
 * aparelho aparece como pendente.
 */

const formatarMoeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COR_STATUS: Record<EntregaRomaneio['status'], string> = { pendente: 'var(--brand-400)', entregue: '#22c55e', nao_entregue: '#ef4444' };

const cardStyle: React.CSSProperties = {
  padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
};

const chip: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', borderRadius: '999px', padding: '3px 9px',
};

const atalho: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', height: '40px', padding: '0 12px', borderRadius: '10px',
  border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)',
  fontSize: '13px', fontWeight: 600, textDecoration: 'none',
};

const horaCurta = (iso: string) => {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '' : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const CartaoEntrega: React.FC<{
  entrega: EntregaRomaneio;
  ordem: number;
  canhotoPendente: boolean;
  emRota: boolean;
  onRegistrar: () => void;
}> = ({ entrega, ordem, canhotoPendente, emRota, onRegistrar }) => {
  const mapa = linkDoMapa(entrega);
  const telefone = entrega.telefone.replace(/\D/g, '');
  const diferenca = precisaJustificarValor(entrega) ? diferencaDoRecebido(entrega) : 0;
  const feita = entrega.status !== 'pendente';
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>{ordem}.</span>{entrega.clienteNome}
          </div>
          {(entrega.endereco || entrega.cidade) && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
              {entrega.endereco}{entrega.endereco && entrega.cidade ? ' · ' : ''}{entrega.cidade}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatarMoeda(entrega.valorTotalCentavos)}</div>
          {entrega.formaPagamento && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{entrega.formaPagamento}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
        <span style={chip}>Pedido #{entrega.numeroPedido}</span>
        <span style={chip}>{entrega.notaNumero ? `NF ${entrega.notaNumero}` : 'Sem nota'}</span>
        {entrega.vendedorNome && <span style={chip}>Vend. {entrega.vendedorNome}</span>}
      </div>

      {feita && (
        <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', fontSize: '13px', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: COR_STATUS[entrega.status] }}>
            {entrega.status === 'entregue' ? <CheckCircle size={15} /> : <XCircle size={15} />}
            {ROTULO_STATUS_ENTREGA[entrega.status]}
            {entrega.registradoEm && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>· {horaCurta(entrega.registradoEm)}</span>}
          </div>
          {entrega.status === 'entregue' && entrega.recebedorNome && (
            <div style={{ color: 'var(--text-secondary)' }}>Recebido por {entrega.recebedorNome}{entrega.recebedorDocumento ? ` (${entrega.recebedorDocumento})` : ''}</div>
          )}
          {entrega.status === 'nao_entregue' && <div style={{ color: 'var(--text-secondary)' }}>Motivo: {entrega.motivo}</div>}
          {entrega.recebidoCentavos > 0 && (
            <div style={{ color: 'var(--text-secondary)' }}>Recebeu {formatarMoeda(entrega.recebidoCentavos)} ({entrega.recebidoForma})</div>
          )}
          {diferenca !== 0 && (
            <div style={{ color: '#f59e0b', fontWeight: 600 }}>Diferença {textoDaDiferenca(diferenca)}: <span style={{ fontWeight: 500 }}>{entrega.justificativaValor}</span></div>
          )}
          {entrega.observacao && <div style={{ color: 'var(--text-muted)' }}>{entrega.observacao}</div>}
          {entrega.canhotoUrl ? (
            <a href={entrega.canhotoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '6px', color: 'var(--text-primary)', textDecoration: 'none' }}>
              <img src={entrega.canhotoUrl} alt="Canhoto" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-color)' }} />
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Ver canhoto</span>
            </a>
          ) : canhotoPendente ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', color: 'var(--text-muted)', fontSize: '12px' }}>
              <CloudOff size={14} /> Canhoto guardado no aparelho — sobe quando a rede voltar
            </div>
          ) : null}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        {mapa && (
          <a href={mapa} target="_blank" rel="noopener noreferrer" style={atalho} aria-label="Abrir o endereço no mapa"><MapPin size={16} /> Mapa</a>
        )}
        {telefone && (
          <a href={`tel:${telefone}`} style={atalho} aria-label={`Ligar para ${entrega.clienteNome}`}><Phone size={16} /> Ligar</a>
        )}
        <div style={{ flex: 1 }} />
        {emRota && (
          <button type="button" className={feita ? 'btn-secondary' : 'btn-primary'} onClick={onRegistrar} style={{ height: '40px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
            {!feita && <Camera size={16} />} {feita ? 'Alterar' : 'Registrar'}
          </button>
        )}
      </div>
    </div>
  );
};

const VendedorEntregaRota: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, currentUser, userRole, isOwner, userPermissions } = useAuth();
  const pode = podeUsarEntregasNoApp(userRole, isOwner, userPermissions);
  const [rota, setRota] = useState<RotaDoApp | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState<'faltam' | 'feitas'>('faltam');
  const [pendencias, setPendencias] = useState<PendenciaGuardada[]>([]);

  useEffect(() => {
    if (!id || !tenantId || !pode) return;
    const parar = onSnapshot(doc(db, 'romaneios', id), (snap) => {
      const dados = snap.exists() ? snap.data() : null;
      if (!dados || dados.tenantId !== tenantId) {
        setErro('Rota não encontrada.');
        setCarregando(false);
        return;
      }
      setRota({ id: snap.id, ...lerRomaneio(dados) });
      setErro('');
      setCarregando(false);
    }, (e) => {
      console.error('Erro ao abrir a rota:', e);
      setErro('Não foi possível abrir a rota. Verifique a internet e tente de novo.');
      setCarregando(false);
    });
    return parar;
  }, [id, tenantId, pode]);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const carregar = () => { void listarPendencias(tenantId, currentUser.uid).then(setPendencias); };
    carregar();
    return assinarFilaOffline(carregar);
  }, [tenantId, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pode) return <Navigate to="/vendedor" replace />;

  const canhotosPendentes = canhotosPendentesDaRota(pendencias, id || '');
  const { faltam, feitas } = separarEntregas(rota?.entregas || []);
  const resumo = rota ? resumoDoRomaneio(rota) : null;
  const emRota = rota?.status === 'em_rota';
  const lista = aba === 'faltam' ? faltam : feitas;
  const ordemDe = (entrega: EntregaRomaneio) => (rota ? rota.entregas.findIndex((e) => e.pedidoId === entrega.pedidoId) + 1 : 0);

  const abaBotao = (chave: 'faltam' | 'feitas', rotulo: string, quantidade: number) => (
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
      <VendedorHeader titulo={rota ? tituloDaRota(rota) : 'Rota'} aoVoltar={() => navigate('/vendedor/entregas')} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro || !rota || !resumo ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>{erro || 'Rota não encontrada.'}</div>
        ) : (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Saída {dataCurta(rota.dataSaida)}{rota.horarioSaida ? ` às ${rota.horarioSaida}` : ''} · {rota.motoristaNome || 'Sem motorista'}
                {rota.veiculoDescricao ? ` · ${rota.veiculoDescricao}` : ''}
              </div>
              <div style={{ display: 'flex', gap: '14px', marginTop: '8px', fontSize: '13px', fontWeight: 700 }}>
                <span style={{ color: 'var(--brand-400)' }}>Faltam {resumo.pendentes}</span>
                <span style={{ color: '#22c55e' }}>Entregues {resumo.entregues}</span>
                <span style={{ color: '#ef4444' }}>Não entregues {resumo.naoEntregues}</span>
              </div>
              {rota.observacao && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px', whiteSpace: 'pre-wrap' }}>{rota.observacao}</div>}
              {!emRota && (
                <div style={{ marginTop: '10px', fontSize: '13px', fontWeight: 600, color: '#f59e0b' }}>
                  Esta rota foi encerrada pela loja. Só consulta.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {abaBotao('faltam', 'Faltam entregar', faltam.length)}
              {abaBotao('feitas', 'Feitas', feitas.length)}
            </div>

            {lista.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
                {aba === 'faltam' ? 'Nenhuma entrega pendente. Rota concluída!' : 'Nenhuma entrega registrada ainda.'}
              </div>
            ) : lista.map((entrega) => (
              <CartaoEntrega
                key={entrega.pedidoId}
                entrega={entrega}
                ordem={ordemDe(entrega)}
                canhotoPendente={canhotosPendentes.has(entrega.pedidoId)}
                emRota={emRota}
                onRegistrar={() => navigate(`/vendedor/entregas/${rota.id}/${entrega.pedidoId}`)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorEntregaRota;

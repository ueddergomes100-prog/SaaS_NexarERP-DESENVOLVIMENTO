import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getServiceHours, getServiceTotal } from '../../utils/osServicePricing';
import { resolverDescontoImpressaoOS, totalComDescontoOS } from '../../utils/osDescontoImpressao';
import VendedorHeader from './VendedorHeader';

/**
 * OS so' leitura, com os mesmos calculos da folha impressa (OsPrintDocument):
 * total de servico por hora (osServicePricing) e desconto (osDescontoImpressao).
 */

interface LinhaOS {
  nome: string;
  tipo: 'Serviço' | 'Peça';
  detalhe: string;
  total: number;
}

interface OsDetalhe {
  id: string;
  numeroOS: string;
  status: string;
  statusColor?: string;
  clienteNome: string;
  clienteTelefone: string;
  veiculo: string;
  defeitoRelatado: string;
  relatorioTecnico: string;
  criadoEm: string;
  linhas: LinhaOS[];
  subtotal: number;
  descontoRotulo: string;
  descontoValor: number;
  total: number;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const cardStyle: React.CSSProperties = {
  padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
};

const tituloSecao: React.CSSProperties = {
  fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px',
};

const textoLivre: React.CSSProperties = {
  fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: 0,
};

const VendedorOrdemServicoDetalhe: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, userPermissions } = useAuth();
  const [os, setOs] = useState<OsDetalhe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!id || !tenantId) return;
    let cancelado = false;

    getDoc(doc(db, 'ordens_de_servico', id)).then((snap) => {
      if (cancelado) return;
      const data = snap.exists() ? snap.data() : null;
      if (!data || data.tenantId !== tenantId) {
        setErro('Ordem de serviço não encontrada.');
        return;
      }

      const servicos: LinhaOS[] = (data.servicos || []).map((s: any) => ({
        nome: s.nome || 'Serviço',
        tipo: 'Serviço' as const,
        detalhe: `${getServiceHours(s).toFixed(2)} h × ${formatarMoeda(Number(s.preco || 0))}`,
        total: getServiceTotal(s),
      }));
      const pecas: LinhaOS[] = (data.pecas || []).map((p: any) => ({
        nome: p.nome || 'Peça',
        tipo: 'Peça' as const,
        detalhe: `${Number(p.quantidade || 1)} × ${formatarMoeda(Number(p.preco || 0))}`,
        total: Number(p.preco || 0) * Number(p.quantidade || 1),
      }));
      const linhas = [...servicos, ...pecas];
      const subtotal = linhas.reduce((soma, l) => soma + l.total, 0);
      const desconto = resolverDescontoImpressaoOS(data.desconto);

      setOs({
        id: snap.id,
        numeroOS: data.numeroOS || snap.id.substring(0, 6).toUpperCase(),
        status: data.status || '',
        statusColor: data.statusColor,
        clienteNome: data.clienteNome || '',
        clienteTelefone: data.clienteTelefone || '',
        veiculo: [data.modelo, data.placa ? String(data.placa).toUpperCase() : '', data.ano, data.cor].filter(Boolean).join(' · '),
        defeitoRelatado: data.defeitoRelatado || '',
        relatorioTecnico: data.relatorioTecnico || '',
        criadoEm: data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR') : '',
        linhas,
        subtotal,
        descontoRotulo: desconto.rotulo,
        descontoValor: desconto.temDesconto ? desconto.valor : 0,
        total: totalComDescontoOS(subtotal, desconto),
      });
    }).catch(() => {
      if (!cancelado) setErro('Não foi possível abrir a ordem de serviço. Verifique a internet e tente de novo.');
    }).finally(() => {
      if (!cancelado) setCarregando(false);
    });

    return () => { cancelado = true; };
  }, [id, tenantId]);

  if (!userPermissions.includes('mecanica.os')) {
    return <Navigate to="/vendedor" replace />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo={os ? `OS #${os.numeroOS}` : 'Ordem de Serviço'}
        acao={os && (
          <button
            type="button"
            aria-label="Imprimir"
            onClick={() => navigate(`/vendedor/os/${os.id}/imprimir`)}
            style={{
              width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Printer size={18} />
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro || !os ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>{erro || 'Ordem de serviço não encontrada.'}</div>
        ) : (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{os.clienteNome || 'Sem cliente'}</div>
              {os.clienteTelefone && (
                <div style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginTop: '3px' }}>{os.clienteTelefone}</div>
              )}
              <div style={{ fontSize: '13.5px', fontWeight: 600, marginTop: '6px', color: os.statusColor || 'var(--brand-400)' }}>
                {os.status}{os.criadoEm ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · aberta em {os.criadoEm}</span> : null}
              </div>
            </div>

            {os.veiculo && (
              <div style={cardStyle}>
                <div style={tituloSecao}>Veículo</div>
                <p style={textoLivre}>{os.veiculo}</p>
              </div>
            )}

            {(os.defeitoRelatado || os.relatorioTecnico) && (
              <div style={cardStyle}>
                {os.defeitoRelatado && (
                  <>
                    <div style={tituloSecao}>Problema relatado</div>
                    <p style={textoLivre}>{os.defeitoRelatado}</p>
                  </>
                )}
                {os.relatorioTecnico && (
                  <>
                    <div style={{ ...tituloSecao, marginTop: os.defeitoRelatado ? '12px' : 0 }}>Relatório técnico</div>
                    <p style={textoLivre}>{os.relatorioTecnico}</p>
                  </>
                )}
              </div>
            )}

            <div style={cardStyle}>
              <div style={tituloSecao}>Serviços e peças</div>
              {os.linhas.length === 0 ? (
                <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Nenhum serviço ou peça adicionado.</div>
              ) : os.linhas.map((linha, index) => (
                <div key={index} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderTop: index === 0 ? 'none' : '1px solid var(--border-color)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{linha.nome}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{linha.tipo} · {linha.detalhe}</div>
                  </div>
                  <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatarMoeda(linha.total)}</div>
                </div>
              ))}

              <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '6px', paddingTop: '8px' }}>
                {os.descontoValor > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-secondary)' }}>
                      <span>Subtotal</span><span>{formatarMoeda(os.subtotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      <span>{os.descontoRotulo}</span><span>- {formatarMoeda(os.descontoValor)}</span>
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px' }}>
                  <span>Total</span><span>{formatarMoeda(os.total)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorOrdemServicoDetalhe;

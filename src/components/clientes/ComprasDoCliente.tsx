import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ChevronRight, Loader2, ShoppingBag } from 'lucide-react';
import { db } from '../../services/firebase';
import { TabIdContext, TabsContext } from '../../contexts/TabsContext';
import { useAuth } from '../../contexts/AuthContext';
import { addDaysToDateInput, getDateInputInTimeZone } from '../../utils/dateTime';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { resumirComprasDoCliente } from '../../utils/comprasDoClienteDomain';

/**
 * Compras do cliente (27/11/2026, pedido do dono): as vendas feitas no sistema
 * para ele, o total, a ultima compra e os produtos que mais leva. Na ficha do
 * cliente e na consulta do cliente no app. Regra em comprasDoClienteDomain.ts.
 * Quem so' ve as proprias vendas (Configuracoes > restringir vendas) ve so' as
 * dele aqui tambem.
 */

type Periodo = 'tudo' | '365' | '90';
const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: 'tudo', rotulo: 'Tudo' },
  { id: '365', rotulo: '12 meses' },
  { id: '90', rotulo: '90 dias' },
];
// Lista recolhida (27/11/2026, dono: "listar so' as ultimas 3 e botao de ver mais").
const NA_LISTA = 3;
const A_MAIS = 10;

const moeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const qtd = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const corDoStatus = (status: string, conta: boolean, cancelada: boolean) => {
  if (cancelada) return { cor: '#ef4444', fundo: 'rgba(239,68,68,0.10)' };
  if (!conta) return { cor: '#d97706', fundo: 'rgba(245,158,11,0.12)' };
  return status ? { cor: '#059669', fundo: 'rgba(16,185,129,0.12)' } : { cor: 'var(--text-muted)', fundo: 'var(--bg-tertiary)' };
};

interface Props {
  tenantId: string | null | undefined;
  clienteId: string | null | undefined;
  /** App: so' os numeros e os produtos (a consulta do app ja' lista o historico recente). */
  compacto?: boolean;
  /** O app esconde valores de quem nao ve valores. */
  mostrarValores?: boolean;
}

const ComprasDoCliente: React.FC<Props> = ({ tenantId, clienteId, compacto = false, mostrarValores = true }) => {
  const navigate = useNavigate();
  const { vendasVisiveisDeUsuarioId } = useAuth();
  const [pedidos, setPedidos] = useState<Array<{ id: string } & Record<string, unknown>>>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('tudo');
  const [visiveis, setVisiveis] = useState(NA_LISTA);
  // Abrir a venda em ABA NOVA (27/11/2026: antes a ficha do cliente fechava).
  const abas = useContext(TabsContext);
  const abaAtual = useContext(TabIdContext);
  const abrirVenda = (id: string, numero: string) => {
    const caminho = `/pedidos-venda/visualizar/${id}`;
    if (abas) void abas.openTab(caminho, `Pedido ${numero}`, abaAtual ?? undefined);
    else navigate(caminho);
  };

  useEffect(() => {
    if (!tenantId || !clienteId) return undefined;
    let vivo = true;
    setCarregando(true);
    setErro('');
    // So' igualdades (sem indice composto); a ordem e o periodo ficam na regra.
    getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('clienteId', '==', clienteId)))
      .then((snap) => {
        if (!vivo) return;
        const lidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string } & Record<string, unknown>);
        setPedidos(filtrarVendasVisiveis(lidos as Array<{ id: string; vendedorId?: string }>, vendasVisiveisDeUsuarioId) as Array<{ id: string } & Record<string, unknown>>);
      })
      .catch((falha) => {
        console.error('Compras do cliente: nao foi possivel ler as vendas.', falha);
        if (vivo) setErro('Não foi possível carregar as compras deste cliente. Verifique a internet e abra a ficha de novo.');
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [tenantId, clienteId, vendasVisiveisDeUsuarioId]);

  const resumo = useMemo(() => {
    const desde = periodo === 'tudo' ? '' : addDaysToDateInput(getDateInputInTimeZone(), -Number(periodo));
    return resumirComprasDoCliente(pedidos, { desde, maxProdutos: compacto ? 5 : 8 });
  }, [pedidos, periodo, compacto]);

  if (!clienteId) return null;

  const cartao: React.CSSProperties = {
    background: 'var(--bg-secondary)', borderRadius: '16px', boxShadow: '0 1px 3px rgba(30,20,60,0.06), 0 6px 18px rgba(30,20,60,0.05)',
    padding: compacto ? '12px 14px' : '14px 16px',
  };
  const numeros: Array<{ rotulo: string; valor: string }> = [
    ...(mostrarValores ? [{ rotulo: 'Total comprado', valor: moeda(resumo.totalCentavos) }] : []),
    { rotulo: 'Compras', valor: String(resumo.compras) },
    ...(mostrarValores ? [{ rotulo: 'Ticket médio', valor: moeda(resumo.ticketMedioCentavos) }] : []),
    { rotulo: 'Última compra', valor: dataBr(resumo.ultimaCompra) },
  ];
  const lista = resumo.vendas.slice(0, visiveis);

  return (
    <section aria-label="Compras do cliente" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: compacto ? 0 : '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingBottom: compacto ? 0 : '12px', borderBottom: compacto ? 'none' : '1px solid var(--border-color)' }}>
        <ShoppingBag size={compacto ? 16 : 20} style={{ color: 'var(--accent-purple)' }} aria-hidden="true" />
        <h3 style={{ fontSize: compacto ? '14px' : '16px', fontWeight: 600, margin: 0, flex: 1 }}>Compras do cliente</h3>
        <div role="group" aria-label="Período" style={{ display: 'flex', gap: '6px' }}>
          {PERIODOS.map((p) => {
            const ativo = periodo === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => { setPeriodo(p.id); setVisiveis(NA_LISTA); }}
                style={{
                  border: 'none', borderRadius: '999px', padding: '6px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                  background: ativo ? 'var(--accent-purple)' : 'var(--bg-tertiary)', color: ativo ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {p.rotulo}
              </button>
            );
          })}
        </div>
      </div>

      {carregando ? (
        <div style={{ ...cartao, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13.5px' }}>
          <Loader2 size={16} className="spin-animation" aria-hidden="true" /> Carregando as compras...
        </div>
      ) : erro ? (
        <div style={{ ...cartao, color: '#ef4444', fontSize: '13.5px' }}>{erro}</div>
      ) : resumo.vendas.length === 0 ? (
        <div style={{ ...cartao, color: 'var(--text-muted)', fontSize: '13.5px' }}>
          {periodo === 'tudo' ? 'Este cliente ainda não tem vendas no sistema.' : 'Nenhuma venda para este cliente neste período.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${compacto ? 130 : 150}px, 1fr))`, gap: '10px' }}>
            {numeros.map((n) => (
              <div key={n.rotulo} style={cartao}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{n.rotulo}</div>
                <div style={{ fontSize: compacto ? '18px' : '21px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>{n.valor}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: compacto ? '1fr' : 'minmax(0, 3fr) minmax(0, 2fr)', gap: '12px', alignItems: 'start' }}>
            {!compacto && <div style={{ ...cartao, padding: '6px 0' }}>
              {lista.map((v, i) => {
                const status = corDoStatus(v.status, v.conta, v.cancelada);
                const linha = (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        #{v.numero} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {dataBr(v.data)}</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[v.bonificacao ? 'Bonificação' : v.formas, v.vendedorNome].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <span style={{ fontSize: '11.5px', fontWeight: 700, color: status.cor, background: status.fundo, borderRadius: '999px', padding: '3px 9px', whiteSpace: 'nowrap' }}>{v.status || '—'}</span>
                    {mostrarValores && (
                      <strong style={{ fontSize: '13.5px', minWidth: '86px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', textDecoration: v.cancelada ? 'line-through' : 'none', color: v.cancelada ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        {moeda(v.totalCentavos)}
                      </strong>
                    )}
                  </>
                );
                const estiloLinha: React.CSSProperties = {
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '9px 14px', background: 'none', border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-color)', textAlign: 'left', color: 'inherit', font: 'inherit',
                };
                return (
                  <button key={v.id} type="button" title="Abrir a venda em outra aba" onClick={() => abrirVenda(v.id, v.numero)} style={{ ...estiloLinha, cursor: 'pointer' }}>
                    {linha}
                    <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  </button>
                );
              })}
              {resumo.vendas.length > NA_LISTA && (
                <button
                  type="button"
                  onClick={() => setVisiveis((atual) => (atual >= resumo.vendas.length ? NA_LISTA : atual + A_MAIS))}
                  style={{ display: 'block', width: '100%', padding: '10px 14px', border: 'none', borderTop: '1px solid var(--border-color)', background: 'none', color: 'var(--accent-purple)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
                >
                  {visiveis >= resumo.vendas.length
                    ? 'Mostrar só as últimas'
                    : `Ver mais (${Math.min(A_MAIS, resumo.vendas.length - visiveis)} de ${resumo.vendas.length - visiveis} restantes)`}
                </button>
              )}
            </div>}

            {resumo.produtos.length > 0 && (
              <div style={cartao}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>O que mais compra</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {resumo.produtos.map((p) => (
                    <div key={p.chave} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '13px' }}>
                      <span style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.nome}>{p.nome}</span>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {qtd(p.quantidade)} {p.unidade} · {p.vezes}x{mostrarValores ? ` · ${moeda(p.valorCentavos)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            Total, ticket e produtos contam só venda faturada. Pré-venda em aberto, cancelada e bonificação aparecem na lista, fora das contas.
          </div>
        </>
      )}
    </section>
  );
};

export default React.memo(ComprasDoCliente);

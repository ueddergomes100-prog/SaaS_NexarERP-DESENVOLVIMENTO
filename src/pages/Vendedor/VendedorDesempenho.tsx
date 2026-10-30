import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Target, TrendingDown, TrendingUp } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import {
  calcularDesempenho,
  inicioDaBuscaDoDesempenho,
  metaDoVendedor,
  type DesempenhoVendedor,
  type RankingDesempenho,
  type VendaParaDesempenho,
} from '../../utils/desempenhoVendedorDomain';
import VendedorHeader from './VendedorHeader';
import './vendedorMobile.css';

/**
 * MEU DESEMPENHO (pedido de cliente, 30/10/2026): os numeros do proprio
 * vendedor -- so' as vendas DELE (pedidos_venda.vendedorId = login). A conta
 * mora em desempenhoVendedorDomain.ts; aqui so' busca e desenha.
 *
 * Busca as vendas do dia 1 do mes passado em diante (uma consulta, o mesmo
 * indice do resumo do dia): da' o mes atual, a comparacao com o mes passado e
 * os rankings sem baixar o historico inteiro.
 */

const moeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const moedaCurta = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const Cartao: React.FC<{ rotulo: string; valor: string; detalhe?: string; destaque?: boolean }> = ({ rotulo, valor, detalhe, destaque }) => (
  <div className="app-cartao" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{rotulo}</span>
    <span style={{ fontSize: destaque ? '22px' : '18px', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</span>
    {detalhe && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{detalhe}</span>}
  </div>
);

const Ranking: React.FC<{ titulo: string; itens: RankingDesempenho[]; unidade: (item: RankingDesempenho) => string }> = ({ titulo, itens, unidade }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <div className="app-secao">{titulo}</div>
    {itens.length === 0 ? (
      <div className="app-cartao" style={{ padding: '14px 16px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>Nenhuma venda faturada neste mês ainda.</div>
    ) : (
      <div className="app-cartao" style={{ padding: '6px 16px' }}>
        {itens.map((item, i) => (
          <div key={item.chave} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: i < itens.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
            <span style={{ width: '22px', fontSize: '13px', fontWeight: 800, color: 'var(--accent-purple)' }}>{i + 1}º</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{unidade(item)}</div>
            </div>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{moeda(item.totalCentavos)}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const VendedorDesempenho: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const [desempenho, setDesempenho] = useState<DesempenhoVendedor | null>(null);
  const [erro, setErro] = useState('');
  const hoje = useMemo(() => getDateInputInTimeZone(), []);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;
    const inicio = dateInputToUtcStart(inicioDaBuscaDoDesempenho(hoje));
    Promise.all([
      getDocs(query(
        collection(db, 'pedidos_venda'),
        where('tenantId', '==', tenantId),
        where('vendedorId', '==', currentUser.uid),
        where('createdAt', '>=', Timestamp.fromDate(inicio ?? new Date())),
      )),
      getDoc(doc(db, 'configuracoes', tenantId)).catch(() => null),
    ]).then(([snap, config]) => {
      if (cancelado) return;
      const vendas = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VendaParaDesempenho);
      const meta = metaDoVendedor(config?.exists() ? config.data().metasVendedores : null, currentUser.uid);
      setDesempenho(calcularDesempenho(vendas, hoje, meta));
    }).catch((e) => {
      console.error('Erro ao carregar o desempenho do vendedor:', e);
      if (!cancelado) setErro('Não foi possível carregar seus números. Verifique a internet e tente de novo.');
    });
    return () => { cancelado = true; };
  }, [tenantId, currentUser, hoje]);

  const mesNome = new Date(`${hoje}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' });
  const grafico = useMemo(() => (desempenho?.porDia || []).map((p) => ({ dia: String(Number(p.dia.slice(8))), valor: p.totalCentavos / 100 })), [desempenho]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Meu desempenho" subtitulo={`Suas vendas faturadas · ${mesNome}`} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {erro ? (
          <div role="alert" className="app-cartao" style={{ padding: '16px', color: '#ef4444', fontSize: '14px' }}>{erro}</div>
        ) : !desempenho ? (
          <div className="app-cartao" style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando seus números...</div>
        ) : (
          <>
            {desempenho.meta && (
              <div className="app-cartao" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  <Target size={16} color="var(--accent-purple)" /> Meta do mês: {moeda(desempenho.meta.valorCentavos)}
                </div>
                <div style={{ height: '12px', borderRadius: '999px', backgroundColor: 'var(--bg-tertiary)', overflow: 'hidden' }} role="progressbar" aria-valuenow={desempenho.meta.percentual} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${Math.min(100, desempenho.meta.percentual)}%`, height: '100%', borderRadius: '999px', backgroundColor: desempenho.meta.percentual >= 100 ? '#10b981' : 'var(--accent-purple)' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{desempenho.meta.percentual.toLocaleString('pt-BR')}% da meta</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {desempenho.meta.faltaCentavos > 0 ? `Faltam ${moeda(desempenho.meta.faltaCentavos)}` : 'Meta batida!'}
                  </span>
                </div>
              </div>
            )}

            {/* Grade por classe (vendedorMobile.css): grid inline vira 1 coluna no celular pela regra global do index.css. */}
            <div className="vendedor-atalhos-grid" style={{ gap: '10px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <Cartao
                  rotulo={`Vendido em ${mesNome}`}
                  valor={moeda(desempenho.mes.totalCentavos)}
                  destaque
                  detalhe={desempenho.variacaoPercentual === null
                    ? `${desempenho.mes.quantidade} venda(s)`
                    : `${desempenho.mes.quantidade} venda(s) · ${desempenho.variacaoPercentual >= 0 ? '+' : ''}${desempenho.variacaoPercentual.toLocaleString('pt-BR')}% sobre o mesmo período do mês passado`}
                />
              </div>
              <Cartao rotulo="Hoje" valor={moeda(desempenho.hoje.totalCentavos)} detalhe={`${desempenho.hoje.quantidade} venda(s)`} />
              <Cartao rotulo="Esta semana" valor={moeda(desempenho.semana.totalCentavos)} detalhe={`${desempenho.semana.quantidade} venda(s)`} />
              <Cartao rotulo="Ticket médio" valor={moeda(desempenho.mes.ticketMedioCentavos)} detalhe="por venda no mês" />
              <Cartao rotulo="Comissão do mês" valor={moeda(desempenho.comissaoMesCentavos)} detalhe="das vendas faturadas" />
              <Cartao rotulo="Mês passado" valor={moeda(desempenho.mesPassadoInteiro.totalCentavos)} detalhe={`${desempenho.mesPassadoInteiro.quantidade} venda(s) no mês inteiro`} />
              <Cartao
                rotulo="Aguardando faturamento"
                valor={moeda(desempenho.aguardandoFaturamento.totalCentavos)}
                detalhe={`${desempenho.aguardandoFaturamento.quantidade} pré-venda(s) em aberto`}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="app-secao" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {desempenho.variacaoPercentual !== null && desempenho.variacaoPercentual < 0
                  ? <TrendingDown size={15} color="#ef4444" />
                  : <TrendingUp size={15} color="#10b981" />}
                Vendas por dia
              </div>
              <div className="app-cartao" style={{ padding: '12px 8px 4px', height: '190px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grafico} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="dia" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <Tooltip
                      cursor={{ fill: 'rgba(124,58,237,0.08)' }}
                      formatter={(valor) => [moedaCurta(Number(valor) * 100), 'Vendido']}
                      labelFormatter={(dia) => `Dia ${dia}`}
                    />
                    <Bar dataKey="valor" fill="#7c3aed" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <Ranking
              titulo="Produtos que você mais vendeu"
              itens={desempenho.topProdutos}
              unidade={(item) => `${item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} un. vendidas`}
            />
            <Ranking
              titulo="Clientes que mais compraram"
              itens={desempenho.topClientes}
              unidade={(item) => `${item.quantidade} compra(s) no mês`}
            />

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Conta só venda faturada, pela data do faturamento. Venda cancelada não entra. Pré-venda em aberto aparece em "Aguardando faturamento" até a loja finalizar.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorDesempenho;

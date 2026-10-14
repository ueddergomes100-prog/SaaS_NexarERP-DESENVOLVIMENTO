import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, Box, ChevronRight, ClipboardList, FileText, ListChecks, LogOut, Package, Receipt, Repeat, Send, SquarePlus, Tag, Truck, Users, Wrench, type LucideIcon } from 'lucide-react';
import wordmarkDark from '../../assets/hennder-wordmark-dark.webp';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { buscarResumoHojeDoVendedor } from '../../services/vendedorRankingService';
import { CAMINHO_INSTALACAO, estaInstalado } from './pwa';
import { listarRascunhos } from './vendedorRascunhosStore';
import './vendedorMobile.css';
import { PERMISSAO_BALANCO, podeUsarEntregasNoApp, podeUsarOsNoApp } from './vendedorPermissoes';
import { hasTenantFullAccess } from '../../utils/roles';
import { PERMISSAO_TROCA_SOLICITAR } from '../../utils/trocaDomain';
import { comOrigem } from './navegacaoApp';

interface PedidoRecente {
  id: string;
  tipo: 'Pedido' | 'Orçamento';
  numero: string;
  status: string;
  clienteNome: string;
  valorTotal: number;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const saudacaoPorHora = () => {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
};

/** "terça-feira, 14 de outubro" */
const dataDeHoje = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

interface AtalhoProps {
  Icone: LucideIcon;
  rotulo: string;
  detalhe?: string;
  variante?: 'principal' | 'ambar';
  aoTocar: () => void;
}

/** Atalho da tela inicial: icone em circulo em cima, nome embaixo (vendedorVisual.css, .app-atalho). */
const Atalho: React.FC<AtalhoProps> = ({ Icone, rotulo, detalhe, variante, aoTocar }) => (
  <button type="button" onClick={aoTocar} className={`app-atalho${variante ? ` app-atalho--${variante}` : ''}`}>
    <span className="app-icone"><Icone size={25} strokeWidth={1.9} /></span>
    <span className="app-atalho__rotulo">
      {rotulo}
      {detalhe && <span className="app-atalho__detalhe">{detalhe}</span>}
    </span>
  </button>
);

const VendedorHome: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, logout, userNome, userPermissions, controlaFiscal, userRole, isOwner, filialAtual } = useAuth();
  const podeSolicitarTroca = hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_TROCA_SOLICITAR);
  const [recentes, setRecentes] = useState<PedidoRecente[]>([]);
  const [resumoHoje, setResumoHoje] = useState<{ pedidos: number; orcamentos: number } | null>(null);
  // A Home remonta a cada visita (key por rota no VendedorShell), entao ler
  // na montagem ja pega o que foi salvo/enviado nas outras telas.
  const [rascunhosPendentes] = useState(() => (tenantId && currentUser ? listarRascunhos(tenantId, currentUser.uid).length : 0));

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;
    buscarResumoHojeDoVendedor(tenantId, currentUser.uid)
      .then((resumo) => { if (!cancelado) setResumoHoje(resumo); })
      .catch(() => setResumoHoje({ pedidos: 0, orcamentos: 0 }));
    return () => { cancelado = true; };
  }, [tenantId, currentUser]);

  const totalHoje = (resumoHoje?.pedidos || 0) + (resumoHoje?.orcamentos || 0);
  const dadosGrafico = useMemo(() => [
    { nome: 'Pedidos', valor: resumoHoje?.pedidos || 0, cor: '#7c3aed' },
    { nome: 'Orçamentos', valor: resumoHoje?.orcamentos || 0, cor: '#3b82f6' },
  ], [resumoHoje]);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    let cancelado = false;

    getDocs(query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      where('vendedorId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(3),
    )).then((snap) => {
      if (cancelado) return;
      setRecentes(snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          tipo: 'Pedido' as const,
          numero: data.numeroPedido || '',
          status: data.status || '',
          clienteNome: data.clienteNome || '',
          valorTotal: Number(data.valorTotal || 0),
        };
      }));
    }).catch(() => setRecentes([]));

    return () => { cancelado = true; };
  }, [tenantId, currentUser]);

  const nome = userNome || currentUser?.displayName || 'Vendedor';
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;
  const subtitulo = filialAtual?.nome ? `${filialAtual.nome} · ${dataDeHoje()}` : dataDeHoje();

  return (
    // A tela inteira rola junto (cabecalho incluso): o cartao de resumo "sobe" por
    // cima do degrade, como no video de divulgacao.
    <div style={{ height: '100%', overflowY: 'auto', backgroundColor: 'var(--bg-primary)' }}>
      <div className="app-heroi">
        <div className="app-heroi__linha">
          <img className="app-heroi__marca" src={wordmarkDark} alt="Hennder Company" />
          <button type="button" className="app-vidro" onClick={() => void logout()} aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
        <div className="app-heroi__ola">{saudacaoPorHora()}, {primeiroNome}</div>
        <div className="app-heroi__sub">{subtitulo}</div>
      </div>

      <div className="app-inicio__corpo">
        <div className="app-cartao" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div style={{ position: 'relative', width: '92px', height: '92px', flexShrink: 0 }}>
            {totalHoje > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dadosGrafico}
                    dataKey="valor"
                    nameKey="nome"
                    innerRadius={30}
                    outerRadius={44}
                    paddingAngle={dadosGrafico.filter((d) => d.valor > 0).length > 1 ? 4 : 0}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    cornerRadius={4}
                  >
                    {dadosGrafico.map((entrada) => (
                      <Cell key={entrada.nome} fill={entrada.cor} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ position: 'absolute', inset: '4px', borderRadius: '50%', border: '12px solid var(--bg-tertiary)' }} />
            )}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{resumoHoje ? totalHoje : '–'}</span>
              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '2px' }}>hoje</span>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="app-secao" style={{ paddingLeft: 0 }}>Resumo de hoje</div>
            {resumoHoje && totalHoje === 0 ? (
              <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Nenhum pedido ou orçamento hoje ainda.
              </div>
            ) : (
              dadosGrafico.map((d) => (
                <div key={d.nome} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: d.cor, flexShrink: 0 }} />
                  <span style={{ fontSize: '14px', color: 'var(--text-secondary)', flex: 1 }}>{d.nome}</span>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{resumoHoje ? d.valor : '–'}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {rascunhosPendentes > 0 && (
          <button type="button" className="app-aviso app-aviso--ambar" onClick={() => navigate('/vendedor/rascunhos')}>
            <span className="app-icone"><Send size={20} /></span>
            <span className="app-aviso__texto">
              <strong>{rascunhosPendentes === 1 ? '1 rascunho não enviado' : `${rascunhosPendentes} rascunhos não enviados`}</strong>
              A loja só recebe depois de você tocar em "Enviar dados"
            </span>
            <ChevronRight size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          </button>
        )}

        {!estaInstalado() && (
          <button
            type="button"
            className="app-aviso"
            // Navegacao REAL de proposito: so' carregando /vendedor.html o
            // <head> certo chega no navegador, que e' o que o iPhone le ao
            // adicionar a tela de inicio. Ver VendedorInstalar.tsx.
            onClick={() => window.location.assign(CAMINHO_INSTALACAO)}
          >
            <span className="app-icone"><SquarePlus size={20} /></span>
            <span className="app-aviso__texto">
              <strong>Instalar na tela de início</strong>
              Abre como aplicativo, em tela cheia
            </span>
            <ChevronRight size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          </button>
        )}

        <div className="vendedor-atalhos-grid">
          <Atalho Icone={Box} rotulo="Novo Pedido" variante="principal" aoTocar={() => navigate('/vendedor/pedido/novo')} />
          <Atalho Icone={FileText} rotulo="Novo Orçamento" aoTocar={() => navigate('/vendedor/orcamento/novo')} />
          <Atalho Icone={Tag} rotulo="Consultar Preço" aoTocar={() => navigate('/vendedor/preco')} />
          <Atalho Icone={Users} rotulo="Consultar Cliente" aoTocar={() => navigate('/vendedor/cliente')} />
          {podeSolicitarTroca && (
            <>
              <Atalho Icone={Repeat} rotulo="Nova Troca" detalhe="Reposição sem cobrança" variante="ambar" aoTocar={() => navigate('/vendedor/troca/nova')} />
              <Atalho Icone={ListChecks} rotulo="Minhas Trocas" variante="ambar" aoTocar={() => navigate('/vendedor/trocas')} />
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="app-secao">Mais módulos</div>
          <div className="vendedor-atalhos-grid">
            <Atalho Icone={Send} rotulo="Rascunhos e Envio" aoTocar={() => navigate('/vendedor/rascunhos')} />
            {podeUsarOsNoApp(userRole, isOwner, userPermissions) && (
              <Atalho Icone={Wrench} rotulo="Ordens de Serviço" aoTocar={() => navigate('/vendedor/os', comOrigem('/vendedor'))} />
            )}
            {podeUsarEntregasNoApp(userRole, isOwner, userPermissions) && (
              <Atalho Icone={Truck} rotulo="Entregas" aoTocar={() => navigate('/vendedor/entregas', comOrigem('/vendedor'))} />
            )}
            {controlaFiscal && userPermissions.includes('fiscal.emitir') && (
              <Atalho Icone={Receipt} rotulo="Emitir Nota Fiscal" aoTocar={() => navigate('/vendedor/pedidos')} />
            )}
            {userPermissions.includes('financeiro.pagar') && (
              <Atalho Icone={ArrowDownCircle} rotulo="Contas a Pagar" aoTocar={() => navigate('/vendedor/contas-pagar')} />
            )}
            {userPermissions.includes('financeiro.receber') && (
              <Atalho Icone={ArrowUpCircle} rotulo="Contas a Receber" aoTocar={() => navigate('/vendedor/contas-receber')} />
            )}
            {/* Balanco mexe no saldo do estoque: so' quem tem a permissao de Ajuste
                Manual de Estoque no cadastro do funcionario ve o atalho. */}
            {userPermissions.includes(PERMISSAO_BALANCO) && (
              <Atalho Icone={ClipboardList} rotulo="Balanço" aoTocar={() => navigate('/vendedor/balanco')} />
            )}
          </div>
        </div>

        {recentes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="app-secao">Últimos pedidos</div>
            {recentes.map((item) => (
              <div key={item.id} className="app-linha">
                <span className="app-icone"><Package size={21} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.clienteNome}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}>
                    {item.tipo} #{item.numero} &middot; {item.status}
                  </div>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatarMoeda(item.valorTotal)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VendedorHome;

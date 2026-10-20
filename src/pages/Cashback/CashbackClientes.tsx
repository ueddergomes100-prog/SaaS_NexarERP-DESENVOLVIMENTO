import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { AlertTriangle, Coins, FileText, Search, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { hasTenantFullAccess } from '../../utils/roles';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  ROTULO_MODELO_CASHBACK,
  formatarCashback,
  lerResumoCashback,
  movimentoNaTela,
  parteDoSaldoVenceu,
  resumoPelosMovimentos,
  temDivida,
  temSaldo,
  textoDoSaldo,
  venceEmAte,
  type MovimentoNaTela,
  type ResumoCashbackDoCliente,
} from '../../utils/cashbackDomain';
import { montarDocumentoCashback, type ClienteDoRelatorioCashback } from '../../utils/relatorioCashbackDomain';
import { useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import EstadoVazio from '../../components/common/EstadoVazio';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';

/**
 * COMERCIAL › CASHBACK (fase 3, 20/10/2026). So' leitura: o saldo de cada
 * cliente (resumo gravado pelo servidor em clientes.cashback) e, ao abrir um
 * cliente, os lotes e movimentos dele (cashback_movimentos). Quem gera, usa e
 * estorna e' o servidor (server/services/cashback.js).
 */

export const PERMISSAO_CASHBACK = 'vendas.cashback';

type Filtro = 'com_saldo' | 'negativo' | 'vencendo' | 'todos';

const FILTROS: Array<{ valor: Filtro; rotulo: string }> = [
  { valor: 'com_saldo', rotulo: 'Com saldo' },
  { valor: 'vencendo', rotulo: 'Vence em 30 dias' },
  { valor: 'negativo', rotulo: 'Saldo negativo' },
  { valor: 'todos', rotulo: 'Todos' },
];

const DIAS_VENCENDO = 30;

const dataBr = (dia: string | null): string => (dia ? dia.split('-').reverse().join('/') : '');
const dataHoraBr = (ms: number): string => (ms
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  : '');

const millisDe = (valor: unknown): number => {
  const v = valor as { toMillis?: () => number; seconds?: number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : (Number(v?.seconds) || 0) * 1000;
};

const CashbackClientes: React.FC = () => {
  const { tenantId, configCashback, userRole, isOwner, userPermissions } = useAuth();
  const podeVer = hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_CASHBACK);
  const { linha } = useLinhaSelecionavel();
  const hoje = getDateInputInTimeZone();

  const [clientes, setClientes] = useState<ClienteDoRelatorioCashback[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('com_saldo');
  const [busca, setBusca] = useState('');
  const [previewAberto, setPreviewAberto] = useState(false);
  const [selecionado, setSelecionado] = useState<ClienteDoRelatorioCashback | null>(null);
  const [movimentos, setMovimentos] = useState<MovimentoNaTela[]>([]);
  const [carregandoMovimentos, setCarregandoMovimentos] = useState(false);

  // So' quem tem resumo gravado (o servidor grava na primeira venda paga).
  useEffect(() => {
    if (!tenantId || !podeVer) return undefined;
    setCarregando(true);
    const q = query(
      collection(db, 'clientes'),
      where('tenantId', '==', tenantId),
      where('cashback.modelo', 'in', ['reais', 'pontos']),
    );
    return onSnapshot(q, (snap) => {
      const lista: ClienteDoRelatorioCashback[] = [];
      snap.docs.forEach((d) => {
        const dados = d.data();
        const resumo = lerResumoCashback(dados.cashback);
        if (!resumo) return;
        lista.push({
          id: d.id,
          nome: String(dados.nome || ''),
          codigo: dados.codigo ? String(dados.codigo) : undefined,
          documento: dados.documento ? String(dados.documento) : undefined,
          telefone: dados.telefone ? String(dados.telefone) : undefined,
          resumo,
          atualizadoEmMs: millisDe((dados.cashback as Record<string, unknown>)?.atualizadoEm),
        });
      });
      lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setClientes(lista);
      setErro('');
      setCarregando(false);
    }, (falha) => {
      console.error('Erro ao ler o cashback dos clientes:', falha);
      setErro('Não foi possível carregar o cashback dos clientes. Confira a internet e abra a tela de novo.');
      setCarregando(false);
    });
  }, [tenantId, podeVer]);

  // Lotes e movimentos do cliente aberto.
  useEffect(() => {
    if (!tenantId || !selecionado) { setMovimentos([]); return undefined; }
    let ativo = true;
    setCarregandoMovimentos(true);
    getDocs(query(collection(db, 'cashback_movimentos'), where('tenantId', '==', tenantId), where('clienteId', '==', selecionado.id)))
      .then((snap) => {
        if (!ativo) return;
        setMovimentos(snap.docs.map((d) => movimentoNaTela(d.id, d.data())).sort((a, b) => b.criadoEmMs - a.criadoEmMs));
      })
      .catch((falha) => {
        console.error('Erro ao ler os movimentos de cashback:', falha);
        if (ativo) setMovimentos([]);
      })
      .finally(() => { if (ativo) setCarregandoMovimentos(false); });
    return () => { ativo = false; };
  }, [tenantId, selecionado]);

  const contagem = useMemo(() => ({
    com_saldo: clientes.filter((c) => temSaldo(c.resumo)).length,
    vencendo: clientes.filter((c) => temSaldo(c.resumo) && venceEmAte(c.resumo, hoje, DIAS_VENCENDO)).length,
    negativo: clientes.filter((c) => temDivida(c.resumo)).length,
    todos: clientes.length,
  }), [clientes, hoje]);

  const termo = busca.trim().toLowerCase();
  const digitosDaBusca = termo.replace(/\D/g, '');
  const filtrados = useMemo(() => clientes
    .filter((c) => {
      if (filtro === 'com_saldo') return temSaldo(c.resumo);
      if (filtro === 'vencendo') return temSaldo(c.resumo) && venceEmAte(c.resumo, hoje, DIAS_VENCENDO);
      if (filtro === 'negativo') return temDivida(c.resumo);
      return true;
    })
    .filter((c) => !termo
      || c.nome.toLowerCase().includes(termo)
      || String(c.codigo || '').toLowerCase().includes(termo)
      || (digitosDaBusca !== '' && String(c.documento || '').replace(/\D/g, '').includes(digitosDaBusca))),
  [clientes, filtro, termo, digitosDaBusca, hoje]);

  const totais = useMemo(() => {
    const comSaldo = clientes.filter((c) => temSaldo(c.resumo));
    return {
      reais: comSaldo.filter((c) => c.resumo.modelo === 'reais').reduce((s, c) => s + c.resumo.saldoCentavos, 0),
      pontos: comSaldo.filter((c) => c.resumo.modelo === 'pontos').reduce((s, c) => s + c.resumo.saldoPontos, 0),
      temPontos: clientes.some((c) => c.resumo.modelo === 'pontos'),
      temReais: clientes.some((c) => c.resumo.modelo === 'reais'),
    };
  }, [clientes]);

  if (!podeVer) {
    return (
      <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Seu usuário não tem permissão para ver o cashback dos clientes. Peça a um responsável liberar &quot;Vendas: Cashback&quot; no seu cadastro.
      </div>
    );
  }

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="cashback-clientes"
        documento={montarDocumentoCashback(filtrados, {
          hoje,
          filtrosAplicados: [
            `Lista: ${FILTROS.find((f) => f.valor === filtro)?.rotulo || filtro}`,
            busca.trim() ? `Busca: "${busca.trim()}"` : '',
          ].filter(Boolean),
        })}
        nomeArquivo={nomeArquivoRelatorio('Cashback', hoje, hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar ao cashback"
      />
    );
  }

  const resumoDoDetalhe: ResumoCashbackDoCliente | null = selecionado && !carregandoMovimentos && movimentos.length > 0
    ? { modelo: selecionado.resumo.modelo, ...resumoPelosMovimentos(movimentos, hoje, { centavos: selecionado.resumo.dividaCentavos, pontos: selecionado.resumo.dividaPontos }) }
    : null;

  const cartao = (rotulo: string, valor: string, detalhe?: string) => (
    <div className="card" style={{ padding: '18px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: '1 1 200px' }}>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{rotulo}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '6px' }}>{valor}</div>
      {detalhe && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{detalhe}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Coins size={28} color="var(--accent-purple)" /> Cashback
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Saldo de cada cliente, de onde veio e quando vence. O saldo nasce na venda paga e é usado como forma de pagamento &quot;Cashback&quot;.
          </p>
        </div>
        <MenuMaisOpcoes
          itens={[{
            texto: 'Relatório', Icone: FileText,
            titulo: 'Abre em PDF os clientes da lista, com saldo e vencimento (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
            desabilitado: carregando,
            onClick: () => setPreviewAberto(true),
          }]}
        />
      </div>

      {!configCashback.ativo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245, 158, 11, 0.4)', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#b45309' }}>
          <AlertTriangle size={18} />
          <span>O cashback está desligado: nenhuma venda gera nem usa saldo. Ligue em Configurações Gerais › Cadastro, crédito e transferência › Cashback.</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {cartao('Clientes com saldo', String(contagem.com_saldo), configCashback.ativo ? ROTULO_MODELO_CASHBACK[configCashback.modelo] : undefined)}
        {(totais.temReais || !totais.temPontos) && cartao('Saldo em R$', formatarCashback('reais', totais.reais, 0), 'Soma do que os clientes podem usar')}
        {totais.temPontos && cartao('Saldo em pontos', formatarCashback('pontos', 0, totais.pontos), 'Soma do que os clientes podem trocar')}
        {cartao(`Vence em ${DIAS_VENCENDO} dias`, String(contagem.vencendo), 'Clientes com parte do saldo vencendo')}
      </div>

      {selecionado && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700 }}>{selecionado.codigo ? `${selecionado.codigo} · ` : ''}{selecionado.nome}</h2>
              <div style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
                Saldo hoje: <strong style={{ color: 'var(--text-primary)' }}>{textoDoSaldo(resumoDoDetalhe ?? selecionado.resumo)}</strong>
                {temDivida(selecionado.resumo) && (
                  <> · saldo negativo de {formatarCashback(selecionado.resumo.modelo, selecionado.resumo.dividaCentavos, selecionado.resumo.dividaPontos)}, abatido do próximo cashback</>
                )}
              </div>
              {resumoDoDetalhe && textoDoSaldo(resumoDoDetalhe) !== textoDoSaldo(selecionado.resumo) && (
                <div style={{ color: '#b45309', fontSize: '13px', marginTop: '4px' }}>
                  Parte do saldo venceu desde a última venda deste cliente. O saldo acima já está sem a parte vencida.
                </div>
              )}
            </div>
            <button type="button" className="icon-btn" title="Fechar o detalhe" onClick={() => setSelecionado(null)}><X size={18} /></button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Data</th>
                  <th style={{ padding: '12px' }}>Movimento</th>
                  <th style={{ padding: '12px' }}>Venda</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Valor</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Sobra do lote</th>
                  <th style={{ padding: '12px' }}>Validade</th>
                </tr>
              </thead>
              <tbody>
                {carregandoMovimentos ? (
                  <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
                ) : movimentos.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '8px' }}><EstadoVazio titulo="Nenhum movimento de cashback deste cliente." compacto /></td></tr>
                ) : movimentos.map((m) => {
                  const vencido = m.tipo === 'gerado' && Boolean(m.validade && m.validade < hoje);
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{dataHoraBr(m.criadoEmMs)}</td>
                      <td style={{ padding: '12px' }}>
                        {m.rotulo}
                        {m.tipo === 'gerado' && m.estornado && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#ef4444' }}>(estornado)</span>}
                      </td>
                      <td style={{ padding: '12px' }}>{m.numeroPedido ? `#${m.numeroPedido}` : ''}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600, color: m.sinal > 0 ? '#10b981' : '#ef4444' }}>
                        {m.sinal > 0 ? '+' : '−'} {formatarCashback(m.modelo, m.centavos, m.pontos)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {m.tipo === 'gerado' ? formatarCashback(m.modelo, m.restanteCentavos, m.restantePontos) : ''}
                      </td>
                      <td style={{ padding: '12px', color: vencido ? '#ef4444' : undefined }}>
                        {m.tipo === 'gerado' ? (m.validade ? `${dataBr(m.validade)}${vencido ? ' (venceu)' : ''}` : 'Não vence') : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por cliente, código ou CPF/CNPJ..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {FILTROS.map(({ valor, rotulo }) => (
              <button
                key={valor}
                type="button"
                onClick={() => setFiltro(valor)}
                style={{
                  padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${filtro === valor ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                  backgroundColor: filtro === valor ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                  color: filtro === valor ? '#fff' : 'var(--text-primary)',
                }}
              >
                {rotulo} ({contagem[valor]})
              </button>
            ))}
          </div>
        </div>

        {erro && <div style={{ color: '#ef4444', marginBottom: '12px' }}>{erro}</div>}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Cliente</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Saldo</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Saldo negativo</th>
                <th style={{ padding: '14px' }}>Próximo vencimento</th>
                <th style={{ padding: '14px' }}>Última movimentação</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '8px' }}><EstadoVazio titulo={clientes.length === 0 ? 'Nenhum cliente com cashback ainda. O saldo aparece aqui depois da primeira venda paga de um produto com "Permitir cashback".' : 'Nenhum cliente nesta lista.'} compacto /></td></tr>
              ) : filtrados.map((c) => {
                const venceu = parteDoSaldoVenceu(c.resumo, hoje);
                return (
                  <tr
                    key={c.id}
                    {...linha(c.id, () => setSelecionado(c))}
                    style={{ borderBottom: '1px solid var(--border-color)', ...(selecionado?.id === c.id ? { backgroundColor: 'var(--bg-tertiary)' } : {}) }}
                    title="Clique para ver os lotes e movimentos deste cliente"
                  >
                    <td style={{ padding: '14px', fontWeight: 600 }}>{c.codigo ? `${c.codigo} · ` : ''}{c.nome}</td>
                    <td style={{ padding: '14px', textAlign: 'right', fontWeight: 700, color: temSaldo(c.resumo) ? '#10b981' : 'var(--text-muted)' }}>{textoDoSaldo(c.resumo)}</td>
                    <td style={{ padding: '14px', textAlign: 'right', color: temDivida(c.resumo) ? '#ef4444' : 'var(--text-muted)' }}>
                      {temDivida(c.resumo) ? formatarCashback(c.resumo.modelo, c.resumo.dividaCentavos, c.resumo.dividaPontos) : '—'}
                    </td>
                    <td style={{ padding: '14px', color: venceu ? '#b45309' : undefined }}>
                      {c.resumo.proximoVencimento ? `${dataBr(c.resumo.proximoVencimento)}${venceu ? ' (venceu; atualiza na próxima venda)' : ''}` : 'Não vence'}
                    </td>
                    <td style={{ padding: '14px', color: 'var(--text-muted)' }}>{dataHoraBr(c.atualizadoEmMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CashbackClientes;

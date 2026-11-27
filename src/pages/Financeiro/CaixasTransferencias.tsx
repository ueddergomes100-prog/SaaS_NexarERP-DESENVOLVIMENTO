import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtualizarQuandoVisivel } from '../../hooks/useAtualizarQuandoVisivel';
import { ArrowLeftRight, FileText, Landmark, Loader2, Pencil, Plus, Vault, Wallet, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import BotaoOlhoValores from '../../components/common/BotaoOlhoValores';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { formatarReais, type ContaRef } from '../../utils/contasDinheiroDomain';
import { ROTULO_MOVIMENTO_GAVETA } from '../../utils/gavetaDinheiroDomain';
import {
  extratoDoCaixa,
  lancarNoCaixa,
  listarCaixasEBancos,
  salvarCaixa,
  transferirEntreContas,
  type BancoResumo,
  type CaixaResumo,
  type LancamentoDoCaixa,
} from '../../services/caixasService';
import { useTabs } from '../../contexts/TabsContext';
import { pedirFiltroDoRelatorioDoCaixa } from '../../components/finance/pedirFiltroDoRelatorioDoCaixa';

/**
 * FINANCEIRO > CAIXAS E TRANSFERENCIAS (21/10/2026, pedido do dono: "todo ERP
 * tem"). Os caixas da empresa (CAIXA e COFRE nascem sozinhos) com saldo, os
 * bancos, e a transferencia entre qualquer par: caixa -> banco (deposito),
 * banco -> caixa (suprimento), caixa -> cofre, banco -> banco. Tudo pelo
 * servidor (services/caixasService.ts). Regra em contasDinheiroDomain.ts.
 */

const dataBr = (iso: string) => String(iso || '').split('-').reverse().join('/');

const ROTULO_TIPO_LANCAMENTO: Record<string, string> = {
  saldo_inicial: 'Saldo inicial',
  ajuste: 'Lançamento',
  transferencia_entrada: 'Transferência recebida',
  transferencia_saida: 'Transferência enviada',
  // Dinheiro das vendas na gaveta (23/11/2026): montado pelo servidor no CAIXA.
  ...ROTULO_MOVIMENTO_GAVETA,
};

/** Periodo do dinheiro das vendas no extrato do CAIXA (so' com a chave ligada). */
const PERIODOS_DO_EXTRATO = [
  { dias: 1, rotulo: 'Hoje e ontem' },
  { dias: 7, rotulo: 'Últimos 7 dias' },
  { dias: 30, rotulo: 'Últimos 30 dias' },
  { dias: 90, rotulo: 'Últimos 90 dias' },
];

const estiloFundo: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1200, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const estiloJanela: React.CSSProperties = { width: '100%', maxWidth: '480px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px' };
const estiloCampo: React.CSSProperties = { width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' };
const estiloRotulo: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' };

const centavosDoTexto = (texto: string): number => {
  const n = Number(String(texto || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

type Conta = CaixaResumo | BancoResumo;
const chaveDaConta = (c: Conta) => `${c.tipo}:${c.id}`;
const contaDaChave = (chave: string): ContaRef | null => {
  const [tipo, id] = chave.split(':');
  return (tipo === 'caixa' || tipo === 'banco') && id ? { tipo, id } : null;
};

const Janela: React.FC<{ titulo: string; onFechar: () => void; children: React.ReactNode }> = ({ titulo, onFechar, children }) => (
  <div style={estiloFundo} onClick={onFechar}>
    <div style={estiloJanela} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '17px' }}>{titulo}</h3>
        <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
      </div>
      {children}
    </div>
  </div>
);

const CaixasTransferencias: React.FC = () => {
  const { openTab } = useTabs();
  const { tenantId } = useAuth();
  // Olhinho (21/11/2026): esconde os saldos dos caixas e bancos junto com as outras telas.
  const { mostrar: mostrarValor } = useValoresOcultos();
  const [caixas, setCaixas] = useState<CaixaResumo[]>([]);
  const [bancos, setBancos] = useState<BancoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [caixaAberto, setCaixaAberto] = useState<CaixaResumo | null>(null);
  const [extrato, setExtrato] = useState<LancamentoDoCaixa[] | null>(null);
  const [diasDoExtrato, setDiasDoExtrato] = useState(30);
  // Chave "dinheiro das vendas na gaveta" (Configuracoes da Filial): muda o texto de ajuda.
  const [gavetaAtiva, setGavetaAtiva] = useState(false);
  const [janela, setJanela] = useState<'transferir' | 'caixa' | 'lancar' | null>(null);
  const [editando, setEditando] = useState<CaixaResumo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const hoje = getDateInputInTimeZone();

  const [transferencia, setTransferencia] = useState({ origem: '', destino: '', valor: '', data: hoje, descricao: '' });
  const [formCaixa, setFormCaixa] = useState({ nome: '', descricao: '', saldoInicial: '', ativo: true });
  const [lancamento, setLancamento] = useState({ caixaId: '', direcao: 'credito' as 'credito' | 'debito', valor: '', data: hoje, descricao: '' });

  const carregar = useCallback(async () => {
    try {
      const r = await listarCaixasEBancos();
      setCaixas(r.caixas);
      setBancos(r.bancos);
      setGavetaAtiva(Boolean(r.gaveta?.ativo));
    } catch (erro) {
      showError('Não foi possível carregar os caixas', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { if (tenantId) void carregar(); }, [tenantId, carregar]);

  const abrirExtrato = async (caixa: CaixaResumo, dias = diasDoExtrato) => {
    setCaixaAberto(caixa);
    setExtrato(null);
    try {
      setExtrato(await extratoDoCaixa(caixa.id, dias));
    } catch (erro) {
      showError('Não foi possível ler o extrato', erro instanceof Error ? erro.message : 'Tente de novo.');
      setExtrato([]);
    }
  };

  // Atualiza sozinho (25/11/2026, pedido do dono): a cada 30 s com a tela a vista,
  // sem aviso de erro (tenta de novo na proxima). Extrato aberto: so' rele quando
  // algum saldo mudou -- ler 30 dias de lancamentos a toa pesa.
  const raizRef = useRef<HTMLDivElement>(null);
  const assinaturaDosSaldos = useRef('');
  const atualizarSozinho = async () => {
    if (janela || salvando) return;
    try {
      const r = await listarCaixasEBancos();
      const assinatura = [...r.caixas, ...r.bancos].map((c) => `${c.id}:${c.saldoCentavos}`).join('|');
      const mudou = assinaturaDosSaldos.current !== '' && assinaturaDosSaldos.current !== assinatura;
      assinaturaDosSaldos.current = assinatura;
      setCaixas(r.caixas);
      setBancos(r.bancos);
      setGavetaAtiva(Boolean(r.gaveta?.ativo));
      if (mudou && caixaAberto) setExtrato(await extratoDoCaixa(caixaAberto.id, diasDoExtrato));
    } catch (erro) {
      console.warn('Caixas e Transferências: atualização automática falhou; tenta de novo em 30 s.', erro);
    }
  };
  useAtualizarQuandoVisivel(() => { void atualizarSozinho(); }, 30000, raizRef);

  const contas: Conta[] = [...caixas.filter((c) => c.ativo), ...bancos];

  const executar = async (acao: () => Promise<string>) => {
    setSalvando(true);
    try {
      const mensagem = await acao();
      showSuccess(mensagem);
      setJanela(null);
      setEditando(null);
      await carregar();
      if (caixaAberto) void abrirExtrato(caixaAberto);
    } catch (erro) {
      showError('Não foi possível concluir', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarTransferencia = async () => {
    const origem = contaDaChave(transferencia.origem);
    const destino = contaDaChave(transferencia.destino);
    const valorCentavos = centavosDoTexto(transferencia.valor);
    if (!origem || !destino) { showError('Atenção', 'Escolha de onde o dinheiro sai e para onde vai.'); return; }
    if (valorCentavos <= 0) { showError('Atenção', 'Informe um valor maior que zero.'); return; }
    const nomeDe = contas.find((c) => chaveDaConta(c) === transferencia.origem)?.nome || '';
    const nomePara = contas.find((c) => chaveDaConta(c) === transferencia.destino)?.nome || '';
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: 'Confirmar transferência?',
      text: `Transferir ${formatarReais(valorCentavos)} de ${nomeDe} para ${nomePara} em ${dataBr(transferencia.data)}?`,
      showCancelButton: true,
      confirmButtonText: 'Sim, transferir',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;
    await executar(async () => {
      const r = await transferirEntreContas({ origem, destino, valorCentavos, data: transferencia.data, descricao: transferencia.descricao.trim() });
      setTransferencia({ origem: '', destino: '', valor: '', data: hoje, descricao: '' });
      return `${formatarReais(r.valorCentavos)} transferidos de ${r.nomeOrigem} para ${r.nomeDestino}.`;
    });
  };

  const confirmarCaixa = () => executar(async () => {
    const r = await salvarCaixa({
      nome: formCaixa.nome,
      descricao: formCaixa.descricao.trim(),
      ...(editando ? {} : { saldoInicialCentavos: centavosDoTexto(formCaixa.saldoInicial) }),
      ativo: formCaixa.ativo,
    }, editando?.id);
    return editando ? `Caixa ${r.nome} alterado.` : `Caixa ${r.nome} criado.`;
  });

  const confirmarLancamento = () => executar(async () => {
    const valorCentavos = centavosDoTexto(lancamento.valor);
    await lancarNoCaixa(lancamento.caixaId, { direcao: lancamento.direcao, valorCentavos, descricao: lancamento.descricao.trim(), data: lancamento.data });
    setLancamento({ caixaId: '', direcao: 'credito', valor: '', data: hoje, descricao: '' });
    return `${lancamento.direcao === 'credito' ? 'Entrada' : 'Saída'} de ${formatarReais(valorCentavos)} registrada no caixa.`;
  });

  const abrirNovoCaixa = () => { setEditando(null); setFormCaixa({ nome: '', descricao: '', saldoInicial: '', ativo: true }); setJanela('caixa'); };
  const abrirEditarCaixa = (c: CaixaResumo) => { setEditando(c); setFormCaixa({ nome: c.nome, descricao: c.descricao, saldoInicial: '', ativo: c.ativo }); setJanela('caixa'); };
  const abrirLancar = (c?: CaixaResumo) => { setLancamento((atual) => ({ ...atual, caixaId: c?.id || caixas[0]?.id || '' })); setJanela('lancar'); };
  const abrirTransferir = (origem?: Conta) => { setTransferencia((atual) => ({ ...atual, origem: origem ? chaveDaConta(origem) : atual.origem })); setJanela('transferir'); };

  const cartao = (c: Conta, acoes: React.ReactNode) => (
    <div key={chaveDaConta(c)} className="card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: c.tipo === 'caixa' ? 'rgba(16,185,129,0.14)' : 'rgba(139,92,246,0.14)', color: c.tipo === 'caixa' ? '#10b981' : '#8b5cf6' }}>
          {c.tipo === 'banco' ? <Landmark size={20} /> : c.nome === 'COFRE' ? <Vault size={20} /> : <Wallet size={20} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.nome}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c.tipo === 'caixa' ? (c.descricao || 'Caixa') : 'Banco'}</div>
          {c.tipo === 'caixa' && c.recebeDinheiroDasVendas && (
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#10b981', marginTop: '2px' }}>Recebe o dinheiro das vendas</div>
          )}
        </div>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: c.saldoCentavos < 0 ? '#ef4444' : 'var(--text-primary)' }}>{mostrarValor(formatarReais(c.saldoCentavos))}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>{acoes}</div>
    </div>
  );

  const botaoPequeno = (texto: string, aoClicar: () => void, Icone?: typeof Pencil) => (
    <button type="button" className="btn-secondary" onClick={aoClicar} style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {Icone && <Icone size={14} />} {texto}
    </button>
  );

  return (
    <div ref={raizRef} className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700 }}>Caixas e Transferências</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Dinheiro da loja (caixa, cofre) e bancos. Transfira entre eles: depósito, suprimento do caixa, de um banco para outro.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <BotaoOlhoValores />
          <MenuMaisOpcoes
            itens={[
              {
                texto: 'Relatório completo do caixa', Icone: FileText,
                titulo: 'Vendas e recebimentos por forma de pagamento, turnos do caixa, sangrias e contas pagas, em PDF',
                onClick: () => { void pedirFiltroDoRelatorioDoCaixa('/financeiro/caixas/relatorio').then((caminho) => { if (caminho) void openTab(caminho, 'Relatório do caixa'); }); },
              },
              { texto: 'Novo caixa', Icone: Plus, titulo: 'Cadastra outro lugar onde a loja guarda dinheiro (ex.: segunda gaveta)', onClick: abrirNovoCaixa },
              { texto: 'Lançar no caixa', Icone: Wallet, titulo: 'Entrada ou saída a mão num caixa (acerto, troco inicial, retirada)', desabilitado: caixas.length === 0, onClick: () => abrirLancar() },
            ]}
          />
          <button type="button" className="btn-primary" onClick={() => abrirTransferir()} disabled={contas.length < 2} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ArrowLeftRight size={18} /> Nova transferência
          </button>
        </div>
      </div>

      {carregando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spin-icon" /> Carregando...</div>
      ) : (
        <>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Caixas</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            {caixas.map((c) => cartao(c, (
              <>
                {botaoPequeno('Extrato', () => void abrirExtrato(c))}
                {c.ativo && botaoPequeno('Transferir', () => abrirTransferir(c), ArrowLeftRight)}
                {c.ativo && botaoPequeno('Lançar', () => abrirLancar(c))}
                {botaoPequeno('Editar', () => abrirEditarCaixa(c), Pencil)}
                {!c.ativo && <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>Inativo</span>}
              </>
            )))}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>Bancos</div>
          {bancos.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhum banco ativo. Cadastre em Cadastros Auxiliares › Bancos.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px', marginBottom: '24px' }}>
              {bancos.map((b) => cartao(b, botaoPequeno('Transferir', () => abrirTransferir(b), ArrowLeftRight)))}
            </div>
          )}
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 0 }}>
            {gavetaAtiva
              ? 'O CAIXA soma sozinho todo o dinheiro recebido (vendas da Frente de Caixa, pedidos de venda e contas recebidas em dinheiro), menos o que foi pago em dinheiro, as sangrias e as transferências. No fechamento do caixa, a sobra ou a falta entra aqui. Para guardar o dinheiro do dia, use Transferir do CAIXA para o COFRE. Para desligar: Configurações da Filial › Parâmetros de venda.'
              : 'O saldo do caixa vem do saldo inicial, das transferências e dos lançamentos feitos aqui. A venda em dinheiro continua no Fluxo de Caixa. Para o CAIXA somar sozinho o dinheiro das vendas, ligue "Dinheiro das vendas na gaveta" em Configurações da Filial › Parâmetros de venda.'}
            {' '}O extrato do banco fica em Cadastros Auxiliares › Bancos.
          </p>
        </>
      )}

      {caixaAberto && (
        <div className="card list-container" style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <strong>Extrato — {caixaAberto.nome}</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {caixaAberto.recebeDinheiroDasVendas && (
                <select
                  value={diasDoExtrato}
                  aria-label="Período do dinheiro das vendas no extrato"
                  title="Período do dinheiro das vendas (transferências e lançamentos a mão aparecem sempre)"
                  onChange={(e) => { const dias = Number(e.target.value); setDiasDoExtrato(dias); void abrirExtrato(caixaAberto, dias); }}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 'var(--radius-md)', fontSize: '13px' }}
                >
                  {PERIODOS_DO_EXTRATO.map((p) => <option key={p.dias} value={p.dias}>{p.rotulo}</option>)}
                </select>
              )}
              <button type="button" onClick={() => { setCaixaAberto(null); setExtrato(null); }} aria-label="Fechar extrato" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Lançamento</th>
                  <th>Descrição</th>
                  <th style={{ textAlign: 'right' }}>Entrada</th>
                  <th style={{ textAlign: 'right' }}>Saída</th>
                </tr>
              </thead>
              <tbody>
                {extrato === null ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Carregando...</td></tr>
                ) : extrato.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Nenhum lançamento neste caixa ainda.</td></tr>
                ) : extrato.map((l) => (
                  <tr key={l.id}>
                    <td>{dataBr(l.data)}</td>
                    <td>{ROTULO_TIPO_LANCAMENTO[l.tipo] || l.tipo}</td>
                    <td>{l.descricao}</td>
                    <td style={{ textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{l.direcao === 'credito' ? formatarReais(l.valorCentavos) : ''}</td>
                    <td style={{ textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>{l.direcao === 'debito' ? formatarReais(l.valorCentavos) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {janela === 'transferir' && (
        <Janela titulo="Nova transferência" onFechar={() => setJanela(null)}>
          <label style={estiloRotulo}>De (sai)
            <select value={transferencia.origem} onChange={(e) => setTransferencia({ ...transferencia, origem: e.target.value })} style={estiloCampo}>
              <option value="">Selecione...</option>
              {contas.map((c) => <option key={chaveDaConta(c)} value={chaveDaConta(c)}>{c.tipo === 'caixa' ? 'Caixa' : 'Banco'} · {c.nome} ({formatarReais(c.saldoCentavos)})</option>)}
            </select>
          </label>
          <label style={estiloRotulo}>Para (entra)
            <select value={transferencia.destino} onChange={(e) => setTransferencia({ ...transferencia, destino: e.target.value })} style={estiloCampo}>
              <option value="">Selecione...</option>
              {contas.filter((c) => chaveDaConta(c) !== transferencia.origem).map((c) => <option key={chaveDaConta(c)} value={chaveDaConta(c)}>{c.tipo === 'caixa' ? 'Caixa' : 'Banco'} · {c.nome}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={estiloRotulo}>Valor (R$)
              <input value={transferencia.valor} inputMode="decimal" onChange={(e) => setTransferencia({ ...transferencia, valor: e.target.value })} style={estiloCampo} />
            </label>
            <label style={estiloRotulo}>Data
              <input type="date" value={transferencia.data} onChange={(e) => setTransferencia({ ...transferencia, data: e.target.value })} style={estiloCampo} />
            </label>
          </div>
          <label style={estiloRotulo}>Descrição (opcional)
            <input value={transferencia.descricao} maxLength={120} onChange={(e) => setTransferencia({ ...transferencia, descricao: e.target.value })} style={estiloCampo} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn-secondary" onClick={() => setJanela(null)}>Cancelar</button>
            <button type="button" className="btn-primary" disabled={salvando} onClick={() => void confirmarTransferencia()}>{salvando ? 'Transferindo...' : 'Transferir'}</button>
          </div>
        </Janela>
      )}

      {janela === 'caixa' && (
        <Janela titulo={editando ? `Editar ${editando.nome}` : 'Novo caixa'} onFechar={() => setJanela(null)}>
          <label style={estiloRotulo}>Nome
            <input value={formCaixa.nome} maxLength={40} onChange={(e) => setFormCaixa({ ...formCaixa, nome: e.target.value.toUpperCase() })} style={{ ...estiloCampo, textTransform: 'uppercase' }} />
          </label>
          <label style={estiloRotulo}>Descrição (opcional)
            <input value={formCaixa.descricao} maxLength={120} onChange={(e) => setFormCaixa({ ...formCaixa, descricao: e.target.value })} style={estiloCampo} />
          </label>
          {!editando && (
            <label style={estiloRotulo}>Saldo inicial (R$) — o dinheiro que já está nele hoje
              <input value={formCaixa.saldoInicial} inputMode="decimal" onChange={(e) => setFormCaixa({ ...formCaixa, saldoInicial: e.target.value })} style={estiloCampo} />
            </label>
          )}
          {editando && !editando.padrao && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formCaixa.ativo} onChange={(e) => setFormCaixa({ ...formCaixa, ativo: e.target.checked })} style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }} />
              Caixa ativo
            </label>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn-secondary" onClick={() => setJanela(null)}>Cancelar</button>
            <button type="button" className="btn-primary" disabled={salvando} onClick={() => void confirmarCaixa()}>{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </Janela>
      )}

      {janela === 'lancar' && (
        <Janela titulo="Lançar no caixa" onFechar={() => setJanela(null)}>
          <label style={estiloRotulo}>Caixa
            <select value={lancamento.caixaId} onChange={(e) => setLancamento({ ...lancamento, caixaId: e.target.value })} style={estiloCampo}>
              {caixas.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome} ({formatarReais(c.saldoCentavos)})</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['credito', 'debito'] as const).map((d) => (
              <button key={d} type="button" className={lancamento.direcao === d ? 'btn-primary' : 'btn-secondary'} onClick={() => setLancamento({ ...lancamento, direcao: d })} style={{ flex: 1 }}>
                {d === 'credito' ? 'Entrada (+)' : 'Saída (−)'}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={estiloRotulo}>Valor (R$)
              <input value={lancamento.valor} inputMode="decimal" onChange={(e) => setLancamento({ ...lancamento, valor: e.target.value })} style={estiloCampo} />
            </label>
            <label style={estiloRotulo}>Data
              <input type="date" value={lancamento.data} onChange={(e) => setLancamento({ ...lancamento, data: e.target.value })} style={estiloCampo} />
            </label>
          </div>
          <label style={estiloRotulo}>Descrição
            <input value={lancamento.descricao} maxLength={120} onChange={(e) => setLancamento({ ...lancamento, descricao: e.target.value })} style={estiloCampo} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn-secondary" onClick={() => setJanela(null)}>Cancelar</button>
            <button type="button" className="btn-primary" disabled={salvando} onClick={() => void confirmarLancamento()}>{salvando ? 'Gravando...' : 'Gravar'}</button>
          </div>
        </Janela>
      )}
    </div>
  );
};

export default CaixasTransferencias;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ArrowLeftRight, FileText, Loader2, RotateCcw, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { ErroDoServidor } from '../../services/apiServidor';
import {
  desfazerAcertoComFornecedor,
  listarAcertosComFornecedor,
  registrarAcertoComFornecedor,
  type AcertoFeito,
} from '../../services/acertoFornecedorService';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { pedirMotivoEstorno } from '../../utils/baixaFinanceiraUi';
import { centavosDoCampo, textoDoCampo } from '../../utils/ajustesDaBaixaDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { isCardPayment, toCents, type PaymentMethod } from '../../utils/financeDomain';
import { LIMITE_CONTAS_POR_LADO, reaisDoAcerto, ROTULO_SITUACAO_ACERTO } from '../../utils/acertoFornecedorDomain';

/*
 * ACERTO COM FORNECEDOR (24/11/2026, pedido do dono para a Jomarly): o cliente
 * paga direto o fornecedor. Regra em utils/acertoFornecedorDomain.ts; quem
 * grava e' o servidor (services/acertoFornecedorService.ts).
 *
 * A janela mostra, de um lado, as contas em aberto do cliente escolhido e, do
 * outro, as contas a pagar em aberto. Os dois lados precisam somar o mesmo
 * valor. Na aba "Acertos feitos" da' para imprimir o comprovante e desfazer.
 */

export interface TituloParaAcerto {
  id: string;
  descricao?: string;
  valor?: number;
  valorCentavos?: number;
  status?: string;
  clienteNome?: string | null;
  clienteId?: string | null;
  fornecedorId?: string | null;
  fornecedorNome?: string | null;
  dataVencimento?: string | null;
  data?: string | null;
  formaPagamento?: string | null;
  cheque?: unknown;
  boleto?: { nossoNumero?: string | null; status?: string | null } | null;
}

interface Props {
  tenantId: string;
  /** Contas a receber em aberto que a tela ja' tem carregadas. */
  titulosAReceber: TituloParaAcerto[];
  podeDesfazer: boolean;
  onFechar: () => void;
  /** Abre o comprovante (PDF) na tela de quem chamou. */
  onComprovante: (acerto: AcertoFeito) => void;
}

const saldoDe = (t: TituloParaAcerto): number => Number(t.valorCentavos ?? toCents(Number(t.valor || 0)));
const dataBr = (iso?: string | null): string => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const nomeDoDevedor = (t: TituloParaAcerto): string => String((t.fornecedorId ? t.fornecedorNome : t.clienteNome) || t.clienteNome || t.fornecedorNome || '').trim();
const chaveDoDevedor = (t: TituloParaAcerto): string => (t.fornecedorId ? `f:${t.fornecedorId}` : `c:${nomeDoDevedor(t).toUpperCase()}`);

/** Cheque, boleto emitido e cartao tem caminho proprio: nao entram no acerto (o servidor tambem recusa). */
const entraNoAcerto = (t: TituloParaAcerto, lado: 'receber' | 'pagar'): boolean => {
  if (t.status !== 'Pendente') return false;
  if (t.cheque || t.formaPagamento === 'Cheque') return false;
  if (lado === 'receber' && t.boleto?.nossoNumero && t.boleto.status !== 'cancelado') return false;
  if (lado === 'receber' && isCardPayment(t.formaPagamento as PaymentMethod)) return false;
  return saldoDe(t) > 0;
};

const estiloFundo: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1200, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' };
const estiloJanela: React.CSSProperties = { width: '100%', maxWidth: '1080px', maxHeight: '94vh', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const estiloCampo: React.CSSProperties = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 10px', color: 'var(--text-primary)', width: '100%' };
const estiloLista: React.CSSProperties = { border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'auto', maxHeight: '300px' };
const estiloRotulo: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' };

type Escolhas = Record<string, string>;

const AcertoFornecedorModal: React.FC<Props> = ({ tenantId, titulosAReceber, podeDesfazer, onFechar, onComprovante }) => {
  const hoje = getDateInputInTimeZone();
  const [aba, setAba] = useState<'novo' | 'feitos'>('novo');
  const [devedor, setDevedor] = useState('');
  const [buscaCliente, setBuscaCliente] = useState('');
  const [buscaFornecedor, setBuscaFornecedor] = useState('');
  const [receber, setReceber] = useState<Escolhas>({});
  const [pagar, setPagar] = useState<Escolhas>({});
  const [contasAPagar, setContasAPagar] = useState<TituloParaAcerto[] | null>(null);
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [feitos, setFeitos] = useState<AcertoFeito[] | null>(null);
  const [desfazendo, setDesfazendo] = useState('');
  // Um id por acerto: reenviar (a internet caiu) nao grava duas vezes; troca depois de gravar.
  const idAcerto = useRef(crypto.randomUUID());

  const carregarContasAPagar = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('tipo', '==', 'saida'), where('status', '==', 'Pendente')));
      setContasAPagar(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TituloParaAcerto).filter((t) => entraNoAcerto(t, 'pagar')));
    } catch (erro) {
      console.error('Acerto com fornecedor: não foi possível ler as contas a pagar.', erro);
      showError('Não foi possível ler as contas a pagar', 'Confira a internet e abra o acerto de novo.');
      setContasAPagar([]);
    }
  }, [tenantId]);
  useEffect(() => { void carregarContasAPagar(); }, [carregarContasAPagar]);

  const carregarFeitos = useCallback(async () => {
    try {
      setFeitos(await listarAcertosComFornecedor());
    } catch (erro) {
      showError('Não foi possível ler os acertos', erro instanceof ErroDoServidor ? erro.message : 'Confira a internet e tente de novo.');
      setFeitos([]);
    }
  }, []);
  useEffect(() => { if (aba === 'feitos' && feitos === null) void carregarFeitos(); }, [aba, feitos, carregarFeitos]);

  // Clientes com conta em aberto que pode entrar no acerto.
  const devedores = useMemo(() => {
    const mapa = new Map<string, { chave: string; nome: string; contas: number; totalCentavos: number }>();
    titulosAReceber.filter((t) => entraNoAcerto(t, 'receber')).forEach((t) => {
      const chave = chaveDoDevedor(t);
      const atual = mapa.get(chave) || { chave, nome: nomeDoDevedor(t) || 'Sem nome', contas: 0, totalCentavos: 0 };
      mapa.set(chave, { ...atual, contas: atual.contas + 1, totalCentavos: atual.totalCentavos + saldoDe(t) });
    });
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [titulosAReceber]);
  const devedoresFiltrados = useMemo(() => {
    const termo = buscaCliente.trim().toUpperCase();
    return (termo ? devedores.filter((d) => d.nome.toUpperCase().includes(termo)) : devedores).slice(0, 80);
  }, [devedores, buscaCliente]);

  const contasDoCliente = useMemo(
    () => titulosAReceber
      .filter((t) => devedor && chaveDoDevedor(t) === devedor && entraNoAcerto(t, 'receber'))
      .sort((a, b) => String(a.dataVencimento || a.data || '').localeCompare(String(b.dataVencimento || b.data || ''))),
    [titulosAReceber, devedor],
  );
  const contasAPagarFiltradas = useMemo(() => {
    const termo = buscaFornecedor.trim().toUpperCase();
    return (contasAPagar || [])
      .filter((t) => Boolean(pagar[t.id] !== undefined) || !termo || `${t.fornecedorNome || ''} ${t.descricao || ''}`.toUpperCase().includes(termo))
      .sort((a, b) => String(a.fornecedorNome || '').localeCompare(String(b.fornecedorNome || ''), 'pt-BR') || String(a.dataVencimento || a.data || '').localeCompare(String(b.dataVencimento || b.data || '')))
      .slice(0, 200);
  }, [contasAPagar, buscaFornecedor, pagar]);

  const soma = (escolhas: Escolhas): number => Object.values(escolhas).reduce((total, texto) => total + (centavosDoCampo(texto) || 0), 0);
  const totalReceber = soma(receber);
  const totalPagar = soma(pagar);
  const diferenca = totalReceber - totalPagar;

  const alternar = (lado: 'receber' | 'pagar', t: TituloParaAcerto) => {
    const mudar = lado === 'receber' ? setReceber : setPagar;
    mudar((atual) => {
      if (atual[t.id] !== undefined) {
        return Object.fromEntries(Object.entries(atual).filter(([id]) => id !== t.id));
      }
      return { ...atual, [t.id]: textoDoCampo(saldoDe(t)) };
    });
  };
  const mudarValor = (lado: 'receber' | 'pagar', id: string, texto: string) => {
    (lado === 'receber' ? setReceber : setPagar)((atual) => ({ ...atual, [id]: texto }));
  };

  const escolherDevedor = (chave: string) => {
    setDevedor(chave);
    setReceber({});
  };

  const confirmar = async () => {
    const montar = (escolhas: Escolhas, titulos: TituloParaAcerto[], nome: string) => {
      const contas: Array<{ transacaoId: string; valorCentavos: number }> = [];
      for (const [id, texto] of Object.entries(escolhas)) {
        const titulo = titulos.find((t) => t.id === id);
        const centavos = centavosDoCampo(texto);
        if (!titulo || centavos === null || centavos <= 0) return { erro: `Confira o valor de cada conta ${nome} marcada (em reais, com vírgula: 500,00).` };
        if (centavos > saldoDe(titulo)) return { erro: `A conta "${titulo.descricao || ''}" tem ${reaisDoAcerto(saldoDe(titulo))} em aberto; o valor marcado é maior.` };
        contas.push({ transacaoId: id, valorCentavos: centavos });
      }
      return { contas };
    };
    const ladoReceber = montar(receber, contasDoCliente, 'do cliente');
    if ('erro' in ladoReceber) { showError('Confira as contas do cliente', ladoReceber.erro || ''); return; }
    const ladoPagar = montar(pagar, contasAPagar || [], 'de fornecedor');
    if ('erro' in ladoPagar) { showError('Confira as contas dos fornecedores', ladoPagar.erro || ''); return; }
    if (ladoReceber.contas.length === 0 || ladoPagar.contas.length === 0) {
      showError('Falta escolher as contas', 'Marque ao menos uma conta do cliente e ao menos uma conta de fornecedor.');
      return;
    }
    if (ladoReceber.contas.length > LIMITE_CONTAS_POR_LADO || ladoPagar.contas.length > LIMITE_CONTAS_POR_LADO) {
      showError('Contas demais', `Use no máximo ${LIMITE_CONTAS_POR_LADO} contas de cada lado por acerto. Faça em mais de um acerto.`);
      return;
    }
    if (diferenca !== 0) {
      showError('Os dois lados precisam somar o mesmo valor', `As contas do cliente somam ${reaisDoAcerto(totalReceber)} e as dos fornecedores ${reaisDoAcerto(totalPagar)}. Ajuste o valor de uma das contas: a diferença fica em aberto nela.`);
      return;
    }
    const nomeCliente = devedores.find((d) => d.chave === devedor)?.nome || 'o cliente';
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: 'Confirmar o acerto?',
      text: `${nomeCliente} pagou ${reaisDoAcerto(totalReceber)} direto ao(s) fornecedor(es) em ${dataBr(data)}. As contas marcadas dos dois lados serão baixadas, sem mexer em caixa nem em banco.`,
      showCancelButton: true,
      confirmButtonText: 'Sim, fazer o acerto',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;

    setSalvando(true);
    try {
      const r = await registrarAcertoComFornecedor({ idAcerto: idAcerto.current, receber: ladoReceber.contas, pagar: ladoPagar.contas, data, observacao: observacao.trim() });
      idAcerto.current = crypto.randomUUID();
      setReceber({});
      setPagar({});
      setObservacao('');
      setFeitos(null);
      void carregarContasAPagar();
      showSuccess(`Acerto de ${reaisDoAcerto(r.acerto.totalCentavos)} feito. As contas do cliente e dos fornecedores foram baixadas.`);
      const imprimir = await NexusSwal.fire({
        icon: 'question',
        title: 'Imprimir o comprovante?',
        text: `Comprovante de que ${r.acerto.clienteNome || 'o cliente'} pagou direto ${r.acerto.fornecedores.join(', ') || 'o fornecedor'}.`,
        showCancelButton: true,
        confirmButtonText: 'Abrir comprovante',
        cancelButtonText: 'Agora não',
      });
      if (imprimir.isConfirmed) onComprovante(r.acerto);
    } catch (erro) {
      console.error('Erro ao fazer o acerto com fornecedor:', erro);
      showError('O acerto não foi feito', erro instanceof ErroDoServidor ? erro.message : 'Confira a internet e tente de novo. Nada foi alterado.');
    } finally {
      setSalvando(false);
    }
  };

  const desfazer = async (acerto: AcertoFeito) => {
    const motivo = await pedirMotivoEstorno({
      titulo: 'Desfazer o acerto?',
      texto: `As contas de ${acerto.clienteNome || 'cliente'} e as dos fornecedores (${acerto.fornecedores.join(', ') || 'fornecedor'}) voltam a ficar em aberto, no valor de ${reaisDoAcerto(acerto.totalCentavos)}.`,
    });
    if (!motivo) return;
    setDesfazendo(acerto.id);
    try {
      await desfazerAcertoComFornecedor(acerto.id, motivo);
      showSuccess('Acerto desfeito. As contas voltaram a ficar em aberto.');
      await carregarFeitos();
      void carregarContasAPagar();
    } catch (erro) {
      console.error('Erro ao desfazer o acerto com fornecedor:', erro);
      showError('Não foi possível desfazer o acerto', erro instanceof ErroDoServidor ? erro.message : 'Confira a internet e tente de novo.');
    } finally {
      setDesfazendo('');
    }
  };

  const linhaDeConta = (lado: 'receber' | 'pagar', t: TituloParaAcerto) => {
    const escolhas = lado === 'receber' ? receber : pagar;
    const marcada = escolhas[t.id] !== undefined;
    return (
      <tr key={t.id} style={{ borderTop: '1px solid var(--border-color)' }}>
        <td style={{ padding: '6px 8px', width: '28px' }}>
          <input type="checkbox" checked={marcada} onChange={() => alternar(lado, t)} aria-label={`Incluir a conta ${t.descricao || ''}`} style={{ width: '16px', height: '16px', accentColor: 'var(--accent-purple)' }} />
        </td>
        <td style={{ padding: '6px 8px', fontSize: '13px' }}>
          {lado === 'pagar' && <div style={{ fontWeight: 600 }}>{t.fornecedorNome || 'Sem fornecedor'}</div>}
          <div>{t.descricao}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vence {dataBr(t.dataVencimento || t.data) || 'sem data'} · em aberto {reaisDoAcerto(saldoDe(t))}</div>
        </td>
        <td style={{ padding: '6px 8px', width: '120px' }}>
          {marcada && (
            <input
              type="text"
              inputMode="decimal"
              value={escolhas[t.id]}
              onChange={(e) => mudarValor(lado, t.id, e.target.value)}
              aria-label={`Valor da conta ${t.descricao || ''} que entra no acerto, em reais`}
              title="Quanto desta conta entra no acerto; menos que o saldo deixa o resto em aberto"
              style={{ ...estiloCampo, textAlign: 'right', padding: '6px 8px' }}
            />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div style={estiloFundo} role="dialog" aria-modal="true" aria-label="Acerto com fornecedor">
      <div style={estiloJanela}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ArrowLeftRight size={20} /> Acerto com fornecedor</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>O cliente pagou direto o fornecedor: as contas dos dois lados são baixadas juntas, sem mexer em caixa nem em banco.</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>

        <div style={{ display: 'flex', gap: '8px', padding: '10px 20px 0' }}>
          {([['novo', 'Novo acerto'], ['feitos', 'Acertos feitos']] as const).map(([id, rotulo]) => (
            <button key={id} type="button" onClick={() => setAba(id)} className={aba === id ? 'btn-primary' : 'btn-secondary'} style={{ padding: '6px 14px', fontSize: '13px' }}>{rotulo}</button>
          ))}
        </div>

        {aba === 'novo' ? (
          <>
            <div style={{ padding: '14px 20px', overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: '18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <span style={estiloRotulo}>1. Cliente que pagou o fornecedor</span>
                <input type="text" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} placeholder="Buscar cliente..." aria-label="Buscar cliente" style={estiloCampo} />
                <select value={devedor} onChange={(e) => escolherDevedor(e.target.value)} aria-label="Cliente" style={estiloCampo}>
                  <option value="">Selecione o cliente...</option>
                  {devedoresFiltrados.map((d) => <option key={d.chave} value={d.chave}>{d.nome} — {d.contas} conta(s), {reaisDoAcerto(d.totalCentavos)}</option>)}
                </select>
                <span style={estiloRotulo}>2. Contas dele que entram no acerto</span>
                <div style={estiloLista}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {!devedor ? (
                        <tr><td style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Escolha o cliente para ver as contas em aberto.</td></tr>
                      ) : contasDoCliente.length === 0 ? (
                        <tr><td style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Este cliente não tem conta em aberto que possa entrar no acerto.</td></tr>
                      ) : contasDoCliente.map((t) => linhaDeConta('receber', t))}
                    </tbody>
                  </table>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Conta em cheque, com boleto emitido ou de cartão não aparece aqui.</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <span style={estiloRotulo}>3. Contas de fornecedor que ele pagou</span>
                <input type="text" value={buscaFornecedor} onChange={(e) => setBuscaFornecedor(e.target.value)} placeholder="Buscar fornecedor ou conta..." aria-label="Buscar fornecedor ou conta" style={estiloCampo} />
                <div style={{ ...estiloLista, maxHeight: '372px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {contasAPagar === null ? (
                        <tr><td style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Carregando as contas a pagar...</td></tr>
                      ) : contasAPagarFiltradas.length === 0 ? (
                        <tr><td style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma conta a pagar em aberto{buscaFornecedor.trim() ? ' com essa busca' : ''}. Lance a conta em Contas a Pagar.</td></tr>
                      ) : contasAPagarFiltradas.map((t) => linhaDeConta('pagar', t))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '13px', lineHeight: 1.6, minWidth: '250px' }}>
                <div>Contas do cliente: <strong>{reaisDoAcerto(totalReceber)}</strong></div>
                <div>Contas dos fornecedores: <strong>{reaisDoAcerto(totalPagar)}</strong></div>
                <div style={{ fontWeight: 700, color: diferenca === 0 && totalReceber > 0 ? '#10b981' : '#ef4444' }}>
                  {totalReceber === 0 && totalPagar === 0
                    ? 'Marque as contas dos dois lados.'
                    : diferenca === 0
                      ? 'Os dois lados batem.'
                      : `Diferença de ${reaisDoAcerto(Math.abs(diferenca))}: ${diferenca > 0 ? 'o cliente está com valor a mais' : 'os fornecedores estão com valor a mais'}.`}
                </div>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Data em que o cliente pagou
                <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} style={{ ...estiloCampo, width: '170px' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)', flex: 1, minWidth: '200px' }}>
                Observação (opcional)
                <input type="text" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} style={estiloCampo} />
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn-secondary" onClick={onFechar} disabled={salvando}>Cancelar</button>
                <button type="button" className="btn-primary" onClick={() => void confirmar()} disabled={salvando} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  {salvando ? <Loader2 size={16} className="spin-icon" /> : <ArrowLeftRight size={16} />} Fazer o acerto
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '14px 20px', overflow: 'auto' }}>
            {feitos === null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spin-icon" /> Carregando...</div>
            ) : feitos.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhum acerto com fornecedor feito ainda.</p>
            ) : (
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Pagou direto a</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Situação</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {feitos.map((a) => (
                    <tr key={a.id}>
                      <td>{dataBr(a.data)}</td>
                      <td>{a.clienteNome}</td>
                      <td>{a.fornecedores.join(', ')}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{reaisDoAcerto(a.totalCentavos)}</td>
                      <td style={{ color: a.status === 'estornado' ? '#ef4444' : '#10b981', fontWeight: 600 }} title={a.status === 'estornado' ? `Motivo: ${a.motivoDoEstorno}` : undefined}>{ROTULO_SITUACAO_ACERTO[a.status] || a.status}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn-secondary" onClick={() => onComprovante(a)} style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '6px' }}>
                          <FileText size={14} /> Comprovante
                        </button>
                        {podeDesfazer && a.status === 'concluido' && (
                          <button type="button" className="btn-secondary" disabled={desfazendo !== ''} onClick={() => void desfazer(a)} title="Volta as contas do cliente e dos fornecedores para em aberto" style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <RotateCcw size={14} /> {desfazendo === a.id ? 'Desfazendo...' : 'Desfazer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AcertoFornecedorModal;

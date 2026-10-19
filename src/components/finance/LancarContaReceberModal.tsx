import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc } from 'firebase/firestore';
import { ArrowUpCircle, Building2, CheckCircle, Loader2, User, X, AlertTriangle } from 'lucide-react';
import { db } from '../../services/firebase';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import ClientAutocomplete from '../common/ClientAutocomplete';
import ParcelasEditor from '../financeiro/ParcelasEditor';
import NovaCategoriaInline from './NovaCategoriaInline';
import { showError } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { addDaysToDateInput, getDateInputInTimeZone } from '../../utils/dateTime';
import { fromCents, toCents } from '../../utils/financeDomain';
import { dividirEmParcelas } from '../../utils/pagamentoEntradaDomain';
import { avisoDeSoma } from '../../utils/despesaParceladaDomain';
import type { ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import { faltandoNoPagador, pagadorDoCadastro } from '../../utils/cobrancaEmBoletoDomain';
import {
  FORMAS_PREVISTAS_RECEBER,
  LIMITE_PARCELAS_LANCAMENTO,
  MENSAGEM_ESCOLHA_DEVEDOR,
  type TipoDevedor,
} from '../../utils/lancamentoReceberDomain';
import { editarContaAReceber, lancarContaAReceber } from '../../services/baixaFinanceiraService';

/*
 * LANCAR CONTA A RECEBER (19/10/2026, pedido do dono): valor que um CLIENTE ou
 * um FORNECEDOR deve a empresa sem ter vindo de venda/OS. A conta entra em
 * aberto (o recebimento e' o "Dar baixa" de sempre) e o servidor grava, com o
 * log de quem lancou. Regra em src/utils/lancamentoReceberDomain.ts.
 *
 * Editando, a mesma janela mexe numa parcela so': descricao, categoria, forma
 * prevista, vencimento, documento, observacao e quem paga. O valor muda pelo
 * "Alterar valor" (pede motivo).
 *
 * Conta nova vence em 30 dias (pedido do dono); a categoria pode ser criada ali
 * mesmo (NovaCategoriaInline). Sem texto dentro dos campos (decisao do dono).
 */

/** Vencimento sugerido de uma conta nova: daqui a 30 dias. */
const PRAZO_PADRAO_DIAS = 30;

export interface ContaParaEditar {
  id: string;
  descricao: string;
  categoria?: string;
  formaPagamento?: string;
  vencimento: string;
  valor: number;
  documento?: string;
  observacao?: string;
  clienteId?: string | null;
  clienteNome?: string | null;
  fornecedorId?: string | null;
  fornecedorNome?: string | null;
}

interface Props {
  aberto: boolean;
  tenantId: string;
  /** Plano de contas de receitas da filial (Configuracoes). */
  categorias: string[];
  editando?: ContaParaEditar | null;
  onFechar: () => void;
  onSalvo: (mensagem: string) => void;
  /** Categoria criada na janela: a tela atualiza o plano de contas que ela guarda. */
  onCategoriasAtualizadas?: (lista: string[]) => void;
}

interface Cadastro {
  id: string;
  nome?: string;
  codigo?: string;
  documento?: string;
  cnpj?: string;
  telefone?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  ativo?: boolean;
}

const campo: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
  padding: '12px', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
};
const rotulo: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };
const grupo: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px' };
const opcional = <span style={{ color: 'var(--text-muted)' }}>(opcional)</span>;
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numeroDoCampo = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;

const LancarContaReceberModal: React.FC<Props> = ({ aberto, tenantId, categorias, editando = null, onFechar, onSalvo, onCategoriasAtualizadas }) => {
  const { items: clientes } = useTenantCollection<Cadastro>('clientes', tenantId, { enabled: aberto });
  const { items: fornecedores } = useTenantCollection<Cadastro>('fornecedores', tenantId, { enabled: aberto });
  const fornecedoresAtivos = useMemo(() => fornecedores.filter((f) => f.ativo !== false), [fornecedores]);

  const [tipo, setTipo] = useState<TipoDevedor>('cliente');
  const [busca, setBusca] = useState('');
  const [devedor, setDevedor] = useState<{ id: string; nome: string } | null>(null);
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState(() => addDaysToDateInput(getDateInputInTimeZone(), PRAZO_PADRAO_DIAS));
  const [forma, setForma] = useState<string>('Boleto');
  const [parcelar, setParcelar] = useState(false);
  const [parcelas, setParcelas] = useState<ParcelaComCheque[]>([]);
  const [parcelasAceitas, setParcelasAceitas] = useState(false);
  const [documento, setDocumento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  // Id do lancamento, gerado ao abrir: repetir o envio (internet caiu) nao lanca duas vezes.
  const [idLancamento, setIdLancamento] = useState('');

  useEffect(() => {
    if (!aberto) return;
    setIdLancamento(doc(collection(db, 'transacoes')).id);
    setSalvando(false);
    setParcelar(false);
    setParcelas([]);
    setParcelasAceitas(false);
    if (editando) {
      const ehFornecedor = Boolean(editando.fornecedorId);
      setTipo(ehFornecedor ? 'fornecedor' : 'cliente');
      const id = String((ehFornecedor ? editando.fornecedorId : editando.clienteId) || '');
      const nome = String((ehFornecedor ? editando.fornecedorNome : editando.clienteNome) || '');
      setDevedor(id ? { id, nome } : null);
      setBusca(nome);
      setDescricao(editando.descricao || '');
      // A conta guarda a categoria em maiuscula; o select mostra a do plano de contas.
      const salva = String(editando.categoria || '');
      setCategoria(categorias.find((c) => c.toUpperCase() === salva.toUpperCase()) || salva);
      setValor(String(editando.valor ?? '').replace('.', ','));
      setVencimento(editando.vencimento || getDateInputInTimeZone());
      setForma(editando.formaPagamento && (FORMAS_PREVISTAS_RECEBER as readonly string[]).includes(editando.formaPagamento) ? editando.formaPagamento : 'Outros');
      setDocumento(editando.documento || '');
      setObservacao(editando.observacao || '');
    } else {
      setTipo('cliente');
      setDevedor(null);
      setBusca('');
      setDescricao('');
      setCategoria(categorias[0] || '');
      setValor('');
      setVencimento(addDaysToDateInput(getDateInputInTimeZone(), PRAZO_PADRAO_DIAS));
      setForma('Boleto');
      setDocumento('');
      setObservacao('');
    }
  }, [aberto, editando]); // eslint-disable-line react-hooks/exhaustive-deps

  useEscapeLayer(aberto && !salvando, onFechar);

  const lista = tipo === 'cliente' ? clientes : fornecedoresAtivos;
  const cadastroEscolhido = devedor ? lista.find((c) => c.id === devedor.id) || null : null;
  // Boleto usa o cadastro de quem paga: avisa ja' aqui o que falta (o banco recusa sem).
  const faltandoParaBoleto = forma === 'Boleto' && cadastroEscolhido ? faltandoNoPagador(pagadorDoCadastro(cadastroEscolhido)) : [];

  const total = numeroDoCampo(valor);
  const parcelasEfetivas = parcelar ? parcelas : [{ numero: '1', vencimento, valor: total }];
  const somaParcelas = parcelasEfetivas.reduce((s, p) => s + (Number(p.valor) || 0), 0);

  const trocarTipo = (novo: TipoDevedor) => {
    if (novo === tipo) return;
    setTipo(novo);
    setDevedor(null);
    setBusca('');
  };

  const ligarParcelas = (ligar: boolean) => {
    setParcelar(ligar);
    setParcelasAceitas(false);
    if (ligar && parcelas.length === 0) setParcelas(dividirEmParcelas(total, 2, vencimento));
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    if (!devedor) { showError('Quem vai pagar?', MENSAGEM_ESCOLHA_DEVEDOR); return; }
    if (!descricao.trim()) { showError('Atenção', 'Informe a descrição: do que é este valor a receber.'); return; }
    if (!vencimento) { showError('Atenção', 'Informe a data de vencimento.'); return; }

    setSalvando(true);
    try {
      if (editando) {
        const r = await editarContaAReceber({
          tenantId,
          transacaoId: editando.id,
          devedor: { tipo, id: devedor.id },
          descricao, categoria, formaPrevista: forma, documento, observacao, vencimento,
        });
        onSalvo(r.alterou ? 'Conta a receber atualizada.' : 'Nada mudou na conta.');
        return;
      }
      if (!(total > 0)) { showError('Atenção', 'Informe o valor a receber, maior que zero.'); return; }
      if (parcelar) {
        if (parcelas.length === 0) { showError('Parcelas', 'Monte as parcelas (botão Dividir) ou desmarque "Receber em parcelas".'); return; }
        if (parcelas.length > LIMITE_PARCELAS_LANCAMENTO) { showError('Parcelas', `Lance no máximo ${LIMITE_PARCELAS_LANCAMENTO} parcelas de uma vez.`); return; }
        const semData = parcelas.findIndex((p) => !p.vencimento);
        if (semData >= 0) { showError('Parcelas', `Parcela ${semData + 1}: informe o vencimento.`); return; }
        const semValor = parcelas.findIndex((p) => !(Number(p.valor) > 0));
        if (semValor >= 0) { showError('Parcelas', `Parcela ${semValor + 1}: o valor deve ser maior que zero.`); return; }
        const aviso = avisoDeSoma(parcelas, total);
        if (aviso && !parcelasAceitas) {
          showError('As parcelas não fecham com o valor', `${aviso} Ajuste os valores ou marque "Conferi as parcelas e quero lançar assim".`);
          return;
        }
      }
      const r = await lancarContaAReceber({
        tenantId,
        idLancamento,
        devedor: { tipo, id: devedor.id },
        descricao,
        categoria,
        formaPrevista: forma,
        documento,
        observacao,
        parcelas: parcelasEfetivas.map((p) => ({ vencimento: p.vencimento, valorCentavos: toCents(Number(p.valor) || 0) })),
      });
      onSalvo(r.jaLancado
        ? 'Esta conta já tinha sido lançada (o envio anterior chegou). Nada foi duplicado.'
        : `Conta a receber lançada: ${reais(fromCents(r.totalCentavos))}${r.quantidade > 1 ? ` em ${r.quantidade} parcelas` : ''}.`);
    } catch (erro) {
      showError(editando ? 'Não foi possível salvar' : 'Não foi possível lançar', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
    } finally {
      setSalvando(false);
    }
  };

  if (!aberto) return null;
  const largo = parcelar && !editando;

  const botaoTipo = (valorTipo: TipoDevedor, texto: string, Icone: typeof User) => (
    <button
      type="button"
      onClick={() => trocarTipo(valorTipo)}
      aria-pressed={tipo === valorTipo}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 12px', cursor: 'pointer',
        borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: '14px',
        border: `1px solid ${tipo === valorTipo ? '#10b981' : 'var(--border-color)'}`,
        backgroundColor: tipo === valorTipo ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-tertiary)',
        color: tipo === valorTipo ? '#10b981' : 'var(--text-secondary)',
      }}
    >
      <Icone size={16} /> {texto}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '16px' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editando ? 'Editar conta a receber' : 'Lançar conta a receber'}
        style={{
          backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: largo ? '900px' : '560px',
          maxHeight: '92vh', overflow: 'hidden auto', border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', margin: 0 }}>
            <ArrowUpCircle size={24} />
            {editando ? 'Editar conta a receber' : 'Lançar conta a receber'}
          </h2>
          <button type="button" onClick={onFechar} disabled={salvando} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <form onSubmit={salvar} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={grupo}>
            <span style={rotulo}>Quem vai pagar</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {botaoTipo('cliente', 'Cliente', User)}
              {botaoTipo('fornecedor', 'Fornecedor', Building2)}
            </div>
            <ClientAutocomplete<Cadastro>
              value={busca}
              onChange={(texto) => {
                setBusca(texto);
                // Apagou o nome: desvincula (a conta nao pode ficar presa a quem nao esta mais escrito).
                if (!texto.trim()) setDevedor(null);
              }}
              clients={lista}
              onSelect={(c) => {
                const nome = String(c.nome || '').trim();
                setDevedor({ id: c.id, nome });
                setBusca(nome);
              }}
              {...(tipo === 'fornecedor'
                ? {
                  renderItem: (f: Cadastro) => <span>{f.codigo ? `${f.codigo} · ${f.nome}` : f.nome}</span>,
                  emptyHint: <span>Nenhum fornecedor com esse nome. Cadastre em Cadastros &gt; Fornecedores.</span>,
                }
                : {
                  buscaDeCliente: true,
                  emptyHint: <span>Nenhum cliente com esse nome. Cadastre em Clientes.</span>,
                })}
              placeholder={tipo === 'cliente' ? 'Buscar cliente' : 'Buscar fornecedor'}
              ariaLabel={tipo === 'cliente' ? 'Buscar cliente' : 'Buscar fornecedor'}
            />
            {devedor && (
              <div style={{ fontSize: '12.5px', color: '#10b981', fontWeight: 600 }}>
                {tipo === 'cliente' ? 'Cliente' : 'Fornecedor'}: {devedor.nome}
              </div>
            )}
            {faltandoParaBoleto.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12.5px', color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>Para emitir o boleto, o banco exige {faltandoParaBoleto.join(', ')} de quem paga. Complete em {tipo === 'cliente' ? 'Clientes' : 'Fornecedores'} antes de emitir (a conta pode ser lançada agora).</span>
              </div>
            )}
          </div>

          <div style={grupo}>
            <label style={rotulo} htmlFor="lcr-descricao">Descrição</label>
            <input
              id="lcr-descricao"
              type="text"
              value={descricao}
              maxLength={200}
              onChange={(e) => setDescricao(aplicarCaixaAltaCadastro(e.target, e.target.value))}
              style={{ ...campo, textTransform: 'uppercase' }}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
            <div style={grupo}>
              <label style={rotulo} htmlFor="lcr-valor">{parcelar ? 'Valor total (R$)' : 'Valor (R$)'}</label>
              <input
                id="lcr-valor"
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => { setValor(e.target.value.replace(/[^0-9,.]/g, '')); setParcelasAceitas(false); }}
                disabled={Boolean(editando)}
                title={editando ? 'Para mudar o valor, use "Alterar valor" na conta.' : undefined}
                style={{ ...campo, fontWeight: 600, fontSize: '16px', opacity: editando ? 0.7 : 1 }}
                required={!editando}
              />
            </div>
            <div style={grupo}>
              <label style={rotulo} htmlFor="lcr-vencimento">{parcelar ? '1º vencimento' : 'Vencimento'}</label>
              <input id="lcr-vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} style={campo} required />
            </div>
            <div style={grupo}>
              <label style={rotulo} htmlFor="lcr-forma">Forma prevista</label>
              <select id="lcr-forma" value={forma} onChange={(e) => setForma(e.target.value)} style={campo}>
                {FORMAS_PREVISTAS_RECEBER.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          {editando && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-8px' }}>
              O valor não muda aqui: para mudar, use "Alterar valor" na conta.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div style={grupo}>
              <label style={rotulo} htmlFor="lcr-categoria">Categoria (Plano de Contas)</label>
              <select id="lcr-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={campo}>
                {categoria && !categorias.some((c) => c.toUpperCase() === categoria.toUpperCase()) && <option value={categoria}>{categoria.toUpperCase()}</option>}
                {categorias.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
              <NovaCategoriaInline
                tipo="receita"
                tenantId={tenantId}
                onCriada={(nome, lista) => {
                  onCategoriasAtualizadas?.(lista);
                  setCategoria(lista.find((c) => c.toUpperCase() === nome.toUpperCase()) || nome);
                }}
              />
            </div>
            <div style={grupo}>
              <label style={rotulo} htmlFor="lcr-documento">Nº do documento {opcional}</label>
              <input id="lcr-documento" type="text" value={documento} maxLength={60} onChange={(e) => setDocumento(e.target.value)} style={campo} />
            </div>
          </div>

          {!editando && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={parcelar} onChange={(e) => ligarParcelas(e.target.checked)} />
                Receber em parcelas
              </label>
              {parcelar && (
                <ParcelasEditor
                  parcelas={parcelas}
                  onParcelas={setParcelas}
                  total={total}
                  dataBase={getDateInputInTimeZone()}
                  // Cheque a receber: os dados do cheque entram na baixa, nao aqui.
                  forma={forma === 'Cheque' ? 'Cheque a receber' : forma}
                  bancos={[]}
                  aceitas={parcelasAceitas}
                  onAceitar={setParcelasAceitas}
                />
              )}
            </>
          )}

          <div style={grupo}>
            <label style={rotulo} htmlFor="lcr-observacao">Observação {opcional}</label>
            <textarea id="lcr-observacao" value={observacao} maxLength={500} rows={2} onChange={(e) => setObservacao(e.target.value)} style={{ ...campo, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {editando
                ? <>Valor da conta: <strong style={{ color: 'var(--text-primary)' }}>{reais(Number(editando.valor) || 0)}</strong></>
                : <>A receber: <strong style={{ color: '#10b981', fontSize: '16px' }}>{reais(somaParcelas)}</strong>{parcelasEfetivas.length > 1 ? ` em ${parcelasEfetivas.length} parcelas` : ''} · entra em aberto</>}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="button" className="btn-secondary" onClick={onFechar} disabled={salvando}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={salvando} style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}>
                {salvando ? <Loader2 size={18} className="spin-animation" /> : <CheckCircle size={18} />}
                {editando ? 'Salvar alterações' : (parcelasEfetivas.length > 1 ? 'Lançar parcelas' : 'Lançar conta')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LancarContaReceberModal;

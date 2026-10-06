import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Power, Save, Tag } from 'lucide-react';
import { useTabs } from '../../contexts/TabsContext';
import { showError, showSuccess } from '../../utils/alerts';
import { erroDeAcessoNegado } from '../../utils/erroFirestoreDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { alterarSituacaoDaPromocao, promocoesComProdutos, salvarPromocao } from '../../services/promocaoService';
import {
  margemDaPromocao,
  precoBaseDaPromocao,
  precoPromocionalDoItem,
  resumoDoPeriodo,
  ROTULO_STATUS_PROMOCAO,
  statusDaPromocao,
  type PromocaoComId,
} from '../../utils/promocaoDomain';

/**
 * PROMOCAO INDIVIDUAL NO CADASTRO DO PRODUTO (2026-10-01).
 *
 * "O preco promocional e' caso queira definir uma promocao dentro do item
 * individual, mesmo fora da tela de promocao" -- e as duas nunca se duplicam.
 * Por isso a individual E' uma promocao da tela Promocoes, marcada
 * `individual`, com um produto so': a mesma trava (promocaoDomain
 * .conflitosDaPromocao) vale nos dois sentidos.
 */

interface Props {
  tenantId: string;
  uid: string;
  produto: { id: string; nome: string; codigo: string; precoVenda: number; precoAVista: number; precoCusto: number };
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const numero = (texto: string): number => {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const PromocaoIndividualPanel: React.FC<Props> = ({ tenantId, uid, produto }) => {
  const { openTab } = useTabs();
  const hoje = getDateInputInTimeZone();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [daTela, setDaTela] = useState<PromocaoComId[]>([]);
  const [individualId, setIndividualId] = useState<string | undefined>();
  const [inativa, setInativa] = useState(false);
  const [form, setForm] = useState({ preco: '', inicio: hoje, fim: '', continua: false, quota: '', soAVista: false });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const todas = await promocoesComProdutos(tenantId, [produto.id]);
      // So' importa o que vale agora ou vai valer: o historico fica na tela Promocoes.
      const ativas = todas.filter((p) => statusDaPromocao(p, hoje) !== 'encerrada');
      setDaTela(ativas.filter((p) => !p.individual && !p.inativa));
      const individual = ativas.find((p) => p.individual) || todas.find((p) => p.individual && statusDaPromocao(p, hoje) !== 'encerrada');
      if (individual) {
        const item = individual.itens[0];
        setIndividualId(individual.id);
        setInativa(individual.inativa);
        setForm({
          preco: item ? String(item.valor).replace('.', ',') : '',
          inicio: individual.dataInicio,
          fim: individual.dataFim,
          continua: individual.continua,
          quota: item?.quota ? String(item.quota) : '',
          soAVista: individual.formas === 'vista',
        });
      }
    } catch (erro) {
      console.error('Erro ao carregar as promoções do produto:', erro);
    } finally {
      setCarregando(false);
    }
  }, [tenantId, produto.id, hoje]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const formas = form.soAVista ? 'vista' : 'todas';
      const novoId = await salvarPromocao({
        tenantId,
        uid,
        id: individualId,
        promocao: {
          nome: `PROMOÇÃO ${produto.nome}`.slice(0, 60),
          individual: true,
          dataInicio: form.inicio,
          dataFim: form.fim,
          continua: form.continua,
          inativa: false,
          diasSemana: [],
          formas,
          limitePorVenda: null,
          observacao: '',
          itens: [{ produtoId: produto.id, codigo: produto.codigo, nome: produto.nome, tipo: 'valor', valor: numero(form.preco), quota: numero(form.quota) || null }],
        },
        precosAtuais: { [produto.id]: precoBaseDaPromocao(formas, { venda: produto.precoVenda, vista: produto.precoAVista }) },
      });
      setIndividualId(novoId);
      setInativa(false);
      showSuccess('Promoção do produto salva.');
    } catch (erro) {
      console.error('Erro ao salvar a promoção do produto:', erro);
      showError('Não foi possível salvar a promoção', erroDeAcessoNegado(erro)
        ? 'Você não tem permissão para alterar promoções. Peça ao administrador a permissão "Vendas: Promoções".'
        : ((erro as { code?: string })?.code ? 'Confira sua conexão e tente de novo.' : (erro as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  const encerrar = async () => {
    if (!individualId) return;
    try {
      await alterarSituacaoDaPromocao(uid, individualId, !inativa);
      setInativa(!inativa);
      showSuccess(inativa ? 'Promoção reativada.' : 'Promoção encerrada: o produto volta ao preço normal.');
    } catch (erro) {
      showError('Não foi possível alterar', erroDeAcessoNegado(erro) ? 'Você não tem permissão para alterar promoções.' : 'Tente de novo.');
    }
  };

  const formas = form.soAVista ? 'vista' : 'todas';
  const base = precoBaseDaPromocao(formas, { venda: produto.precoVenda, vista: produto.precoAVista });
  const precoPromo = precoPromocionalDoItem({ tipo: 'valor', valor: numero(form.preco) }, base);
  const margem = margemDaPromocao(precoPromo, produto.precoCusto);
  const campo: React.CSSProperties = { padding: '9px 11px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' };
  const statusIndividual = individualId
    ? statusDaPromocao({ inativa, dataInicio: form.inicio, dataFim: form.fim, continua: form.continua }, hoje)
    : null;

  return (
    <div style={{ marginTop: '20px', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <Tag size={18} color="var(--accent-purple)" />
        <strong>Promoção deste produto</strong>
        {statusIndividual && <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '10px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{ROTULO_STATUS_PROMOCAO[statusIndividual]}</span>}
        {carregando && <Loader2 size={15} className="spin-icon" />}
      </div>

      {!carregando && daTela.length > 0 && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: '#fbbf24' }}>
          {daTela.map((p) => (
            <div key={p.id}>
              Este produto está na promoção <button type="button" onClick={() => openTab(`/vendas/promocoes/${p.id}`)} style={{ background: 'none', border: 'none', color: 'var(--accent-purple)', cursor: 'pointer', padding: 0, fontWeight: 700 }}>"{p.nome}"</button> (tela Promoções), {resumoDoPeriodo(p)}.
              {' '}Para criar uma promoção individual no mesmo período, tire-o de lá antes.
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          Preço promocional (R$)
          <input inputMode="decimal" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} style={campo} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          Começa em
          <input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} style={campo} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          Termina em
          <input type="date" value={form.continua ? '' : form.fim} disabled={form.continua} onChange={(e) => setForm({ ...form, fim: e.target.value })} style={campo} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          Quantidade em promoção
          <input inputMode="numeric" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} placeholder="Sem limite" style={campo} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input type="checkbox" checked={form.continua} onChange={(e) => setForm({ ...form, continua: e.target.checked })} /> Sem data para acabar
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input type="checkbox" checked={form.soAVista} onChange={(e) => setForm({ ...form, soAVista: e.target.checked })} /> Só à vista (dinheiro, Pix, débito, crédito 1x)
        </label>
      </div>

      {numero(form.preco) > 0 && (
        <div style={{ marginTop: '10px', fontSize: '13px' }}>
          De <s>{moeda(base)}</s> por <strong style={{ color: 'var(--accent-purple)' }}>{moeda(precoPromo)}</strong>
          {margem.lucroPercentual !== null && (
            <span style={{ marginLeft: '10px', color: margem.abaixoDoCusto ? '#ef4444' : 'var(--text-muted)' }}>
              {margem.abaixoDoCusto ? `abaixo do custo (${moeda(produto.precoCusto)})` : `lucro de ${margem.lucroPercentual.toFixed(1)}% sobre o custo`}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={salvando || carregando} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {salvando ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />} {individualId ? 'Salvar promoção' : 'Colocar em promoção'}
        </button>
        {individualId && (
          <button type="button" className="btn-secondary" onClick={() => void encerrar()} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: inativa ? '#10b981' : '#ef4444' }}>
            <Power size={16} /> {inativa ? 'Reativar' : 'Encerrar promoção'}
          </button>
        )}
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>Salva na hora, separado do botão "Salvar" do produto. Para vários produtos de uma vez, use Vendas › Promoções.</span>
      </div>
    </div>
  );
};

export default PromocaoIndividualPanel;

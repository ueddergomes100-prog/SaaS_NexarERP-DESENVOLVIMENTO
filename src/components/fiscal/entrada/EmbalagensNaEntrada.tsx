import React, { useState } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { custoDaEmbalagem, margemSobreCusto, normalizeEmbalagens } from '../../../utils/embalagemDomain';
import {
  edicaoInicialDasEmbalagens,
  numeroDoCampoDeEmbalagem,
  type EdicaoDasEmbalagens,
  type EmbalagemNovaNaEntrada,
} from '../../../utils/embalagemNaEntradaDomain';

/**
 * Bloco "Embalagens" do item da nota (26/11/2026, pedido do dono): mostra as
 * embalagens do produto para corrigir custo e preco, e cadastra a que falta.
 * Usado na Entrada de XML e na Nota Avulsa (tambem no XML importado nela).
 * Regra em utils/embalagemNaEntradaDomain.ts; quem grava e' a tela que salva a entrada.
 */
export interface UnidadeParaEmbalagem {
  id: string;
  sigla: string;
  casasDecimais?: number;
  permiteFracionado?: boolean;
}

interface Props {
  /** Id do item na tela (para os ids dos campos). */
  idBase: string;
  nomeDoProduto: string;
  /** Campo `embalagens` cru do produto (vazio para produto novo). */
  embalagensDoCadastro: unknown;
  /** Sigla da unidade do estoque do produto. */
  siglaBase: string;
  /** Custo por unidade do estoque que esta nota esta' dando (para sugerir o da embalagem). */
  custoBase: number;
  /** Preco de venda por unidade do estoque (para mostrar o calculado). */
  precoBase: number;
  unidades: ReadonlyArray<UnidadeParaEmbalagem>;
  podePreco: boolean;
  podeCusto: boolean;
  /** undefined = a pessoa ainda nao mexeu (abre com o que o cadastro tem). */
  valor: EdicaoDasEmbalagens | undefined;
  onChange: (valor: EdicaoDasEmbalagens) => void;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const rotuloStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' };
const campoStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box',
};
const ajudaStyle: React.CSSProperties = { fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '3px' };

const novaVazia = (): EmbalagemNovaNaEntrada => ({
  chave: `nova-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  unidadeMedidaId: '', sigla: '', casasDecimais: 0, fracionado: false, fator: '', precoCusto: '', precoVenda: '', precoAVista: '',
});

const EmbalagensNaEntrada: React.FC<Props> = ({
  idBase, nomeDoProduto, embalagensDoCadastro, siglaBase, custoBase, precoBase, unidades, podePreco, podeCusto, valor, onChange,
}) => {
  const atuais = normalizeEmbalagens(embalagensDoCadastro).filter((e) => e.ativo);
  const edicao = valor ?? edicaoInicialDasEmbalagens(embalagensDoCadastro);
  const [aberto, setAberto] = useState(atuais.length > 0);
  const podeAlgo = podePreco || podeCusto;

  const editarExistente = (id: string, campo: 'precoCusto' | 'precoVenda' | 'precoAVista', texto: string) => {
    onChange({ ...edicao, existentes: edicao.existentes.map((e) => (e.id === id ? { ...e, [campo]: texto } : e)) });
  };
  const editarNova = (chave: string, patch: Partial<EmbalagemNovaNaEntrada>) => {
    onChange({ ...edicao, novas: edicao.novas.map((n) => (n.chave === chave ? { ...n, ...patch } : n)) });
  };

  const resumo = atuais.length === 0 && edicao.novas.length === 0
    ? 'O produto não tem embalagem cadastrada.'
    : `${atuais.length} cadastrada(s)${edicao.novas.length ? ` · ${edicao.novas.length} nova(s) nesta entrada` : ''}`;

  return (
    <div style={{ marginTop: '12px', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 700, fontSize: '14px', textAlign: 'left' }}
      >
        <Package size={16} aria-hidden="true" /> Embalagens
        <span style={{ fontWeight: 400, fontSize: '12.5px', color: 'var(--text-muted)' }}>— {resumo}</span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--accent-purple, #7c3aed)' }}>{aberto ? 'Fechar' : 'Abrir'}</span>
      </button>

      {aberto && (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {!podeAlgo && (
            <div style={ajudaStyle}>Para mexer nas embalagens precisa de "Estoque: alterar o preço" ou "Estoque: alterar o custo" no seu cadastro de funcionário.</div>
          )}

          {atuais.map((emb) => {
            const ed = edicao.existentes.find((e) => e.id === emb.id);
            if (!ed) return null;
            const custoCalculado = custoDaEmbalagem({ precoCusto: 0, fatorConversao: emb.fatorConversao }, custoBase);
            const custoProprio = numeroDoCampoDeEmbalagem(ed.precoCusto);
            const custoQueVale = custoProprio && custoProprio > 0 ? custoProprio : custoCalculado;
            const vendaDigitada = numeroDoCampoDeEmbalagem(ed.precoVenda);
            const vendaQueVale = vendaDigitada && vendaDigitada > 0 ? vendaDigitada : Math.round(precoBase * emb.fatorConversao * 100) / 100;
            const margem = margemSobreCusto(vendaQueVale, custoQueVale);
            const id = `${idBase}-emb-${emb.id}`;
            return (
              <div key={emb.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', alignItems: 'start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>{emb.unidadeMedidaSigla} de {String(emb.fatorConversao).replace('.', ',')} {siglaBase}</div>
                  <div style={ajudaStyle}>Margem: {margem === null ? '—' : `${margem.toFixed(1).replace('.', ',')}%`}</div>
                </div>
                <div>
                  <label htmlFor={`${id}-custo`} style={rotuloStyle}>Custo</label>
                  <input id={`${id}-custo`} inputMode="decimal" style={campoStyle} value={ed.precoCusto} disabled={!podeCusto} onChange={(e) => editarExistente(emb.id, 'precoCusto', e.target.value)} />
                  <div style={ajudaStyle}>Pela nota: {brl(custoCalculado)}{ed.precoCusto.trim() === '' ? ' (vale este)' : ''}</div>
                </div>
                <div>
                  <label htmlFor={`${id}-venda`} style={rotuloStyle}>Preço de venda</label>
                  <input id={`${id}-venda`} inputMode="decimal" style={campoStyle} value={ed.precoVenda} disabled={!podePreco} onChange={(e) => editarExistente(emb.id, 'precoVenda', e.target.value)} />
                  {ed.precoVenda.trim() === '' && <div style={ajudaStyle}>Vazio: {brl(Math.round(precoBase * emb.fatorConversao * 100) / 100)} (preço da unidade × {String(emb.fatorConversao).replace('.', ',')})</div>}
                </div>
                <div>
                  <label htmlFor={`${id}-vista`} style={rotuloStyle}>Preço à vista</label>
                  <input id={`${id}-vista`} inputMode="decimal" style={campoStyle} value={ed.precoAVista} disabled={!podePreco} onChange={(e) => editarExistente(emb.id, 'precoAVista', e.target.value)} />
                </div>
              </div>
            );
          })}

          {edicao.novas.map((nova) => {
            const id = `${idBase}-${nova.chave}`;
            const fator = numeroDoCampoDeEmbalagem(nova.fator) || 0;
            const custoCalculado = fator > 0 ? custoDaEmbalagem({ precoCusto: 0, fatorConversao: fator }, custoBase) : 0;
            return (
              <div key={nova.chave} style={{ padding: '10px', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', alignItems: 'start' }}>
                  <div>
                    <label htmlFor={`${id}-unidade`} style={rotuloStyle}>Embalagem</label>
                    <select
                      id={`${id}-unidade`}
                      style={campoStyle}
                      value={nova.unidadeMedidaId}
                      onChange={(e) => {
                        const u = unidades.find((x) => x.id === e.target.value);
                        editarNova(nova.chave, { unidadeMedidaId: u?.id || '', sigla: u?.sigla || '', casasDecimais: Number(u?.casasDecimais) || 0, fracionado: u?.permiteFracionado === true });
                      }}
                    >
                      <option value="">Escolha...</option>
                      {unidades.map((u) => <option key={u.id} value={u.id}>{u.sigla}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${id}-fator`} style={rotuloStyle}>Quantos {siglaBase} cabem</label>
                    <input id={`${id}-fator`} inputMode="decimal" style={campoStyle} value={nova.fator} onChange={(e) => editarNova(nova.chave, { fator: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={`${id}-custo`} style={rotuloStyle}>Custo</label>
                    <input id={`${id}-custo`} inputMode="decimal" style={campoStyle} value={nova.precoCusto} disabled={!podeCusto} onChange={(e) => editarNova(nova.chave, { precoCusto: e.target.value })} />
                    {fator > 0 && <div style={ajudaStyle}>Pela nota: {brl(custoCalculado)}</div>}
                  </div>
                  <div>
                    <label htmlFor={`${id}-venda`} style={rotuloStyle}>Preço de venda</label>
                    <input id={`${id}-venda`} inputMode="decimal" style={campoStyle} value={nova.precoVenda} onChange={(e) => editarNova(nova.chave, { precoVenda: e.target.value })} />
                    {fator > 0 && nova.precoVenda.trim() === '' && <div style={ajudaStyle}>Vazio: {brl(Math.round(precoBase * fator * 100) / 100)}</div>}
                  </div>
                  <div>
                    <label htmlFor={`${id}-vista`} style={rotuloStyle}>Preço à vista</label>
                    <input id={`${id}-vista`} inputMode="decimal" style={campoStyle} value={nova.precoAVista} onChange={(e) => editarNova(nova.chave, { precoAVista: e.target.value })} />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onChange({ ...edicao, novas: edicao.novas.filter((n) => n.chave !== nova.chave) })}
                  style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', padding: '6px 10px' }}
                >
                  <Trash2 size={14} aria-hidden="true" /> Tirar esta embalagem
                </button>
              </div>
            );
          })}

          {podePreco && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onChange({ ...edicao, novas: [...edicao.novas, novaVazia()] })}
              style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '7px 12px' }}
              aria-label={`Cadastrar embalagem para ${nomeDoProduto}`}
            >
              <Plus size={14} aria-hidden="true" /> Cadastrar embalagem
            </button>
          )}
          <div style={ajudaStyle}>Grava no cadastro do produto junto com esta entrada. Campo vazio: vale o valor da unidade × a quantidade da embalagem.</div>
        </div>
      )}
    </div>
  );
};

export default EmbalagensNaEntrada;

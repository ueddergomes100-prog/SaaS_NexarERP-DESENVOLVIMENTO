import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Loader2, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { showError, showSuccess } from '../../utils/alerts';
import {
  CONFIG_CUSTOS_PADRAO,
  depreciacaoNoMesCentavos,
  situacaoDoBem,
  type BemDepreciavel,
  type ConfigCustos,
  type LinhaDaSimulacao,
  type ResumoDosCustos,
} from '../../utils/custosDomain';
import { carregarCustos, salvarCustos, simularPrecos } from '../../services/custosService';

/**
 * FINANCEIRO > CUSTOS E FORMACAO DE PRECO (23/10/2026, item 6 do dono).
 *
 * Despesas fixas (media de 3 meses do Contas a Pagar + a mao + depreciacao
 * dos bens), rateio como % do faturamento, impostos/comissao/taxas e margem
 * (produto > grupo > padrao). A simulacao mostra o preco sugerido pela
 * formula do Sebrae ao lado do preco atual e o lucro real de cada venda.
 * Nada muda preco: e' so' para o empresario decidir. Tudo pelo servidor
 * (server/services/custos.js).
 */

type Aba = 'resumo' | 'despesas' | 'bens' | 'percentuais' | 'simulacao';
const ABAS: Array<[Aba, string]> = [
  ['resumo', 'Resumo'],
  ['despesas', 'Despesas fixas'],
  ['bens', 'Bens e depreciação'],
  ['percentuais', 'Impostos, comissão e margem'],
  ['simulacao', 'Preço por produto'],
];

const reais = (centavos: number) => (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reaisDe = (valor: number) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const nomeDoMes = (aaaaMm: string) => {
  const [a, m] = aaaaMm.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** "1.234,56" -> 123456 centavos. */
const paraCentavos = (texto: string): number => {
  const limpo = String(texto || '').replace(/[^\d,.-]/g, '');
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const deCentavos = (c: number) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paraNumero = (texto: string): number => {
  const n = Number(String(texto || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const estiloCampo: React.CSSProperties = { padding: '9px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' };
const Cartao: React.FC<{ titulo: string; valor: string; detalhe?: string; cor?: string }> = ({ titulo, valor, detalhe, cor }) => (
  <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '200px', flex: 1 }}>
    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{titulo}</span>
    <strong style={{ fontSize: '22px', color: cor || 'var(--text-primary)' }}>{valor}</strong>
    {detalhe && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{detalhe}</span>}
  </div>
);

const CustosFormacaoPreco: React.FC = () => {
  const [aba, setAba] = useState<Aba>('resumo');
  const [config, setConfig] = useState<ConfigCustos>(CONFIG_CUSTOS_PADRAO);
  const [resumo, setResumo] = useState<ResumoDosCustos | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const [simulacao, setSimulacao] = useState<LinhaDaSimulacao[] | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [busca, setBusca] = useState('');
  const [soAbaixo, setSoAbaixo] = useState(false);
  const [faturamentoManualTexto, setFaturamentoManualTexto] = useState('');

  const aplicar = useCallback((d: { config: ConfigCustos; resumo: ResumoDosCustos; categorias: string[] }) => {
    setConfig(d.config);
    setResumo(d.resumo);
    setCategorias(d.categorias);
    setFaturamentoManualTexto(d.config.faturamentoManualCentavos ? deCentavos(d.config.faturamentoManualCentavos) : '');
    setAlterado(false);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      aplicar(await carregarCustos());
    } catch (e) {
      showError('Não foi possível carregar os custos', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setCarregando(false);
    }
  }, [aplicar]);
  useEffect(() => { void carregar(); }, [carregar]);

  const mudar = (parcial: Partial<ConfigCustos>) => { setConfig((c) => ({ ...c, ...parcial })); setAlterado(true); };

  const salvar = async () => {
    setSalvando(true);
    try {
      aplicar(await salvarCustos({ ...config, faturamentoManualCentavos: faturamentoManualTexto.trim() ? paraCentavos(faturamentoManualTexto) : null }));
      setSimulacao(null);
      showSuccess('Custos salvos. O rateio e os preços sugeridos foram recalculados.');
    } catch (e) {
      showError('Custos não salvos', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const simular = useCallback(async () => {
    setSimulando(true);
    try {
      setSimulacao((await simularPrecos()).linhas);
    } catch (e) {
      showError('Não foi possível simular os preços', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setSimulando(false);
    }
  }, []);
  useEffect(() => { if (aba === 'simulacao' && simulacao === null && !simulando) void simular(); }, [aba, simulacao, simulando, simular]);

  const grupos = useMemo(() => [...new Set([...(simulacao || []).map((l) => l.grupo).filter(Boolean), ...Object.keys(config.margensPorGrupo)])].sort(), [simulacao, config.margensPorGrupo]);
  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (simulacao || [])
      .filter((l) => !termo || l.nome.toLowerCase().includes(termo) || l.codigo.toLowerCase().includes(termo) || l.grupo.toLowerCase().includes(termo))
      .filter((l) => !soAbaixo || (l.diferencaPercentual !== null && l.diferencaPercentual < 0));
  }, [simulacao, busca, soAbaixo]);
  const abaixo = (simulacao || []).filter((l) => l.diferencaPercentual !== null && l.diferencaPercentual < 0).length;
  const mesDaConta = resumo ? resumo.meses[resumo.meses.length - 1] : '';

  const mudarBem = (indice: number, parcial: Partial<BemDepreciavel>) => mudar({ bens: config.bens.map((b, i) => (i === indice ? { ...b, ...parcial } : b)) });

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calculator size={26} color="var(--accent-purple)" /> Custos e Formação de Preço
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Quanto a empresa gasta para funcionar, quanto isso pesa em cada venda e o preço que cobre tudo com o lucro que você quer (método do Sebrae). Nada muda preço sozinho.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={() => void carregar()} disabled={carregando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><RefreshCw size={16} /> Atualizar</button>
          <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={salvando || !alterado} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {salvando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />} Salvar
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {ABAS.map(([chave, rotulo]) => (
          <button key={chave} type="button" className={aba === chave ? 'btn-primary' : 'btn-secondary'} onClick={() => setAba(chave)} style={{ padding: '8px 14px', fontSize: '13px' }}>{rotulo}</button>
        ))}
      </div>

      {carregando || !resumo ? (
        <div className="card" style={{ padding: '24px', color: 'var(--text-muted)' }}>Carregando...</div>
      ) : (
        <>
          {aba === 'resumo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <Cartao titulo="Despesa fixa do mês" valor={reais(resumo.despesaFixaMensalCentavos)} detalhe={`Média de ${nomeDoMes(resumo.meses[0])} a ${nomeDoMes(mesDaConta)}`} />
                <Cartao titulo="Faturamento médio" valor={reais(resumo.faturamentoMedioCentavos)} detalhe={config.faturamentoManualCentavos ? 'Informado à mão' : 'Recebido no período (mesma conta do Dashboard)'} />
                <Cartao titulo="Rateio nas vendas" valor={pct(resumo.rateioPercentual)} detalhe="Despesa fixa ÷ faturamento: entra no preço de cada produto" cor="var(--accent-purple)" />
                <Cartao titulo="Ponto de equilíbrio" valor={resumo.pontoDeEquilibrioCentavos !== null ? reais(resumo.pontoDeEquilibrioCentavos) : '—'} detalhe="Faturamento do mês que só paga as despesas (sem lucro)" />
              </div>
              <div className="card" style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>De onde vem a despesa fixa</h3>
                <table className="data-table" style={{ width: '100%' }}>
                  <tbody>
                    <tr><td>Média das categorias fixas pagas no Contas a Pagar</td><td style={{ textAlign: 'right' }}>{reais(resumo.mediaDespesaFixaCentavos)}</td></tr>
                    <tr><td>Despesas lançadas à mão</td><td style={{ textAlign: 'right' }}>{reais(resumo.ajustesCentavos)}</td></tr>
                    <tr><td>Depreciação dos bens</td><td style={{ textAlign: 'right' }}>{reais(resumo.depreciacaoMensalCentavos)}</td></tr>
                    <tr><td style={{ fontWeight: 700 }}>Despesa fixa do mês</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{reais(resumo.despesaFixaMensalCentavos)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="card" style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>Mês a mês</h3>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead><tr><th>Mês</th><th style={{ textAlign: 'right' }}>Despesa fixa paga</th><th style={{ textAlign: 'right' }}>Faturamento</th></tr></thead>
                  <tbody>
                    {resumo.meses.map((m) => (
                      <tr key={m}><td>{nomeDoMes(m)}</td><td style={{ textAlign: 'right' }}>{reais(resumo.despesaPorMes[m])}</td><td style={{ textAlign: 'right' }}>{reais(resumo.faturamentoPorMes[m])}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'despesas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card" style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Quais categorias do Contas a Pagar são despesa fixa?</h3>
                <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Fixa é o que a empresa paga vendendo ou não (aluguel, salários, contador, internet). Compra de mercadoria e frete de venda <strong>não</strong> entram aqui. Valores: média paga em {resumo.meses.map(nomeDoMes).join(', ')}.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
                  {categorias.map((cat) => {
                    const media = resumo.categorias.find((c) => c.categoria.toUpperCase() === cat.toUpperCase())?.mediaCentavos || 0;
                    const marcada = config.categoriasFixas.some((c) => c.toUpperCase() === cat.toUpperCase());
                    return (
                      <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '14px' }}>
                        <input type="checkbox" checked={marcada} onChange={(e) => mudar({ categoriasFixas: e.target.checked ? [...config.categoriasFixas, cat] : config.categoriasFixas.filter((c) => c.toUpperCase() !== cat.toUpperCase()) })} style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }} />
                        <span style={{ flex: 1 }}>{cat}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{reais(media)}/mês</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="card" style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Despesas lançadas à mão</h3>
                <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>O que não passa pelo Contas a Pagar (pró-labore, despesa paga em dinheiro do caixa). Valor negativo tira da média (conta que não vai se repetir).</p>
                {config.ajustes.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <input aria-label="Descrição da despesa" value={a.descricao} onChange={(e) => mudar({ ajustes: config.ajustes.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)) })} style={{ ...estiloCampo, flex: 1, minWidth: '200px' }} />
                    <input aria-label="Valor por mês" inputMode="decimal" defaultValue={deCentavos(a.valorCentavos)} onBlur={(e) => mudar({ ajustes: config.ajustes.map((x, j) => (j === i ? { ...x, valorCentavos: paraCentavos(e.target.value) } : x)) })} style={{ ...estiloCampo, width: '160px', textAlign: 'right' }} />
                    <button type="button" className="btn-secondary" aria-label="Remover" onClick={() => mudar({ ajustes: config.ajustes.filter((_, j) => j !== i) })} style={{ padding: '8px 10px' }}><Trash2 size={16} /></button>
                  </div>
                ))}
                <button type="button" className="btn-secondary" onClick={() => mudar({ ajustes: [...config.ajustes, { descricao: '', valorCentavos: 0 }] })} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={16} /> Despesa à mão</button>
              </div>
              <div className="card" style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Faturamento médio</h3>
                <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>Calculado: {reais(resumo.faturamentoMedioCalculadoCentavos)} por mês (recebido no período). Se parte do faturamento não passa pelo sistema, informe o valor real; em branco usa o calculado.</p>
                <input aria-label="Faturamento médio informado" inputMode="decimal" value={faturamentoManualTexto} onChange={(e) => { setFaturamentoManualTexto(e.target.value); setAlterado(true); }} style={{ ...estiloCampo, width: '200px', textAlign: 'right' }} />
              </div>
            </div>
          )}

          {aba === 'bens' && (
            <div className="card" style={{ padding: '18px' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Bens da empresa</h3>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
                Máquinas, veículos, móveis, computadores. A depreciação é linear: (valor − residual) ÷ meses de vida útil, a partir do mês seguinte à compra. Referência usual: veículo 5 anos, máquina e móveis 10 anos, computador 5 anos (confirme com o contador).
              </p>
              <div className="table-wrapper">
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr><th>Bem</th><th>Valor</th><th>Compra</th><th>Vida (anos)</th><th>Residual</th><th style={{ textAlign: 'right' }}>Por mês</th><th style={{ textAlign: 'right' }}>Valor hoje</th><th>Ativo</th><th /></tr>
                  </thead>
                  <tbody>
                    {config.bens.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhum bem cadastrado.</td></tr>}
                    {config.bens.map((b, i) => {
                      const valido = b.valorCentavos > 0 && b.vidaUtilAnos > 0 && /^\d{4}-\d{2}-\d{2}$/.test(b.dataCompra);
                      const sit = valido ? situacaoDoBem(b, mesDaConta) : null;
                      return (
                        <tr key={b.id || i}>
                          <td><input aria-label="Nome do bem" value={b.nome} onChange={(e) => mudarBem(i, { nome: e.target.value })} style={{ ...estiloCampo, width: '100%', minWidth: '160px' }} /></td>
                          <td><input aria-label="Valor do bem" inputMode="decimal" defaultValue={b.valorCentavos ? deCentavos(b.valorCentavos) : ''} onBlur={(e) => mudarBem(i, { valorCentavos: paraCentavos(e.target.value) })} style={{ ...estiloCampo, width: '120px', textAlign: 'right' }} /></td>
                          <td><input aria-label="Data de compra" type="date" value={b.dataCompra} onChange={(e) => mudarBem(i, { dataCompra: e.target.value })} style={estiloCampo} /></td>
                          <td><input aria-label="Vida útil em anos" inputMode="decimal" defaultValue={b.vidaUtilAnos ? String(b.vidaUtilAnos).replace('.', ',') : ''} onBlur={(e) => mudarBem(i, { vidaUtilAnos: paraNumero(e.target.value) })} style={{ ...estiloCampo, width: '80px', textAlign: 'right' }} /></td>
                          <td><input aria-label="Valor residual" inputMode="decimal" defaultValue={deCentavos(b.residualCentavos)} onBlur={(e) => mudarBem(i, { residualCentavos: paraCentavos(e.target.value) })} style={{ ...estiloCampo, width: '110px', textAlign: 'right' }} /></td>
                          <td style={{ textAlign: 'right' }}>{valido ? reais(depreciacaoNoMesCentavos(b, mesDaConta)) : '—'}</td>
                          <td style={{ textAlign: 'right' }} title={sit ? `Faltam ${sit.mesesRestantes} mês(es)` : ''}>{sit ? reais(sit.valorAtualCentavos) : '—'}</td>
                          <td><input type="checkbox" aria-label="Bem em uso" checked={b.ativo} onChange={(e) => mudarBem(i, { ativo: e.target.checked })} style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }} /></td>
                          <td><button type="button" className="btn-secondary" aria-label="Remover bem" onClick={() => mudar({ bens: config.bens.filter((_, j) => j !== i) })} style={{ padding: '6px 8px' }}><Trash2 size={15} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn-secondary" onClick={() => mudar({ bens: [...config.bens, { id: `bem-${Date.now()}`, nome: '', valorCentavos: 0, dataCompra: '', vidaUtilAnos: 5, residualCentavos: 0, ativo: true }] })} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}><Plus size={16} /> Bem</button>
            </div>
          )}

          {aba === 'percentuais' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card" style={{ padding: '18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
                {([
                  ['impostoPercentual', 'Imposto sobre a venda (%)', 'Alíquota efetiva que o contador informa (ex.: Simples 6,5%).'],
                  ['comissaoPercentual', 'Comissão (%)', 'Padrão; produto com comissão própria usa a dele.'],
                  ['taxasPercentual', 'Taxas e outras despesas variáveis (%)', 'Cartão, frete por conta da loja, embalagem.'],
                  ['margemPadrao', 'Margem de lucro desejada (%)', 'Padrão da empresa; grupo e produto podem ter a sua.'],
                ] as Array<[keyof ConfigCustos, string, string]>).map(([chave, rotulo, dica]) => (
                  <label key={chave} style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {rotulo}
                    <input inputMode="decimal" defaultValue={String(config[chave] ?? '').replace('.', ',')} key={`${chave}-${String(config[chave])}`} title={dica} onBlur={(e) => mudar({ [chave]: paraNumero(e.target.value) } as Partial<ConfigCustos>)} style={{ ...estiloCampo, textAlign: 'right' }} />
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{dica}</span>
                  </label>
                ))}
              </div>
              <div className="card" style={{ padding: '18px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Margem por grupo</h3>
                <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>Em branco usa a margem padrão ({pct(config.margemPadrao)}). Os grupos aparecem depois de abrir "Preço por produto".</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
                  {grupos.map((g) => (
                    <label key={g} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                      <span style={{ flex: 1 }}>{g}</span>
                      <input aria-label={`Margem do grupo ${g}`} inputMode="decimal" defaultValue={config.margensPorGrupo[g] !== undefined ? String(config.margensPorGrupo[g]).replace('.', ',') : ''} onBlur={(e) => {
                        const v = e.target.value.trim();
                        const proximo = { ...config.margensPorGrupo };
                        if (v) proximo[g] = paraNumero(v); else delete proximo[g];
                        mudar({ margensPorGrupo: proximo });
                      }} style={{ ...estiloCampo, width: '90px', textAlign: 'right' }} />
                      <span>%</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {aba === 'simulacao' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="search-bar" style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                  <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" title="Nome, código ou grupo" style={{ width: '100%', padding: '10px 14px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={soAbaixo} onChange={(e) => setSoAbaixo(e.target.checked)} style={{ accentColor: 'var(--accent-purple)' }} />
                  Só abaixo do sugerido ({abaixo})
                </label>
                <button type="button" className="btn-secondary" onClick={() => void simular()} disabled={simulando} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={15} /> Recalcular</button>
              </div>
              {alterado && <div className="card" style={{ padding: '10px 14px', fontSize: '13px', border: '1px solid #f59e0b' }}>Há mudanças não salvas: salve para a simulação usar os números novos.</div>}
              <div className="card list-container">
                <div className="table-wrapper">
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th style={{ textAlign: 'right' }}>Custo</th>
                        <th style={{ textAlign: 'right' }}>Margem</th>
                        <th style={{ textAlign: 'right' }}>Preço sugerido</th>
                        <th style={{ textAlign: 'right' }}>Preço atual</th>
                        <th style={{ textAlign: 'right' }}>Diferença</th>
                        <th style={{ textAlign: 'right' }}>Lucro por venda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulando || simulacao === null ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Calculando...</td></tr>
                      ) : linhas.length === 0 ? (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Nenhum produto.</td></tr>
                      ) : linhas.slice(0, 500).map((l) => {
                        const cor = l.diferencaPercentual === null ? 'var(--text-muted)' : l.diferencaPercentual < 0 ? '#ef4444' : '#10b981';
                        return (
                          <tr key={l.id}>
                            <td style={{ minWidth: '220px' }}><strong>{l.nome}</strong><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{l.codigo}{l.grupo ? ` · ${l.grupo}` : ''}</div></td>
                            <td style={{ textAlign: 'right' }}>{l.custo > 0 ? reaisDe(l.custo) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>
                              <input aria-label={`Margem de ${l.nome}`} inputMode="decimal" defaultValue={config.margensPorProduto[l.id] !== undefined ? String(config.margensPorProduto[l.id]).replace('.', ',') : ''} placeholder={undefined} title={`Em branco usa a do ${l.origemMargem === 'grupo' ? 'grupo' : 'padrão'} (${pct(l.margem)})`} onBlur={(e) => {
                                const v = e.target.value.trim();
                                const proximo = { ...config.margensPorProduto };
                                if (v) proximo[l.id] = paraNumero(v); else delete proximo[l.id];
                                mudar({ margensPorProduto: proximo });
                              }} style={{ ...estiloCampo, width: '70px', padding: '6px 8px', textAlign: 'right' }} />
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pct(l.margem)} {l.origemMargem === 'produto' ? '' : `(${l.origemMargem === 'grupo' ? 'grupo' : 'padrão'})`}</div>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }} title={l.problema}>{l.precoSugerido !== null ? reaisDe(l.precoSugerido) : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{l.custo > 0 ? 'ver ⓘ' : 'sem custo'}</span>}</td>
                            <td style={{ textAlign: 'right' }}>{reaisDe(l.precoAtual)}</td>
                            <td style={{ textAlign: 'right', color: cor, fontWeight: 600 }}>{l.diferencaPercentual === null ? '—' : `${l.diferencaPercentual > 0 ? '+' : ''}${pct(l.diferencaPercentual)}`}</td>
                            <td style={{ textAlign: 'right', color: l.lucroAtual < 0 ? '#ef4444' : 'var(--text-primary)' }}>{reaisDe(l.lucroAtual)}<div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pct(l.margemRealAtual)} do preço</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {linhas.length > 500 && <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Mostrando 500 de {linhas.length}. Use a busca para achar os outros.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CustosFormacaoPreco;

import React, { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { showError, showSuccess } from '../../utils/alerts';
import { formatarReais, type Cotacao } from '../../utils/comprasDomain';
import { lancarPropostasManuais } from '../../services/comprasService';
import { estiloCampo } from './comprasUi';

/**
 * PREENCHER A COTACAO A MAO (pedido de cliente, 12/11/2026).
 *
 * Fornecedor que nao responde pelo link passa o preco por telefone, WhatsApp
 * ou planilha. Com a chave "Preencher à mão" ligada, a grade do comparativo
 * vira campos: uma coluna por fornecedor, uma linha por item, mais o prazo de
 * entrega e a condicao de pagamento de cada um. So' vai ao servidor o
 * fornecedor que mudou; apagar todos os precos de um fornecedor devolve ele
 * para "Aguardando". Regra e gravacao no servidor (comprasDomain.ts).
 */

interface Props {
  cotacao: Cotacao;
  /** Avisa a tela se ha' preco digitado e ainda nao salvo (para perguntar antes de desligar a chave). */
  onMudou: (temAlteracao: boolean) => void;
  onSalvo: () => void;
}

interface Coluna { precos: Record<string, string>; prazo: string; condicao: string }

const textoDoPreco = (centavos: number | undefined): string => (centavos && centavos > 0 ? (centavos / 100).toFixed(2).replace('.', ',') : '');

/** Centavos do que foi digitado: 0 = vazio; null = nao e' numero. Aceita "12,50", "12.50" e "1.234,56". */
const centavosDoPreco = (texto: string): number | null => {
  const limpo = String(texto || '').trim();
  if (!limpo) return 0;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const colunaDoFornecedor = (cotacao: Cotacao, fornecedorId: string): Coluna => {
  const f = cotacao.fornecedores.find((x) => x.fornecedorId === fornecedorId);
  return {
    precos: Object.fromEntries(cotacao.itens.map((i) => [i.produtoId, textoDoPreco(f?.precos?.[i.produtoId])])),
    prazo: f && f.prazoEntregaDias !== null && f.prazoEntregaDias !== undefined ? String(f.prazoEntregaDias) : '',
    condicao: f?.condicaoPagamento || '',
  };
};

/** Igualdade pelo VALOR (12,5 e 12,50 sao o mesmo preco). */
const mesmaColuna = (a: Coluna, b: Coluna, cotacao: Cotacao): boolean => (
  a.prazo.trim() === b.prazo.trim()
  && a.condicao.trim() === b.condicao.trim()
  && cotacao.itens.every((i) => centavosDoPreco(a.precos[i.produtoId] || '') === centavosDoPreco(b.precos[i.produtoId] || ''))
);

const campoDaGrade: React.CSSProperties = { ...estiloCampo, padding: '6px 8px', width: '110px', textAlign: 'right' };

const PrecosManuaisDaCotacao: React.FC<Props> = ({ cotacao, onMudou, onSalvo }) => {
  // Os valores de partida sao os de quando a chave foi ligada: a resposta de
  // um fornecedor que chegue pelo link no meio da digitacao nao apaga o que
  // a pessoa esta' digitando (so' as colunas que ela mexeu vao ao servidor).
  const [partida] = useState<Record<string, Coluna>>(() => Object.fromEntries(cotacao.fornecedores.map((f) => [f.fornecedorId, colunaDoFornecedor(cotacao, f.fornecedorId)])));
  const [colunas, setColunas] = useState<Record<string, Coluna>>(partida);
  const [salvando, setSalvando] = useState(false);

  const alteradas = useMemo(
    () => cotacao.fornecedores.filter((f) => colunas[f.fornecedorId] && partida[f.fornecedorId] && !mesmaColuna(colunas[f.fornecedorId], partida[f.fornecedorId], cotacao)),
    [cotacao, colunas, partida],
  );
  useEffect(() => { onMudou(alteradas.length > 0); }, [alteradas.length, onMudou]);

  const mudarPreco = (fornecedorId: string, produtoId: string, valor: string) => {
    setColunas((atual) => ({ ...atual, [fornecedorId]: { ...atual[fornecedorId], precos: { ...atual[fornecedorId].precos, [produtoId]: valor.replace(/[^\d.,]/g, '') } } }));
  };
  const mudarCampo = (fornecedorId: string, campo: 'prazo' | 'condicao', valor: string) => {
    setColunas((atual) => ({ ...atual, [fornecedorId]: { ...atual[fornecedorId], [campo]: campo === 'prazo' ? valor.replace(/\D/g, '').slice(0, 3) : valor } }));
  };

  // Enter desce para o mesmo fornecedor no proximo item (digitacao em coluna, como numa planilha).
  const aoTeclar = (event: React.KeyboardEvent<HTMLInputElement>, coluna: number, linha: number) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const proximo = document.getElementById(`preco-manual-${coluna}-${linha + 1}`) || document.getElementById(`preco-manual-${coluna + 1}-0`);
    if (proximo instanceof HTMLInputElement) { proximo.focus(); proximo.select(); }
  };

  const menorDaLinha = (produtoId: string): number => {
    const valores = cotacao.fornecedores.map((f) => centavosDoPreco(colunas[f.fornecedorId]?.precos[produtoId] || '')).filter((c): c is number => c !== null && c > 0);
    return valores.length > 0 ? Math.min(...valores) : 0;
  };
  const totalDe = (fornecedorId: string): number => cotacao.itens.reduce((t, i) => {
    const c = centavosDoPreco(colunas[fornecedorId]?.precos[i.produtoId] || '');
    return t + (c ? Math.round(c * i.quantidade) : 0);
  }, 0);

  const salvar = async () => {
    const propostas: Parameters<typeof lancarPropostasManuais>[1] = {};
    for (const f of alteradas) {
      const coluna = colunas[f.fornecedorId];
      const precos: Record<string, number> = {};
      for (const item of cotacao.itens) {
        const c = centavosDoPreco(coluna.precos[item.produtoId] || '');
        if (c === null) { showError('Preço inválido', `Confira o preço de ${item.nome} em ${f.nome}. Use só números, por exemplo 12,50.`); return; }
        if (c > 0) precos[item.produtoId] = c;
      }
      const prazo = coluna.prazo.trim() ? Number(coluna.prazo) : null;
      if (prazo !== null && (!Number.isInteger(prazo) || prazo > 365)) { showError('Prazo inválido', `O prazo de entrega de ${f.nome} é em dias, de 0 a 365.`); return; }
      const temPreco = Object.keys(precos).length > 0;
      if (!temPreco && (coluna.prazo.trim() || coluna.condicao.trim())) {
        showError('Falta o preço', `${f.nome} está com prazo ou condição, mas sem nenhum preço. Informe o preço de pelo menos um item ou apague o prazo e a condição.`);
        return;
      }
      propostas[f.fornecedorId] = { precos, prazoEntregaDias: temPreco ? prazo : null, condicaoPagamento: temPreco ? coluna.condicao.trim() : '', observacao: temPreco ? (f.observacao || '') : '' };
    }
    if (Object.keys(propostas).length === 0) return;
    setSalvando(true);
    try {
      const r = await lancarPropostasManuais(cotacao.id, propostas);
      const partes = [
        r.lancados.length ? `Preços salvos: ${r.lancados.join(', ')}.` : '',
        r.limpos.length ? `Preços apagados: ${r.limpos.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
      showSuccess(partes || 'Preços salvos.');
      onMudou(false);
      onSalvo();
    } catch (erro) {
      showError('Não foi possível salvar os preços', erro instanceof Error ? erro.message : 'Confira a internet e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="card list-container">
      <div className="table-wrapper">
        <table className="data-table" data-sem-ajuste style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Produto</th>
              <th style={{ textAlign: 'right' }}>Qtd.</th>
              {cotacao.fornecedores.map((f) => <th key={f.fornecedorId} style={{ textAlign: 'right' }}>{f.nome}</th>)}
            </tr>
          </thead>
          <tbody>
            {cotacao.itens.map((item, linha) => {
              const menor = menorDaLinha(item.produtoId);
              return (
                <tr key={item.produtoId}>
                  <td><div style={{ fontWeight: 600 }}>{item.nome}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.codigo}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{item.quantidade.toLocaleString('pt-BR')} {item.unidade}</td>
                  {cotacao.fornecedores.map((f, coluna) => {
                    const texto = colunas[f.fornecedorId]?.precos[item.produtoId] || '';
                    const centavos = centavosDoPreco(texto);
                    const invalido = centavos === null;
                    const melhor = !invalido && centavos > 0 && centavos === menor;
                    return (
                      <td key={f.fornecedorId} style={{ textAlign: 'right' }}>
                        <input
                          id={`preco-manual-${coluna}-${linha}`}
                          value={texto}
                          inputMode="decimal"
                          disabled={salvando}
                          aria-label={`Preço unitário de ${item.nome} em ${f.nome}`}
                          title={invalido ? 'Use só números, por exemplo 12,50' : `Preço unitário de ${item.nome} em ${f.nome}`}
                          onChange={(e) => mudarPreco(f.fornecedorId, item.produtoId, e.target.value)}
                          onKeyDown={(e) => aoTeclar(e, coluna, linha)}
                          onFocus={(e) => e.target.select()}
                          style={{ ...campoDaGrade, ...(invalido ? { borderColor: '#ef4444' } : melhor ? { borderColor: '#10b981', color: '#10b981', fontWeight: 700 } : {}) }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700 }}>Prazo de entrega (dias)</td>
              {cotacao.fornecedores.map((f) => (
                <td key={f.fornecedorId} style={{ textAlign: 'right' }}>
                  <input value={colunas[f.fornecedorId]?.prazo || ''} inputMode="numeric" disabled={salvando} aria-label={`Prazo de entrega de ${f.nome}, em dias`} title="Em quantos dias o fornecedor entrega" onChange={(e) => mudarCampo(f.fornecedorId, 'prazo', e.target.value)} style={campoDaGrade} />
                </td>
              ))}
            </tr>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700 }}>Condição de pagamento</td>
              {cotacao.fornecedores.map((f) => (
                <td key={f.fornecedorId} style={{ textAlign: 'right' }}>
                  <input value={colunas[f.fornecedorId]?.condicao || ''} maxLength={120} disabled={salvando} aria-label={`Condição de pagamento de ${f.nome}`} title="Ex.: 28 dias, à vista, 30/60" onChange={(e) => mudarCampo(f.fornecedorId, 'condicao', e.target.value)} style={{ ...campoDaGrade, textAlign: 'left' }} />
                </td>
              ))}
            </tr>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700 }}>Total por fornecedor</td>
              {cotacao.fornecedores.map((f) => {
                const total = totalDe(f.fornecedorId);
                return <td key={f.fornecedorId} style={{ textAlign: 'right', fontWeight: 700 }}>{total > 0 ? formatarReais(total) : '—'}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 16px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Digite o preço unitário de cada item; Enter desce para o próximo. Item em branco = o fornecedor não cotou. O menor preço de cada item fica em verde.
        </span>
        <button type="button" className="btn-primary" disabled={salvando || alteradas.length === 0} onClick={() => void salvar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={18} /> {salvando ? 'Salvando...' : 'Salvar preços'}
        </button>
      </div>
    </div>
  );
};

export default PrecosManuaisDaCotacao;

import React, { useMemo, useRef, useState } from 'react';
import { FileUp, Link2, X } from 'lucide-react';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { parseNfeXml, type NotaParseada } from '../../utils/nfeXmlDomain';
import {
  ROTULO_VINCULO_AVULSO,
  avisoDoDestinatario,
  fatorDoFornecedor,
  fornecedorDoXml,
  itemAvulsoDoXml,
  parcelasDasDuplicatas,
  vinculoAutomatico,
  type OrigemDoVinculoAvulso,
  type ProdutoParaVinculoAvulso,
} from '../../utils/notaAvulsaXmlDomain';
import type { NotaAvulsaItem } from '../../utils/notaAvulsaDomain';
import type { ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { showError, showWarning } from '../../utils/alerts';

/*
 * "IMPORTAR XML DE OUTRO CNPJ" NA NOTA AVULSA (25/11/2026, Embala Minas).
 * Le o XML e puxa so' produtos, valores e boleto (duplicatas). Cada item do
 * XML e' ligado a um produto do cadastro como na Entrada de XML: sozinho pelo
 * codigo que este fornecedor usa ou pelo codigo de barras; senao a pessoa
 * escolhe (e o vinculo fica guardado para a proxima nota). Regra em
 * src/utils/notaAvulsaXmlDomain.ts.
 */

export interface ProdutoParaXml extends ProdutoParaVinculoAvulso {
  codigo?: string;
  precoVenda?: number;
  ativo?: boolean;
  temGrade?: boolean;
  categoria?: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
}

export interface OrigemXmlDaNota {
  chave: string;
  numero: string;
  emitenteNome: string;
  emitenteDocumento: string;
  destinatarioNome: string;
  destinatarioDocumento: string;
}

interface Props<P extends ProdutoParaXml, F extends { id: string; nome: string; documento?: string }> {
  produtos: P[];
  fornecedores: F[];
  fornecedorSelecionado: { id: string; nome: string } | null;
  cnpjDaEmpresa: string;
  onFornecedor: (f: F) => void;
  onAplicar: (r: {
    itens: Array<NotaAvulsaItem & { codigoFornecedor?: string; fatorXml?: number }>;
    frete: number;
    desconto: number;
    parcelas: ParcelaComCheque[];
    origem: OrigemXmlDaNota;
  }) => void;
}

interface LinhaDoXml {
  produtoId: string;
  origem: OrigemDoVinculoAvulso | null;
  fator: string;
  ignorar: boolean;
  busca: string;
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const documentoBr = (d: string) => (d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d);

function ImportarXmlNaNotaAvulsa<P extends ProdutoParaXml, F extends { id: string; nome: string; documento?: string }>({
  produtos, fornecedores, fornecedorSelecionado, cnpjDaEmpresa, onFornecedor, onAplicar,
}: Props<P, F>) {
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const [nota, setNota] = useState<NotaParseada | null>(null);
  const [linhas, setLinhas] = useState<LinhaDoXml[]>([]);
  const fornecedorId = fornecedorSelecionado?.id || '';
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  const lerArquivo = async (arquivo: File) => {
    let lida: NotaParseada;
    try {
      lida = parseNfeXml(await arquivo.text());
    } catch {
      showError('XML inválido', 'Não foi possível ler este arquivo. Confira se é o XML da NF-e (o arquivo .xml que o fornecedor mandou).');
      return;
    }
    const aviso = avisoDoDestinatario(cnpjDaEmpresa, lida);
    if (aviso) { showError('Este XML é desta empresa', aviso); return; }
    if (lida.itens.length === 0) { showError('XML sem produtos', 'Este XML não tem itens de produto para lançar.'); return; }
    const doCadastro = fornecedorDoXml(fornecedores, lida);
    const idDoFornecedor = doCadastro ? doCadastro.id : fornecedorId;
    if (doCadastro) onFornecedor(doCadastro);
    else showWarning('Fornecedor do XML não cadastrado', `${lida.emitente.nome || 'O emitente'} (${documentoBr(lida.emitente.documento)}) não está em Fornecedores. Cadastre-o ou escolha o fornecedor acima antes de lançar a nota.`);
    setNota(lida);
    setLinhas(lida.itens.map((item) => {
      const auto = vinculoAutomatico(item, produtos, idDoFornecedor);
      return {
        produtoId: auto ? auto.produto.id : '',
        origem: auto ? auto.origem : null,
        fator: String(fatorDoFornecedor(auto?.produto, idDoFornecedor)),
        ignorar: false,
        busca: auto ? auto.produto.nome : '',
      };
    }));
  };

  const mudar = (i: number, patch: Partial<LinhaDoXml>) => setLinhas((atual) => atual.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pendentes = linhas.filter((l) => !l.ignorar && !l.produtoId).length;
  const aplicar = () => {
    if (!nota) return;
    if (!fornecedorSelecionado) { showError('Escolha o fornecedor', 'Escolha (ou cadastre) o fornecedor da nota antes de lançar os itens do XML.'); return; }
    if (pendentes > 0) { showError('Itens sem produto', `${pendentes} item(ns) do XML ainda sem produto do cadastro. Escolha o produto de cada um ou marque "Não lançar".`); return; }
    const itens = nota.itens.flatMap((item, i) => {
      const l = linhas[i];
      const produto = l && !l.ignorar ? porId.get(l.produtoId) : undefined;
      if (!produto) return [];
      const fator = Number(String(l.fator).replace(',', '.'));
      const f = Number.isFinite(fator) && fator > 0 ? fator : 1;
      return [{ ...itemAvulsoDoXml(item, produto, f), ...(f !== 1 ? { fatorXml: f } : {}) }];
    });
    if (itens.length === 0) { showError('Nenhum item para lançar', 'Todos os itens foram marcados como "Não lançar".'); return; }
    // Produto vendido por unidade inteira nao pode entrar com fracao depois da conversao.
    const fracionadoErrado = itens.find((it) => porId.get(it.produtoId)?.unidadeMedidaFracionado !== true && !Number.isInteger(Math.round(it.quantidade * 1000) / 1000));
    if (fracionadoErrado) {
      showError('Confira a conversão', `${fracionadoErrado.produtoNome} ficaria com ${fracionadoErrado.quantidade.toLocaleString('pt-BR')} no estoque, mas a unidade dele não aceita fração. Confira as "unidades no estoque por 1 da nota" desse item.`);
      return;
    }
    onAplicar({
      itens,
      frete: Number(nota.totais.frete) || 0,
      desconto: Number(nota.totais.desconto) || 0,
      parcelas: parcelasDasDuplicatas(nota.duplicatas, getDateInputInTimeZone()),
      origem: {
        chave: nota.chave,
        numero: nota.numero,
        emitenteNome: nota.emitente.nome,
        emitenteDocumento: nota.emitente.documento,
        destinatarioNome: nota.destinatario?.nome || '',
        destinatarioDocumento: nota.destinatario?.documento || '',
      },
    });
    setNota(null);
    setLinhas([]);
  };

  return (
    <>
      <input ref={arquivoRef} type="file" accept=".xml,text/xml,application/xml" style={{ display: 'none' }} onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) void lerArquivo(a); }} />
      <button type="button" className="btn-secondary" onClick={() => arquivoRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title="Puxa produtos, valores e boleto do XML de uma NF-e emitida para outro CNPJ">
        <FileUp size={16} /> Importar XML de outro CNPJ
      </button>
      {nota && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="card" role="dialog" aria-modal="true" aria-label="Itens do XML" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '1000px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
              <div>
                <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>NF-e {nota.numero} — {nota.emitente.nome}</h2>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  Para {nota.destinatario?.nome || '—'} ({documentoBr(nota.destinatario?.documento || '')}) · Total {moeda(nota.totais.total)} · {nota.duplicatas.length} boleto(s)
                </div>
              </div>
              <button type="button" onClick={() => { setNota(null); setLinhas([]); }} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 24px' }}>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Entram só os produtos, as quantidades, os valores, o frete/desconto e os boletos. Ligue cada item a um produto do cadastro: o vínculo fica guardado e na próxima nota deste fornecedor entra sozinho.
              </p>
              <table className="data-table">
                <thead>
                  <tr><th>Item do XML</th><th style={{ textAlign: 'right' }}>Qtd</th><th style={{ textAlign: 'right' }}>Valor</th><th style={{ minWidth: '280px' }}>Produto do cadastro</th><th style={{ width: '110px' }} title="Quantas unidades do estoque cabem em 1 unidade da nota (caixa com 12 = 12)">Unidades no estoque por 1 da nota</th><th>Não lançar</th></tr>
                </thead>
                <tbody>
                  {nota.itens.map((item, i) => {
                    const l = linhas[i];
                    if (!l) return null;
                    return (
                      <tr key={`${item.numero}-${i}`} style={{ opacity: l.ignorar ? 0.5 : 1 }}>
                        <td>{item.descricao}<div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>cód. {item.codigo || '—'}{item.ean ? ` · EAN ${item.ean}` : ''}</div></td>
                        <td style={{ textAlign: 'right' }}>{item.quantidade.toLocaleString('pt-BR')} {item.unidade}</td>
                        <td style={{ textAlign: 'right' }}>{moeda(item.valorProduto)}</td>
                        <td>
                          <ProductAutocomplete<P>
                            value={l.busca}
                            onChange={(v) => mudar(i, { busca: v, ...(v.trim() ? {} : { produtoId: '', origem: null }) })}
                            products={produtos}
                            onSelect={(p) => mudar(i, { produtoId: p.id, origem: 'manual', busca: p.nome, fator: String(fatorDoFornecedor(p, fornecedorId)) })}
                            renderItem={renderProdutoOpcaoBusca}
                            ariaLabel={`Produto do cadastro para ${item.descricao}`}
                            disabled={l.ignorar}
                          />
                          {l.produtoId && l.origem && (
                            <div style={{ fontSize: '11.5px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><Link2 size={12} /> {ROTULO_VINCULO_AVULSO[l.origem]}</div>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Quantas unidades do estoque cabem em 1 ${item.unidade} de ${item.descricao}`}
                            title={`Quantas unidades do estoque cabem em 1 ${item.unidade} (caixa com 12 = 12). Use 1 se a nota e o estoque usam a mesma unidade.`}
                            value={l.fator}
                            onChange={(e) => mudar(i, { fator: e.target.value })}
                            disabled={l.ignorar}
                            style={{ width: '80px', padding: '6px 8px', textAlign: 'right', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={l.ignorar} onChange={(e) => mudar(i, { ignorar: e.target.checked })} aria-label={`Não lançar ${item.descricao}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
              <span style={{ fontSize: '13px', color: pendentes > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                {pendentes > 0 ? `${pendentes} item(ns) ainda sem produto.` : 'Todos os itens ligados.'}
                {!fornecedorSelecionado ? ' Escolha o fornecedor da nota.' : ''}
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => { setNota(null); setLinhas([]); }}>Cancelar</button>
                <button type="button" className="btn-primary" onClick={aplicar}>Lançar os itens na nota</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ImportarXmlNaNotaAvulsa;

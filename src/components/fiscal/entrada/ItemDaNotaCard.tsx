import React from 'react';
import { Link2, Unlink } from 'lucide-react';
import type { ItemDaNota } from '../../../utils/nfeXmlDomain';
import type { ItemEntradaConfig } from '../../../utils/entradaNfeDomain';
import type { CustoDoItemDeEntrada } from '../../../utils/custoEntradaDomain';
import { fatorValido, quantidadeNoEstoque } from '../../../utils/custoEntradaDomain';
import { CSOSN_OPTIONS, ICMS_CST_OPTIONS } from '../../../utils/fiscalDomain';
import { ROTULO_ORIGEM_VINCULO } from '../../../utils/vinculoItemNfeDomain';
import {
  avisosDePreco,
  lucroPorUnidade,
  markupDoPreco,
  numeroDaTela,
  vendaMinima,
  variacaoDeMargem,
} from '../../../utils/precificacaoEntradaDomain';
import { campoInputStyle, campoLabelStyle, grupoStyle, moeda, moeda4, percentual } from './estilos';

/*
 * UM ITEM DA NOTA NA ENTRADA (2026-09-24).
 *
 * Mostra tudo que a nota trouxe do item, o CUSTO REAL que vai para o estoque
 * (com frete, IPI, ST, desconto, creditos), a unidade/fator de conversao, o
 * vinculo com o cadastro, e a precificacao (varejo e atacado) -- o mesmo que
 * o outro ERP mostra na aba Itens.
 */

export interface CadastroVinculado {
  nome: string;
  quantidade: number;
  precoCusto?: number;
  precoVenda?: number;
  unidade?: string;
}

interface ItemDaNotaCardProps {
  indice: number;
  total: number;
  item: ItemDaNota;
  config: ItemEntradaConfig;
  custo: CustoDoItemDeEntrada | undefined;
  /** Custo por unidade de ESTOQUE (ja dividido pelo fator). */
  custoUnitarioEstoque: number;
  cadastro: CadastroVinculado | undefined;
  usaCsosn: boolean;
  markupVarejoDigitado: string | undefined;
  markupAtacadoDigitado: string | undefined;
  onAlterarTipo: (tipo: ItemEntradaConfig['tipo']) => void;
  onAlterarConfig: (patch: Partial<ItemEntradaConfig>) => void;
  onAlterarCampo: (campo: keyof ItemEntradaConfig, valor: string) => void;
  onPrecoVarejo: (texto: string) => void;
  onMarkupVarejo: (texto: string) => void;
  onPrecoAtacado: (texto: string) => void;
  onMarkupAtacado: (texto: string) => void;
  onAbrirVinculo: () => void;
  onDesvincular: () => void;
  /** Painel de sugestoes/busca de vinculo, quando aberto para este item. */
  painelDeVinculo: React.ReactNode;
}

const Detalhe: React.FC<{ rotulo: string; valor: React.ReactNode }> = ({ rotulo, valor }) => (
  <div style={{ minWidth: '110px' }}>
    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{rotulo}</div>
    <div style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>{valor}</div>
  </div>
);

const ItemDaNotaCard: React.FC<ItemDaNotaCardProps> = ({
  indice, total, item, config, custo, custoUnitarioEstoque, cadastro, usaCsosn,
  markupVarejoDigitado, markupAtacadoDigitado,
  onAlterarTipo, onAlterarConfig, onAlterarCampo, onPrecoVarejo, onMarkupVarejo, onPrecoAtacado, onMarkupAtacado,
  onAbrirVinculo, onDesvincular, painelDeVinculo,
}) => {
  const fator = fatorValido(config.fator);
  const quantidadeEntrando = quantidadeNoEstoque(item.quantidade, config.fator);
  const precoVarejo = numeroDaTela(config.precoVenda);
  const precoAtacado = numeroDaTela(config.atacadoPreco);
  const descontoMaximo = numeroDaTela(config.descontoMaximo);
  const custoAnterior = cadastro?.precoCusto ?? 0;
  const variacaoDoCusto = custoAnterior > 0 && custoUnitarioEstoque > 0 ? ((custoUnitarioEstoque - custoAnterior) / custoAnterior) * 100 : null;
  const margem = variacaoDeMargem(cadastro?.precoVenda ?? 0, custoAnterior, custoUnitarioEstoque);
  const avisos = config.tipo === 'revenda'
    ? avisosDePreco({ custo: custoUnitarioEstoque, precoVarejo, atacadoAtivo: config.atacadoAtivo, precoAtacado, descontoMaximoPercentual: descontoMaximo })
    : [];
  const vinculado = config.classificacao !== 'novo';
  const botaoPequeno: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', fontSize: '12px' };

  return (
    <div style={{ padding: '18px 24px', borderBottom: indice < total - 1 ? '1px solid var(--border-color)' : 'none' }}>
      {/* Cabecalho do item */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div>
          <strong style={{ fontSize: '14px' }}>{item.numero ? `${item.numero}. ` : ''}{item.descricao}</strong>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Código XML: {item.codigo} · NCM: {item.ncm}{item.cest ? ` · CEST: ${item.cest}` : ''}{item.ean ? ` · EAN: ${item.ean}` : ''} · CFOP: {item.cfop}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {item.quantidade} {item.unidade} × {moeda4(item.valorUnitario)} = <strong>{moeda(item.valorProduto)}</strong>
            {item.pedido ? ` · Pedido ${item.pedido}` : ''}
          </div>
        </div>

        {vinculado && cadastro && (
          <span style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', backgroundColor: config.classificacao === 'estoque' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: config.classificacao === 'estoque' ? '#10b981' : '#f59e0b' }}>
            {config.classificacao === 'estoque' ? 'Soma no cadastro (Revenda)' : (config.classificacao === 'insumo' ? 'Soma no cadastro (Insumo)' : 'Soma no cadastro (Matéria-Prima)')} — hoje {cadastro.quantidade}
          </span>
        )}
        {!vinculado && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Item novo — classificar como:</span>
            <select value={config.tipo} onChange={(e) => onAlterarTipo(e.target.value as ItemEntradaConfig['tipo'])} className="form-select" style={{ padding: '6px 10px', fontSize: '13px' }}>
              <option value="revenda">Produto de Revenda</option>
              <option value="materia_prima">Matéria-Prima</option>
              <option value="insumo">Insumo (material de consumo)</option>
            </select>
          </div>
        )}
      </div>

      {/* Vinculo com o cadastro */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        {vinculado ? (
          <>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {ROTULO_ORIGEM_VINCULO[config.origemVinculo ?? 'automatico']}: <strong style={{ color: 'var(--text-primary)' }}>{cadastro?.nome}</strong>
            </span>
            <button type="button" className="btn-secondary" onClick={onAbrirVinculo} style={botaoPequeno}><Link2 size={13} /> Trocar cadastro</button>
            <button type="button" className="btn-secondary" onClick={onDesvincular} style={botaoPequeno}><Unlink size={13} /> Desvincular (cadastrar como novo)</button>
          </>
        ) : (
          <button type="button" className="btn-secondary" onClick={onAbrirVinculo} style={botaoPequeno}><Link2 size={13} /> Já tenho este item cadastrado — vincular</button>
        )}
      </div>
      {painelDeVinculo}

      {/* Unidade, fator e custo real */}
      <div style={{ ...grupoStyle, marginBottom: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', alignItems: 'end' }}>
          {vinculado ? (
            <div className="input-group">
              <label style={campoLabelStyle}>1 {item.unidade} da nota equivale a quantas unidades do estoque{cadastro?.unidade ? ` (${cadastro.unidade})` : ''}?</label>
              <input type="number" step="any" min="0" value={config.fator} onChange={(e) => onAlterarCampo('fator', e.target.value)} style={campoInputStyle} aria-label={`Fator de conversão do item ${item.descricao}`} />
            </div>
          ) : (
            <Detalhe rotulo="Unidade do estoque" valor={<strong>{item.unidade} (a mesma da nota)</strong>} />
          )}
          <Detalhe rotulo="Entra no estoque" valor={<strong>{quantidadeEntrando.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}{cadastro?.unidade ? ` ${cadastro.unidade}` : ''}</strong>} />
          <Detalhe rotulo="Custo real da entrada" valor={<strong>{moeda(custo?.custoTotal ?? 0)}</strong>} />
          <Detalhe rotulo="Custo por unidade de estoque" valor={<strong style={{ color: '#10b981' }}>{moeda4(custoUnitarioEstoque)}</strong>} />
          {cadastro && custoAnterior > 0 && (
            <Detalhe
              rotulo="Custo antes → agora"
              valor={<span>{moeda4(custoAnterior)} → <strong style={{ color: variacaoDoCusto !== null && variacaoDoCusto > 0 ? '#ef4444' : '#10b981' }}>{moeda4(custoUnitarioEstoque)}</strong>{variacaoDoCusto !== null ? ` (${variacaoDoCusto > 0 ? '▲' : '▼'} ${percentual(Math.abs(variacaoDoCusto))})` : ''}</span>}
            />
          )}
        </div>
        {fator !== 1 && (
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '8px' }}>
            {item.quantidade} {item.unidade} × {fator} = {quantidadeEntrando.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} no estoque. O sistema guarda este fator para as próximas notas deste fornecedor.
          </div>
        )}
        {custo && (
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.6 }}>
            Como o custo foi formado: produto {moeda(custo.valorProduto)}
            {custo.frete > 0 ? ` + frete ${moeda(custo.frete)}` : ''}
            {custo.seguro > 0 ? ` + seguro ${moeda(custo.seguro)}` : ''}
            {custo.outrasDespesas > 0 ? ` + outras despesas ${moeda(custo.outrasDespesas)}` : ''}
            {custo.ipi > 0 ? ` + IPI ${moeda(custo.ipi)}` : ''}
            {custo.icmsSt > 0 ? ` + ICMS-ST ${moeda(custo.icmsSt)}` : ''}
            {custo.desconto > 0 ? ` − desconto ${moeda(custo.desconto)}` : ''}
            {custo.icmsDesonerado > 0 ? ` − ICMS desonerado ${moeda(custo.icmsDesonerado)}` : ''}
            {custo.creditos.icms > 0 ? ` − crédito de ICMS ${moeda(custo.creditos.icms)}` : ''}
            {custo.creditos.pisCofins > 0 ? ` − crédito de PIS/COFINS ${moeda(custo.creditos.pisCofins)}` : ''}
            {' '}= <strong>{moeda(custo.custoTotal)}</strong>.
          </div>
        )}
      </div>

      {/* Impostos que vieram na nota */}
      <details style={{ marginBottom: '12px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12.5px', color: 'var(--text-secondary)' }}>Impostos da nota neste item</summary>
        <div style={{ ...grupoStyle, marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          <Detalhe rotulo={`ICMS (${item.icms.situacao || '—'} · origem ${item.icms.origem || '—'})`} valor={`base ${moeda(item.icms.base)} · ${item.icms.aliquota}% · ${moeda(item.icms.valor)}`} />
          {(item.icms.valorSt > 0 || item.icms.baseSt > 0) && (
            <Detalhe rotulo="ICMS-ST" valor={`base ${moeda(item.icms.baseSt)} · ${item.icms.aliquotaSt}% · MVA ${item.icms.mvaSt}% · ${moeda(item.icms.valorSt)}`} />
          )}
          <Detalhe rotulo={`IPI (${item.ipi.situacao || '—'})`} valor={`${item.ipi.aliquota}% · ${moeda(item.ipi.valor)}`} />
          <Detalhe rotulo={`PIS (${item.pis.situacao || '—'})`} valor={`${item.pis.aliquota}% · ${moeda(item.pis.valor)}`} />
          <Detalhe rotulo={`COFINS (${item.cofins.situacao || '—'})`} valor={`${item.cofins.aliquota}% · ${moeda(item.cofins.valor)}`} />
          {item.informacaoAdicional && <Detalhe rotulo="Informação adicional" valor={item.informacaoAdicional} />}
        </div>
      </details>

      {/* Lote e validade */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <div className="input-group">
          <label style={campoLabelStyle}>Lote</label>
          <input type="text" value={config.lote} onChange={(e) => onAlterarCampo('lote', e.target.value)} placeholder="Opcional" style={campoInputStyle} />
        </div>
        <div className="input-group">
          <label style={campoLabelStyle}>Validade</label>
          <input type="date" value={config.validade} onChange={(e) => onAlterarCampo('validade', e.target.value)} style={campoInputStyle} />
        </div>
      </div>

      {config.tipo === 'revenda' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Precificacao varejo */}
          <div style={grupoStyle}>
            <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>PREÇO DE VENDA — VAREJO</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <div className="input-group">
                <label style={campoLabelStyle}>Markup sobre o custo (%)</label>
                <input type="text" inputMode="decimal" value={markupVarejoDigitado ?? markupDoPreco(precoVarejo, custoUnitarioEstoque)} onChange={(e) => onMarkupVarejo(e.target.value)} style={campoInputStyle} aria-label="Markup do varejo" />
              </div>
              <div className="input-group">
                <label style={campoLabelStyle}>Preço de Venda *</label>
                <input type="number" step="0.01" min="0" value={config.precoVenda} onChange={(e) => onPrecoVarejo(e.target.value)} style={campoInputStyle} />
              </div>
              <Detalhe rotulo="Lucro por unidade" valor={<strong>{precoVarejo > 0 ? moeda(lucroPorUnidade(precoVarejo, custoUnitarioEstoque)) : '—'}</strong>} />
              <div className="input-group">
                <label style={campoLabelStyle}>Desconto máximo (%)</label>
                <input type="number" step="0.01" min="0" max="100" value={config.descontoMaximo} onChange={(e) => onAlterarCampo('descontoMaximo', e.target.value)} style={campoInputStyle} />
              </div>
              <Detalhe rotulo="Venda mínima" valor={<strong>{precoVarejo > 0 ? moeda(vendaMinima(precoVarejo, descontoMaximo)) : '—'}</strong>} />
            </div>
            {cadastro && (cadastro.precoVenda ?? 0) > 0 && (
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Este produto já vendia a {moeda(cadastro.precoVenda ?? 0)} (margem {percentual(margem.antes)} com o custo de antes; {percentual(margem.depois)} com o custo desta nota). O preço só muda se você alterar aqui.
              </div>
            )}
          </div>

          {/* Atacado */}
          <div style={grupoStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, cursor: config.atacadoBloqueado ? 'not-allowed' : 'pointer' }}>
              <input type="checkbox" checked={config.atacadoAtivo} disabled={config.atacadoBloqueado} onChange={(e) => onAlterarConfig({ atacadoAtivo: e.target.checked })} />
              PREÇO DE ATACADO
            </label>
            {config.atacadoBloqueado && (
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>Este produto tem mais de uma faixa de atacado; edite no cadastro do produto. A entrada não altera.</div>
            )}
            {config.atacadoAtivo && !config.atacadoBloqueado && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginTop: '8px' }}>
                <div className="input-group">
                  <label style={campoLabelStyle}>Quantidade mínima</label>
                  <input type="number" step="any" min="0" value={config.atacadoQtdMinima} onChange={(e) => onAlterarCampo('atacadoQtdMinima', e.target.value)} style={campoInputStyle} />
                </div>
                <div className="input-group">
                  <label style={campoLabelStyle}>Markup do atacado (%)</label>
                  <input type="text" inputMode="decimal" value={markupAtacadoDigitado ?? markupDoPreco(precoAtacado, custoUnitarioEstoque)} onChange={(e) => onMarkupAtacado(e.target.value)} style={campoInputStyle} aria-label="Markup do atacado" />
                </div>
                <div className="input-group">
                  <label style={campoLabelStyle}>Preço de atacado</label>
                  <input type="number" step="0.01" min="0" value={config.atacadoPreco} onChange={(e) => onPrecoAtacado(e.target.value)} style={campoInputStyle} />
                </div>
                <Detalhe rotulo="Lucro por unidade" valor={<strong>{precoAtacado > 0 ? moeda(lucroPorUnidade(precoAtacado, custoUnitarioEstoque)) : '—'}</strong>} />
              </div>
            )}
          </div>

          {avisos.length > 0 && (
            <div role="alert" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '12.5px', lineHeight: 1.5 }}>
              {avisos.map((aviso) => <div key={aviso}>{aviso}</div>)}
            </div>
          )}

          {/* Tributacao de saida do produto (como ja era) */}
          <div style={{ ...grupoStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <div className="input-group">
              <label style={campoLabelStyle}>{usaCsosn ? 'CSOSN' : 'CST ICMS'}</label>
              <select value={config.csosn} onChange={(e) => onAlterarCampo('csosn', e.target.value)} className="form-select" style={campoInputStyle}>
                <option value="">Selecione...</option>
                {(usaCsosn ? CSOSN_OPTIONS : ICMS_CST_OPTIONS).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {!usaCsosn && (
              <>
                <div className="input-group"><label style={campoLabelStyle}>Alíquota ICMS (%)</label><input type="number" step="0.01" min="0" value={config.aliquotaIcms} onChange={(e) => onAlterarCampo('aliquotaIcms', e.target.value)} style={campoInputStyle} /></div>
                <div className="input-group"><label style={campoLabelStyle}>Redução Base ICMS (%)</label><input type="number" step="0.01" min="0" value={config.reducaoBaseIcms} onChange={(e) => onAlterarCampo('reducaoBaseIcms', e.target.value)} style={campoInputStyle} /></div>
                <div className="input-group"><label style={campoLabelStyle}>CST PIS</label><input type="text" value={config.cstPis} onChange={(e) => onAlterarCampo('cstPis', e.target.value)} style={campoInputStyle} /></div>
                <div className="input-group"><label style={campoLabelStyle}>Alíquota PIS (%)</label><input type="number" step="0.01" min="0" value={config.aliquotaPis} onChange={(e) => onAlterarCampo('aliquotaPis', e.target.value)} style={campoInputStyle} /></div>
                <div className="input-group"><label style={campoLabelStyle}>CST COFINS</label><input type="text" value={config.cstCofins} onChange={(e) => onAlterarCampo('cstCofins', e.target.value)} style={campoInputStyle} /></div>
                <div className="input-group"><label style={campoLabelStyle}>Alíquota COFINS (%)</label><input type="number" step="0.01" min="0" value={config.aliquotaCofins} onChange={(e) => onAlterarCampo('aliquotaCofins', e.target.value)} style={campoInputStyle} /></div>
              </>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
          {config.tipo === 'insumo'
            ? `Insumo (material de consumo): não é vendido e não entra na receita de produto — soma no estoque de insumos pelo custo de ${moeda4(custoUnitarioEstoque)} por unidade.`
            : `Matéria-prima: sem preço de venda nem tributação — entra no estoque de produção pelo custo de ${moeda4(custoUnitarioEstoque)} por unidade.`}
        </p>
      )}
    </div>
  );
};

export default ItemDaNotaCard;

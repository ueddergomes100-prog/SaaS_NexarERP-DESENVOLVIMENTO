import React, { useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import {
  CATEGORIAS_DE_COMPRA,
  FORMAS_DE_PAGAMENTO,
  conferirParcelas,
  diasAteVencer,
  dividirEmParcelas,
  type DestinoDoPagamento,
  type ModoDePagamento,
  type ParcelaDaEntrada,
} from '../../../utils/pagamentoEntradaDomain';
import { campoInputStyle, campoLabelStyle, cartaoStyle, grupoStyle, moeda, tituloDoCartaoStyle } from './estilos';

export interface BancoParaEntrada {
  id: string;
  nome: string;
}

interface PagamentoCardProps {
  modo: ModoDePagamento;
  onModo: (modo: ModoDePagamento) => void;
  parcelas: ParcelaDaEntrada[];
  onParcelas: (parcelas: ParcelaDaEntrada[]) => void;
  totalDaNota: number;
  dataEmissao: string;
  formaPrevista: string;
  onFormaPrevista: (forma: string) => void;
  categoria: string;
  onCategoria: (categoria: string) => void;
  destino: DestinoDoPagamento;
  onDestino: (destino: DestinoDoPagamento) => void;
  bancoId: string;
  onBancoId: (id: string) => void;
  bancos: BancoParaEntrada[];
  parcelasAceitas: boolean;
  onAceitarParcelas: (aceita: boolean) => void;
  /** Forma de pagamento que o XML informou (rotulo), para a pessoa comparar. */
  formaNoXml: string;
}

const PagamentoCard: React.FC<PagamentoCardProps> = ({
  modo, onModo, parcelas, onParcelas, totalDaNota, dataEmissao, formaPrevista, onFormaPrevista, categoria, onCategoria,
  destino, onDestino, bancoId, onBancoId, bancos, parcelasAceitas, onAceitarParcelas, formaNoXml,
}) => {
  const [quantidadeParaDividir, setQuantidadeParaDividir] = useState('3');
  const [intervalo, setIntervalo] = useState('30');
  const conferencia = conferirParcelas(parcelas, totalDaNota);

  const alterar = (indice: number, patch: Partial<ParcelaDaEntrada>) => {
    onParcelas(parcelas.map((parcela, i) => (i === indice ? { ...parcela, ...patch } : parcela)));
    onAceitarParcelas(false);
  };

  const dividir = () => {
    const primeiro = parcelas[0]?.vencimento || dataEmissao;
    onParcelas(dividirEmParcelas(totalDaNota, Number(quantidadeParaDividir), primeiro, Number(intervalo) || 30));
    onAceitarParcelas(false);
  };

  const adicionar = () => {
    const ultima = parcelas[parcelas.length - 1];
    onParcelas([...parcelas, { numero: String(parcelas.length + 1), vencimento: ultima?.vencimento || dataEmissao, valor: 0 }]);
    onAceitarParcelas(false);
  };

  const remover = (indice: number) => {
    onParcelas(parcelas.filter((_, i) => i !== indice).map((parcela, i) => ({ ...parcela, numero: String(i + 1) })));
    onAceitarParcelas(false);
  };

  return (
    <div className="card" style={cartaoStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <FileText size={18} color="var(--accent-purple)" />
        <h3 style={tituloDoCartaoStyle}>Forma de pagamento — Contas a Pagar</h3>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="radio" name="modo-pagamento" checked={modo === 'prazo'} onChange={() => onModo('prazo')} /> A prazo (fica em Contas a Pagar)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="radio" name="modo-pagamento" checked={modo === 'avista'} onChange={() => onModo('avista')} /> À vista (já paga na entrada)
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
        <div className="input-group">
          <label style={campoLabelStyle}>Categoria da despesa</label>
          <select value={categoria} onChange={(e) => onCategoria(e.target.value)} className="form-select" style={campoInputStyle}>
            {CATEGORIAS_DE_COMPRA.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label style={campoLabelStyle}>Forma de pagamento{modo === 'prazo' ? ' prevista' : ''}</label>
          <select value={formaPrevista} onChange={(e) => onFormaPrevista(e.target.value)} className="form-select" style={campoInputStyle}>
            {FORMAS_DE_PAGAMENTO.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
          </select>
          {formaNoXml && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>A nota informa: {formaNoXml}</span>}
        </div>
      </div>

      {modo === 'avista' ? (
        <div style={grupoStyle}>
          <div style={{ fontSize: '12.5px', marginBottom: '8px' }}>Pagamento de <strong>{moeda(totalDaNota)}</strong> hoje, saindo de:</div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="radio" name="destino-pagamento" checked={destino === 'caixa'} onChange={() => onDestino('caixa')} /> Caixa (dinheiro)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="radio" name="destino-pagamento" checked={destino === 'banco'} onChange={() => onDestino('banco')} /> Banco
            </label>
          </div>
          {destino === 'banco' && (
            <div className="input-group" style={{ maxWidth: '320px' }}>
              <label style={campoLabelStyle}>Banco</label>
              <select value={bancoId} onChange={(e) => onBancoId(e.target.value)} className="form-select" style={campoInputStyle}>
                <option value="">Selecione o banco...</option>
                {bancos.map((banco) => <option key={banco.id} value={banco.id}>{banco.nome}</option>)}
              </select>
            </div>
          )}
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '10px' }}>
            O título entra como <strong>Pago</strong> e o saldo do banco é debitado. Uma nota paga não pode ser excluída depois sem estornar o pagamento antes.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {parcelas.map((parcela, indice) => {
              const dias = diasAteVencer(dataEmissao, parcela.vencimento);
              return (
                <div key={indice} style={{ display: 'grid', gridTemplateColumns: '60px minmax(150px, 190px) 90px minmax(120px, 160px) auto', gap: '10px', alignItems: 'end' }}>
                  <div><label style={campoLabelStyle}>Parcela</label><div style={{ padding: '8px 0', fontSize: '13px', fontWeight: 600 }}>{parcela.numero}</div></div>
                  <div className="input-group">
                    <label style={campoLabelStyle}>Vencimento</label>
                    <input type="date" value={parcela.vencimento} onChange={(e) => alterar(indice, { vencimento: e.target.value })} style={campoInputStyle} />
                  </div>
                  <div><label style={campoLabelStyle}>Dias</label><div style={{ padding: '8px 0', fontSize: '13px', color: 'var(--text-muted)' }}>{dias === null ? '—' : dias}</div></div>
                  <div className="input-group">
                    <label style={campoLabelStyle}>Valor</label>
                    <input type="number" step="0.01" min="0" value={parcela.valor || ''} onChange={(e) => alterar(indice, { valor: Number(e.target.value) || 0 })} style={campoInputStyle} />
                  </div>
                  <button type="button" className="btn-secondary" onClick={() => remover(indice)} disabled={parcelas.length <= 1} aria-label={`Remover parcela ${parcela.numero}`} style={{ padding: '8px' }}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'end', marginTop: '12px' }}>
            <button type="button" className="btn-secondary" onClick={adicionar} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}><Plus size={14} /> Adicionar parcela</button>
            <div className="input-group" style={{ width: '80px' }}>
              <label style={campoLabelStyle}>Dividir em</label>
              <input type="number" min="1" max="60" value={quantidadeParaDividir} onChange={(e) => setQuantidadeParaDividir(e.target.value)} style={campoInputStyle} />
            </div>
            <div className="input-group" style={{ width: '110px' }}>
              <label style={campoLabelStyle}>a cada (dias)</label>
              <input type="number" min="1" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} style={campoInputStyle} />
            </div>
            <button type="button" className="btn-secondary" onClick={dividir} style={{ fontSize: '12px' }}>Dividir o total em parcelas iguais</button>
          </div>

          <div style={{ marginTop: '12px', fontSize: '13px' }}>
            Soma das parcelas: <strong>{moeda(conferencia.soma)}</strong> · Total da nota: <strong>{moeda(totalDaNota)}</strong>
          </div>
          {conferencia.erro && <div role="alert" style={{ marginTop: '8px', color: '#ef4444', fontSize: '13px' }}>{conferencia.erro}</div>}
          {conferencia.aviso && (
            <div role="alert" style={{ marginTop: '8px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '13px', lineHeight: 1.5 }}>
              {conferencia.aviso}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={parcelasAceitas} onChange={(e) => onAceitarParcelas(e.target.checked)} />
                Conferi as parcelas e quero lançar assim
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PagamentoCard;

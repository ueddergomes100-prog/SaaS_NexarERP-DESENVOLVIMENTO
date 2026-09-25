import React from 'react';
import { FileText } from 'lucide-react';
import {
  CATEGORIAS_DE_COMPRA,
  FORMAS_DE_PAGAMENTO,
  type DestinoDoPagamento,
  type ModoDePagamento,
} from '../../../utils/pagamentoEntradaDomain';
import type { ParcelaComCheque } from '../../../utils/chequeEmitidoDomain';
import ParcelasEditor from '../../financeiro/ParcelasEditor';
import { campoInputStyle, campoLabelStyle, cartaoStyle, grupoStyle, moeda, tituloDoCartaoStyle } from './estilos';

export interface BancoParaEntrada {
  id: string;
  nome: string;
}

interface PagamentoCardProps {
  modo: ModoDePagamento;
  onModo: (modo: ModoDePagamento) => void;
  parcelas: ParcelaComCheque[];
  onParcelas: (parcelas: ParcelaComCheque[]) => void;
  totalDaNota: number;
  dataEmissao: string;
  formaPrevista: string;
  onFormaPrevista: (forma: string) => void;
  categoria: string;
  onCategoria: (categoria: string) => void;
  /** Categorias do plano de contas da empresa; sem elas, usa a lista padrao de compras. */
  categoriasDaEmpresa?: string[];
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
  modo, onModo, parcelas, onParcelas, totalDaNota, dataEmissao, formaPrevista, onFormaPrevista, categoria, onCategoria, categoriasDaEmpresa,
  destino, onDestino, bancoId, onBancoId, bancos, parcelasAceitas, onAceitarParcelas, formaNoXml,
}) => {
  // Cheque nunca e' "a vista": o dinheiro so' sai quando o cheque compensa.
  const emCheque = formaPrevista === 'Cheque';
  const modoEfetivo: ModoDePagamento = emCheque ? 'prazo' : modo;
  const opcoesDeCategoria = categoriasDaEmpresa && categoriasDaEmpresa.length > 0 ? categoriasDaEmpresa : [...CATEGORIAS_DE_COMPRA];

  return (
    <div className="card" style={cartaoStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <FileText size={18} color="var(--accent-purple)" />
        <h3 style={tituloDoCartaoStyle}>Forma de pagamento — Contas a Pagar</h3>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
        <div className="input-group">
          <label style={campoLabelStyle}>Categoria da despesa</label>
          <select value={categoria} onChange={(e) => onCategoria(e.target.value)} className="form-select" style={campoInputStyle}>
            {opcoesDeCategoria.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label style={campoLabelStyle}>Forma de pagamento</label>
          <select value={formaPrevista} onChange={(e) => { onFormaPrevista(e.target.value); if (e.target.value === 'Cheque') onModo('prazo'); }} className="form-select" style={campoInputStyle}>
            {FORMAS_DE_PAGAMENTO.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
          </select>
          {formaNoXml && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>A nota informa: {formaNoXml}</span>}
        </div>
      </div>

      {!emCheque && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input type="radio" name="modo-pagamento" checked={modoEfetivo === 'prazo'} onChange={() => onModo('prazo')} /> A prazo (fica em Contas a Pagar)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input type="radio" name="modo-pagamento" checked={modoEfetivo === 'avista'} onChange={() => onModo('avista')} /> À vista (já paga na entrada)
          </label>
        </div>
      )}

      {modoEfetivo === 'avista' ? (
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
        <ParcelasEditor
          parcelas={parcelas}
          onParcelas={onParcelas}
          total={totalDaNota}
          dataBase={dataEmissao}
          forma={formaPrevista}
          bancos={bancos}
          aceitas={parcelasAceitas}
          onAceitar={onAceitarParcelas}
        />
      )}
    </div>
  );
};

export default PagamentoCard;

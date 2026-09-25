import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { conferirParcelas, diasAteVencer, dividirEmParcelas } from '../../utils/pagamentoEntradaDomain';
import { aplicarChequesNasParcelas, type BancoDoCheque, type ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import { campoInputStyle, campoLabelStyle, moeda } from '../fiscal/entrada/estilos';

/*
 * PARCELAS DE UM PAGAMENTO (boleto, PIX, transferencia... ou CHEQUES).
 *
 * Usado na Entrada de NF-e e no "Lancar Despesa" do Contas a Pagar: editar
 * vencimento e valor, dividir o total em N vezes (a cada X dias), adicionar e
 * remover parcela. Com forma = Cheque, cada parcela ganha banco e numero do
 * cheque, e a data passa a ser a de COMPENSACAO (o dia em que o valor sai do
 * banco). Soma que nao fecha com o total pede confirmacao (nao impede).
 */

interface ParcelasEditorProps {
  parcelas: ParcelaComCheque[];
  onParcelas: (parcelas: ParcelaComCheque[]) => void;
  total: number;
  /** Data de referencia para a coluna "Dias" (emissao da nota, ou hoje). */
  dataBase: string;
  forma: string;
  bancos: BancoDoCheque[];
  aceitas: boolean;
  onAceitar: (aceita: boolean) => void;
}

const ParcelasEditor: React.FC<ParcelasEditorProps> = ({ parcelas, onParcelas, total, dataBase, forma, bancos, aceitas, onAceitar }) => {
  const [quantidadeParaDividir, setQuantidadeParaDividir] = useState('3');
  const [intervalo, setIntervalo] = useState('30');
  const [bancoDeTodos, setBancoDeTodos] = useState('');
  const [primeiroCheque, setPrimeiroCheque] = useState('');
  const emCheque = forma === 'Cheque';
  const conferencia = conferirParcelas(parcelas, total);

  const alterar = (indice: number, patch: Partial<ParcelaComCheque>) => {
    onParcelas(parcelas.map((parcela, i) => (i === indice ? { ...parcela, ...patch } : parcela)));
    onAceitar(false);
  };

  const dividir = () => {
    const primeiro = parcelas[0]?.vencimento || dataBase;
    const novas = dividirEmParcelas(total, Number(quantidadeParaDividir), primeiro, Number(intervalo) || 30);
    // Ao redividir, preserva banco/numero ja escolhidos nas primeiras parcelas.
    onParcelas(novas.map((parcela, i) => ({ ...parcela, ...(parcelas[i]?.bancoId ? { bancoId: parcelas[i].bancoId } : {}), ...(parcelas[i]?.numeroCheque ? { numeroCheque: parcelas[i].numeroCheque } : {}) })));
    onAceitar(false);
  };

  const adicionar = () => {
    const ultima = parcelas[parcelas.length - 1];
    onParcelas([...parcelas, { numero: String(parcelas.length + 1), vencimento: ultima?.vencimento || dataBase, valor: 0, ...(ultima?.bancoId ? { bancoId: ultima.bancoId } : {}) }]);
    onAceitar(false);
  };

  const remover = (indice: number) => {
    onParcelas(parcelas.filter((_, i) => i !== indice).map((parcela, i) => ({ ...parcela, numero: String(i + 1) })));
    onAceitar(false);
  };

  const colunas = emCheque
    ? '52px minmax(140px, 170px) 60px minmax(110px, 140px) minmax(130px, 170px) minmax(100px, 130px) auto'
    : '60px minmax(150px, 190px) 90px minmax(120px, 160px) auto';

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {parcelas.map((parcela, indice) => {
          const dias = diasAteVencer(dataBase, parcela.vencimento);
          return (
            <div key={indice} style={{ display: 'grid', gridTemplateColumns: colunas, gap: '10px', alignItems: 'end' }}>
              <div><label style={campoLabelStyle}>{emCheque ? 'Cheque' : 'Parcela'}</label><div style={{ padding: '8px 0', fontSize: '13px', fontWeight: 600 }}>{parcela.numero}</div></div>
              <div className="input-group">
                <label style={campoLabelStyle}>{emCheque ? 'Compensa em (bom para)' : 'Vencimento'}</label>
                <input type="date" value={parcela.vencimento} onChange={(e) => alterar(indice, { vencimento: e.target.value })} style={campoInputStyle} />
              </div>
              <div><label style={campoLabelStyle}>Dias</label><div style={{ padding: '8px 0', fontSize: '13px', color: 'var(--text-muted)' }}>{dias === null ? '—' : dias}</div></div>
              <div className="input-group">
                <label style={campoLabelStyle}>Valor</label>
                <input type="number" step="0.01" min="0" value={parcela.valor || ''} onChange={(e) => alterar(indice, { valor: Number(e.target.value) || 0 })} style={campoInputStyle} />
              </div>
              {emCheque && (
                <>
                  <div className="input-group">
                    <label style={campoLabelStyle}>Banco do cheque</label>
                    <select value={parcela.bancoId || ''} onChange={(e) => alterar(indice, { bancoId: e.target.value })} className="form-select" style={campoInputStyle} aria-label={`Banco do cheque da parcela ${parcela.numero}`}>
                      <option value="">Selecione...</option>
                      {bancos.map((banco) => <option key={banco.id} value={banco.id}>{banco.nome}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label style={campoLabelStyle}>Nº do cheque</label>
                    <input type="text" value={parcela.numeroCheque || ''} onChange={(e) => alterar(indice, { numeroCheque: e.target.value })} style={campoInputStyle} aria-label={`Número do cheque da parcela ${parcela.numero}`} />
                  </div>
                </>
              )}
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
        <button type="button" className="btn-secondary" onClick={dividir} style={{ fontSize: '12px' }}>{emCheque ? 'Dividir o total em cheques iguais' : 'Dividir o total em parcelas iguais'}</button>
      </div>

      {emCheque && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'end', marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
          <div className="input-group" style={{ minWidth: '180px' }}>
            <label style={campoLabelStyle}>Mesmo banco para todos</label>
            <select value={bancoDeTodos} onChange={(e) => setBancoDeTodos(e.target.value)} className="form-select" style={campoInputStyle}>
              <option value="">Selecione...</option>
              {bancos.map((banco) => <option key={banco.id} value={banco.id}>{banco.nome}</option>)}
            </select>
          </div>
          <div className="input-group" style={{ width: '170px' }}>
            <label style={campoLabelStyle}>1º nº do cheque</label>
            <input type="text" value={primeiroCheque} onChange={(e) => setPrimeiroCheque(e.target.value)} placeholder="Numera em sequência" style={campoInputStyle} />
          </div>
          <button type="button" className="btn-secondary" onClick={() => { onParcelas(aplicarChequesNasParcelas(parcelas, bancoDeTodos, primeiroCheque)); onAceitar(false); }} style={{ fontSize: '12px' }}>Aplicar a todos os cheques</button>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>O cheque só sai do banco quando você confirma a compensação em Financeiro › Cheques › Emitidos.</span>
        </div>
      )}

      <div style={{ marginTop: '12px', fontSize: '13px' }}>
        Soma das parcelas: <strong>{moeda(conferencia.soma)}</strong> · Total: <strong>{moeda(total)}</strong>
      </div>
      {conferencia.erro && <div role="alert" style={{ marginTop: '8px', color: '#ef4444', fontSize: '13px' }}>{conferencia.erro}</div>}
      {conferencia.aviso && (
        <div role="alert" style={{ marginTop: '8px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '13px', lineHeight: 1.5 }}>
          {conferencia.aviso}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={aceitas} onChange={(e) => onAceitar(e.target.checked)} />
            Conferi as parcelas e quero lançar assim
          </label>
        </div>
      )}
    </div>
  );
};

export default ParcelasEditor;

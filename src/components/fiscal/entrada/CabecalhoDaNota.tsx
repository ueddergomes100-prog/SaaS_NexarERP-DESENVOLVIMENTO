import React from 'react';
import { CheckCircle, FileText, Loader2, Printer } from 'lucide-react';
import type { NotaParseada } from '../../../utils/nfeXmlDomain';
import { formatarChave, formatarDocumento } from '../../../utils/danfePdf';
import { campoInputStyle, campoLabelStyle, cartaoStyle, dataBr, moeda, tituloDoCartaoStyle } from './estilos';

interface CabecalhoDaNotaProps {
  nota: NotaParseada;
  fornecedorNome: string;
  fornecedorCadastrado: boolean;
  dataEntrada: string;
  onDataEntrada: (valor: string) => void;
  observacao: string;
  onObservacao: (valor: string) => void;
  onImprimirDanfe: () => void;
  gerandoDanfe: boolean;
}

const Campo: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div>
    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>{rotulo}</label>
    <strong style={{ fontSize: '14px', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{children}</strong>
  </div>
);

/** Dados da nota lidos do XML + data de entrada e observacao (o que o outro ERP mostra na aba "Nota Fiscal"). */
const CabecalhoDaNota: React.FC<CabecalhoDaNotaProps> = ({
  nota, fornecedorNome, fornecedorCadastrado, dataEntrada, onDataEntrada, observacao, onObservacao, onImprimirDanfe, gerandoDanfe,
}) => (
  <div className="card" style={cartaoStyle}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <FileText size={18} color="var(--accent-purple)" />
        <h3 style={tituloDoCartaoStyle}>Dados da nota</h3>
        {fornecedorCadastrado && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#10b981', fontWeight: 600 }}><CheckCircle size={13} /> Fornecedor cadastrado</span>
        )}
      </div>
      <button type="button" className="btn-secondary" onClick={onImprimirDanfe} disabled={gerandoDanfe} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {gerandoDanfe ? <Loader2 size={16} className="spin-icon" /> : <Printer size={16} />} Imprimir DANFE
      </button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
      <Campo rotulo="Fornecedor">{fornecedorNome}</Campo>
      <Campo rotulo="CNPJ do fornecedor">{formatarDocumento(nota.emitente.documento)}</Campo>
      <Campo rotulo="Número / Série / Modelo">{nota.numero} / {nota.serie || '—'} / {nota.modelo || '—'}</Campo>
      <Campo rotulo="Natureza da operação">{nota.naturezaOperacao || '—'}</Campo>
      <Campo rotulo="Data de emissão">{dataBr(nota.dataEmissao)}</Campo>
      <Campo rotulo="Data de saída">{dataBr(nota.dataSaida)}</Campo>
      <Campo rotulo="Valor total da nota"><span style={{ fontSize: '18px', color: '#10b981' }}>{moeda(nota.totais.total)}</span></Campo>
      <Campo rotulo="Protocolo de autorização">{nota.protocolo || '—'}</Campo>
    </div>

    <div style={{ marginTop: '14px' }}>
      <label style={campoLabelStyle}>Chave de acesso</label>
      <div style={{ fontFamily: 'monospace', fontSize: '13px', color: nota.chave ? 'var(--text-primary)' : '#f59e0b', wordBreak: 'break-all' }}>
        {nota.chave ? formatarChave(nota.chave) : 'Este XML não traz a chave de acesso. Sem ela não dá para conferir se a nota já foi lançada antes.'}
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: '16px', marginTop: '16px' }}>
      <div className="input-group">
        <label style={campoLabelStyle}>Data de entrada da mercadoria</label>
        <input type="date" value={dataEntrada} onChange={(e) => onDataEntrada(e.target.value)} style={campoInputStyle} />
      </div>
      <div className="input-group">
        <label style={campoLabelStyle}>Observação</label>
        <input type="text" value={observacao} onChange={(e) => onObservacao(e.target.value)} placeholder="Opcional — aparece no histórico desta entrada" style={campoInputStyle} maxLength={300} />
      </div>
    </div>

    {nota.informacoesComplementares && (
      <div style={{ marginTop: '14px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        <strong>Informações complementares da nota:</strong> {nota.informacoesComplementares}
      </div>
    )}
  </div>
);

export default CabecalhoDaNota;

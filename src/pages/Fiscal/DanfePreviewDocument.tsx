import React from 'react';
import { getCompanyAddressRows } from '../../utils/companyAddress';

export interface DanfePreviewItem {
  nome: string;
  quantidade: number;
  precoUnitario: number;
}

interface DanfePreviewDocumentProps {
  /** Dados do emitente, do doc `configuracoes/{tenantId}`. */
  configData: any;
  tipo: string;
  clienteNome: string;
  documento: string;
  email?: string;
  enderecoCliente: {
    rua?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
  };
  descricao: string;
  valorTotal: number;
  itens: DanfePreviewItem[];
  ncm?: string;
  cfop?: string;
}

const formatMoeda = (valor: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(Number.isFinite(valor) ? valor : 0);

/**
 * Pre-visualizacao (rascunho) da DANFE, montada a partir do que esta no
 * formulario ANTES de transmitir -- serve pra conferir emitente,
 * destinatario, itens e total antes de mandar pra SEFAZ.
 *
 * IMPORTANTE: isto NAO e' uma DANFE. Uma DANFE real so existe depois da
 * autorizacao (tem numero, chave de acesso e protocolo, que aqui ainda nao
 * existem) e e' emitida pela Spedy/SEFAZ, nao por esta tela. Por isso o
 * documento sai carimbado como rascunho sem valor fiscal em todas as
 * chamadas -- nunca deve poder ser confundido com o documento autorizado.
 */
const DanfePreviewDocument: React.FC<DanfePreviewDocumentProps> = ({
  configData,
  tipo,
  clienteNome,
  documento,
  email,
  enderecoCliente,
  descricao,
  valorTotal,
  itens,
  ncm,
  cfop,
}) => {
  const companyAddressRows = getCompanyAddressRows(configData);
  const hoje = new Date().toLocaleDateString('pt-BR');
  const enderecoClienteLinha = [
    [enderecoCliente.rua, enderecoCliente.numero].filter(Boolean).join(', '),
    enderecoCliente.bairro,
    [enderecoCliente.cidade, enderecoCliente.estado].filter(Boolean).join(' - '),
    enderecoCliente.cep,
  ].filter(Boolean).join(' | ');

  return (
    <div className="a4-page">
      <div
        style={{
          border: '2px dashed #b45309',
          backgroundColor: '#fef3c7',
          color: '#78350f',
          padding: '10px 14px',
          marginBottom: '16px',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: '13px',
          letterSpacing: '0.5px',
        }}
      >
        PRÉ-VISUALIZAÇÃO — DOCUMENTO NÃO TRANSMITIDO / SEM VALOR FISCAL
        <div style={{ fontWeight: 400, fontSize: '11px', marginTop: '4px' }}>
          Conferência interna antes do envio. A DANFE válida só é gerada após a autorização da SEFAZ.
        </div>
      </div>

      <div className="a4-header">
        <div className="a4-logo">
          {configData?.logo && (
            <img src={configData.logo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain', marginBottom: '8px' }} />
          )}
          <h2 style={{ fontSize: configData?.logo ? '16px' : '24px', margin: 0 }}>{configData?.nomeOficina || 'EMITENTE'}</h2>
          <p>CNPJ: {configData?.cnpj || '—'}</p>
          {companyAddressRows.map((row) => (
            <p key={row.label}><strong>{row.label}:</strong> {row.value}</p>
          ))}
          <p>{configData?.telefone || ''} {configData?.email ? `| ${configData.email}` : ''}</p>
        </div>
        <div className="a4-os-info">
          <h1>{tipo} (RASCUNHO)</h1>
          <h2 className="os-number">Nº —</h2>
          <p><strong>Emissão prevista:</strong> {hoje}</p>
          <p><strong>Chave de acesso:</strong> —</p>
        </div>
      </div>

      <div className="a4-section">
        <h3>Destinatário</h3>
        <p><strong>Nome:</strong> {clienteNome || '—'}</p>
        <p><strong>CPF / CNPJ:</strong> {documento || '—'}</p>
        {email && <p><strong>E-mail:</strong> {email}</p>}
        {enderecoClienteLinha && <p><strong>Endereço:</strong> {enderecoClienteLinha}</p>}
      </div>

      <div className="a4-section">
        <h3>Itens</h3>
        {itens.length > 0 ? (
          <table className="a4-table">
            <thead>
              <tr>
                <th>Descrição</th>
                <th style={{ textAlign: 'center' }}>Qtd</th>
                <th style={{ textAlign: 'right' }}>Valor Unit.</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item, index) => (
                <tr key={`${item.nome}-${index}`}>
                  <td>{item.nome}</td>
                  <td style={{ textAlign: 'center' }}>{item.quantidade}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoeda(item.precoUnitario)}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoeda(item.precoUnitario * item.quantidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>{descricao || 'Sem itens detalhados — a nota será emitida pela descrição informada.'}</p>
        )}
      </div>

      {(ncm || cfop) && (
        <div className="a4-section">
          <h3>Dados fiscais informados</h3>
          {ncm && <p><strong>NCM:</strong> {ncm}</p>}
          {cfop && <p><strong>CFOP:</strong> {cfop}</p>}
        </div>
      )}

      <div className="a4-section">
        <h3>Total</h3>
        <p style={{ fontSize: '18px', fontWeight: 700 }}>{formatMoeda(valorTotal)}</p>
      </div>

      <div style={{ marginTop: '24px', fontSize: '11px', color: '#78350f', borderTop: '1px dashed #b45309', paddingTop: '10px' }}>
        Rascunho gerado em {hoje} apenas para conferência. Não possui número, chave de acesso nem protocolo de
        autorização, e não substitui a DANFE emitida após a transmissão.
      </div>
    </div>
  );
};

export default DanfePreviewDocument;

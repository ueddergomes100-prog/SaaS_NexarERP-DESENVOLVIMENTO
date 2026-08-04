import React from 'react';
import { getCompanyAddressRows } from '../../utils/companyAddress';

interface PedidoPrintDocumentProps {
  pedidoData: any;
  clientData: any;
  configData: any;
}

/**
 * Layout do recibo de venda (Modulo 3). Compartilhado entre a impressao
 * unitaria (PedidoPrint.tsx) e a impressao em lote (PedidoPrintLote.tsx)
 * para nao duplicar o layout em dois lugares.
 */
const PedidoPrintDocument: React.FC<PedidoPrintDocumentProps> = ({ pedidoData, clientData, configData }) => {
  const dataCriacao = pedidoData.createdAt?.toDate ? pedidoData.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const companyAddressRows = getCompanyAddressRows(configData);
  const itens = pedidoData.itens || [];
  const valorTotal = pedidoData.valorTotal || 0;

  return (
    <div className="a4-page">
      <div className="a4-header">
        <div className="a4-logo">
          {configData?.logo && (
            <img src={configData.logo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain', marginBottom: '8px' }} />
          )}
          <h2 style={{ fontSize: configData?.logo ? '16px' : '24px', margin: 0 }}>{configData?.nomeOficina || 'NEXAR ERP'}</h2>
          <p>CNPJ: {configData?.cnpj || '00.000.000/0001-00'}</p>
          {companyAddressRows.map((row) => (
            <p key={row.label}><strong>{row.label}:</strong> {row.value}</p>
          ))}
          <p>{configData?.telefone || ''} | {configData?.email || ''}</p>
        </div>
        <div className="a4-os-info">
          <h1>RECIBO DE VENDA</h1>
          <h2 className="os-number">Nº {pedidoData.numeroPedido || pedidoData.id.substring(0, 6).toUpperCase()}</h2>
          <p><strong>Data:</strong> {dataCriacao}</p>
        </div>
      </div>

      <div className="a4-section">
        <h3 className="section-title">Dados do Cliente</h3>
        <div className="a4-grid">
          <p><strong>Nome:</strong> {pedidoData.clienteNome}</p>
          <p><strong>CPF/CNPJ:</strong> {clientData?.documento || '---'}</p>
          <p><strong>Telefone:</strong> {clientData?.telefone || '---'}</p>
          <p><strong>E-mail:</strong> {clientData?.email || '---'}</p>
        </div>
        <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
          <p><strong>Endereço:</strong> {clientData?.endereco || '---'}{clientData?.numero ? `, ${clientData.numero}` : ''}</p>
          <p><strong>Bairro:</strong> {clientData?.bairro || '---'}</p>
        </div>
      </div>

      <div className="a4-section">
        <p><strong>Forma de Pagamento:</strong> {pedidoData.formaPagamento}</p>
      </div>

      <div className="a4-section">
        <h3 className="section-title">Produtos Adquiridos</h3>
        <table className="a4-table">
          <thead>
            <tr>
              <th>Descrição do Item</th>
              <th style={{ textAlign: 'center' }}>Qtd</th>
              <th style={{ textAlign: 'right' }}>V. Unitário</th>
              <th style={{ textAlign: 'right' }}>Desconto</th>
              <th style={{ textAlign: 'right' }}>Subtotal (R$)</th>
            </tr>
          </thead>
          <tbody>
            {itens.length > 0 ? (
              itens.map((item: any, i: number) => (
                <tr key={i}>
                  <td>{item.nome}</td>
                  <td style={{ textAlign: 'center' }}>
                    {Number(item.quantidade).toFixed(item.unidadeMedidaCasasDecimais ?? 0)} {item.unidadeMedidaSigla || 'UN'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.precoUnitario)}
                  </td>
                  <td style={{ textAlign: 'right', color: item.desconto > 0 ? '#ef4444' : 'inherit' }}>
                    {item.desconto > 0 ? `- ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.desconto)}` : '-'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.subtotal)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '10px' }}>Nenhum item adicionado.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ textAlign: 'right', color: '#666', fontSize: '13px' }}>Subtotal Itens:</td>
              <td style={{ textAlign: 'right', color: '#666', fontSize: '13px' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pedidoData.valorTotalItens || 0)}
              </td>
            </tr>
            {pedidoData.valorTotalDescontos > 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', color: '#ef4444', fontSize: '13px' }}>Descontos:</td>
                <td style={{ textAlign: 'right', color: '#ef4444', fontSize: '13px' }}>
                  -{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pedidoData.valorTotalDescontos)}
                </td>
              </tr>
            )}
            {pedidoData.frete > 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', color: '#666', fontSize: '13px' }}>Frete (+):</td>
                <td style={{ textAlign: 'right', color: '#666', fontSize: '13px' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pedidoData.frete)}
                </td>
              </tr>
            )}
            {pedidoData.encargos > 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'right', color: '#666', fontSize: '13px' }}>Encargos (+):</td>
                <td style={{ textAlign: 'right', color: '#666', fontSize: '13px' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pedidoData.encargos)}
                </td>
              </tr>
            )}
            <tr style={{ borderTop: '2px solid #333' }}>
              <td colSpan={4} style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '15px', paddingTop: '8px' }}>TOTAL GERAL:</td>
              <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '18px', paddingTop: '8px' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="a4-signatures">
        <div className="signature-box">
          <div className="signature-line"></div>
          <p>Assinatura do Cliente</p>
        </div>
        <div className="signature-box">
          <div className="signature-line"></div>
          <p>Assinatura do Responsável</p>
        </div>
      </div>

      <div className="a4-footer">
        <p>Obrigado pela preferência!</p>
        <p>Gerado pelo Sistema Hennder ERP.</p>
      </div>
    </div>
  );
};

export default PedidoPrintDocument;

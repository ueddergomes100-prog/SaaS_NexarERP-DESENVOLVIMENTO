import React from 'react';
import { getCompanyAddressRows } from '../../utils/companyAddress';

export interface MinutaItem {
  id: string;
  nome: string;
  /** Na unidade em que foi vendido: "2 SC", nao "40 KG". O separador tira 2
   * sacos da prateleira, e a conversao para quilo nao interessa a ele. */
  quantidade: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  /** Presente quando o item foi vendido em embalagem. */
  embalagemId?: string;
  codigo?: string;
  localizacaoEstoque?: string;
}

interface MinutaPrintDocumentProps {
  pedidoData: any;
  itens: MinutaItem[];
  configData: any;
}

/**
 * Layout da minuta de entrega (Modulo 12, Fatia 2/4) -- documento de
 * separacao pro estoque, deliberadamente SEM nenhum valor monetario (preco,
 * desconto, total). So local, codigo, produto e quantidade, mais rodape de
 * assinatura. `itens` ja vem enriquecido (localizacaoEstoque/codigo do
 * cadastro) e ordenado por quem chamou (MinutaPrint.tsx), nao por aqui --
 * este componente so renderiza.
 */
const MinutaPrintDocument: React.FC<MinutaPrintDocumentProps> = ({ pedidoData, itens, configData }) => {
  const dataCriacao = pedidoData.createdAt?.toDate ? pedidoData.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const companyAddressRows = getCompanyAddressRows(configData);

  return (
    <div className="a4-page">
      <div className="a4-header">
        <div className="a4-logo">
          {configData?.logo && (
            <img src={configData.logo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain', marginBottom: '8px' }} />
          )}
          <h2 style={{ fontSize: configData?.logo ? '16px' : '24px', margin: 0 }}>{configData?.nomeOficina || 'NEXAR ERP'}</h2>
          {companyAddressRows.map((row) => (
            <p key={row.label}><strong>{row.label}:</strong> {row.value}</p>
          ))}
        </div>
        <div className="a4-os-info">
          <h1>MINUTA DE ENTREGA</h1>
          <h2 className="os-number">Pedido Nº {pedidoData.numeroPedido || pedidoData.id.substring(0, 6).toUpperCase()}</h2>
          <p><strong>Data:</strong> {dataCriacao}</p>
        </div>
      </div>

      <div className="a4-section">
        <div className="a4-grid">
          <p><strong>Cliente:</strong> {pedidoData.clienteNome || 'Consumidor Final'}</p>
          <p><strong>Vendedor:</strong> {pedidoData.vendedorNome || '---'}</p>
        </div>
      </div>

      <div className="a4-section">
        <h3 className="section-title">Itens para Separação</h3>
        <table className="a4-table">
          <thead>
            <tr>
              <th>Local</th>
              <th>Código</th>
              <th>Produto</th>
              <th style={{ textAlign: 'center' }}>Qtd</th>
            </tr>
          </thead>
          <tbody>
            {itens.length > 0 ? (
              itens.map((item, i) => (
                <tr key={`${item.id}-${i}`}>
                  <td>{item.localizacaoEstoque || '---'}</td>
                  <td>{item.codigo || '---'}</td>
                  <td>{item.nome}</td>
                  <td style={{ textAlign: 'center' }}>
                    {Number(item.quantidade).toFixed(item.unidadeMedidaCasasDecimais ?? 0)} {item.unidadeMedidaSigla || 'UN'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '10px' }}>Nenhum item adicionado.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
          {itens.length} {itens.length === 1 ? 'item' : 'itens'} — documento sem valores, uso exclusivo para separação de mercadoria.
        </p>
      </div>

      <div className="a4-signatures">
        <div className="signature-box">
          <div className="signature-line"></div>
          <p>Separado por</p>
        </div>
        <div className="signature-box">
          <div className="signature-line"></div>
          <p>Conferido por</p>
        </div>
      </div>

      <div className="a4-footer">
        <p>Gerado pelo Sistema Hennder ERP.</p>
      </div>
    </div>
  );
};

export default MinutaPrintDocument;

import React from 'react';
import { DEFAULT_OS_PRINT_MODEL } from '../../utils/osPrintModels';
import { getServiceHours, getServiceTotal } from '../../utils/osServicePricing';
import { getCompanyAddressRows } from '../../utils/companyAddress';
import { resolverDescontoImpressaoOS, totalComDescontoOS } from '../../utils/osDescontoImpressao';
import OsPrintPersonalizado01 from './OsPrintPersonalizado01';
import './OsPrint.css';

interface OsPrintDocumentProps {
  osData: any;
  clientData: any;
  vehicleData: any;
  configData: any;
}

/**
 * Folha impressa da OS (modelo padrao A4 ou personalizado-01, conforme a
 * configuracao da empresa). Separada de OsPrint.tsx pra ser a MESMA folha no
 * desktop e no app do vendedor externo (VendedorOsImprimir.tsx).
 */
const OsPrintDocument: React.FC<OsPrintDocumentProps> = ({ osData, clientData, vehicleData, configData }) => {
  const dataCriacao = osData.createdAt?.toDate ? osData.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const companyAddressRows = getCompanyAddressRows(configData, 'Av. das Indústrias, 1000 - São Paulo, SP');
  const servicos = osData.servicos || [];
  const pecas = osData.pecas || [];
  const todosItens = [
    ...servicos.map((s: any) => ({ ...s, tipo: 'Serviço', totalCalculado: getServiceTotal(s) })),
    ...pecas.map((p: any) => ({ ...p, tipo: 'Peça', totalCalculado: Number(p.preco || 0) * Number(p.quantidade || 1) }))
  ];
  const subtotalItens = todosItens.reduce((total: number, item: any) => total + item.totalCalculado, 0);
  const descontoOS = resolverDescontoImpressaoOS(osData.desconto);
  const valorTotal = totalComDescontoOS(subtotalItens, descontoOS);

  return (
    <>
      {(configData?.modeloImpressaoOS || DEFAULT_OS_PRINT_MODEL) === 'personalizado-01' ? (
        <OsPrintPersonalizado01
          osData={osData}
          clientData={clientData}
          vehicleData={vehicleData}
          configData={configData}
        />
      ) : (
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
            <p>{configData?.telefone || '(11) 3333-4444'} | {configData?.email || 'contato@nexarerp.com.br'}</p>
          </div>
          <div className="a4-os-info">
            <h1>ORDEM DE SERVIÇO</h1>
            <h2 className="os-number">Nº {osData.numeroOS || osData.id.substring(0, 6).toUpperCase()}</h2>
            <p><strong>Data:</strong> {dataCriacao}</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Dados do Cliente</h3>
          <div className="a4-grid">
            <p><strong>Nome:</strong> {osData.clienteNome}</p>
            <p><strong>CPF/CNPJ:</strong> {clientData?.documento || '---'}</p>
            <p><strong>Telefone:</strong> {osData.clienteTelefone}</p>
            <p><strong>E-mail:</strong> {clientData?.email || '---'}</p>
          </div>
          <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
            <p><strong>Endereço:</strong> {clientData?.endereco || '---'}{clientData?.numero ? `, ${clientData.numero}` : ''}</p>
            <p><strong>Bairro:</strong> {clientData?.bairro || '---'}</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Dados do Veículo</h3>
          <div className="a4-grid">
            <p><strong>Veículo:</strong> {osData.modelo || 'Não informado'}</p>
            <p><strong>Placa:</strong> {osData.placa?.toUpperCase()}</p>
            <p><strong>Ano:</strong> {osData.ano || 'Não informado'}</p>
            <p><strong>Cor:</strong> {osData.cor || 'Não informado'}</p>
          </div>
        </div>

        <div className="a4-section" style={{ display: 'flex', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <h3 className="section-title">Problema Relatado (Cliente)</h3>
            <p className="a4-text-block texto-como-digitado">{osData.defeitoRelatado || 'Nenhum defeito relatado.'}</p>
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="section-title">Relatório Técnico (Mecânico)</h3>
            <p className="a4-text-block texto-como-digitado">{osData.relatorioTecnico || 'Nenhum relatório técnico emitido.'}</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Serviços e Peças Executados</h3>
          <table className="a4-table">
            <thead>
              <tr>
                <th>Descrição do Item</th>
                <th style={{ textAlign: 'center' }}>Qtd. / Tempo</th>
                <th style={{ textAlign: 'right' }}>Valor Unit. / Hora</th>
                <th style={{ textAlign: 'right' }}>Total (R$)</th>
              </tr>
            </thead>
            <tbody>
              {todosItens.length > 0 ? (
                todosItens.map((item: any, i: number) => (
                  <tr key={i}>
                    <td>
                      {item.nome}
                      <span style={{ fontSize: '10px', color: '#666', marginLeft: '6px' }}>({item.tipo})</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {item.tipo === 'Serviço' ? `${getServiceHours(item).toFixed(2)} h` : item.quantidade}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.preco)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.totalCalculado)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '10px' }}>Nenhum serviço ou peça adicionado.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              {/* Subtotal e desconto so aparecem quando houve desconto -- OS
                  sem desconto imprime exatamente como imprimia antes. */}
              {descontoOS.temDesconto && (
                <>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right' }}>Subtotal:</td>
                    <td style={{ textAlign: 'right' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(subtotalItens)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right' }}>{descontoOS.rotulo}:</td>
                    <td style={{ textAlign: 'right' }}>
                      -{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(descontoOS.valor)}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL GERAL:</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '18px' }}>
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
            <p>Assinatura do Responsável (Empresa)</p>
          </div>
        </div>

        <div className="a4-footer">
          <p>{configData?.garantiaPadrao || 'Garantia de 90 dias para peças e serviços executados de acordo com o Código de Defesa do Consumidor.'}</p>
          <p>Gerado pelo Sistema Hennder ERP.</p>
        </div>
      </div>
      )}
    </>
  );
};

export default OsPrintDocument;

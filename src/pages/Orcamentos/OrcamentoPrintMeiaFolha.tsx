import React, { useEffect } from 'react';
import { mensagemDoDocumento } from '../../utils/mensagensPadraoDomain';
import { dadosDaFolhaDoOrcamento, numeroBr } from './orcamentoFolhaComum';
import '../Vendas/PedidoPrintMeiaFolha.css';
import './OrcamentoPrintModelos.css';

interface Props {
  data: any;
  clientData: any;
  configData: any;
}

/**
 * Orcamento em MEIA FOLHA (23/11/2026): o visual do pedido em meia folha
 * (PedidoPrintMeiaFolha) com cara de orcamento -- titulo ORCAMENTO, validade
 * em destaque, servicos e pecas na mesma tabela, condicoes comerciais e o
 * "de acordo" do cliente no lugar de assinatura/despacho.
 */
const OrcamentoPrintMeiaFolha: React.FC<Props> = ({ data, clientData, configData }) => {
  const f = dadosDaFolhaDoOrcamento(data, clientData, configData);
  const mensagem = mensagemDoDocumento(configData, 'orcamento');

  // Margem pequena, como o pedido em meia folha. So' a margem, nunca o papel.
  useEffect(() => {
    const estilo = document.createElement('style');
    estilo.setAttribute('data-orcamento-meia-folha', 'true');
    estilo.textContent = '@media print { @page { margin: 4mm; } }';
    document.head.appendChild(estilo);
    return () => { estilo.remove(); };
  }, []);

  return (
    <div className="mf-page orc-mf">
      <p className="mf-disclaimer">
        Orçamento — não é documento fiscal nem pedido. Preços e condições válidos por {f.validadeDias} dias{f.validadeAte ? `, até ${f.validadeAte}` : ''}.
      </p>

      <div className="mf-company-header">
        {f.empresa.logo && <img src={f.empresa.logo} alt="Logo" className="mf-logo" />}
        {f.empresa.nome && <h1 className="mf-company-name">{f.empresa.nome}</h1>}
        {(f.empresa.cnpj || f.empresa.telefone) && (
          <p className="mf-company-line">
            {f.empresa.cnpj && <span>CNPJ: {f.empresa.cnpj}</span>}
            {f.empresa.telefone && <span>Tel: {f.empresa.telefone}</span>}
            {f.empresa.email && <span>{f.empresa.email}</span>}
          </p>
        )}
        {f.empresa.endereco && <p className="mf-company-address">{f.empresa.endereco}</p>}
      </div>

      <div className="mf-meta-row">
        <div className="mf-order-box orc-mf-titulo">
          <span className="mf-order-label">ORÇAMENTO</span>
          <span className="mf-order-number">{f.numero}</span>
        </div>
        <div className="mf-meta-info">
          <p><strong>Emissão:</strong> {f.emissao ? f.emissao.toLocaleDateString('pt-BR') : '---'}</p>
          <p><strong>Válido até:</strong> {f.validadeAte || `${f.validadeDias} dias`}</p>
          {f.vendedor && <p><strong>Vendedor:</strong> {f.vendedor}</p>}
        </div>
      </div>

      <div className="mf-cliente-row">
        <span><strong>Cliente:</strong> {[f.cliente.codigo, f.cliente.nome].filter(Boolean).join(' ')}</span>
        <span><strong>Telefone:</strong> {f.cliente.telefone}</span>
        {f.cliente.documento && <span><strong>CPF/CNPJ:</strong> {f.cliente.documento}</span>}
        {f.cliente.cidade && <span><strong>Cidade:</strong> {f.cliente.cidade}</span>}
      </div>
      {(f.cliente.endereco || f.veiculo) && (
        <div className="mf-cliente-row mf-cliente-row--secundaria">
          {f.cliente.endereco && <span><strong>Endereço:</strong> {[f.cliente.endereco, f.cliente.bairro].filter(Boolean).join(' - ')}</span>}
          {f.veiculo && <span><strong>Veículo/Equip.:</strong> {f.veiculo}</span>}
        </div>
      )}

      <table className="mf-items-table">
        <thead>
          <tr>
            <th style={{ width: '9%' }}>Cód.</th>
            <th>Descrição</th>
            <th style={{ width: '6%' }}>Un.</th>
            <th style={{ width: '9%', textAlign: 'right' }}>Qtd.</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Unit.</th>
            <th style={{ width: '13%', textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {f.itens.length > 0 ? f.itens.map((item, i) => (
            <tr key={i}>
              <td>{item.codigo || (item.servico ? 'SERV.' : '-')}</td>
              <td>{item.descricao}</td>
              <td>{item.unidade}</td>
              <td style={{ textAlign: 'right' }}>{item.quantidade}</td>
              <td style={{ textAlign: 'right' }}>{numeroBr(item.unitario)}</td>
              <td style={{ textAlign: 'right' }}>{numeroBr(item.total)}</td>
            </tr>
          )) : (
            <tr><td colSpan={6} style={{ textAlign: 'center' }}>Nenhum item no orçamento.</td></tr>
          )}
        </tbody>
      </table>

      <div className="mf-payment-row">
        <div className="mf-payment-left">
          <p><strong>CONDIÇÃO DE PAGAMENTO:</strong> {f.condicao || 'A combinar'}</p>
          {f.prazo && <p><strong>PRAZO DE ENTREGA:</strong> {f.prazo}</p>}
          {f.observacoes && <p className="texto-como-digitado"><strong>OBSERVAÇÕES:</strong> {f.observacoes}</p>}
        </div>
        <div className="mf-totals-right">
          {f.temServicos && <p>Mão de obra: <span>{numeroBr(f.totais.servicos)}</span></p>}
          <p>{f.temServicos ? 'Peças e produtos' : 'Valor produtos'}: <span>{numeroBr(f.totais.produtos)}</span></p>
          {f.totais.desconto > 0 && <p>Desconto: <span>- {numeroBr(f.totais.desconto)}</span></p>}
          {f.totais.frete > 0 && <p>Frete: <span>{numeroBr(f.totais.frete)}</span></p>}
          <p className="mf-total-final">Total do orçamento: <span>{numeroBr(f.totais.total)}</span></p>
        </div>
      </div>

      <div className="mf-rodape">
        <div className="mf-rodape-texto">
          {mensagem && <p className="mf-situacao" style={{ whiteSpace: 'pre-line' }}>{mensagem}</p>}
          <div className="mf-signatures">
            <p>De acordo (cliente): <span className="mf-sig-line" /></p>
            <p>Data: <span className="mf-sig-line orc-mf-data" /></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrcamentoPrintMeiaFolha;

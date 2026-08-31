import React, { useEffect } from 'react';
import { formatCompanyAddress } from '../../utils/companyAddress';
import { formatarDocumento } from '../../utils/documentoValidacao';
import { STATUS_PRE_VENDA, STATUS_EM_ANALISE, STATUS_FINALIZADA, STATUS_CANCELADA } from '../../utils/preVendaDomain';
import './PedidoPrintMeiaFolha.css';

interface Parcela {
  numero: number;
  dataVencimento: string;
  valor: number;
}

interface PedidoPrintMeiaFolhaProps {
  pedidoData: any;
  clientData: any;
  configData: any;
  parcelas: Parcela[];
}

const formatNumber = (value: number, decimals = 2) =>
  Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const formatDateTime = (value: any) => {
  if (value?.toDate) {
    return value.toDate().toLocaleString('pt-BR');
  }
  if (value instanceof Date) {
    return value.toLocaleString('pt-BR');
  }
  return '---';
};

const formatDate = (value: string) => {
  if (!value) return '---';
  // dataVencimento e' gravada como 'YYYY-MM-DD' -- formata sem passar por
  // Date (evita o problema de fuso horario deslocando o dia).
  const partes = value.split('-');
  if (partes.length === 3) {
    const [ano, mes, dia] = partes;
    return `${dia}/${mes}/${ano}`;
  }
  return value;
};

const SITUACAO_LABELS: Record<string, string> = {
  [STATUS_FINALIZADA]: 'Concluída',
  [STATUS_CANCELADA]: 'Cancelada',
  [STATUS_PRE_VENDA]: 'Em Aberto',
  [STATUS_EM_ANALISE]: 'Em Aberto',
};

const PedidoPrintMeiaFolha: React.FC<PedidoPrintMeiaFolhaProps> = ({ pedidoData, clientData, configData, parcelas }) => {
  const itens = pedidoData.itens || [];
  const valorProdutos = pedidoData.valorTotalItens || 0;
  const frete = pedidoData.frete || 0;
  // Desconto geral e' so um snapshot pro relatorio de descontos (ver
  // comentario em PedidoVendaForm.tsx) -- nao chega a ser abatido do
  // valorTotal gravado, entao somar aqui quebraria a conta impressa
  // (Produtos - Desconto + Frete != Total). Mesma fonte que PedidoPrintDocument usa.
  const valorDesconto = pedidoData.valorTotalDescontos || 0;
  const valorTotal = pedidoData.valorTotal || 0;
  const situacao = SITUACAO_LABELS[pedidoData.status] || pedidoData.status || '---';
  // @page precisa dizer o TAMANHO DO PAPEL, senao o navegador assume A4 e
  // sobra margem torta na meia folha. Fica aqui, injetado enquanto este
  // modelo esta montado, e nao no .css: o arquivo de estilo e' carregado
  // junto com o modelo A4 (os dois vivem em PedidoPrint.tsx), e uma regra
  // @page fixa quebraria a impressao de pagina inteira.
  useEffect(() => {
    const estilo = document.createElement('style');
    estilo.setAttribute('data-meia-folha', 'true');
    estilo.textContent = '@media print { @page { size: 210mm 148mm; margin: 4mm; } }';
    document.head.appendChild(estilo);
    return () => { estilo.remove(); };
  }, []);

  const endereco = formatCompanyAddress(configData);

  // Endereco do cliente montado das partes que existirem: cadastro sem
  // numero ou sem bairro nao pode imprimir "RUA X, - " com sobra de
  // pontuacao. Sem nenhuma parte, a linha inteira nao aparece.
  const enderecoCliente = [
    [clientData?.endereco, clientData?.numero].filter(Boolean).join(', '),
    clientData?.bairro,
  ].filter(Boolean).join(' - ');

  return (
    <div className="mf-page">
      <p className="mf-disclaimer">
        Não é documento fiscal - não é válido como recibo e garantia de mercadoria - não comprova pagamento.
      </p>

      <div className="mf-company-header">
        {configData?.logo && <img src={configData.logo} alt="Logo" className="mf-logo" />}
        <h1 className="mf-company-name">{configData?.nomeOficina || 'NEXAR ERP'}</h1>
        <p className="mf-company-line">
          <span>Cnpj: {configData?.cnpj || '00.000.000/0001-00'}</span>
          <span>Tel: {configData?.telefone || ''}</span>
        </p>
        {endereco && <p className="mf-company-address">{endereco}</p>}
      </div>

      <div className="mf-meta-row">
        <div className="mf-order-box">
          <span className="mf-order-label">PEDIDO DE VENDA</span>
          <span className="mf-order-number">{pedidoData.numeroPedido || pedidoData.id?.substring(0, 6).toUpperCase()}</span>
        </div>
        <div className="mf-meta-info">
          <p><strong>Data:</strong> {formatDateTime(pedidoData.createdAt)}</p>
          <p><strong>Vendedor:</strong> {pedidoData.vendedorNome || '---'}</p>
          <p><strong>Telefone:</strong> {clientData?.telefone || ''}</p>
        </div>
      </div>

      {/* Dados do cliente. So entra o campo que EXISTE no cadastro -- rotulo
          com valor vazio ("E-mail:" sem e-mail) so ocupa espaco num papel
          pequeno e faz o balcao achar que o sistema perdeu o dado. */}
      <div className="mf-cliente-row">
        <span><strong>Cliente:</strong> {pedidoData.clienteNome || 'Consumidor Final'}</span>
        {clientData?.codigo && <span><strong>Código:</strong> {clientData.codigo}</span>}
        {clientData?.documento && <span><strong>CPF/CNPJ:</strong> {formatarDocumento(clientData.documento)}</span>}
        <span><strong>Cidade:</strong> {clientData?.cidade || ''}</span>
      </div>

      {(enderecoCliente || clientData?.email) && (
        <div className="mf-cliente-row mf-cliente-row--secundaria">
          {enderecoCliente && <span><strong>Endereço:</strong> {enderecoCliente}</span>}
          {clientData?.email && <span><strong>E-mail:</strong> {clientData.email}</span>}
        </div>
      )}

      <table className="mf-items-table">
        <thead>
          <tr>
            <th style={{ width: '8%' }}>Cod.</th>
            <th>Descrição do Item</th>
            <th style={{ width: '10%', textAlign: 'right' }}>Qtd.</th>
            <th style={{ width: '10%', textAlign: 'right' }}>Unit.</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Tot. Prod.</th>
            <th style={{ width: '10%', textAlign: 'right' }}>Desc.</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Valor Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.length > 0 ? (
            itens.map((item: any, i: number) => (
              <tr key={i}>
                <td>{item.codigo || '-'}</td>
                <td>{item.nome}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(item.quantidade, item.unidadeMedidaCasasDecimais ?? 0)}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(item.precoUnitario)}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(item.quantidade * item.precoUnitario)}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(item.desconto)}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(item.subtotal)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center' }}>Nenhum item adicionado.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mf-payment-row">
        <div className="mf-payment-left">
          <p><strong>CONDIÇÃO DE PAGAMENTO:</strong> {pedidoData.formaPagamento || '---'}</p>

          {parcelas.length > 0 && (
            <table className="mf-parcelas-table">
              <thead>
                <tr>
                  <th>PARC</th>
                  <th>VENCIMENTO</th>
                  <th style={{ textAlign: 'right' }}>VALOR</th>
                </tr>
              </thead>
              <tbody>
                {parcelas.map((parcela) => (
                  <tr key={parcela.numero}>
                    <td>{parcela.numero}</td>
                    <td>{formatDate(parcela.dataVencimento)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(parcela.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mf-totals-right">
          <p>Valor Produtos: <span>{formatNumber(valorProdutos)}</span></p>
          <p>Frete: <span>{formatNumber(frete)}</span></p>
          <p>Valor Desconto: <span>{formatNumber(valorDesconto)}</span></p>
          <p className="mf-total-final">Valor Total: <span>{formatNumber(valorTotal)}</span></p>
        </div>
      </div>

      <p className="mf-situacao"><strong>Situação Atual:</strong> {situacao}</p>

      {configData?.observacoesPadraoPedido && (
        <div className="mf-observacoes">
          <strong>Observações:</strong>
          <p>{configData.observacoesPadraoPedido}</p>
        </div>
      )}

      <div className="mf-signatures">
        <p>Assinatura: <span className="mf-sig-line" /></p>
        <p>Despacho: <span className="mf-sig-line" /></p>
      </div>

      <p className="mf-footer-brand">Desenvolvido por Hennder ERP</p>
    </div>
  );
};

export default PedidoPrintMeiaFolha;

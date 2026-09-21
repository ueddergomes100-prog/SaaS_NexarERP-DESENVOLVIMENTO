import React from 'react';
import PedidoPrintDocument from './PedidoPrintDocument';
import PedidoPrintMeiaFolha from './PedidoPrintMeiaFolha';
import PedidoPrintPreVenda from './PedidoPrintPreVenda';
import { DEFAULT_PEDIDO_PRINT_MODEL } from '../../utils/pedidoPrintModels';

interface PedidoPrintModeloProps {
  pedidoData: any;
  clientData: any;
  configData: any;
  parcelas: Array<{ numero: number; dataVencimento: string; valor: number }>;
}

/**
 * Escolhe o modelo de impressao do pedido conforme Configuracoes. Um lugar so':
 * impressao unitaria, em lote e do app do vendedor passam por aqui, pra um
 * modelo novo nao ficar faltando em uma delas.
 */
const PedidoPrintModelo: React.FC<PedidoPrintModeloProps> = ({ pedidoData, clientData, configData, parcelas }) => {
  const modelo = configData?.modeloImpressaoPedidoVenda || DEFAULT_PEDIDO_PRINT_MODEL;

  if (modelo === 'meia-folha') {
    return <PedidoPrintMeiaFolha pedidoData={pedidoData} clientData={clientData} configData={configData} parcelas={parcelas} />;
  }
  if (modelo === 'pre-venda') {
    return <PedidoPrintPreVenda pedidoData={pedidoData} clientData={clientData} configData={configData} />;
  }
  return <PedidoPrintDocument pedidoData={pedidoData} clientData={clientData} configData={configData} />;
};

export default PedidoPrintModelo;

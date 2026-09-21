import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';

/**
 * Estado passado via `navigate(..., { state })` de Consultar Cliente/Preço
 * pro Novo Pedido -- o "+" nessas telas e' um atalho pra iniciar um pedido
 * ja com o cliente/produto encontrado, sem ter que buscar de novo.
 */
/** Estado de navegacao pro cadastro de cliente: pra onde voltar depois de
 *  salvar (com o cliente novo ja' escolhido). */
export interface VendedorNovoClienteNavState {
  retornarPara?: 'pedido' | 'orcamento';
}

export interface VendedorNovoPedidoNavState {
  clientePreSelecionado?: { id: string; nome: string };
  itemPreAdicionado?: ItemVendaExterna;
}

import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';

/**
 * Estado passado via `navigate(..., { state })` de Consultar Cliente/Preço
 * pro Novo Pedido -- o "+" nessas telas e' um atalho pra iniciar um pedido
 * ja com o cliente/produto encontrado, sem ter que buscar de novo.
 */
export interface VendedorNovoPedidoNavState {
  clientePreSelecionado?: { id: string; nome: string };
  itemPreAdicionado?: ItemVendaExterna;
}

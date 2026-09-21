import React, { useState } from 'react';
import { usePedidoPrintExtras } from '../../hooks/usePedidoPrintExtras';
import { ehPreVenda } from '../../utils/preVendaDomain';
import {
  codigoENomeMinuta,
  condicaoPagamentoMinuta,
  formatarCepMinuta,
  formatarDataCurtaMinuta,
  formatarDocumentoMinuta,
  formatarGeradoEmMinuta,
  formatarHoraMinuta,
  formatarTelefoneMinuta,
  formatarTotalPecasMinuta,
  vendedorMinuta,
} from '../../utils/minutaDomain';
import './PedidoPrintPreVenda.css';

interface PedidoPrintPreVendaProps {
  pedidoData: any;
  clientData: any;
  configData: any;
}

const numero = (valor: number, casas = 2) =>
  Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Total que so' aparece quando existe: o papel antigo deixa em branco o que
 * e' zero (desconto, frete, encargos), em vez de imprimir "0,00" em tudo. */
const totalOuVazio = (valor: number) => (Number(valor || 0) !== 0 ? numero(valor) : '');

/**
 * Modelo de impressao "Pre-venda" (pedido da Sol Natus, 2026-09-21): a folha
 * do sistema antigo, em A4 -- quadro da empresa com o aviso de que nao e'
 * documento fiscal, quadro do pedido/cliente, tabela de itens, totais e
 * rodape com estacao, usuario e hora.
 *
 * Diferencas de proposito em relacao a folha antiga:
 *  - sem a coluna "Referencia";
 *  - quantidade sem casas de sobra: segue a unidade do item, igual ao modelo
 *    meia folha ("3", nao "3,0000"; fracionado mostra as casas da unidade);
 *  - valor unitario com 2 casas (o antigo trazia 6).
 *
 * Serve pra pre-venda e pra pedido de venda: so' o titulo muda. Nao declara
 * `@page { size }` (regra do projeto).
 */
const PedidoPrintPreVenda: React.FC<PedidoPrintPreVendaProps> = ({ pedidoData, clientData, configData }) => {
  const extras = usePedidoPrintExtras(pedidoData);
  // Fixo enquanto a folha esta montada: o "Gerado em" nao pode andar a cada render.
  const [geradoEm] = useState(() => new Date());

  const itens: any[] = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];
  const criadoEm: Date | null = pedidoData.createdAt?.toDate ? pedidoData.createdAt.toDate() : null;
  const preVenda = ehPreVenda(pedidoData.status);
  const rotulo = preVenda ? 'PRE-VENDA' : 'PEDIDO';
  const numeroPedido = pedidoData.numeroPedido || pedidoData.id?.substring(0, 6).toUpperCase() || '';
  const nomeEmpresa = String(configData?.nomeOficina || '').trim();
  const telefoneEmpresa = formatarTelefoneMinuta(configData?.telefone);
  const condicao = condicaoPagamentoMinuta(pedidoData.pagamentos) || String(pedidoData.formaPagamento || '');
  const foneCliente = [formatarTelefoneMinuta(clientData?.telefone), formatarTelefoneMinuta(clientData?.celular)]
    .filter(Boolean).join(' / ');
  const enderecoCliente = [clientData?.endereco, clientData?.numero].filter(Boolean).join(', ');

  return (
    <div className="pv-page">
      <div className="pv-caixa">
        <div className="pv-linha pv-linha--topo">
          <span><span className="pv-rotulo">Empresa:</span> <strong>{nomeEmpresa}</strong></span>
          <span>'{rotulo} {numeroPedido}' &nbsp;<span className="pv-rotulo">Fone:</span> {telefoneEmpresa}</span>
          <span><span className="pv-rotulo">Página:</span> 1 / 1</span>
        </div>
        <div className="pv-aviso">
          NAO E DOCUMENTO FISCAL - NAO VALE COMO RECIBO NEM GARANTIA DE MERCADORIA - NAO COMPROVA PAGTO
        </div>
      </div>

      <div className="pv-caixa pv-dados">
        <div className="pv-linha">
          <span><span className="pv-rotulo">Pedido:</span> {numeroPedido}</span>
          <span><span className="pv-rotulo">Dt Emissão:</span> {formatarDataCurtaMinuta(criadoEm)}</span>
          <span><span className="pv-rotulo">Hora:</span> {formatarHoraMinuta(criadoEm)}</span>
          <span><span className="pv-rotulo">Operação:</span> VENDAS</span>
          <span><span className="pv-rotulo">Contrato:</span></span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Cliente:</span> {codigoENomeMinuta(clientData?.codigo, pedidoData.clienteNome || 'Consumidor Final')}</span>
          <span><span className="pv-rotulo">Fone:</span> {foneCliente}</span>
          <span><span className="pv-rotulo">CNPJ/CPF:</span> {formatarDocumentoMinuta(clientData?.documento)}</span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Endereço:</span> {enderecoCliente}</span>
          <span><span className="pv-rotulo">Bairro:</span> {clientData?.bairro || ''}</span>
          <span><span className="pv-rotulo">I.E./C.I.:</span> {clientData?.identidade || ''}</span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Cidade:</span> {clientData?.cidade || ''}</span>
          <span><span className="pv-rotulo">UF:</span> {clientData?.estado || ''} &nbsp;<span className="pv-rotulo">Cep:</span> {formatarCepMinuta(clientData?.cep)}</span>
          <span><span className="pv-rotulo">Ordem Serviço:</span></span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Referência:</span> {clientData?.referencia || ''}</span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Vendedor:</span> {vendedorMinuta(extras.vendedorCodigo, pedidoData.vendedorNome)}</span>
          <span><span className="pv-rotulo">Cond.Pagto:</span> {condicao}</span>
          <span>{formatarTotalPecasMinuta(itens)} Pcs</span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Observação:</span> {String(pedidoData.observacao || '')}</span>
        </div>
      </div>

      <table className="pv-tabela">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col />
          <col style={{ width: '14%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Matric.</th>
            <th>Descrição</th>
            <th>Marca</th>
            <th>Und.</th>
            <th className="pv-num">Quantid.</th>
            <th className="pv-num">Vr Unit.</th>
            <th className="pv-num">Vr Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.length > 0 ? (
            itens.map((item, i) => {
              const extra = extras.itens[String(item.id)] || { codigo: '', marca: '' };
              return (
                <tr key={`${item.id}-${i}`}>
                  <td>{item.codigo || extra.codigo}</td>
                  <td>{item.nome}</td>
                  <td>{item.marca || extra.marca}</td>
                  <td>{item.unidadeMedidaSigla || 'UN'}</td>
                  <td className="pv-num">{numero(item.quantidade, item.unidadeMedidaCasasDecimais ?? 0)}</td>
                  <td className="pv-num">{numero(item.precoUnitario)}</td>
                  <td className="pv-num">{numero(Number(item.quantidade || 0) * Number(item.precoUnitario || 0))}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', padding: '8px' }}>Nenhum item adicionado.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pv-totais">
        <span><span className="pv-rotulo">Vr Produto:</span> <strong>{numero(pedidoData.valorTotalItens)}</strong></span>
        <span><span className="pv-rotulo">Vr Desconto:</span> {totalOuVazio(pedidoData.valorTotalDescontos)}</span>
        <span><span className="pv-rotulo">Vr Frete:</span> {totalOuVazio(pedidoData.frete)}</span>
        <span><span className="pv-rotulo">Vr Encargos:</span> {totalOuVazio(pedidoData.encargos)}</span>
        <span><span className="pv-rotulo">Vr Outros:</span></span>
        <span><span className="pv-rotulo">Vr Liquido:</span> <strong>{numero(pedidoData.valorTotal)}</strong></span>
      </div>

      <div className="pv-rodape">
        <span>{preVenda ? 'Pré-Venda' : 'Pedido'}: {numeroPedido}/UN</span>
        <span>Estação: {nomeEmpresa.replace(/\s+/g, '').toUpperCase().slice(0, 20)} - Usuário: {extras.usuarioNome.toUpperCase()}</span>
        <span>Gerado em {formatarGeradoEmMinuta(geradoEm)}</span>
      </div>
    </div>
  );
};

export default PedidoPrintPreVenda;

import React, { useEffect, useState } from 'react';
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
import { formatCompanyAddress } from '../../utils/companyAddress';
import { pagamentoImpresso, rotuloDaForma, textoDosVencimentos, valorLiquidoDoPapel, type PagamentoImpresso } from '../../utils/pagamentoImpressoDomain';
import './PedidoPrintPreVenda.css';

interface PedidoPrintPreVendaProps {
  pedidoData: any;
  clientData: any;
  configData: any;
  /**
   * Modelo "Pre-venda simplificada" (Jomarly, 17/11/2026): sem Marca, Contrato
   * e total de pecas; nome do cliente em destaque; "Cod." no lugar de "Matric.";
   * logo dentro do quadro da empresa, com fone e CNPJ na mesma linha do nome
   * (sem "'PEDIDO 0001'" e "Pagina"); "Dt Pedido" em negrito; sem o cabecalho
   * do navegador; sem o rodape (estacao/usuario/gerado em); totais presos no
   * pe da folha (meia folha deitada), com OBS. e assinatura centralizada.
   */
  simplificado?: boolean;
}

const numero = (valor: number, casas = 2) =>
  Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Total que so' aparece quando existe: o papel antigo deixa em branco o que
 * e' zero (desconto, frete, encargos), em vez de imprimir "0,00" em tudo. */
const totalOuVazio = (valor: number) => (Number(valor || 0) !== 0 ? numero(valor) : '');

/**
 * Valor de cada forma e, separado, o que ficou a prazo (23/11/2026, Jomarly
 * 0339): so' o "Vr Liquido" fazia parecer que o cliente pagou tudo.
 */
const LinhasDePagamento: React.FC<{ pagamento: PagamentoImpresso }> = ({ pagamento }) => {
  if (pagamento.formas.length === 0) return null;
  return (
    <div className="pv-pagamentos">
      <div>
        <span className="pv-rotulo">Pagamento:</span>{' '}
        {pagamento.formas.map((forma, i) => {
          const vencimentos = forma.aPrazo ? textoDosVencimentos(forma) : '';
          return (
            <span key={forma.forma}>
              {i > 0 && ' · '}
              {rotuloDaForma(forma)} <strong>{numero(forma.valorCentavos / 100)}</strong>{vencimentos && ` (${vencimentos})`}
            </span>
          );
        })}
      </div>
    </div>
  );
};

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
const PedidoPrintPreVenda: React.FC<PedidoPrintPreVendaProps> = ({ pedidoData, clientData, configData, simplificado = false }) => {
  const extras = usePedidoPrintExtras(pedidoData);
  // Fixo enquanto a folha esta montada: o "Gerado em" nao pode andar a cada render.
  const [geradoEm] = useState(() => new Date());

  // Jomarly: sem a data/hora e o titulo que o navegador imprime no alto e no pe
  // da folha -- margem pequena, como a meia folha (PedidoPrintMeiaFolha.tsx).
  // So' a margem, nunca o tamanho do papel (regra do projeto).
  useEffect(() => {
    if (!simplificado) return undefined;
    const estilo = document.createElement('style');
    estilo.setAttribute('data-pre-venda-simples', 'true');
    estilo.textContent = '@media print { @page { margin: 4mm; } }';
    document.head.appendChild(estilo);
    return () => { estilo.remove(); };
  }, [simplificado]);

  const itens: any[] = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];
  const criadoEm: Date | null = pedidoData.createdAt?.toDate ? pedidoData.createdAt.toDate() : null;
  const preVenda = ehPreVenda(pedidoData.status);
  const dataHoraPedido = criadoEm ? formatarGeradoEmMinuta(criadoEm).replace(' as ', ' ') : '';
  const rotulo = preVenda ? 'PRE-VENDA' : 'PEDIDO';
  const numeroPedido = pedidoData.numeroPedido || pedidoData.id?.substring(0, 6).toUpperCase() || '';
  const nomeEmpresa = String(configData?.nomeOficina || '').trim();
  const telefoneEmpresa = formatarTelefoneMinuta(configData?.telefone);
  const cnpjEmpresa = formatarDocumentoMinuta(configData?.cnpj);
  // "RUA X, Nº 32 - BAIRRO, CIDADE - UF, CEP" (mesma montagem do DAV de exemplo).
  const cidadeEmpresa = [configData?.nfseCidadeNome || configData?.cidade, configData?.nfseCidadeEstado || configData?.estado]
    .map((v) => String(v || '').trim()).filter(Boolean).join(' - ');
  const enderecoEmpresa = [formatCompanyAddress(configData), cidadeEmpresa, formatarCepMinuta(configData?.cep)]
    .filter(Boolean).join(', ');
  const condicao = condicaoPagamentoMinuta(pedidoData.pagamentos) || String(pedidoData.formaPagamento || '');
  const pagamento = pagamentoImpresso(pedidoData.pagamentos);
  // Vr Liquido = o que entrou; o a prazo sai em "Vr a Prazo" (23/11/2026).
  const liquido = valorLiquidoDoPapel(pedidoData.valorTotal, pagamento);
  const foneCliente = [formatarTelefoneMinuta(clientData?.telefone), formatarTelefoneMinuta(clientData?.celular)]
    .filter(Boolean).join(' / ');
  const enderecoCliente = [clientData?.endereco, clientData?.numero].filter(Boolean).join(', ');

  return (
    <div className={simplificado ? 'pv-page pv-page--simples' : 'pv-page'}>
      {simplificado ? (
        // Jomarly (17/11/2026): cabecalho no formato do DAV da Eletrica Terra
        // (exemplo do dono): aviso centralizado no alto; no quadro, logo +
        // empresa/contato/endereco a esquerda e pedido/pagina/vendedor/data a direita.
        <>
          <div className="pv-aviso-topo">
            NÃO É DOCUMENTO FISCAL. NÃO É VÁLIDO COMO RECIBO E COMO GARANTIA DE MERCADORIA.
          </div>
          <div className="pv-caixa pv-caixa--empresa">
            {configData?.logo && <img className="pv-logo-caixa" src={configData.logo} alt="Logo" />}
            <div className="pv-empresa-dados">
              <div><strong>EMPRESA:</strong> {nomeEmpresa}</div>
              <div>
                <strong>CONTATO:</strong> {telefoneEmpresa}
                {cnpjEmpresa && <> &nbsp;&nbsp;<strong>CNPJ:</strong> {cnpjEmpresa}</>}
              </div>
              {enderecoEmpresa && <div className="pv-empresa-endereco"><strong>ENDEREÇO:</strong> {enderecoEmpresa}</div>}
            </div>
            <div className="pv-empresa-direita">
              <div className="pv-empresa-numero"><strong>{rotulo} - {numeroPedido}</strong> &nbsp;&nbsp; <strong>PÁGINA - 1/1</strong></div>
              <div><strong>VENDEDOR:</strong> {vendedorMinuta(extras.vendedorCodigo, pedidoData.vendedorNome)}</div>
              <div><strong>DATA:</strong> {dataHoraPedido}</div>
            </div>
          </div>
        </>
      ) : (
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
      )}

      <div className="pv-caixa pv-dados">
        <div className="pv-linha">
          <span><span className="pv-rotulo">Pedido:</span> {numeroPedido}</span>
          {simplificado
            ? <span><strong>Dt Pedido: {formatarDataCurtaMinuta(criadoEm)}</strong></span>
            : <span><span className="pv-rotulo">Dt Emissão:</span> {formatarDataCurtaMinuta(criadoEm)}</span>}
          <span><span className="pv-rotulo">Hora:</span> {formatarHoraMinuta(criadoEm)}</span>
          <span><span className="pv-rotulo">Operação:</span> VENDAS</span>
          {!simplificado && <span><span className="pv-rotulo">Contrato:</span></span>}
        </div>
        <div className="pv-linha">
          <span className={simplificado ? 'pv-cliente-destaque' : undefined}><span className="pv-rotulo">Cliente:</span> {codigoENomeMinuta(clientData?.codigo, pedidoData.clienteNome || 'Consumidor Final')}</span>
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
          {!simplificado && <span>{formatarTotalPecasMinuta(itens)} Pcs</span>}
        </div>
        {!simplificado && (
          <div className="pv-linha">
            <span><span className="pv-rotulo">Observação:</span> {String(pedidoData.observacao || '')}</span>
          </div>
        )}
      </div>

      <table className="pv-tabela">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col />
          {!simplificado && <col style={{ width: '14%' }} />}
          <col style={{ width: '6%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>{simplificado ? 'Cód.' : 'Matric.'}</th>
            <th>Descrição</th>
            {!simplificado && <th>Marca</th>}
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
                  {!simplificado && <td>{item.marca || extra.marca}</td>}
                  <td>{item.unidadeMedidaSigla || 'UN'}</td>
                  <td className="pv-num">{numero(item.quantidade, item.unidadeMedidaCasasDecimais ?? 0)}</td>
                  <td className="pv-num">{numero(item.precoUnitario)}</td>
                  <td className="pv-num">{numero(Number(item.quantidade || 0) * Number(item.precoUnitario || 0))}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={simplificado ? 6 : 7} style={{ textAlign: 'center', padding: '8px' }}>Nenhum item adicionado.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Jomarly: totais, OBS. e assinatura presos no pe da folha (margin-top auto). */}
      <div className={simplificado ? 'pv-fim' : undefined}>

      {simplificado ? (
        <>
          {/* Linha e totais em cima; Observacoes e assinatura embaixo (17/11/2026). */}
          <div className="pv-linha-final" />
          <div className="pv-totais">
            <span><span className="pv-rotulo">Vr Produto:</span> <strong>{numero(pedidoData.valorTotalItens)}</strong></span>
            <span><span className="pv-rotulo">Vr Desconto:</span> {totalOuVazio(pedidoData.valorTotalDescontos)}</span>
            <span><span className="pv-rotulo">Vr Frete:</span> {totalOuVazio(pedidoData.frete)}</span>
            <span><span className="pv-rotulo">Vr Encargos:</span> {totalOuVazio(pedidoData.encargos)}</span>
            <span><span className="pv-rotulo">Vr Outros:</span></span>
            {pagamento.temAPrazo && <span><span className="pv-rotulo">Vr a Prazo:</span> <strong>{numero(pagamento.aPrazoCentavos / 100)}</strong></span>}
            <span><span className="pv-rotulo">Vr Liquido:</span> <strong>{numero(liquido)}</strong></span>
          </div>
          <LinhasDePagamento pagamento={pagamento} />
          <div className="pv-obs">
            <span className="pv-rotulo">Observações:</span> {String(pedidoData.observacao || '')}
          </div>
          <div className="pv-assinatura">
            <div className="pv-assinatura-linha" />
            <span>Assinatura do cliente</span>
          </div>
        </>
      ) : (
        <>
        <div className="pv-totais">
          <span><span className="pv-rotulo">Vr Produto:</span> <strong>{numero(pedidoData.valorTotalItens)}</strong></span>
          <span><span className="pv-rotulo">Vr Desconto:</span> {totalOuVazio(pedidoData.valorTotalDescontos)}</span>
          <span><span className="pv-rotulo">Vr Frete:</span> {totalOuVazio(pedidoData.frete)}</span>
          <span><span className="pv-rotulo">Vr Encargos:</span> {totalOuVazio(pedidoData.encargos)}</span>
          <span><span className="pv-rotulo">Vr Outros:</span></span>
          {pagamento.temAPrazo && <span><span className="pv-rotulo">Vr a Prazo:</span> <strong>{numero(pagamento.aPrazoCentavos / 100)}</strong></span>}
          <span><span className="pv-rotulo">Vr Liquido:</span> <strong>{numero(liquido)}</strong></span>
        </div>
        <LinhasDePagamento pagamento={pagamento} />
        <div className="pv-rodape">
          <span>{preVenda ? 'Pré-Venda' : 'Pedido'}: {numeroPedido}/UN</span>
          <span>Estação: {nomeEmpresa.replace(/\s+/g, '').toUpperCase().slice(0, 20)} - Usuário: {extras.usuarioNome.toUpperCase()}</span>
          <span>Gerado em {formatarGeradoEmMinuta(geradoEm)}</span>
        </div>
        </>
      )}
      </div>
    </div>
  );
};

export default PedidoPrintPreVenda;

import React from 'react';
import {
  codigoENomeMinuta,
  condicaoPagamentoMinuta,
  enderecoMinuta,
  formatarCepMinuta,
  formatarDocumentoMinuta,
  formatarEmissaoMinuta,
  formatarGeradoEmMinuta,
  formatarQuantidadeMinuta,
  formatarTelefoneMinuta,
  formatarTotalPecasMinuta,
  rotuloDocumentoMinuta,
  vendedorMinuta,
} from '../../utils/minutaDomain';
import './MinutaPrint.css';

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
  codigoBarras?: string;
  marca?: string;
  localizacaoEstoque?: string;
}

/** Campos do cadastro do cliente que a minuta imprime. */
export interface MinutaCliente {
  codigo?: string;
  documento?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  telefone?: string;
  celular?: string;
  referencia?: string;
}

interface MinutaPrintDocumentProps {
  pedidoData: any;
  itens: MinutaItem[];
  configData: any;
  cliente?: MinutaCliente | null;
  /** Codigo do vendedor (cadastro de Usuarios), quando existir. */
  vendedorCodigo?: string;
  /** Quem esta imprimindo. */
  usuarioNome?: string;
  /** Data/hora da impressao. Vem de fora pra o rodape nao mudar a cada render. */
  geradoEm: Date;
  /** Colunas opcionais (Configuracoes). Padrao: aparecem. */
  mostrarMarca?: boolean;
  mostrarLocal?: boolean;
}

/**
 * Minuta de entrega no MESMO layout do sistema antigo (pedido da Sol Natus em
 * 2026-09-21, com a folha antiga ao lado): cabecalho em quadro com filial,
 * numero, cliente, endereco, contatos, observacao, condicao de pagamento e
 * vendedor; itens com quantidade, unidade, matricula (codigo), descricao,
 * codigo de barras, marca e local; total de pecas; linhas de data/horario de
 * entrega; assinaturas do entregador e do cliente (com CPF/CNPJ); e o rodape
 * com usuario e hora de geracao.
 *
 * Continua SEM nenhum valor monetario -- e' documento de separacao/entrega.
 * `itens` ja vem enriquecido e ordenado por MinutaPrint.tsx; aqui so' se
 * desenha. Nao declarar `@page { size }` no CSS (regra do projeto).
 */
const MinutaPrintDocument: React.FC<MinutaPrintDocumentProps> = ({
  pedidoData, itens, configData, cliente, vendedorCodigo, usuarioNome, geradoEm, mostrarMarca = true, mostrarLocal = true,
}) => {
  const totalColunas = 5 + (mostrarMarca ? 1 : 0) + (mostrarLocal ? 1 : 0);
  const criadoEm: Date | null = pedidoData.createdAt?.toDate ? pedidoData.createdAt.toDate() : null;
  const numero = pedidoData.numeroPedido || pedidoData.id.substring(0, 6).toUpperCase();
  const ehPreVenda = pedidoData.status === 'Pré-venda';
  const nomeEmpresa = String(configData?.nomeOficina || '').trim();
  const condicao = condicaoPagamentoMinuta(pedidoData.pagamentos);
  const observacao = String(pedidoData.observacao || pedidoData.observacoes || '').trim();
  const documento = formatarDocumentoMinuta(cliente?.documento);
  const fone = formatarTelefoneMinuta(cliente?.telefone);
  const celular = formatarTelefoneMinuta(cliente?.celular);

  return (
    <div className="a4-page minuta-doc">
      <div className="minuta-quadro">
        <span className="minuta-titulo">MINUTA DE ENTREGA</span>

        <div className="minuta-linha">
          <span>Filial: {nomeEmpresa}</span>
          <span>{ehPreVenda ? 'Pré-venda' : 'Pedido'}: {numero}</span>
          <span>Operação: VENDAS</span>
          <span>Página: 1</span>
        </div>

        <div className="minuta-linha">
          <span>Cliente: {codigoENomeMinuta(cliente?.codigo, pedidoData.clienteNome || 'Consumidor Final')}</span>
          <span>Emissão: {formatarEmissaoMinuta(criadoEm)}</span>
        </div>

        <div className="minuta-linha">
          <span>Endereço: {enderecoMinuta(cliente)}</span>
          <span>Fone: {fone} &nbsp; Fax: &nbsp; Cel.: {celular}</span>
        </div>

        <div className="minuta-linha">
          <span>UF: {cliente?.estado || ''} &nbsp; CEP: {formatarCepMinuta(cliente?.cep)} &nbsp; Ref.: {cliente?.referencia || ''}</span>
          {/* Cidade em destaque e afastada do bairro: e' o dado que o entregador
              procura primeiro. */}
          <span className="minuta-bairro-cidade">
            <span>Bairro: {cliente?.bairro || ''}</span>
            <span>Cidade: <strong>{cliente?.cidade || ''}</strong></span>
          </span>
        </div>

        <div className="minuta-linha">
          <span>Obs.: {observacao}</span>
          <span className="minuta-direita">Cond. Pagto: {condicao}</span>
        </div>

        <div className="minuta-linha">
          <span />
          <span className="minuta-direita">Vendedor: {vendedorMinuta(vendedorCodigo, pedidoData.vendedorNome)}</span>
        </div>
      </div>

      <table className="minuta-tabela">
        {/* Larguras fixas: a tabela ocupa a folha inteira e o pontilhado de
            cada linha vai ate' a borda, mesmo com celula vazia (codigo de
            barras, marca ou local sem cadastro). */}
        <colgroup>
          <col style={{ width: '10%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '8%' }} />
          <col />
          <col style={{ width: '20%' }} />
          {mostrarMarca && <col style={{ width: '12%' }} />}
          {mostrarLocal && <col style={{ width: '9%' }} />}
        </colgroup>
        <thead>
          <tr>
            <th className="minuta-num">Quantid.</th>
            <th>Und.</th>
            <th className="minuta-num">Matric.</th>
            <th>Descrição</th>
            <th className="minuta-barras">Cód.Barras</th>
            {mostrarMarca && <th>Marca</th>}
            {mostrarLocal && <th>Local</th>}
          </tr>
        </thead>
        <tbody>
          {itens.length > 0 ? (
            itens.map((item, i) => (
              <tr key={`${item.id}-${i}`}>
                <td className="minuta-num">{formatarQuantidadeMinuta(item.quantidade)}</td>
                <td>{item.unidadeMedidaSigla || 'UN'}</td>
                <td className="minuta-num">{item.codigo || ''}</td>
                <td className="minuta-descricao">{item.nome}</td>
                <td className="minuta-barras">{item.codigoBarras || ''}</td>
                {mostrarMarca && <td>{item.marca || ''}</td>}
                {mostrarLocal && <td>{item.localizacaoEstoque || ''}</td>}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={totalColunas} style={{ textAlign: 'center', padding: '8px' }}>Nenhum item adicionado.</td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="minuta-total">Total de Peça(s): &nbsp; <strong>{formatarTotalPecasMinuta(itens)}</strong></p>

      <div className="minuta-entrega">
        <div className="minuta-entrega-campo">
          <span>Data de Entrega</span>
          <span className="minuta-tracos">____/____/____</span>
        </div>
        <div className="minuta-entrega-campo minuta-entrega-horario">
          <span>Horário</span>
          <span className="minuta-tracos">_____ : _____</span>
        </div>
      </div>

      <div className="minuta-assinaturas">
        <div className="minuta-assinatura">
          <div className="minuta-linha-assinatura" />
          <span>Assinatura do Entregador</span>
        </div>
        <div className="minuta-assinatura">
          <div className="minuta-linha-assinatura" />
          <span>
            Assinatura do Cliente{documento ? <> &nbsp; {rotuloDocumentoMinuta(cliente?.documento)}: {documento}</> : null}
          </span>
        </div>
      </div>

      <div className="minuta-rodape">
        <span>Estação: {nomeEmpresa.replace(/\s+/g, '').toUpperCase()}</span>
        <span>Usuário: {(usuarioNome || '').toUpperCase()}</span>
        <span>Gerado em {formatarGeradoEmMinuta(geradoEm)}</span>
      </div>
    </div>
  );
};

export default MinutaPrintDocument;

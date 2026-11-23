import React, { useEffect } from 'react';
import { mensagemDoDocumento } from '../../utils/mensagensPadraoDomain';
import { formatarHoraMinuta } from '../../utils/minutaDomain';
import { dadosDaFolhaDoOrcamento, numeroBr } from './orcamentoFolhaComum';
import '../Vendas/PedidoPrintPreVenda.css';
import './OrcamentoPrintModelos.css';

interface Props {
  data: any;
  clientData: any;
  configData: any;
}

/**
 * Orcamento SIMPLIFICADO, modelo DAV (23/11/2026): o formato da pre-venda
 * simplificada da Jomarly (PedidoPrintPreVenda simplificado) com cara de
 * orcamento -- aviso de validade no alto, ORCAMENTO no quadro da empresa,
 * cliente em destaque, itens com codigo, totais e "de acordo" no pe da folha.
 */
const OrcamentoPrintSimples: React.FC<Props> = ({ data, clientData, configData }) => {
  const f = dadosDaFolhaDoOrcamento(data, clientData, configData);
  const mensagem = mensagemDoDocumento(configData, 'orcamento');

  useEffect(() => {
    const estilo = document.createElement('style');
    estilo.setAttribute('data-orcamento-simples', 'true');
    estilo.textContent = '@media print { @page { margin: 4mm; } }';
    document.head.appendChild(estilo);
    return () => { estilo.remove(); };
  }, []);

  return (
    <div className="pv-page pv-page--simples orc-simples">
      <div className="pv-aviso-topo">
        ORÇAMENTO — NÃO É DOCUMENTO FISCAL NEM PEDIDO. VÁLIDO POR {f.validadeDias} DIAS{f.validadeAte ? `, ATÉ ${f.validadeAte}` : ''}.
      </div>
      <div className="pv-caixa pv-caixa--empresa">
        {f.empresa.logo && <img className="pv-logo-caixa" src={f.empresa.logo} alt="Logo" />}
        <div className="pv-empresa-dados">
          {f.empresa.nome && <div><strong>EMPRESA:</strong> {f.empresa.nome}</div>}
          {(f.empresa.telefone || f.empresa.cnpj) && (
            <div>
              {f.empresa.telefone && <><strong>CONTATO:</strong> {f.empresa.telefone}</>}
              {f.empresa.cnpj && <> &nbsp;&nbsp;<strong>CNPJ:</strong> {f.empresa.cnpj}</>}
            </div>
          )}
          {f.empresa.endereco && <div className="pv-empresa-endereco"><strong>ENDEREÇO:</strong> {f.empresa.endereco}</div>}
        </div>
        <div className="pv-empresa-direita">
          <div className="pv-empresa-numero orc-simples-titulo"><strong>ORÇAMENTO - {f.numero}</strong></div>
          {f.vendedor && <div><strong>VENDEDOR:</strong> {f.vendedor}</div>}
          <div><strong>EMISSÃO:</strong> {f.emissao ? `${f.emissao.toLocaleDateString('pt-BR')} ${formatarHoraMinuta(f.emissao)}` : ''}</div>
          <div><strong>VÁLIDO ATÉ:</strong> {f.validadeAte}</div>
        </div>
      </div>

      <div className="pv-caixa pv-dados">
        <div className="pv-linha">
          <span className="pv-cliente-destaque"><span className="pv-rotulo">Cliente:</span> {[f.cliente.codigo, f.cliente.nome].filter(Boolean).join(' ')}</span>
          <span><span className="pv-rotulo">Fone:</span> {f.cliente.telefone}</span>
          <span><span className="pv-rotulo">CNPJ/CPF:</span> {f.cliente.documento}</span>
        </div>
        <div className="pv-linha">
          <span><span className="pv-rotulo">Endereço:</span> {f.cliente.endereco}</span>
          <span><span className="pv-rotulo">Bairro:</span> {f.cliente.bairro}</span>
          <span><span className="pv-rotulo">Cidade:</span> {f.cliente.cidade}</span>
        </div>
        {f.veiculo && (
          <div className="pv-linha">
            <span><span className="pv-rotulo">Veículo/Equip.:</span> {f.veiculo}</span>
          </div>
        )}
        <div className="pv-linha">
          <span><span className="pv-rotulo">Cond.Pagto:</span> {f.condicao || 'A combinar'}</span>
          {f.prazo && <span><span className="pv-rotulo">Prazo de entrega:</span> {f.prazo}</span>}
        </div>
      </div>

      <table className="pv-tabela">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col />
          <col style={{ width: '6%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Cód.</th>
            <th>Descrição</th>
            <th>Und.</th>
            <th className="pv-num">Quantid.</th>
            <th className="pv-num">Vr Unit.</th>
            <th className="pv-num">Vr Total</th>
          </tr>
        </thead>
        <tbody>
          {f.itens.length > 0 ? f.itens.map((item, i) => (
            <tr key={i}>
              <td>{item.codigo || (item.servico ? 'SERV.' : '')}</td>
              <td>{item.descricao}</td>
              <td>{item.unidade}</td>
              <td className="pv-num">{item.quantidade}</td>
              <td className="pv-num">{numeroBr(item.unitario)}</td>
              <td className="pv-num">{numeroBr(item.total)}</td>
            </tr>
          )) : (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '8px' }}>Nenhum item no orçamento.</td></tr>
          )}
        </tbody>
      </table>

      <div className="pv-fim">
        <div className="pv-linha-final" />
        <div className="pv-totais">
          {f.temServicos && <span><span className="pv-rotulo">Vr Serviços:</span> <strong>{numeroBr(f.totais.servicos)}</strong></span>}
          <span><span className="pv-rotulo">Vr Produtos:</span> <strong>{numeroBr(f.totais.produtos)}</strong></span>
          <span><span className="pv-rotulo">Vr Desconto:</span> {f.totais.desconto > 0 ? numeroBr(f.totais.desconto) : ''}</span>
          <span><span className="pv-rotulo">Vr Frete:</span> {f.totais.frete > 0 ? numeroBr(f.totais.frete) : ''}</span>
          <span className="orc-simples-total"><span className="pv-rotulo">Total do orçamento:</span> <strong>{numeroBr(f.totais.total)}</strong></span>
        </div>
        <div className="pv-obs">
          <span className="pv-rotulo">Observações:</span> <span className="texto-como-digitado">{f.observacoes}</span>
        </div>
        {mensagem && <div className="pv-obs" style={{ whiteSpace: 'pre-line' }}>{mensagem}</div>}
        <div className="pv-assinatura">
          <div className="pv-assinatura-linha" />
          <span>De acordo do cliente — data ____/____/______</span>
        </div>
      </div>
    </div>
  );
};

export default OrcamentoPrintSimples;

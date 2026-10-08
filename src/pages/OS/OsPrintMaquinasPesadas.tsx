import React from 'react';
import { getCompanyAddressRows } from '../../utils/companyAddress';
import { getServiceHours, getServiceTotal } from '../../utils/osServicePricing';
import { resolverDescontoImpressaoOS, totalComDescontoOS } from '../../utils/osDescontoImpressao';
import { kmDoDeslocamento, parseConfigMaquinasPesadas, parseDeslocamento, temDeslocamento } from '../../utils/oficinaDomain';
import './OsPrintMaquinasPesadas.css';

/*
 * MODELO DE IMPRESSAO "MAQUINAS PESADAS" (2026-10-07, fase 1 do plano
 * docs/PLANO_MAQUINAS_PESADAS.md).
 *
 * Reproduz o talao de OS em papel usado por oficinas de tratores e maquinas:
 * cabecalho com os dados do equipamento (modelo, frota/placa, serie/chassi,
 * horimetro) e do atendimento (data, nº, responsavel, hora inicio/termino),
 * reclamacao do cliente, grade de pecas/servicos com unidade e quantidade,
 * bloco de deslocamento (KM inicial/final, hora, local), tecnico/veiculo,
 * observacoes, total e o texto de concordancia com assinatura do cliente.
 * Mesmas props dos outros modelos (OsPrintDocument decide qual usar).
 */

interface Props {
  osData: any;
  clientData: any;
  vehicleData: any;
  configData: any;
}

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const dataBr = (v: any) => {
  if (!v) return '';
  if (v?.toDate) return v.toDate().toLocaleDateString('pt-BR');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
};
const ou = (v: any, vazio = '') => (v === null || v === undefined || String(v).trim() === '' ? vazio : String(v));
const LINHAS_MINIMAS = 12;

const OsPrintMaquinasPesadas: React.FC<Props> = ({ osData, clientData, vehicleData, configData }) => {
  const configMaquinas = parseConfigMaquinasPesadas(configData?.maquinasPesadas);
  const empresaEndereco = getCompanyAddressRows(configData, '').map((l) => l.value).join(' - ');
  const servicos = (osData.servicos || []).map((s: any) => ({
    nome: s.nome, unidade: 'SV', quantidade: getServiceHours(s), unitario: Number(s.preco || 0), total: getServiceTotal(s), detalhe: s.detalhamento || '',
  }));
  const pecas = (osData.pecas || []).map((p: any) => ({
    nome: p.nome, unidade: p.unidadeMedidaSigla || 'UN', quantidade: Number(p.quantidade || 1), unitario: Number(p.preco || 0), total: Number(p.preco || 0) * Number(p.quantidade || 1), detalhe: '',
  }));
  const itens = [...pecas, ...servicos];
  const subtotal = itens.reduce((t, i) => t + i.total, 0);
  const desconto = resolverDescontoImpressaoOS(osData.desconto);
  const total = totalComDescontoOS(subtotal, desconto);
  const deslocamento = parseDeslocamento(osData.deslocamento);
  const linhasVazias = Math.max(0, LINHAS_MINIMAS - itens.length);
  const telefoneCliente = ou(osData.clienteTelefone || clientData?.telefone || clientData?.celular);
  const frota = ou(osData.frota || vehicleData?.frota);
  const placa = ou(osData.placa || vehicleData?.placa).toUpperCase();
  const serie = ou(osData.serie || vehicleData?.serie).toUpperCase();
  const horimetro = ou(osData.horimetro || vehicleData?.horimetro);

  return (
    <div className="os-mp-page">
      <header className="os-mp-header">
        <div className="os-mp-empresa">
          {configData?.logo && <img src={configData.logo} alt="Logo" className="os-mp-logo" />}
          <div>
            <strong>{configData?.nomeOficina || configData?.razaoSocial || 'Empresa'}</strong>
            {empresaEndereco && <div>{empresaEndereco}</div>}
            <div>{[configData?.telefone, configData?.cnpj ? `CNPJ ${configData.cnpj}` : ''].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="os-mp-titulo">
          <h1>ORDEM DE SERVIÇO</h1>
          <div className="os-mp-numero">Nº {osData.numeroOS || osData.id?.substring(0, 8).toUpperCase()}</div>
        </div>
      </header>

      <section className="os-mp-grid os-mp-grid-cabecalho">
        <div className="os-mp-bloco">
          <div className="os-mp-campo os-mp-campo-largo"><span>Cliente</span><b>{ou(osData.clienteNome)}</b></div>
          <div className="os-mp-campo"><span>Telefone</span><b>{telefoneCliente}</b></div>
          <div className="os-mp-campo"><span>Modelo do equipamento</span><b>{[osData.marca, osData.modelo].filter(Boolean).join(' ')}</b></div>
          <div className="os-mp-campo"><span>Tipo</span><b>{ou(osData.tipoEquipamento)}</b></div>
          <div className="os-mp-campo"><span>Frota / Placa</span><b>{[frota ? `Frota ${frota}` : '', placa].filter(Boolean).join(' · ')}</b></div>
          <div className="os-mp-campo"><span>Série / Chassi</span><b>{serie}</b></div>
        </div>
        <div className="os-mp-bloco">
          <div className="os-mp-campo"><span>Data</span><b>{dataBr(osData.dataEntrada || osData.createdAt)}</b></div>
          <div className="os-mp-campo"><span>Responsável</span><b>{ou(osData.mecanicoNome)}</b></div>
          <div className="os-mp-campo"><span>Hora início</span><b>{ou(osData.horaEntrada)}</b></div>
          <div className="os-mp-campo"><span>Hora término</span><b>{ou(osData.horaSaida)}</b></div>
          <div className="os-mp-campo"><span>Horímetro</span><b>{horimetro ? `${horimetro} h` : ''}</b></div>
          <div className="os-mp-campo"><span>Situação</span><b>{ou(osData.status)}</b></div>
        </div>
      </section>

      <section className="os-mp-secao">
        <div className="os-mp-secao-titulo">Reclamação do cliente</div>
        <div className="os-mp-texto">{ou(osData.defeitoRelatado)}</div>
      </section>

      <table className="os-mp-tabela">
        <thead>
          <tr>
            <th className="os-mp-col-item">Item</th>
            <th>Peças / Serviços</th>
            <th className="os-mp-col-unid">Unid.</th>
            <th className="os-mp-col-qtd">Quant.</th>
            <th className="os-mp-col-valor">R$</th>
            <th className="os-mp-col-valor">Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, i) => (
            <tr key={i}>
              <td className="os-mp-col-item">{i + 1}</td>
              <td>{item.nome}{item.detalhe ? <small> — {item.detalhe}</small> : null}</td>
              <td className="os-mp-col-unid">{item.unidade}</td>
              <td className="os-mp-col-qtd">{item.quantidade}</td>
              <td className="os-mp-col-valor">{moeda(item.unitario)}</td>
              <td className="os-mp-col-valor">{moeda(item.total)}</td>
            </tr>
          ))}
          {Array.from({ length: linhasVazias }, (_, i) => (
            <tr key={`vazia-${i}`} className="os-mp-linha-vazia">
              <td className="os-mp-col-item">{itens.length + i + 1}</td><td /><td /><td /><td /><td />
            </tr>
          ))}
        </tbody>
      </table>

      {osData.relatorioTecnico && (
        <section className="os-mp-secao">
          <div className="os-mp-secao-titulo">Serviço executado</div>
          <div className="os-mp-texto">{osData.relatorioTecnico}</div>
        </section>
      )}

      <section className="os-mp-secao">
        <div className="os-mp-secao-titulo">Deslocamento para atendimento ao cliente</div>
        <div className="os-mp-deslocamento">
          <div className="os-mp-campo"><span>KM inicial</span><b>{deslocamento.kmInicial ?? ''}</b></div>
          <div className="os-mp-campo"><span>KM final</span><b>{deslocamento.kmFinal ?? ''}</b></div>
          <div className="os-mp-campo"><span>KM rodados</span><b>{temDeslocamento(deslocamento) && kmDoDeslocamento(deslocamento) > 0 ? `${kmDoDeslocamento(deslocamento)} km` : ''}</b></div>
          <div className="os-mp-campo"><span>Hora saída</span><b>{deslocamento.horaSaida}</b></div>
          <div className="os-mp-campo"><span>Hora chegada</span><b>{deslocamento.horaChegada}</b></div>
          <div className="os-mp-campo os-mp-campo-largo"><span>Local</span><b>{deslocamento.local}</b></div>
        </div>
      </section>

      <section className="os-mp-grid os-mp-grid-rodape">
        <div className="os-mp-bloco">
          <div className="os-mp-campo"><span>Técnico / Veículo</span><b>{[osData.mecanicoNome, deslocamento.veiculoEmpresa].filter(Boolean).join(' · ')}</b></div>
          <div className="os-mp-campo os-mp-campo-largo"><span>Obs.</span><b>{ou(osData.observacoes)}</b></div>
        </div>
        <div className="os-mp-totais">
          {desconto.temDesconto && (
            <div className="os-mp-total-linha"><span>{desconto.rotulo}</span><b>- {moeda(desconto.valor)}</b></div>
          )}
          <div className="os-mp-total-linha os-mp-total-geral"><span>TOTAL: R$</span><b>{moeda(total)}</b></div>
        </div>
      </section>

      <section className="os-mp-concordancia">
        <p>{configMaquinas.textoConcordancia}</p>
        <div className="os-mp-assinaturas">
          <div className="os-mp-assinatura"><div className="os-mp-linha" /><span>Ass. do Cliente</span></div>
          <div className="os-mp-assinatura os-mp-assinatura-curta"><div className="os-mp-linha" /><span>Data</span></div>
          <div className="os-mp-assinatura"><div className="os-mp-linha" /><span>Local</span></div>
        </div>
      </section>
    </div>
  );
};

export default OsPrintMaquinasPesadas;

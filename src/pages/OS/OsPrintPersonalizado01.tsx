import React from 'react';
import {
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Gauge,
  PackageCheck,
  UserRound,
} from 'lucide-react';
import { getCompanyAddressRows } from '../../utils/companyAddress';
import { getServiceHours, getServiceTotal } from '../../utils/osServicePricing';
import instagramIcon from '../../assets/instagram-icon.png';
import whatsappIcon from '../../assets/whatsapp-icon.png';
import './OsPrintPersonalizado01.css';

interface OsPrintPersonalizado01Props {
  osData: any;
  clientData: any;
  vehicleData: any;
  configData: any;
}

const currency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const formatDate = (value: any) => {
  if (!value) return '---';
  if (value?.toDate) return value.toDate().toLocaleDateString('pt-BR');
  if (value instanceof Date) return value.toLocaleDateString('pt-BR');

  const normalized = String(value).slice(0, 10);
  const [year, month, day] = normalized.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

const displayValue = (value: any) => {
  if (value === null || value === undefined || value === '') return '---';
  return String(value);
};

const formatInstagram = (value: any) => {
  const instagram = String(value || '').trim();
  if (!instagram) return '';
  return instagram.startsWith('@') ? instagram : `@${instagram}`;
};

const formatDateTime = (dateValue: any, timeValue: any) => {
  const date = formatDate(dateValue);
  const time = displayValue(timeValue);

  if (date === '---' && time === '---') return '---';
  if (time === '---') return date;
  if (date === '---') return time;
  return `${date} às ${time}`;
};

const OsPrintPersonalizado01: React.FC<OsPrintPersonalizado01Props> = ({
  osData,
  clientData,
  vehicleData,
  configData,
}) => {
  const servicos = osData.servicos || [];
  const pecas = osData.pecas || [];
  const totalServicos = servicos.reduce(
    (total: number, item: any) => total + getServiceTotal(item),
    0
  );
  const totalPecas = pecas.reduce(
    (total: number, item: any) => total + Number(item.preco || 0) * Number(item.quantidade || 1),
    0
  );
  const tempoTotal = servicos.reduce(
    (total: number, item: any) => total + getServiceHours(item),
    0
  );
  const totalGeral = totalServicos + totalPecas;
  const numeroOS = osData.numeroOS || osData.id?.substring(0, 6).toUpperCase();
  const companyDetails: Array<{ type: 'text' | 'instagram' | 'whatsapp'; value: string }> = [
    configData?.cnpj ? `CNPJ ${configData.cnpj}` : null,
    configData?.telefone || null,
    configData?.email || null,
  ].filter(Boolean).map((value) => ({ type: 'text', value: String(value) }));
  const instagram = formatInstagram(configData?.instagram);
  const whatsapp = configData?.whatsapp || '';
  const companyAddressRows = getCompanyAddressRows(configData);
  if (instagram) companyDetails.push({ type: 'instagram', value: instagram });
  if (whatsapp) companyDetails.push({ type: 'whatsapp', value: String(whatsapp) });
  const enderecoCliente = [
    clientData?.endereco,
    clientData?.numero,
    clientData?.bairro,
    clientData?.cidade,
    clientData?.uf,
  ].filter(Boolean).join(', ');

  return (
    <article className="os-custom-page">
      <header className="os-custom-header">
        <div className="os-custom-brand">
          <div className="os-custom-logo-stage">
            {configData?.logo ? (
              <img src={configData.logo} alt="Logotipo da empresa" />
            ) : (
              <div className="os-custom-brand-mark">N</div>
            )}
          </div>
          <div className="os-custom-brand-info">
            {companyDetails.map((detail) => (
              <p key={`${detail.type}-${detail.value}`}>
                {detail.type === 'instagram' && <img className="os-custom-contact-icon" src={instagramIcon} alt="" />}
                {detail.type === 'whatsapp' && <img className="os-custom-contact-icon" src={whatsappIcon} alt="" />}
                <span>{detail.value}</span>
              </p>
            ))}
          </div>
        </div>

        <div className="os-custom-document-id">
          <span>Ordem de Serviço</span>
          <strong>OS Nº {numeroOS}</strong>
          <small>{displayValue(osData.status)}</small>
        </div>
      </header>

      <div className="os-custom-company-address">
        {companyAddressRows.map((row) => (
          <span key={row.label}><strong>{row.label}:</strong> {row.value}</span>
        ))}
      </div>

      <section className="os-custom-two-columns">
        <div className="os-custom-section">
          <h2>Dados do cliente</h2>
          <dl className="os-custom-data-list">
            <div><dt>Cliente</dt><dd>{displayValue(osData.clienteNome)}</dd></div>
            <div><dt>Telefone</dt><dd>{displayValue(osData.clienteTelefone)}</dd></div>
            <div><dt>CPF / CNPJ</dt><dd>{displayValue(clientData?.documento)}</dd></div>
            <div><dt>E-mail</dt><dd>{displayValue(clientData?.email)}</dd></div>
            <div className="os-custom-wide"><dt>Endereço</dt><dd>{displayValue(enderecoCliente)}</dd></div>
          </dl>
        </div>

        <div className="os-custom-section">
          <h2>Dados do veículo</h2>
          <dl className="os-custom-data-list">
            <div><dt>Veículo</dt><dd>{displayValue(osData.modelo)}</dd></div>
            <div><dt>Marca</dt><dd>{displayValue(osData.marca || vehicleData?.marca)}</dd></div>
            <div><dt>Placa</dt><dd>{displayValue(osData.placa?.toUpperCase())}</dd></div>
            <div><dt>Ano / modelo</dt><dd>{displayValue(osData.ano)}</dd></div>
            <div><dt>Cor</dt><dd>{displayValue(osData.cor)}</dd></div>
            <div><dt>RENAVAM</dt><dd>{displayValue(osData.renavam || vehicleData?.renavam)}</dd></div>
            <div><dt>Combustível</dt><dd>{displayValue(osData.combustivel || vehicleData?.combustivel)}</dd></div>
          </dl>
        </div>
      </section>

      <section className="os-custom-service-strip">
        <div>
          <CalendarDays size={20} />
          <span>Data de entrada</span>
          <strong>{formatDateTime(osData.dataEntrada || osData.createdAt, osData.horaEntrada)}</strong>
        </div>
        <div>
          <CalendarDays size={20} />
          <span>Saída prevista</span>
          <strong>{formatDateTime(osData.dataSaida, osData.horaSaida)}</strong>
        </div>
        <div>
          <Gauge size={20} />
          <span>KM no recebimento</span>
          <strong>{displayValue(osData.quilometragem || vehicleData?.kmAtual)}</strong>
        </div>
        <div>
          <UserRound size={20} />
          <span>Responsável técnico</span>
          <strong>{displayValue(osData.mecanicoNome)}</strong>
        </div>
      </section>

      <section className="os-custom-two-columns os-custom-report-grid">
        <div className="os-custom-section os-custom-text-section">
          <h2>Solicitação do cliente</h2>
          <p>{osData.defeitoRelatado || 'Nenhuma solicitação registrada.'}</p>
        </div>
        <div className="os-custom-section os-custom-text-section">
          <h2>Serviço realizado / relatório técnico</h2>
          <p>{osData.relatorioTecnico || 'Nenhum relatório técnico registrado.'}</p>
        </div>
      </section>

      <section className="os-custom-section os-custom-table-section">
        <h2>Serviços executados</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Descrição do serviço</th>
              <th>Detalhamento</th>
              <th className="number">Tempo</th>
              <th className="number">Valor/h</th>
              <th className="number">Total</th>
            </tr>
          </thead>
          <tbody>
            {servicos.length ? servicos.map((item: any, index: number) => {
              const tempo = getServiceHours(item);
              const total = getServiceTotal(item);
              return (
                <tr key={`${item.id || item.nome}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{displayValue(item.nome)}</td>
                  <td>{displayValue(item.detalhamento)}</td>
                  <td className="number">{tempo ? `${tempo.toFixed(2)} h` : '---'}</td>
                  <td className="number">{currency(item.preco)}</td>
                  <td className="number">{currency(total)}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan={6} className="empty">Nenhum serviço registrado.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Tempo total de serviço</td>
              <td className="number">{tempoTotal ? `${tempoTotal.toFixed(2)} h` : '---'}</td>
              <td>Total serviços</td>
              <td className="number">{currency(totalServicos)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="os-custom-section os-custom-table-section">
        <h2>Peças e materiais utilizados</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Descrição</th>
              <th className="number">Quantidade</th>
              <th className="number">Valor unitário</th>
              <th className="number">Total</th>
            </tr>
          </thead>
          <tbody>
            {pecas.length ? pecas.map((item: any, index: number) => (
              <tr key={`${item.id || item.nome}-${index}`}>
                <td>{index + 1}</td>
                <td>{displayValue(item.nome)}</td>
                <td className="number">{displayValue(item.quantidade)}</td>
                <td className="number">{currency(item.preco)}</td>
                <td className="number">{currency(Number(item.preco || 0) * Number(item.quantidade || 1))}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="empty">Nenhuma peça registrada.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total peças / materiais</td>
              <td className="number">{currency(totalPecas)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="os-custom-summary">
        <div className="os-custom-summary-card">
          <PackageCheck size={20} />
          <span>Materiais fornecidos pelo cliente</span>
          <p>{osData.materiaisCliente || 'Nenhum material informado.'}</p>
        </div>
        <div className="os-custom-summary-card">
          <CreditCard size={20} />
          <span>Condições de pagamento</span>
          <p>
            {osData.condicoesPagamento ||
              `${displayValue(osData.formaPagamento)} - ${
                osData.status === 'Finalizada' ? 'Pagamento registrado' : displayValue(osData.statusPagamento)
              }`}
          </p>
        </div>
        <div className="os-custom-total-card">
          <span>Total geral</span>
          <strong>{currency(totalGeral)}</strong>
        </div>
      </section>

      {(osData.observacoes || configData?.garantiaPadrao) && (
        <section className="os-custom-section os-custom-notes">
          <h2>Observações e condições</h2>
          {osData.observacoes && <p>{osData.observacoes}</p>}
          {configData?.garantiaPadrao && <p>{configData.garantiaPadrao}</p>}
        </section>
      )}

      <section className="os-custom-signatures">
        <div>
          <ClipboardCheck size={18} />
          <p>Autorizo a execução dos serviços descritos nesta ordem.</p>
          <span>Assinatura do cliente</span>
          <small>Data: ____ / ____ / ______</small>
        </div>
        <div>
          <UserRound size={18} />
          <p>{configData?.nomeOficina || 'Responsável técnico'}</p>
          <span>Assinatura do responsável</span>
          <small>Data: ____ / ____ / ______</small>
        </div>
      </section>

      <footer className="os-custom-footer">
        <strong>{configData?.nomeOficina || 'NEXAR ERP'}</strong>
        <span>{[configData?.telefone, configData?.email].filter(Boolean).join('  |  ')}</span>
        <small>Documento gerado pelo Nexar ERP</small>
      </footer>
    </article>
  );
};

export default OsPrintPersonalizado01;

import React, { useEffect, useState } from 'react';
import { mensagemDoDocumento } from '../../utils/mensagensPadraoDomain';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getCompanyAddressRows } from '../../utils/companyAddress';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import { modoDaConfiguracao, parseConfigMaquinasPesadas, rotulosOficina } from '../../utils/oficinaDomain';
import {
  linhasDoPdfDoOrcamento,
  textoCondicaoPagamento,
  textoHoras,
  textoPrazoEntrega,
  totaisDoPdfDoOrcamento,
} from '../../utils/orcamentoModeloDomain';
import '../OS/OsPrint.css';

const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor) || 0);
const quantidadeBr = (valor: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(valor) || 0);

const OrcamentoPrint: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [data, setData] = useState<any>(null);
  const [clientData, setClientData] = useState<any>(null);
  const [configData, setConfigData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !tenantId) return;
      try {
        const docRef = doc(db, 'orcamentos', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const orcData = { id: docSnap.id, ...docSnap.data() } as any;
          setData(orcData);

          // Buscar dados detalhados do cliente
          const qC = query(
            collection(db, 'clientes'), 
            where('tenantId', '==', tenantId),
            where('nome', '==', orcData.clienteNome)
          );
          const snapC = await getDocs(qC);
          if (!snapC.empty) {
            setClientData(snapC.docs[0].data());
          }
        } else {
          alert('Orçamento não encontrado!');
          navigate('/orcamentos');
        }

        if (currentUser) {
          const configRef = doc(db, 'configuracoes', tenantId || '');
          const configSnap = await getDoc(configRef);
          if (configSnap.exists()) {
            setConfigData(configSnap.data());
          }
        }
      } catch (error) {
        console.error("Erro ao buscar dados", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, currentUser, tenantId]);

  const handlePrint = usePrintAndClose('/orcamentos');

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados para impressão...</div>;
  }

  if (!data) return null;

  const dataCriacao = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR') : 'N/A';
  const companyAddressRows = getCompanyAddressRows(configData, 'Endereço da Empresa');
  // PDF por modelo (16/10/2026): servico em horas x valor/hora numa tabela
  // propria (o cliente lia "3 trocas" quando era uma troca de 3 horas);
  // produtos com quantidade e unidade. Sem servico, uma tabela so' de produtos.
  const linhas = linhasDoPdfDoOrcamento(data);
  const totais = totaisDoPdfDoOrcamento(linhas, data);
  const temServicos = linhas.servicos.length > 0;
  const rotulos = rotulosOficina(modoDaConfiguracao(parseConfigMaquinasPesadas(configData?.maquinasPesadas)));
  const condicao = textoCondicaoPagamento(data.condicaoPagamento);
  const prazo = textoPrazoEntrega(data.prazoEntregaDias);
  const temCondicoes = Boolean(data.vendedorNome || condicao || prazo);

  return (
    <div className="print-layout-wrapper">
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/orcamentos')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir Orçamento
        </button>
      </div>

      <div className="a4-page">
        <div className="a4-header">
          <div className="a4-logo">
            {configData?.logo && (
              <img src={configData.logo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain', marginBottom: '8px' }} />
            )}
            <h2 style={{ fontSize: configData?.logo ? '16px' : '24px', margin: 0 }}>{configData?.nomeOficina || 'NEXAR ERP'}</h2>
            <p>CNPJ: {configData?.cnpj || '00.000.000/0001-00'}</p>
            {companyAddressRows.map((row) => (
              <p key={row.label}><strong>{row.label}:</strong> {row.value}</p>
            ))}
            <p>{configData?.telefone || '(00) 0000-0000'} | {configData?.email || 'contato@empresa.com.br'}</p>
          </div>
          <div className="a4-os-info">
            <h1 style={{ color: 'var(--accent-purple)' }}>ORÇAMENTO</h1>
            <h2 className="os-number">Nº {data.numeroOrcamento || data.id.substring(0, 6).toUpperCase()}</h2>
            <p><strong>Data:</strong> {dataCriacao}</p>
            <p><strong>Validade:</strong> {data.validadeDias || 15} dias</p>
          </div>
        </div>

        <div className="a4-section">
          <h3 className="section-title">Dados do Cliente</h3>
          <div className="a4-grid">
            <p><strong>Nome:</strong> {data.clienteNome}</p>
            <p><strong>CPF/CNPJ:</strong> {clientData?.documento || '---'}</p>
            <p><strong>Telefone:</strong> {data.clienteTelefone || 'N/A'}</p>
            <p><strong>E-mail:</strong> {clientData?.email || '---'}</p>
          </div>
          <div style={{ marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
            <p><strong>Endereço:</strong> {clientData?.endereco || '---'}{clientData?.numero ? `, ${clientData.numero}` : ''}</p>
            <p><strong>Bairro:</strong> {clientData?.bairro || '---'}</p>
          </div>
        </div>

        {(data.placa || data.modelo) && (
          <div className="a4-section">
            <h3 className="section-title">{rotulos.dadosVeiculo}</h3>
            <div className="a4-grid">
              <p><strong>{rotulos.veiculo}:</strong> {data.modelo || 'Não informado'}</p>
              <p><strong>{rotulos.placa.replace(' (se tiver)', '')}:</strong> {data.placa?.toUpperCase() || 'N/A'}</p>
              <p><strong>Ano:</strong> {data.ano || 'N/A'}</p>
              <p><strong>Cor:</strong> {data.cor || 'N/A'}</p>
            </div>
          </div>
        )}

        {temServicos && (
          <div className="a4-section">
            <h3 className="section-title">Serviços (mão de obra)</h3>
            <table className="a4-table">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th style={{ textAlign: 'center' }}>Horas</th>
                  <th style={{ textAlign: 'right' }}>Valor / hora</th>
                  <th style={{ textAlign: 'right' }}>Total (R$)</th>
                </tr>
              </thead>
              <tbody>
                {linhas.servicos.map((servico, i) => (
                  <tr key={`s${i}`}>
                    <td>{servico.nome}</td>
                    <td style={{ textAlign: 'center' }}>{textoHoras(servico.horas)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(servico.valorHora)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(servico.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(linhas.produtos.length > 0 || !temServicos) && (
          <div className="a4-section">
            <h3 className="section-title">{temServicos ? 'Peças e produtos' : 'Produtos'}</h3>
            <table className="a4-table">
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th style={{ textAlign: 'center' }}>Qtd</th>
                  <th style={{ textAlign: 'center' }}>Un.</th>
                  <th style={{ textAlign: 'right' }}>Valor unitário</th>
                  <th style={{ textAlign: 'right' }}>Total (R$)</th>
                </tr>
              </thead>
              <tbody>
                {linhas.produtos.length > 0 ? linhas.produtos.map((produto, i) => (
                  <tr key={`p${i}`}>
                    <td>{produto.nome}</td>
                    <td style={{ textAlign: 'center' }}>{quantidadeBr(produto.quantidade)}</td>
                    <td style={{ textAlign: 'center' }}>{produto.unidade}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(produto.unitario)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(produto.total)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '10px' }}>Nenhum item adicionado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="a4-section">
          <table className="a4-table">
            <tbody>
              {temServicos && (
                <tr><td style={{ textAlign: 'right' }}>Mão de obra:</td><td style={{ textAlign: 'right', width: '160px' }}>{moeda(totais.servicos)}</td></tr>
              )}
              {temServicos && (
                <tr><td style={{ textAlign: 'right' }}>Peças e produtos:</td><td style={{ textAlign: 'right', width: '160px' }}>{moeda(totais.produtos)}</td></tr>
              )}
              {totais.desconto > 0 && (
                <tr><td style={{ textAlign: 'right' }}>Desconto:</td><td style={{ textAlign: 'right', width: '160px' }}>- {moeda(totais.desconto)}</td></tr>
              )}
              {totais.frete > 0 && (
                <tr><td style={{ textAlign: 'right' }}>Frete:</td><td style={{ textAlign: 'right', width: '160px' }}>{moeda(totais.frete)}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL GERAL:</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '18px', width: '160px' }}>{moeda(totais.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {temCondicoes && (
          <div className="a4-section">
            <h3 className="section-title">Condições comerciais</h3>
            <div className="a4-grid">
              {data.vendedorNome && <p><strong>Vendedor:</strong> {data.vendedorNome}</p>}
              {condicao && <p><strong>Condição de pagamento:</strong> {condicao}</p>}
              {prazo && <p><strong>Prazo de entrega:</strong> {prazo}</p>}
            </div>
          </div>
        )}

        {data.observacoes && (
          <div className="a4-section">
            <h3 className="section-title">Observações</h3>
            <p className="a4-text-block texto-como-digitado">{data.observacoes}</p>
          </div>
        )}

        <div className="a4-signatures" style={{ marginTop: '60px' }}>
          <div className="signature-box">
            <div className="signature-line"></div>
            <p>Assinatura do Cliente</p>
          </div>
          <div className="signature-box">
            <div className="signature-line"></div>
            <p>{data.vendedorNome ? `${data.vendedorNome} — Responsável comercial` : 'Responsável Comercial'}</p>
          </div>
        </div>

        <div className="a4-footer">
          {mensagemDoDocumento(configData, 'orcamento') && (
            <p style={{ whiteSpace: 'pre-line' }}>{mensagemDoDocumento(configData, 'orcamento')}</p>
          )}
          <p>Este orçamento tem validade de {data.validadeDias || 15} dias a partir da data de emissão.</p>
          <p>Gerado pelo Sistema Hennder ERP.</p>
        </div>
      </div>
    </div>
  );
};

export default OrcamentoPrint;

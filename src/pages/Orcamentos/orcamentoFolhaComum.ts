import { formatCompanyAddress } from '../../utils/companyAddress';
import { formatarCepMinuta, formatarDocumentoMinuta, formatarTelefoneMinuta } from '../../utils/minutaDomain';
import { nomeDaEmpresaNoDocumento } from '../../utils/orcamentoEnvioDomain';
import { linhasDoPdfDoOrcamento, textoCondicaoPagamento, textoHoras, textoPrazoEntrega, totaisDoPdfDoOrcamento } from '../../utils/orcamentoModeloDomain';
import { validadeAte } from '../../utils/orcamentoPrintModels';

/**
 * O que os modelos "meia folha" e "simplificado" do orcamento leem do
 * documento (23/11/2026). Um lugar so': os dois modelos mostram os mesmos
 * numeros, so' a folha muda.
 */

export const numeroBr = (valor: number, casas = 2) =>
  Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export interface LinhaDaFolha {
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: string;
  unitario: number;
  total: number;
  servico: boolean;
}

export const dadosDaFolhaDoOrcamento = (data: any, clientData: any, configData: any) => {
  const emissao: Date | null = data?.createdAt?.toDate ? data.createdAt.toDate() : null;
  const linhas = linhasDoPdfDoOrcamento(data || {});
  const totais = totaisDoPdfDoOrcamento(linhas, data || {});
  const itens: LinhaDaFolha[] = [
    ...linhas.servicos.map((s) => ({
      codigo: '', descricao: s.nome, unidade: 'H', quantidade: textoHoras(s.horas).replace(' h', ''), unitario: s.valorHora, total: s.total, servico: true,
    })),
    ...linhas.produtos.map((p) => ({
      codigo: p.codigo, descricao: p.nome, unidade: p.unidade, quantidade: Number.isInteger(p.quantidade) ? numeroBr(p.quantidade, 0) : numeroBr(p.quantidade, 3).replace(/(,\d*?)0+$/, '$1').replace(/,$/, ''), unitario: p.unitario, total: p.total, servico: false,
    })),
  ];
  const cidadeEmpresa = [configData?.nfseCidadeNome || configData?.cidade, configData?.nfseCidadeEstado || configData?.estado]
    .map((v) => String(v || '').trim()).filter(Boolean).join(' - ');
  const validade = validadeAte(emissao, data?.validadeDias);
  const dias = Number.parseInt(String(data?.validadeDias ?? ''), 10);
  return {
    numero: String(data?.numeroOrcamento || data?.id?.substring(0, 6).toUpperCase() || ''),
    emissao,
    validadeDias: Number.isFinite(dias) && dias > 0 ? dias : 15,
    validadeAte: validade ? validade.toLocaleDateString('pt-BR') : '',
    empresa: {
      nome: nomeDaEmpresaNoDocumento(configData),
      cnpj: formatarDocumentoMinuta(configData?.cnpj),
      telefone: formatarTelefoneMinuta(configData?.telefone),
      email: String(configData?.email || '').trim(),
      endereco: [formatCompanyAddress(configData), cidadeEmpresa, formatarCepMinuta(configData?.cep)].filter(Boolean).join(', '),
      logo: String(configData?.logo || ''),
    },
    cliente: {
      nome: String(data?.clienteNome || 'Consumidor Final'),
      codigo: String(clientData?.codigo ?? '').trim(),
      telefone: [formatarTelefoneMinuta(data?.clienteTelefone || clientData?.telefone), formatarTelefoneMinuta(clientData?.celular)]
        .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / '),
      documento: formatarDocumentoMinuta(clientData?.documento),
      endereco: [String(clientData?.endereco || '').trim(), String(clientData?.numero || '').trim()].filter(Boolean).join(', '),
      bairro: String(clientData?.bairro || '').trim(),
      cidade: [clientData?.cidade, clientData?.estado].map((v) => String(v || '').trim()).filter(Boolean).join(' - '),
    },
    veiculo: [data?.modelo, data?.placa ? String(data.placa).toUpperCase() : '', data?.ano, data?.cor]
      .map((v) => String(v || '').trim()).filter(Boolean).join(' · '),
    vendedor: String(data?.vendedorNome || '').trim(),
    condicao: textoCondicaoPagamento(data?.condicaoPagamento),
    prazo: textoPrazoEntrega(data?.prazoEntregaDias),
    observacoes: String(data?.observacoes || '').trim(),
    itens,
    totais,
    temServicos: linhas.servicos.length > 0,
  };
};

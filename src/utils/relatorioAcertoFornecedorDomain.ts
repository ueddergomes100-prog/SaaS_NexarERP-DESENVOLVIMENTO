import { fraseDoComprovante, reaisDoAcerto, ROTULO_SITUACAO_ACERTO, type SituacaoDoAcerto } from './acertoFornecedorDomain';
import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';

/*
 * COMPROVANTE DO ACERTO COM FORNECEDOR (24/11/2026): o papel que a loja guarda
 * (e entrega ao cliente) dizendo que ele pagou direto o fornecedor. Sai no
 * padrao de relatorio do sistema (PDF na tela, imprimir, salvar).
 *
 * Regra pura: recebe o acerto como o servidor devolve.
 */

export interface ContaDoComprovante {
  descricao: string;
  valorCentavos: number;
  restanteCentavos: number;
  fornecedorNome?: string;
}

export interface AcertoParaComprovante {
  status: SituacaoDoAcerto;
  data: string;
  totalCentavos: number;
  clienteNome: string;
  fornecedores: string[];
  observacao: string;
  receber: ContaDoComprovante[];
  pagar: ContaDoComprovante[];
  criadoPorNome: string;
  motivoDoEstorno: string;
}

const dataBr = (iso: string): string => iso.split('-').reverse().join('/');

export const montarComprovanteDoAcerto = (acerto: AcertoParaComprovante): {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
} => {
  const colunasReceber: ColunaRelatorio<ContaDoComprovante>[] = [
    { id: 'descricao', titulo: 'Conta do cliente', tipo: 'texto', largura: 90, valor: (c) => c.descricao },
    { id: 'valor', titulo: 'Abatido', tipo: 'moeda', valor: (c) => c.valorCentavos },
    { id: 'restante', titulo: 'Fica em aberto', tipo: 'moeda', valor: (c) => c.restanteCentavos },
  ];
  const colunasPagar: ColunaRelatorio<ContaDoComprovante>[] = [
    { id: 'fornecedor', titulo: 'Fornecedor', tipo: 'texto', largura: 50, valor: (c) => c.fornecedorNome || '' },
    { id: 'descricao', titulo: 'Conta paga', tipo: 'texto', largura: 60, valor: (c) => c.descricao },
    { id: 'valor', titulo: 'Pago pelo cliente', tipo: 'moeda', valor: (c) => c.valorCentavos },
    { id: 'restante', titulo: 'Fica em aberto', tipo: 'moeda', valor: (c) => c.restanteCentavos },
  ];
  const filtros = [
    fraseDoComprovante({ cliente: acerto.clienteNome, empresa: '', totalCentavos: acerto.totalCentavos, fornecedores: acerto.fornecedores }),
    'Este acerto não movimentou caixa nem banco.',
    ...(acerto.observacao ? [`Observação: ${acerto.observacao}`] : []),
    ...(acerto.status === 'estornado' ? [`ACERTO DESFEITO. Motivo: ${acerto.motivoDoEstorno || 'não informado'}`] : []),
  ];
  return {
    titulo: 'Acerto com Fornecedor',
    periodo: `Data do pagamento: ${dataBr(acerto.data)}`,
    filtros,
    indicadores: [
      { rotulo: 'Cliente', valor: acerto.clienteNome || '—' },
      { rotulo: 'Valor do acerto', valor: reaisDoAcerto(acerto.totalCentavos) },
      { rotulo: 'Situação', valor: ROTULO_SITUACAO_ACERTO[acerto.status] || acerto.status },
      ...(acerto.criadoPorNome ? [{ rotulo: 'Registrado por', valor: acerto.criadoPorNome }] : []),
    ],
    secoes: [
      {
        id: 'receber', titulo: `Contas de ${acerto.clienteNome || 'cliente'} abatidas`, colunas: colunasReceber, linhas: acerto.receber,
        unidade: ['conta', 'contas'], mensagemVazia: 'Nenhuma conta.',
      } as SecaoRelatorio,
      {
        id: 'pagar', titulo: 'Contas dos fornecedores pagas pelo cliente', colunas: colunasPagar, linhas: acerto.pagar,
        unidade: ['conta', 'contas'], mensagemVazia: 'Nenhuma conta.',
      } as SecaoRelatorio,
    ],
  };
};

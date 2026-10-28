/*
 * EMISSAO DE BOLETO -- UM SO' CAMINHO (15/10/2026).
 *
 * Saiu de pages/Financeiro/Boletos.tsx para o "Dar Baixa" do Contas a Receber
 * tambem emitir (forma "Boleto": pede o vencimento e emite na hora -- decisao
 * do dono). As duas telas usam exatamente o mesmo codigo: reserva do nosso
 * numero, codigo de barras, linha digitavel e PDF. O calculo continua em
 * boletoDomain/boletoCnabDomain/boletoRemessaSicoob (puro e testado).
 */
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { toCents, type BoletoDetails } from '../utils/financeDomain';
import { reserveTenantSequence } from '../utils/firestoreAtomic';
import { codigoBarrasSicoob, formatarNossoNumeroSicoobExibicao, nossoNumeroSicoobComDv, parcelaDoBoletoSicoob } from '../utils/boletoCnabDomain';
import { linhaDigitavelDoCodigoBarras } from '../utils/boletoDomain';
import { gerarPdfBoletos, type DadosPdfBoleto } from '../utils/boletoPdf';
import { nomeArquivoDocumento } from '../utils/nomeArquivoDomain';
import { formatCompanyAddress } from '../utils/companyAddress';
import { erroDoConvenioBoleto } from '../utils/boletoEmissaoDomain';
import { mensagensDoBoleto } from '../utils/boletoRemessaSicoobDomain';
import { pagadorDoCadastro } from '../utils/cobrancaEmBoletoDomain';

export interface BancoBoleto {
  id: string;
  nome: string;
  agencia?: string;
  conta?: string;
  boleto?: {
    ativo?: boolean;
    contaDv?: string;
    codigoCliente?: string;
    cnpjCedente?: string;
    nomeCedente?: string;
    instrucoes?: string;
    multaPercentual?: number;
    jurosMensalPercentual?: number;
    proximoNossoNumero?: number;
    proximaRemessa?: number;
  };
}

export interface TituloBoleto {
  id: string;
  descricao: string;
  clienteId?: string | null;
  clienteNome?: string;
  /** Conta a receber de fornecedor (lancada a mao, 19/10/2026): ele e' o pagador. */
  fornecedorId?: string;
  fornecedorNome?: string;
  valorCentavos: number;
  status: 'Paga' | 'Pendente' | 'Cancelada';
  dataVencimento?: string;
  dataPrevistaRecebimento?: string;
  bancoId?: string;
  bancoNome?: string;
  pedidoId?: string;
  osId?: string;
  paymentIndex?: number;
  boleto?: BoletoDetails;
  /** Dia em que o titulo nasceu (faturamento da venda/OS), AAAA-MM-DD; vazio em lancamento antigo. */
  faturadoEm: string;
}

/** Documento de `transacoes` -> titulo de boleto (tambem usado pelo retorno do banco). */
export const paraTituloBoleto = (id: string, data: DocumentData): TituloBoleto => ({
  id,
  descricao: data.descricao || '',
  clienteId: data.clienteId ?? null,
  clienteNome: data.clienteNome || '',
  ...(data.fornecedorId ? { fornecedorId: String(data.fornecedorId), fornecedorNome: String(data.fornecedorNome || '') } : {}),
  valorCentavos: Number(data.valorCentavos ?? toCents(data.valor)),
  status: data.status || 'Pendente',
  dataVencimento: data.dataVencimento || data.dataPrevistaRecebimento || '',
  dataPrevistaRecebimento: data.dataPrevistaRecebimento || '',
  bancoId: data.bancoId || '',
  bancoNome: data.bancoNome || '',
  pedidoId: data.pedidoId || '',
  osId: data.osId || '',
  paymentIndex: data.paymentIndex,
  boleto: data.boleto || undefined,
  faturadoEm: data.createdAt?.toDate ? getDateInputInTimeZone(data.createdAt.toDate()) : '',
} as TituloBoleto);

/** Bancos ativos da empresa preparados para boleto (leitura unica). */
export const carregarBancosComBoleto = async (tenantId: string): Promise<BancoBoleto[]> => {
  const snap = await getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<BancoBoleto, 'id'>) }))
    .filter((b) => b.boleto?.ativo);
};

/** O banco do titulo, se ele emite boleto; senao o primeiro banco que emite. */
export const bancoDoBoleto = (titulo: Pick<TituloBoleto, 'bancoId'>, bancosComBoleto: BancoBoleto[]): BancoBoleto | undefined => (
  bancosComBoleto.find((b) => b.id === titulo.bancoId) || bancosComBoleto[0]
);

/** Confere o convenio do banco e a data de vencimento do titulo. Devolve o banco (ja' validado)
 *  ou lanca erro em portugues -- usado antes de emitir, tanto sozinho quanto em lote. */
export const validarTituloParaEmissao = (titulo: TituloBoleto, bancosComBoleto: BancoBoleto[]): BancoBoleto => {
  const banco = bancoDoBoleto(titulo, bancosComBoleto);
  if (!banco) {
    throw new Error('Nenhum banco preparado para boleto. Abra Cadastros Auxiliares → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco".');
  }
  const erroConvenio = erroDoConvenioBoleto({
    cooperativa: banco.agencia,
    conta: banco.conta,
    contaDv: banco.boleto?.contaDv,
  });
  if (erroConvenio) throw new Error(erroConvenio);
  if (!(titulo.dataVencimento || titulo.dataPrevistaRecebimento)) {
    throw new Error(`O título "${titulo.descricao}" está sem data de vencimento. Ajuste o título antes de emitir o boleto.`);
  }
  return banco;
};

/** Reserva o nosso numero e grava o boleto no titulo, numa transacao so'. Nao confirma nada com o
 *  usuario nem abre PDF -- isso fica por conta de quem chama. */
export const emitirUmTitulo = async (a: { tenantId: string; uid: string; titulo: TituloBoleto; banco: BancoBoleto }): Promise<BoletoDetails> => {
  const { tenantId, uid, titulo, banco } = a;
  const vencimento = titulo.dataVencimento || titulo.dataPrevistaRecebimento;
  const chaveSequencia = `boleto_nosso_numero_${banco.id}`;
  const piso = Number(banco.boleto?.proximoNossoNumero || 0);
  let dadosGerados: BoletoDetails | null = null;

  await runTransaction(db, async (transaction) => {
    const tituloRef = doc(db, 'transacoes', titulo.id);
    const tituloSnap = await transaction.get(tituloRef);
    if (!tituloSnap.exists()) throw new Error('Título não encontrado. Atualize a página.');
    if (tituloSnap.data().boleto) throw new Error('Este título já tem boleto emitido.');

    // `piso - 1` porque reserveTenantSequence devolve o PROXIMO valor:
    // com piso 1203 o primeiro emitido tem que sair 1203, nao 1204.
    const nossoNumero = await reserveTenantSequence(
      transaction, db, tenantId, chaveSequencia, Math.max(0, piso - 1),
    );

    const codigoBarras = codigoBarrasSicoob({
      dados: {
        cooperativa: String(banco.agencia || ''),
        conta: String(banco.conta || ''),
        contaDv: banco.boleto?.contaDv || '0',
        ...(banco.boleto?.codigoCliente ? { codigoCliente: banco.boleto.codigoCliente } : {}),
        modalidade: '01',
        nossoNumero,
        parcela: parcelaDoBoletoSicoob(titulo),
      },
      vencimento: vencimento!,
      valorCentavos: titulo.valorCentavos,
    });

    dadosGerados = {
      nossoNumero: nossoNumeroSicoobComDv(nossoNumero, {
        cooperativa: String(banco.agencia || ''),
        conta: String(banco.conta || ''),
        contaDv: banco.boleto?.contaDv || '0',
      }),
      linhaDigitavel: linhaDigitavelDoCodigoBarras(codigoBarras),
      codigoBarras,
      vencimento: vencimento!,
      dataEmissao: getDateInputInTimeZone(),
      status: 'emitido',
    };

    transaction.update(tituloRef, {
      boleto: dadosGerados,
      bancoId: banco.id,
      bancoNome: banco.nome,
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(uid, serverTimestamp(), 'Boleto emitido'),
    });
  });

  return dadosGerados!;
};

/**
 * Recalcula codigo de barras e linha digitavel a partir do que e' verdade no cadastro (nosso numero,
 * vencimento, valor, conta do banco) em vez de confiar no que ficou gravado no titulo: assim um
 * boleto emitido antes de uma correcao do calculo sai certo na tela e no PDF.
 */
export const recalcularBoleto = (titulo: TituloBoleto, bancosComBoleto: BancoBoleto[]) => {
  const banco = bancoDoBoleto(titulo, bancosComBoleto);
  if (!banco || !titulo.boleto) return null;
  const nossoNumeroBase = Number(String(titulo.boleto.nossoNumero || '0').slice(0, -1)) || 0;
  const vencimento = titulo.boleto.vencimento || titulo.dataVencimento || '';
  const codigoBarras = codigoBarrasSicoob({
    dados: {
      cooperativa: String(banco.agencia || ''),
      conta: String(banco.conta || ''),
      contaDv: banco.boleto?.contaDv || '0',
      ...(banco.boleto?.codigoCliente ? { codigoCliente: banco.boleto.codigoCliente } : {}),
      modalidade: '01',
      nossoNumero: nossoNumeroBase,
      parcela: parcelaDoBoletoSicoob(titulo),
    },
    vencimento,
    valorCentavos: titulo.valorCentavos,
  });
  return { banco, codigoBarras, linhaDigitavel: linhaDigitavelDoCodigoBarras(codigoBarras), nossoNumeroBase, vencimento };
};

/**
 * Cadastro de quem paga o titulo: o cliente (o do titulo ou o do pedido) ou, em
 * conta a receber de fornecedor (19/10/2026), o fornecedor. So' da empresa.
 * Usado pelo PDF do boleto e pela remessa.
 */
export const cadastroDoPagador = async (tenantId: string, a: { clienteId?: string | null; fornecedorId?: string | null }): Promise<{ dados: Record<string, unknown> | null; deFornecedor: boolean }> => {
  if (a.clienteId) {
    const snap = await getDoc(doc(db, 'clientes', a.clienteId));
    if (snap.exists() && snap.data().tenantId === tenantId) return { dados: snap.data(), deFornecedor: false };
  }
  if (a.fornecedorId) {
    const snap = await getDoc(doc(db, 'fornecedores', a.fornecedorId));
    if (snap.exists() && snap.data().tenantId === tenantId) return { dados: snap.data(), deFornecedor: true };
    return { dados: null, deFornecedor: true };
  }
  return { dados: null, deFornecedor: false };
};

/**
 * Dados do PDF do boleto (recibo do pagador + ficha de compensacao) a partir do titulo. Lanca erro
 * (mensagem em portugues) em vez de mostrar popup, pra cada chamador decidir como reagir.
 */
export const dadosPdfDoBoleto = async (a: { tenantId: string; titulo: TituloBoleto; bancosComBoleto: BancoBoleto[] }): Promise<DadosPdfBoleto> => {
  const { tenantId, titulo, bancosComBoleto } = a;
  if (!tenantId) throw new Error('Sessão sem empresa identificada. Atualize a página.');
  const calc = recalcularBoleto(titulo, bancosComBoleto);
  if (!calc) throw new Error('Configure o convênio de boleto em Cadastros Auxiliares → Bancos.');
  const { banco } = calc;
  if (!banco.boleto?.cnpjCedente || !banco.boleto?.nomeCedente) {
    throw new Error('Preencha o CNPJ e o nome do cedente na Configuração de Boleto do banco antes de gerar o boleto.');
  }
  let cliente: any = null;
  let numeroPedido = '';
  let clienteId = titulo.clienteId || '';
  if (titulo.pedidoId) {
    const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', titulo.pedidoId));
    if (pedidoSnap.exists() && pedidoSnap.data().tenantId === tenantId) {
      numeroPedido = String(pedidoSnap.data().numeroPedido || '');
      clienteId = clienteId || String(pedidoSnap.data().clienteId || '');
    }
  }
  const pagadorCadastro = await cadastroDoPagador(tenantId, { clienteId, fornecedorId: titulo.fornecedorId });
  // Fornecedor grava o CNPJ em `cnpj`; o PDF le `documento`.
  if (pagadorCadastro.dados) cliente = { ...pagadorCadastro.dados, documento: pagadorDoCadastro(pagadorCadastro.dados).documento };
  const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
  const config: any = configSnap.exists() ? configSnap.data() : {};

  const documento = String(cliente?.documento || '').replace(/\D/g, '');
  const formatarDoc = (d: string) => (d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));
  const formatarCep = (c: string) => (c.length === 8 ? c.replace(/^(\d{5})(\d{3})$/, '$1-$2') : c);
  const cnpj = String(banco.boleto.cnpjCedente).replace(/\D/g, '');
  const codigoCliente = String(banco.boleto.codigoCliente || `${banco.conta || ''}${banco.boleto.contaDv || '0'}`).replace(/\D/g, '').padStart(7, '0');
  // Do jeito que o Sicoob imprime: "3049/131877-2" (sem espaco, hifen antes do ultimo digito do codigo).
  const codigoClienteExibicao = `${codigoCliente.slice(0, -1)}-${codigoCliente.slice(-1)}`;
  const instrucoes = mensagensDoBoleto(
    {
      cooperativa: String(banco.agencia || ''),
      conta: String(banco.conta || ''),
      cnpjCedente: cnpj,
      nomeCedente: banco.boleto.nomeCedente,
      instrucoes: banco.boleto.instrucoes,
      multaPercentual: banco.boleto.multaPercentual,
      jurosMensalPercentual: banco.boleto.jurosMensalPercentual,
      numeroRemessa: 0,
    },
    {
      nossoNumero: calc.nossoNumeroBase,
      numeroDocumento: numeroPedido || String(calc.nossoNumeroBase),
      referencia: numeroPedido || undefined,
      vencimento: calc.vencimento,
      valorCentavos: titulo.valorCentavos,
      sacado: { tipoDocumento: 'CPF', documento: '', nome: '' },
    },
  );
  const nome = String(cliente?.nome || titulo.clienteNome || titulo.fornecedorNome || 'Cliente').trim();
  const cepEmpresa = String(config.cep || '').replace(/\D/g, '');
  return {
    bancoNome: 'SICOOB',
    codigoBanco: '756-0',
    localPagamento: 'Pagável Preferenc. nas Cooperativas da Rede Sicoob',
    beneficiarioNome: banco.boleto.nomeCedente,
    beneficiarioCnpj: formatarDoc(cnpj),
    beneficiarioEndereco: [formatCompanyAddress(config), cepEmpresa ? `CEP: ${formatarCep(cepEmpresa)}` : ''].filter(Boolean).join(', '),
    agenciaCodigoBeneficiario: `${String(banco.agencia || '')}/${codigoClienteExibicao}`,
    carteira: '01',
    pagadorNome: nome,
    pagadorDocumento: formatarDoc(documento),
    pagadorRua: [cliente?.endereco, cliente?.numero].filter(Boolean).join(', '),
    pagadorBairro: cliente?.bairro || '',
    pagadorCep: cliente?.cep ? formatarCep(String(cliente.cep).replace(/\D/g, '')) : '',
    pagadorCidade: cliente?.cidade || '',
    pagadorUf: cliente?.estado || '',
    numeroDocumento: numeroPedido || String(calc.nossoNumeroBase),
    nossoNumero: formatarNossoNumeroSicoobExibicao(String(titulo.boleto?.nossoNumero || '')),
    vencimento: calc.vencimento,
    dataEmissao: titulo.boleto?.dataEmissao || getDateInputInTimeZone(),
    valorCentavos: titulo.valorCentavos,
    linhaDigitavel: calc.linhaDigitavel,
    codigoBarras: calc.codigoBarras,
    instrucoes,
    empresaHeader: {
      nome: String(config.nomeOficina || config.razaoSocial || config.nomeFantasia || banco.boleto.nomeCedente || '').trim(),
      endereco: formatCompanyAddress(config) || undefined,
      telefone: config.telefone || undefined,
    },
  };
};

export const nomePdfBoleto = (titulo: TituloBoleto) => nomeArquivoDocumento({
  tipo: 'BOLETO',
  numero: titulo.boleto?.nossoNumero ? formatarNossoNumeroSicoobExibicao(titulo.boleto.nossoNumero) : '',
  destinatario: titulo.clienteNome,
});

export const gerarPdfDoBoleto = async (a: { tenantId: string; titulo: TituloBoleto; bancosComBoleto: BancoBoleto[] }): Promise<{ blob: Blob; nome: string }> => (
  { blob: gerarPdfBoletos([await dadosPdfDoBoleto(a)]), nome: nomePdfBoleto(a.titulo) }
);

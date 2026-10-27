import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, FileText, History, Loader2, PenLine, Save, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, type DocumentSnapshot } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { NexusSwal, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { compactarXml } from '../../utils/xmlCompactoDomain';
import { fromCents, toCents } from '../../utils/financeDomain';
import { semUndefined } from '../../utils/entradaNfeDomain';
import {
  conferirParcelas,
  erroDoPagamentoAVista,
  parcelasIniciais,
  type DestinoDoPagamento,
  type ModoDePagamento,
} from '../../utils/pagamentoEntradaDomain';
import { camposDoTituloEmCheque, erroDosCheques, type ParcelaComCheque } from '../../utils/chequeEmitidoDomain';
import {
  NFSE_EM_BRANCO,
  calcularValorLiquido,
  conferirNfse,
  descricaoDoTituloDaNfse,
  issRetidoValor,
  lerNfseXml,
  servicoParaGravar,
  totalDasRetencoesFederais,
  type NfseEntrada,
  type RetencoesNfse,
} from '../../utils/nfseEntradaDomain';
import PagamentoCard, { type BancoParaEntrada } from '../../components/fiscal/entrada/PagamentoCard';
import CampoDecimal from '../../components/common/CampoDecimal';
import { campoInputStyle, campoLabelStyle, cartaoStyle, grupoStyle, moeda, tituloDoCartaoStyle } from '../../components/fiscal/entrada/estilos';

/*
 * ENTRADA DE NFS-e (servico tomado), 27/10/2026. Regras em nfseEntradaDomain.ts.
 * Importa o XML (padrao nacional ou ABRASF) ou digita a nota; gera a conta a
 * pagar do VALOR LIQUIDO ao prestador e grava a nota no Historico de Entradas
 * (colecao notas_fiscais_entrada, tipoDocumento 'nfse', sem itens).
 */

/** Categorias oferecidas quando a empresa nao tem plano de contas proprio. */
const CATEGORIAS_DE_SERVICO = ['SERVIÇOS DE TERCEIROS', 'MANUTENÇÃO', 'HONORÁRIOS PROFISSIONAIS', 'OUTROS'];

type Origem = 'xml' | 'manual';

const ROTULO_RETENCAO: Record<keyof RetencoesNfse, string> = {
  irrf: 'IR retido',
  pis: 'PIS retido',
  cofins: 'COFINS retido',
  csll: 'CSLL retida',
  inss: 'INSS retido',
  outras: 'Outras retenções',
};

const EntradaNFSe: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { tenantId, currentUser } = useAuth();
  const entradaArquivo = useRef<HTMLInputElement>(null);

  const [origem, setOrigem] = useState<Origem | null>(null);
  const [nota, setNota] = useState<NfseEntrada>(NFSE_EM_BRANCO);
  const [xmlTexto, setXmlTexto] = useState('');
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [arrastando, setArrastando] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [avisosAceitos, setAvisosAceitos] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [cnpjEmpresa, setCnpjEmpresa] = useState('');
  const [categoriasDaEmpresa, setCategoriasDaEmpresa] = useState<string[]>([]);
  const [bancos, setBancos] = useState<BancoParaEntrada[]>([]);
  const [fornecedor, setFornecedor] = useState<{ id: string; nome: string } | null>(null);
  const [procurandoFornecedor, setProcurandoFornecedor] = useState(false);

  // Pagamento: o mesmo cartao da entrada de NF-e.
  const [modoPagamento, setModoPagamento] = useState<ModoDePagamento>('prazo');
  const [parcelas, setParcelas] = useState<ParcelaComCheque[]>([]);
  const [parcelasAceitas, setParcelasAceitas] = useState(false);
  const [formaPrevista, setFormaPrevista] = useState('Boleto');
  const [categoria, setCategoria] = useState(CATEGORIAS_DE_SERVICO[0]);
  const [destinoPagamento, setDestinoPagamento] = useState<DestinoDoPagamento>('caixa');
  const [bancoId, setBancoId] = useState('');

  const modoPagamentoEfetivo: ModoDePagamento = formaPrevista === 'Cheque' ? 'prazo' : modoPagamento;
  const opcoesDeCategoria = categoriasDaEmpresa.length > 0 ? categoriasDaEmpresa : CATEGORIAS_DE_SERVICO;

  useEffect(() => {
    if (!tenantId) return;
    const carregar = async () => {
      try {
        const config = (await getDoc(doc(db, 'configuracoes', tenantId))).data() || {};
        setCnpjEmpresa(String(config.cnpj || ''));
        const plano = config.planoContasDespesas;
        const lista: string[] = Array.isArray(plano) ? plano : (typeof plano === 'string' ? plano.split(String.fromCharCode(10)) : []);
        const limpas = lista.map((c) => String(c).trim()).filter(Boolean);
        // Plano da empresa sem categoria de servico: oferece "SERVICOS DE TERCEIROS"
        // junto (senao a nota caia na primeira do plano, ex. "Aluguel").
        const deServico = limpas.find((c) => /servi|terceir|manuten|honor/i.test(c));
        const opcoes = limpas.length > 0 && !deServico ? [CATEGORIAS_DE_SERVICO[0], ...limpas] : limpas;
        setCategoriasDaEmpresa(opcoes);
        if (opcoes.length > 0) setCategoria(deServico ?? opcoes[0]);
      } catch (err) {
        console.error('Erro ao carregar configurações:', err);
      }
      try {
        const snap = await getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)));
        setBancos(snap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || d.data().banco || 'Banco') })));
      } catch (err) {
        console.error('Erro ao carregar bancos:', err);
      }
    };
    void carregar();
  }, [tenantId]);

  // Fornecedor pelo CPF/CNPJ do prestador. Sem cadastro, ele e' criado ao lancar.
  const documentoPrestador = nota.prestadorDocumento.replace(/\D/g, '');
  useEffect(() => {
    if (!tenantId || (documentoPrestador.length !== 11 && documentoPrestador.length !== 14)) {
      setFornecedor(null);
      return undefined;
    }
    let ativo = true;
    setProcurandoFornecedor(true);
    getDocs(query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId), where('cnpj', '==', documentoPrestador)))
      .then((snap) => {
        if (!ativo) return;
        const achado = snap.docs[0];
        setFornecedor(achado ? { id: achado.id, nome: String(achado.data().nome || '') } : null);
      })
      .catch((err) => { console.error('Erro ao procurar o fornecedor:', err); if (ativo) setFornecedor(null); })
      .finally(() => { if (ativo) setProcurandoFornecedor(false); });
    return () => { ativo = false; };
  }, [tenantId, documentoPrestador]);

  const comecar = (novaOrigem: Origem, novaNota: NfseEntrada, xml = '', arquivo = '') => {
    setOrigem(novaOrigem);
    setNota(novaNota);
    setXmlTexto(xml);
    setNomeArquivo(arquivo);
    setObservacao('');
    setAvisosAceitos(false);
    setModoPagamento('prazo');
    setFormaPrevista('Boleto');
    setDestinoPagamento('caixa');
    setBancoId('');
    setParcelasAceitas(false);
    const emissao = novaNota.dataEmissao || getDateInputInTimeZone();
    setParcelas(novaNota.valorLiquido > 0 ? parcelasIniciais([], emissao, novaNota.valorLiquido) : []);
  };

  const recomecar = () => {
    setOrigem(null);
    setNota(NFSE_EM_BRANCO);
    setXmlTexto('');
    setNomeArquivo('');
    setParcelas([]);
    if (entradaArquivo.current) entradaArquivo.current.value = '';
  };

  const lerArquivo = (arquivo: File) => {
    if (!arquivo.name.toLowerCase().endsWith('.xml')) {
      showError('Arquivo inválido', 'Envie o arquivo .xml da NFS-e. Se o prestador mandou só o PDF, use "Digitar a nota".');
      return;
    }
    const leitor = new FileReader();
    leitor.onload = (e) => {
      const texto = String(e.target?.result ?? '');
      const lido = lerNfseXml(texto);
      if (!lido.ok) {
        showError('Não foi possível ler a NFS-e', lido.erro);
        if (entradaArquivo.current) entradaArquivo.current.value = '';
        return;
      }
      comecar('xml', lido.nota, texto, arquivo.name);
    };
    leitor.readAsText(arquivo);
  };

  /** Muda um campo; valor que mexe no liquido recalcula o liquido e as parcelas. */
  const alterar = (parcial: Partial<NfseEntrada>) => {
    setNota((anterior) => {
      const proxima = { ...anterior, ...parcial };
      const mexeNoLiquido = ['valorServicos', 'descontoIncondicionado', 'valorIss', 'issRetido', 'retencoes'].some((k) => k in parcial);
      if (mexeNoLiquido) {
        proxima.valorLiquido = Math.max(0, calcularValorLiquido(proxima));
      }
      return proxima;
    });
  };
  const alterarRetencao = (campo: keyof RetencoesNfse, valor: number) => alterar({ retencoes: { ...nota.retencoes, [campo]: valor } });
  /** Base ou aliquota mudou: o ISS acompanha (a pessoa ainda pode corrigir o valor). */
  const alterarIss = (parcial: Partial<Pick<NfseEntrada, 'baseIss' | 'aliquotaIss'>>) => {
    const base = parcial.baseIss ?? nota.baseIss;
    const aliquota = parcial.aliquotaIss ?? nota.aliquotaIss;
    alterar({ ...parcial, valorIss: fromCents(Math.round(toCents(base) * aliquota / 100)) });
  };

  // O liquido mudou: parcela unica acompanha; mais de uma, a pessoa confere.
  const liquidoAnterior = useRef(0);
  useEffect(() => {
    if (!origem || nota.valorLiquido === liquidoAnterior.current) return;
    liquidoAnterior.current = nota.valorLiquido;
    setParcelas((atuais) => {
      const emissao = nota.dataEmissao || getDateInputInTimeZone();
      if (atuais.length === 0) return nota.valorLiquido > 0 ? parcelasIniciais([], emissao, nota.valorLiquido) : [];
      if (atuais.length === 1) return [{ ...atuais[0], valor: nota.valorLiquido }];
      return atuais;
    });
    setParcelasAceitas(false);
  }, [origem, nota.valorLiquido, nota.dataEmissao]);

  const conferencia = useMemo(() => conferirNfse(nota, cnpjEmpresa), [nota, cnpjEmpresa]);
  const retidoFederal = totalDasRetencoesFederais(nota.retencoes);
  const retidoIss = issRetidoValor(nota);

  /** Ja lancada? Pela chave (nacional) ou pelo prestador + numero entre as NFS-e. Excluida nao conta. */
  const notaJaLancada = async (): Promise<string | null> => {
    if (!tenantId) return null;
    const colecao = collection(db, 'notas_fiscais_entrada');
    if (nota.chaveAcesso) {
      const porChave = await getDocs(query(colecao, where('tenantId', '==', tenantId), where('chaveAcesso', '==', nota.chaveAcesso)));
      const ativa = porChave.docs.find((d) => d.data().status !== 'excluida');
      if (ativa) return String(ativa.data().numeroNF || nota.numero);
    }
    if (fornecedor) {
      const porNumero = await getDocs(query(colecao, where('tenantId', '==', tenantId), where('fornecedorId', '==', fornecedor.id), where('numeroNF', '==', nota.numero.trim())));
      const ativa = porNumero.docs.find((d) => d.data().tipoDocumento === 'nfse' && d.data().status !== 'excluida');
      if (ativa) return String(ativa.data().numeroNF || nota.numero);
    }
    return null;
  };

  const lancar = async () => {
    if (!tenantId || !currentUser || !origem) return;
    if (conferencia.erros.length > 0) {
      showError('Confira a NFS-e', conferencia.erros.join(' '));
      return;
    }
    if (conferencia.avisos.length > 0 && !avisosAceitos) {
      showError('Confira antes de lançar', `${conferencia.avisos.join(' ')} Se estiver certo, marque "Conferi e quero lançar assim".`);
      return;
    }
    const totalDevido = nota.valorLiquido;
    if (modoPagamentoEfetivo === 'prazo') {
      const conf = conferirParcelas(parcelas, totalDevido);
      if (conf.erro) { showError('Confira as parcelas', conf.erro); return; }
      if (formaPrevista === 'Cheque') {
        const erroCheques = erroDosCheques(parcelas, bancos);
        if (erroCheques) { showError('Confira os cheques', erroCheques); return; }
      }
      if (conf.aviso && !parcelasAceitas) {
        showError('As parcelas não fecham com o valor líquido', `${conf.aviso} Ajuste os valores ou marque "Conferi as parcelas e quero lançar assim".`);
        return;
      }
    } else {
      const erroAVista = erroDoPagamentoAVista({ destino: destinoPagamento, bancoId });
      if (erroAVista) { showError('Pagamento à vista', erroAVista); return; }
    }

    setSalvando(true);
    NexusSwal.fire({ title: 'Lançando a NFS-e...', text: 'Conferindo se a nota já foi lançada e lançando a conta a pagar...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const jaLancada = await notaJaLancada();
      if (jaLancada) {
        Swal.close();
        showError('NFS-e já lançada', `A NFS-e ${jaLancada} de ${nota.prestadorNome} já está no Histórico de Entradas. Lançar de novo duplicaria a conta a pagar. Se o lançamento anterior estava errado, exclua-o no Histórico e lance esta nota outra vez.`);
        return;
      }

      const hoje = getDateInputInTimeZone();
      const nomePrestador = (fornecedor?.nome || nota.prestadorNome).toUpperCase().trim();
      const fornecedorRef = fornecedor ? doc(db, 'fornecedores', fornecedor.id) : doc(collection(db, 'fornecedores'));
      const titulosRefs = modoPagamentoEfetivo === 'prazo' ? parcelas.map(() => doc(collection(db, 'transacoes'))) : [doc(collection(db, 'transacoes'))];
      const notaRef = doc(collection(db, 'notas_fiscais_entrada'));
      const bancoRef = modoPagamentoEfetivo === 'avista' && destinoPagamento === 'banco' ? doc(db, 'bancos', bancoId) : null;
      const bancoNome = bancos.find((b) => b.id === bancoId)?.nome || '';
      const xmlCompacto = xmlTexto ? await compactarXml(xmlTexto) : null;
      const numero = nota.numero.trim();
      const categoriaFinal = categoria.toUpperCase().trim();
      const comum = {
        fornecedorId: fornecedorRef.id,
        fornecedorNome: nomePrestador,
        notaFiscalEntradaNumero: numero,
        notaFiscalEntradaTipo: 'nfse',
        tenantId,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      };

      await runTransaction(db, async (transaction) => {
        // Leituras antes das escritas (regra do Firestore).
        let bancoSnap: DocumentSnapshot | null = null;
        if (bancoRef) {
          bancoSnap = await transaction.get(bancoRef);
          if (!bancoSnap.exists()) throw new Error('O banco escolhido não existe mais. Escolha outro banco ou marque "Caixa".');
        }

        if (!fornecedor) {
          transaction.set(fornecedorRef, {
            nome: nomePrestador,
            cnpj: documentoPrestador,
            telefone: '',
            email: '',
            tenantId,
            createdAt: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        }

        if (modoPagamentoEfetivo === 'prazo') {
          parcelas.forEach((parcela, indice) => {
            transaction.set(titulosRefs[indice], {
              descricao: descricaoDoTituloDaNfse(numero, nomePrestador, { indice, total: parcelas.length }),
              data: parcela.vencimento,
              valor: parcela.valor,
              valorCentavos: toCents(parcela.valor),
              categoria: categoriaFinal,
              status: 'Pendente',
              tipo: 'saida',
              formaPagamentoPrevista: formaPrevista,
              ...(formaPrevista === 'Cheque' ? camposDoTituloEmCheque(parcela, bancos) : {}),
              ...(parcelas.length > 1 ? { parcela: indice + 1, totalParcelas: parcelas.length } : {}),
              ...comum,
            });
          });
        } else {
          const valorCentavos = toCents(totalDevido);
          transaction.set(titulosRefs[0], {
            descricao: descricaoDoTituloDaNfse(numero, nomePrestador),
            data: hoje,
            dataPagamento: hoje,
            valor: fromCents(valorCentavos),
            valorCentavos,
            categoria: categoriaFinal,
            status: 'Paga',
            tipo: 'saida',
            formaPagamento: destinoPagamento === 'banco' ? (formaPrevista === 'Dinheiro' ? 'Transferência' : formaPrevista) : 'Dinheiro',
            naturezaFinanceira: destinoPagamento === 'banco' ? 'bancario_digital' : 'caixa_fisico',
            movimentaCaixaFisico: destinoPagamento === 'caixa',
            ...(destinoPagamento === 'banco' ? { bancoId, bancoNome } : {}),
            ...comum,
          });
          if (bancoRef && bancoSnap) {
            transaction.update(bancoRef, {
              saldoCentavos: Number(bancoSnap.data()?.saldoCentavos || 0) - valorCentavos,
              updatedAt: serverTimestamp(),
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Entrada da NFS-e ${numero}`),
            });
          }
        }

        transaction.set(notaRef, semUndefined({
          tipoDocumento: 'nfse',
          numeroNF: numero,
          dataEmissao: nota.dataEmissao,
          // Valor da nota = valor dos servicos; o que se paga ao prestador e' servico.valorLiquido.
          valorTotal: nota.valorServicos,
          fornecedorId: fornecedorRef.id,
          fornecedorNome: nomePrestador,
          fornecedorCnpj: documentoPrestador,
          itens: [],
          titulosPagarIds: titulosRefs.map((r) => r.id),
          ...(nota.chaveAcesso ? { chaveAcesso: nota.chaveAcesso } : {}),
          modelo: 'NFS-e',
          dataEntrada: hoje,
          ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
          servico: servicoParaGravar(nota),
          pagamento: {
            modo: modoPagamentoEfetivo,
            categoria: categoriaFinal,
            forma: formaPrevista,
            parcelas: modoPagamentoEfetivo === 'prazo' ? parcelas : [],
            ...(modoPagamentoEfetivo === 'avista' ? { destino: destinoPagamento, ...(destinoPagamento === 'banco' ? { bancoId, bancoNome } : {}) } : {}),
          },
          ...(xmlCompacto ? { xmlGzipBase64: xmlCompacto } : {}),
          status: 'ativa',
          tenantId,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        }));
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        await createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || '',
          modulo: 'fiscal',
          acao: 'criacao',
          descricao: `Entrada da NFS-e ${numero} (${nomePrestador}): serviços R$ ${nota.valorServicos.toFixed(2)}, retenções R$ ${(retidoIss + retidoFederal).toFixed(2)}, líquido R$ ${totalDevido.toFixed(2)} em ${titulosRefs.length} título(s)${modoPagamentoEfetivo === 'avista' ? ', paga à vista' : ''}.`,
          status: 'sucesso',
        });
      } catch {
        // Auditoria nao impede a entrada.
      }

      Swal.close();
      recomecar();
      const escolha = await NexusSwal.fire({
        icon: 'success',
        title: `NFS-e ${numero} lançada`,
        html: [
          `• ${titulosRefs.length} título(s) em Contas a Pagar: ${moeda(totalDevido)}${modoPagamentoEfetivo === 'avista' ? ' (paga à vista)' : ''}`,
          ...(retidoIss + retidoFederal > 0 ? [`• Retenções a recolher pela empresa: ${moeda(retidoIss + retidoFederal)}`] : []),
          ...(!fornecedor ? [`• Fornecedor cadastrado: ${nomePrestador}`] : []),
        ].join('<br/>'),
        showDenyButton: true,
        confirmButtonText: 'Lançar outra NFS-e',
        denyButtonText: 'Ver histórico',
        denyButtonColor: '#3f3f46',
      });
      if (escolha.isDenied) openTab('/fiscal/entrada-nfe/historico');
    } catch (err) {
      console.error(err);
      Swal.close();
      showError('Não foi possível lançar a NFS-e', (err as Error).message || 'Nada foi gravado. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const doXml = origem === 'xml';
  const campo = (rotulo: string, filho: React.ReactNode, dica?: string) => (
    <div className="input-group">
      <label style={campoLabelStyle} title={dica}>{rotulo}</label>
      {filho}
    </div>
  );
  const dinheiro = (valor: number, onValor: (n: number) => void, titulo?: string) => (
    <CampoDecimal valor={valor} onValor={onValor} casasMinimas={2} style={campoInputStyle} title={titulo} />
  );

  return (
    <div className="os-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/fiscal/entrada-nfe')} title="Voltar para Entrada de XML">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', margin: 0 }}>
              <FileText size={28} color="var(--accent-purple)" />
              Entrada de NFS-e (serviço tomado)
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              Nota fiscal de serviço recebida: registra a nota para o contador e lança o valor líquido em Contas a Pagar.
            </p>
          </div>
        </div>
        <button type="button" className="btn-secondary" onClick={() => openTab('/fiscal/entrada-nfe/historico')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <History size={16} /> Ver Histórico
        </button>
      </div>

      {!origem ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          <div
            className="card"
            onDragEnter={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={(e) => { e.preventDefault(); setArrastando(false); }}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files?.[0]; if (f) lerArquivo(f); }}
            onClick={() => entradaArquivo.current?.click()}
            style={{ ...cartaoStyle, cursor: 'pointer', textAlign: 'center', padding: '40px 24px', borderStyle: 'dashed', borderColor: arrastando ? 'var(--accent-purple)' : 'var(--border-color)' }}
          >
            <Upload size={36} color="var(--accent-purple)" />
            <h3 style={{ ...tituloDoCartaoStyle, margin: '12px 0 6px' }}>Importar o XML da NFS-e</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Arraste o arquivo .xml aqui ou clique para escolher. Lê a NFS-e do padrão nacional (nfse.gov.br) e o das prefeituras (ABRASF).
            </p>
            <input ref={entradaArquivo} type="file" accept=".xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f); }} />
          </div>
          <div className="card" style={{ ...cartaoStyle, textAlign: 'center', padding: '40px 24px' }}>
            <PenLine size={36} color="var(--accent-purple)" />
            <h3 style={{ ...tituloDoCartaoStyle, margin: '12px 0 6px' }}>Digitar a nota</h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              O prestador mandou só o PDF? Digite os dados que estão na nota.
            </p>
            <button type="button" className="btn-primary" onClick={() => comecar('manual', { ...NFSE_EM_BRANCO, dataEmissao: getDateInputInTimeZone() })}>
              Digitar a NFS-e
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={cartaoStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <h3 style={tituloDoCartaoStyle}>
                {doXml ? `NFS-e importada do XML${nomeArquivo ? ` (${nomeArquivo})` : ''}` : 'NFS-e digitada'}
                {doXml && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>{nota.padrao === 'nacional' ? 'padrão nacional' : 'padrão ABRASF'}</span>}
              </h3>
              <button type="button" className="btn-secondary" onClick={recomecar} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={15} /> Descartar
              </button>
            </div>

            <div style={{ ...grupoStyle, marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                {campo('CNPJ/CPF do prestador *', <input style={campoInputStyle} inputMode="numeric" value={nota.prestadorDocumento} onChange={(e) => alterar({ prestadorDocumento: e.target.value.replace(/\D/g, '').slice(0, 14) })} />)}
                {campo('Prestador (razão social) *', <input style={campoInputStyle} value={nota.prestadorNome} onChange={(e) => alterar({ prestadorNome: e.target.value })} />)}
                {campo('Inscrição municipal', <input style={campoInputStyle} value={nota.prestadorInscricaoMunicipal} onChange={(e) => alterar({ prestadorInscricaoMunicipal: e.target.value })} />)}
              </div>
              <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {procurandoFornecedor ? <><Loader2 size={13} className="spin-icon" /> Procurando o fornecedor...</>
                  : fornecedor ? <><CheckCircle size={13} color="#22c55e" /> Fornecedor cadastrado: <strong>{fornecedor.nome}</strong></>
                    : (documentoPrestador.length === 11 || documentoPrestador.length === 14)
                      ? <>Fornecedor ainda não cadastrado: será cadastrado com este CNPJ/CPF e nome ao lançar.</>
                      : null}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' }}>
              {campo('Número da NFS-e *', <input style={campoInputStyle} value={nota.numero} onChange={(e) => alterar({ numero: e.target.value.trim() })} />)}
              {campo('Data de emissão *', <input type="date" style={campoInputStyle} value={nota.dataEmissao} onChange={(e) => alterar({ dataEmissao: e.target.value })} />)}
              {campo('Competência', <input type="date" style={campoInputStyle} value={nota.competencia} onChange={(e) => alterar({ competencia: e.target.value })} />, 'Mês em que o serviço foi prestado')}
              {campo('Código de verificação', <input style={campoInputStyle} value={nota.codigoVerificacao} onChange={(e) => alterar({ codigoVerificacao: e.target.value })} />)}
              {campo('Código do serviço', <input style={campoInputStyle} value={nota.codigoServico} onChange={(e) => alterar({ codigoServico: e.target.value })} />, 'Item da lista da LC 116 ou código de tributação nacional')}
              {campo('Município da prestação', <input style={campoInputStyle} value={nota.municipioPrestacao} onChange={(e) => alterar({ municipioPrestacao: e.target.value })} />)}
            </div>
            {campo('Descrição do serviço', <textarea style={{ ...campoInputStyle, minHeight: '60px', resize: 'vertical' }} value={nota.descricaoServico} onChange={(e) => alterar({ descricaoServico: e.target.value })} />)}
            {nota.chaveAcesso && (
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>Chave de acesso: {nota.chaveAcesso}</p>
            )}
          </div>

          <div className="card" style={cartaoStyle}>
            <h3 style={{ ...tituloDoCartaoStyle, marginBottom: '14px' }}>Valores, ISS e retenções</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
              {campo('Valor dos serviços *', dinheiro(nota.valorServicos, (v) => alterar({ valorServicos: v })))}
              {campo('Desconto incondicionado', dinheiro(nota.descontoIncondicionado, (v) => alterar({ descontoIncondicionado: v })))}
              {campo('Deduções', dinheiro(nota.deducoes, (v) => alterar({ deducoes: v })), 'Deduções da base do ISS (materiais, subempreitada...)')}
              {campo('Base de cálculo do ISS', dinheiro(nota.baseIss, (v) => alterarIss({ baseIss: v })))}
              {campo('Alíquota do ISS (%)', <CampoDecimal valor={nota.aliquotaIss} onValor={(v) => alterarIss({ aliquotaIss: v })} style={campoInputStyle} />)}
              {campo('Valor do ISS', dinheiro(nota.valorIss, (v) => alterar({ valorIss: v })))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' }}>
              <input type="checkbox" checked={nota.issRetido} onChange={(e) => alterar({ issRetido: e.target.checked })} />
              ISS retido pela empresa (a empresa recolhe o ISS para a prefeitura, não paga ao prestador)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              {(Object.keys(ROTULO_RETENCAO) as Array<keyof RetencoesNfse>)
                .filter((k) => k !== 'outras' || nota.retencoes.outras > 0)
                .map((k) => <React.Fragment key={k}>{campo(ROTULO_RETENCAO[k], dinheiro(nota.retencoes[k], (v) => alterarRetencao(k, v)))}</React.Fragment>)}
            </div>

            <div style={{ ...grupoStyle, marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', fontSize: '13px' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Serviços</span><br /><strong>{moeda(nota.valorServicos)}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>ISS retido</span><br /><strong>{moeda(retidoIss)}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Retenções federais</span><br /><strong>{moeda(retidoFederal)}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>A pagar ao prestador</span><br /><strong style={{ fontSize: '16px', color: 'var(--accent-purple)' }}>{moeda(nota.valorLiquido)}</strong></div>
            </div>
            {retidoIss + retidoFederal > 0 && (
              <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                As retenções ({moeda(retidoIss + retidoFederal)}) a empresa recolhe por guia própria (ISS para a prefeitura; IR, PIS, COFINS, CSLL e INSS por DARF/DCTFWeb). Elas ficam registradas na nota para o contador.
              </p>
            )}
          </div>

          {conferencia.avisos.length > 0 && (
            <div style={{ padding: '14px 18px', borderRadius: '12px', border: '1px solid rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.08)', fontSize: '13px', lineHeight: 1.5 }}>
              {conferencia.avisos.map((a) => <div key={a}>⚠ {a}</div>)}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={avisosAceitos} onChange={(e) => setAvisosAceitos(e.target.checked)} /> Conferi e quero lançar assim
              </label>
            </div>
          )}

          <PagamentoCard
            modo={modoPagamento}
            onModo={(modo) => { setModoPagamento(modo); setParcelasAceitas(false); }}
            parcelas={parcelas}
            onParcelas={setParcelas}
            totalDaNota={nota.valorLiquido}
            dataEmissao={nota.dataEmissao || getDateInputInTimeZone()}
            formaPrevista={formaPrevista}
            onFormaPrevista={setFormaPrevista}
            categoria={categoria}
            onCategoria={setCategoria}
            categoriasDaEmpresa={opcoesDeCategoria}
            destino={destinoPagamento}
            onDestino={setDestinoPagamento}
            bancoId={bancoId}
            onBancoId={setBancoId}
            bancos={bancos}
            parcelasAceitas={parcelasAceitas}
            onAceitarParcelas={setParcelasAceitas}
            formaNoXml=""
          />

          <div className="card" style={cartaoStyle}>
            {campo('Observação', <textarea style={{ ...campoInputStyle, minHeight: '50px', resize: 'vertical' }} value={observacao} onChange={(e) => setObservacao(e.target.value)} />)}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" className="btn-secondary" onClick={recomecar} disabled={salvando}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={() => void lancar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {salvando ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />} Lançar NFS-e
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntradaNFSe;

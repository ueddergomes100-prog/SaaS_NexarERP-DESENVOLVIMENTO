import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { Barcode, Download, FileUp, Loader2, Receipt, Search } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, NexusSwal } from '../../utils/alerts';
import { hasModuleAccess } from '../../utils/roles';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { fromCents, toCents, settledFinancialNatureForPayment, type BoletoDetails } from '../../utils/financeDomain';
import { reserveTenantSequence } from '../../utils/firestoreAtomic';
import { codigoBarrasSicoob, nossoNumeroSicoobComDv } from '../../utils/boletoCnabDomain';
import { formatarLinhaDigitavel, linhaDigitavelDoCodigoBarras } from '../../utils/boletoDomain';
import {
  erroDoConvenioBoleto,
  lerArquivoRetornoSicoob,
  ROTULO_STATUS_BOLETO,
  statusBoletoEfetivo,
  type StatusBoletoEfetivo,
} from '../../utils/boletoEmissaoDomain';
import { montarRemessaSicoob, nomeArquivoRemessaSicoob, type TituloRemessaSicoob } from '../../utils/boletoRemessaSicoobDomain';
import '../OS/OS.css';

/**
 * FINANCEIRO > BOLETOS (2026-09-22).
 *
 * Emissao, arquivo de remessa e leitura do retorno dos boletos Sicoob.
 * O calculo esta todo em boletoDomain/boletoCnabDomain/boletoRemessaSicoob
 * (puro e testado); aqui e' so' tela + escrita no Firestore.
 *
 * O titulo E' a transacao de contas a receber -- boleto nao e' colecao
 * nova, e' um campo `boleto` dentro do proprio titulo, do mesmo jeito que
 * cheque e cartao ja funcionam.
 */

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface BancoBoleto {
  id: string;
  nome: string;
  agencia?: string;
  conta?: string;
  boleto?: {
    ativo?: boolean;
    contaDv?: string;
    cnpjCedente?: string;
    nomeCedente?: string;
    instrucoes?: string;
    multaPercentual?: number;
    jurosMensalPercentual?: number;
    proximoNossoNumero?: number;
    proximaRemessa?: number;
  };
}

interface TituloBoleto {
  id: string;
  descricao: string;
  clienteId?: string | null;
  clienteNome?: string;
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
}

type Aba = 'aguardando' | 'emitidos' | 'remessa' | 'pagos' | 'vencidos';

const ROTULO_ABA: Record<Aba, string> = {
  aguardando: 'Aguardando emissão',
  emitidos: 'Emitidos',
  remessa: 'Em remessa',
  pagos: 'Pagos',
  vencidos: 'Vencidos',
};

const Boletos: React.FC = () => {
  const { tenantId, currentUser, userRole, isOwner, userPermissions } = useAuth();
  const podeAcessar = hasModuleAccess({
    role: userRole,
    isOwner,
    permissions: userPermissions,
    requiredPermission: 'financeiro.boletos',
  });

  const [titulos, setTitulos] = useState<TituloBoleto[]>([]);
  const [bancos, setBancos] = useState<BancoBoleto[]>([]);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<Aba>('aguardando');
  const [busca, setBusca] = useState('');
  const [processando, setProcessando] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const inputRetornoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tenantId || !podeAcessar) { setLoading(false); return undefined; }
    const q = query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('formaPagamento', '==', 'Boleto'),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const dados = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          descricao: data.descricao || '',
          clienteId: data.clienteId ?? null,
          clienteNome: data.clienteNome || '',
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
        } as TituloBoleto;
      });
      setTitulos(dados);
      setLoading(false);
    }, (erro) => {
      console.error('Erro ao carregar boletos:', erro);
      showError('Erro', 'Não foi possível carregar os boletos. Confira sua conexão e suas permissões.');
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantId, podeAcessar]);

  useEffect(() => {
    if (!tenantId || !podeAcessar) return undefined;
    const q = query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true));
    const unsubscribe = onSnapshot(q, (snap) => {
      setBancos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as BancoBoleto[]);
    });
    return () => unsubscribe();
  }, [tenantId, podeAcessar]);

  const bancosComBoleto = useMemo(() => bancos.filter((b) => b.boleto?.ativo), [bancos]);

  const porAba = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtraBusca = (t: TituloBoleto) => !termo
      || (t.clienteNome || '').toLowerCase().includes(termo)
      || (t.descricao || '').toLowerCase().includes(termo)
      || (t.boleto?.nossoNumero || '').includes(termo);

    const visiveis = titulos.filter((t) => t.status !== 'Cancelada').filter(filtraBusca);
    const efetivo = (t: TituloBoleto): StatusBoletoEfetivo | 'aguardando' => (
      t.boleto ? statusBoletoEfetivo(t.boleto) : 'aguardando'
    );

    return {
      aguardando: visiveis.filter((t) => !t.boleto),
      emitidos: visiveis.filter((t) => efetivo(t) === 'emitido'),
      remessa: visiveis.filter((t) => efetivo(t) === 'em_remessa'),
      pagos: visiveis.filter((t) => efetivo(t) === 'pago'),
      vencidos: visiveis.filter((t) => efetivo(t) === 'vencido'),
    } as Record<Aba, TituloBoleto[]>;
  }, [titulos, busca]);

  const listaAtual = porAba[aba];

  // --- Emissao --------------------------------------------------------

  const emitirBoleto = async (titulo: TituloBoleto) => {
    if (!tenantId || !currentUser) return;

    const banco = bancosComBoleto.find((b) => b.id === titulo.bancoId) || bancosComBoleto[0];
    if (!banco) {
      showError(
        'Nenhum banco preparado para boleto',
        'Abra Financeiro → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco", preenchendo o convênio.',
      );
      return;
    }
    const erroConvenio = erroDoConvenioBoleto({
      cooperativa: banco.agencia,
      conta: banco.conta,
      contaDv: banco.boleto?.contaDv,
    });
    if (erroConvenio) { showError('Convênio incompleto', erroConvenio); return; }

    const vencimento = titulo.dataVencimento || titulo.dataPrevistaRecebimento;
    if (!vencimento) {
      showError('Sem vencimento', `O título "${titulo.descricao}" está sem data de vencimento. Ajuste o título antes de emitir o boleto.`);
      return;
    }

    const confirmacao = await NexusSwal.fire({
      title: 'Emitir boleto?',
      html: `<div style="text-align:left;font-size:14px">`
        + `<b>Cliente:</b> ${(titulo.clienteNome || 'Sem cliente').replace(/[<>&]/g, '')}<br/>`
        + `<b>Valor:</b> ${currency.format(fromCents(titulo.valorCentavos))}<br/>`
        + `<b>Vencimento:</b> ${vencimento.split('-').reverse().join('/')}<br/>`
        + `<b>Banco:</b> ${banco.nome.replace(/[<>&]/g, '')}`
        + `</div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Emitir',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;

    setProcessando(true);
    try {
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
            modalidade: '01',
            nossoNumero,
          },
          vencimento,
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
          vencimento,
          dataEmissao: getDateInputInTimeZone(),
          status: 'emitido',
        };

        transaction.update(tituloRef, {
          boleto: dadosGerados,
          bancoId: banco.id,
          bancoNome: banco.nome,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Boleto emitido'),
        });
      });

      const gerado = dadosGerados as BoletoDetails | null;
      await NexusSwal.fire({
        title: 'Boleto emitido',
        html: `<div style="text-align:left;font-size:14px">`
          + `<b>Nosso número:</b> ${gerado?.nossoNumero || ''}<br/><br/>`
          + `<b>Linha digitável:</b><br/><span style="font-family:monospace">${formatarLinhaDigitavel(gerado?.linhaDigitavel || '')}</span>`
          + `</div>`,
        icon: 'success',
      });
    } catch (erro: any) {
      console.error('Erro ao emitir boleto:', erro);
      showError('Não foi possível emitir', erro?.message || 'Tente novamente em instantes.');
    } finally {
      setProcessando(false);
    }
  };

  // --- Arquivo de remessa -------------------------------------------------

  const gerarRemessa = async () => {
    if (!tenantId || !currentUser) return;
    const paraEnviar = porAba.emitidos.filter((t) => selecionados.has(t.id));
    const lista = paraEnviar.length > 0 ? paraEnviar : porAba.emitidos;
    if (lista.length === 0) {
      showError('Nada para enviar', 'Não há boleto emitido aguardando remessa. Emita pelo menos um boleto antes.');
      return;
    }

    const banco = bancosComBoleto.find((b) => b.id === lista[0].bancoId) || bancosComBoleto[0];
    if (!banco) { showError('Sem convênio', 'Configure o convênio de boleto em Financeiro → Bancos.'); return; }
    if (!banco.boleto?.cnpjCedente || !banco.boleto?.nomeCedente) {
      showError(
        'Cedente incompleto',
        'Preencha o CNPJ e o nome do cedente na Configuração de Boleto do banco antes de gerar a remessa.',
      );
      return;
    }

    setProcessando(true);
    try {
      const hoje = getDateInputInTimeZone();
      const agora = new Date();
      const hora = `${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;

      let numeroRemessa = 0;
      await runTransaction(db, async (transaction) => {
        const piso = Number(banco.boleto?.proximaRemessa || 0);
        numeroRemessa = await reserveTenantSequence(
          transaction, db, tenantId, `boleto_remessa_${banco.id}`, Math.max(0, piso - 1),
        );
      });

      // O Sicoob rejeita titulo sem CPF/CNPJ e CEP do pagador -- entao o dado
      // vem do cadastro do cliente e, se faltar, o arquivo nao sai: a mensagem
      // diz quem completar e onde (Clientes), em vez de mandar arquivo torto.
      const titulosRemessa: TituloRemessaSicoob[] = [];
      const problemas: string[] = [];
      for (const [indice, t] of lista.entries()) {
        let numeroPedido = '';
        let clienteId = t.clienteId || '';
        if (t.pedidoId) {
          const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', t.pedidoId));
          if (pedidoSnap.exists() && pedidoSnap.data().tenantId === tenantId) {
            numeroPedido = String(pedidoSnap.data().numeroPedido || '');
            clienteId = clienteId || String(pedidoSnap.data().clienteId || '');
          }
        }
        const clienteSnap = clienteId ? await getDoc(doc(db, 'clientes', clienteId)) : null;
        const cliente = clienteSnap && clienteSnap.exists() && clienteSnap.data().tenantId === tenantId
          ? clienteSnap.data() as any
          : null;
        const nomeCliente = String(cliente?.nome || t.clienteNome || '').trim();
        const documento = String(cliente?.documento || '').replace(/\D/g, '');
        const cep = String(cliente?.cep || '').replace(/\D/g, '');
        const faltando: string[] = [];
        if (documento.length !== 11 && documento.length !== 14) faltando.push('CPF/CNPJ');
        if (cep.length !== 8) faltando.push('CEP');
        if (!String(cliente?.cidade || '').trim()) faltando.push('cidade');
        if (!String(cliente?.estado || '').trim()) faltando.push('UF');
        if (faltando.length > 0) {
          problemas.push(`${nomeCliente || 'Cliente sem nome'} (título ${t.descricao || t.id}): falta ${faltando.join(', ')}`);
          continue;
        }
        const nossoNumero = Number(String(t.boleto?.nossoNumero || '0').slice(0, -1)) || indice + 1;
        titulosRemessa.push({
          nossoNumero,
          numeroDocumento: numeroPedido || String(nossoNumero),
          parcela: t.paymentIndex || 1,
          vencimento: t.boleto?.vencimento || t.dataVencimento || hoje,
          valorCentavos: t.valorCentavos,
          sacado: {
            tipoDocumento: documento.length === 14 ? 'CNPJ' : 'CPF',
            documento,
            nome: nomeCliente,
            endereco: [cliente?.endereco, cliente?.numero].map((x) => String(x || '').trim()).filter(Boolean).join(', '),
            bairro: String(cliente?.bairro || ''),
            cep,
            cidade: String(cliente?.cidade || ''),
            uf: String(cliente?.estado || ''),
          },
        });
      }
      if (problemas.length > 0) {
        throw new Error(`Complete o cadastro em Clientes antes de gerar a remessa — o banco exige CPF/CNPJ, CEP, cidade e UF do pagador. ${problemas.join(' | ')}`);
      }

      const conteudo = montarRemessaSicoob({
        convenio: {
          cooperativa: String(banco.agencia || ''),
          conta: String(banco.conta || ''),
          contaDv: banco.boleto?.contaDv,
          cnpjCedente: banco.boleto.cnpjCedente,
          nomeCedente: banco.boleto.nomeCedente,
          instrucoes: banco.boleto?.instrucoes,
          multaPercentual: banco.boleto?.multaPercentual,
          jurosMensalPercentual: banco.boleto?.jurosMensalPercentual,
          numeroRemessa,
        },
        titulos: titulosRemessa,
        dataGeracao: hoje,
        horaGeracao: hora,
      });

      // CNAB e' texto de largura fixa em latin1; o Blob sai como o banco espera.
      const blob = new Blob([conteudo], { type: 'text/plain;charset=iso-8859-1' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeArquivoRemessaSicoob(numeroRemessa, hoje);
      link.click();
      URL.revokeObjectURL(url);

      // Marca os titulos como enviados so' DEPOIS do arquivo sair.
      for (const t of lista) {
        await runTransaction(db, async (transaction) => {
          const ref = doc(db, 'transacoes', t.id);
          const snap = await transaction.get(ref);
          if (!snap.exists()) return;
          const atual = snap.data().boleto;
          if (!atual || atual.status !== 'emitido') return;
          transaction.update(ref, {
            boleto: { ...atual, status: 'em_remessa', numeroRemessa },
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Incluído na remessa ${numeroRemessa}`),
          });
        });
      }

      setSelecionados(new Set());
      showSuccess(`Remessa ${numeroRemessa} gerada com ${lista.length} boleto(s).`);
    } catch (erro: any) {
      console.error('Erro ao gerar remessa:', erro);
      showError('Não foi possível gerar a remessa', erro?.message || 'Tente novamente.');
    } finally {
      setProcessando(false);
    }
  };

  // --- Arquivo de retorno -------------------------------------------------

  const importarRetorno = (arquivo: File) => {
    const leitor = new FileReader();
    leitor.onload = async (evento) => {
      const conteudo = String(evento.target?.result || '');
      const resumo = lerArquivoRetornoSicoob(conteudo);

      if (resumo.liquidados.length === 0 && resumo.paraConferir.length === 0 && resumo.informativos.length === 0) {
        showError('Nada reconhecido', 'Nenhum título foi encontrado neste arquivo. Confira se é o arquivo de retorno do Sicoob.');
        return;
      }

      const conferir = resumo.paraConferir.slice(0, 8)
        .map((l) => `${l.nossoNumero}${l.valorPagoCentavos ? ` (${currency.format(fromCents(l.valorPagoCentavos))})` : ''}`)
        .join(', ');
      const html = `<div style="text-align:left;font-size:14px">`
        + `<b>${resumo.liquidados.length}</b> título(s) pagos (liquidação), prontos para baixa.<br/>`
        + `<b>${resumo.informativos.length}</b> confirmação(ões) de entrada / título(s) em aberto — só informativo.<br/>`
        + `<b>${resumo.paraConferir.length}</b> com outra ocorrência — <u>não</u> serão tocados`
        + (conferir ? `: ${conferir}${resumo.paraConferir.length > 8 ? '…' : ''}` : '') + `.`
        + `</div>`;

      if (resumo.liquidados.length === 0) {
        await NexusSwal.fire({ title: 'Nenhum pagamento neste arquivo', html, icon: 'info' });
        return;
      }

      const confirmacao = await NexusSwal.fire({
        title: 'Conferir antes de dar baixa',
        html,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Dar baixa nos pagos',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;

      setProcessando(true);
      let baixados = 0;
      let naoEncontrados = 0;
      try {
        for (const linha of resumo.liquidados) {
          const titulo = titulos.find((t) => t.boleto?.nossoNumero === linha.nossoNumero);
          if (!titulo) { naoEncontrados += 1; continue; }
          if (titulo.status === 'Paga') continue;
          await darBaixaBoleto(titulo, linha.valorPagoCentavos || titulo.valorCentavos, linha.dataOcorrencia);
          baixados += 1;
        }
        showSuccess(
          naoEncontrados > 0
            ? `${baixados} boleto(s) baixados. ${naoEncontrados} do arquivo não foram encontrados aqui.`
            : `${baixados} boleto(s) baixados.`,
        );
      } catch (erro: any) {
        console.error('Erro ao aplicar retorno:', erro);
        showError('Não foi possível concluir a baixa', erro?.message || 'Confira os títulos e tente novamente.');
      } finally {
        setProcessando(false);
      }
    };
    leitor.readAsText(arquivo, 'ISO-8859-1');
  };

  const darBaixaBoleto = async (titulo: TituloBoleto, valorPagoCentavos: number, dataPagamento?: string) => {
    if (!tenantId || !currentUser) return;
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'transacoes', titulo.id);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Título não encontrado.');
      const dados = snap.data();
      if (dados.status === 'Paga') return;

      const bancoRef = titulo.bancoId ? doc(db, 'bancos', titulo.bancoId) : null;
      let saldoAtual = 0;
      if (bancoRef) {
        const bancoSnap = await transaction.get(bancoRef);
        if (!bancoSnap.exists()) throw new Error('Banco do boleto não encontrado.');
        saldoAtual = Number(bancoSnap.data().saldoCentavos || 0);
      }

      transaction.update(ref, {
        status: 'Paga',
        dataPagamento: dataPagamento || getDateInputInTimeZone(),
        naturezaFinanceira: settledFinancialNatureForPayment('Boleto'),
        movimentaCaixaFisico: false,
        boleto: { ...(dados.boleto || {}), status: 'pago' },
        recebidoEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Baixa pelo retorno do banco'),
      });

      if (bancoRef) {
        transaction.update(bancoRef, {
          saldoCentavos: saldoAtual + valorPagoCentavos,
          updatedAt: serverTimestamp(),
        });
      }
    });
  };

  // --- Render -------------------------------------------------------------

  if (!podeAcessar) {
    return (
      <div className="os-page">
        <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Você não tem permissão para acessar os boletos. Peça a permissão "Financeiro: Boletos" ao responsável.
        </div>
      </div>
    );
  }

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div className="header-title-group">
          <div>
            <h1 className="page-title">Boletos</h1>
            <p className="page-subtitle">Emissão, arquivo de remessa e retorno do banco</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={gerarRemessa} disabled={processando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} /> Gerar remessa
          </button>
          <button className="btn-secondary" onClick={() => inputRetornoRef.current?.click()} disabled={processando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileUp size={18} /> Importar retorno
          </button>
          <input
            ref={inputRetornoRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) importarRetorno(arquivo);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {bancosComBoleto.length === 0 && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}>
          <strong style={{ color: '#f59e0b' }}>Nenhum banco preparado para boleto.</strong>
          <span style={{ color: 'var(--text-secondary)' }}>
            {' '}Abra Financeiro → Bancos, edite o banco do Sicoob e marque "Emite boleto por este banco".
          </span>
        </div>
      )}

      <div className="card form-section" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            style={{ width: '100%', padding: '10px 12px 10px 32px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Cliente, descrição ou nosso número"
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(Object.keys(ROTULO_ABA) as Aba[]).map((chave) => (
            <button
              key={chave}
              type="button"
              className={aba === chave ? 'btn-primary' : 'btn-secondary'}
              onClick={() => { setAba(chave); setSelecionados(new Set()); }}
              style={{ padding: '8px 14px', fontSize: '13px' }}
            >
              {ROTULO_ABA[chave]} ({porAba[chave].length})
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
            <Loader2 size={20} className="spin" /> Carregando boletos...
          </div>
        ) : listaAtual.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Receipt size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <p style={{ margin: 0 }}>Nenhum boleto em "{ROTULO_ABA[aba]}".</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-tertiary)', textAlign: 'left' }}>
                  {aba === 'emitidos' && <th style={{ padding: '14px 16px', width: '40px' }}></th>}
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Cliente</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Descrição</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Vencimento</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Nosso número</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Situação</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {listaAtual.map((t) => {
                  const situacao: StatusBoletoEfetivo | 'aguardando' = t.boleto ? statusBoletoEfetivo(t.boleto) : 'aguardando';
                  const vencimento = t.boleto?.vencimento || t.dataVencimento || '';
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      {aba === 'emitidos' && (
                        <td style={{ padding: '14px 16px' }}>
                          <input
                            type="checkbox"
                            checked={selecionados.has(t.id)}
                            onChange={(e) => {
                              const novo = new Set(selecionados);
                              if (e.target.checked) novo.add(t.id); else novo.delete(t.id);
                              setSelecionados(novo);
                            }}
                          />
                        </td>
                      )}
                      <td style={{ padding: '14px 16px' }}>{t.clienteNome || '—'}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{t.descricao}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                        {vencimento ? vencimento.split('-').reverse().join('/') : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: '13px' }}>
                        {t.boleto?.nossoNumero || '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                          backgroundColor: situacao === 'pago' ? 'rgba(16,185,129,0.18)'
                            : situacao === 'vencido' ? 'rgba(239,68,68,0.18)'
                              : 'rgba(148,163,184,0.18)',
                          color: situacao === 'pago' ? '#10b981' : situacao === 'vencido' ? '#ef4444' : 'var(--text-muted)',
                        }}>
                          {situacao === 'aguardando' ? 'Aguardando emissão' : ROTULO_STATUS_BOLETO[situacao]}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}>
                        {currency.format(fromCents(t.valorCentavos))}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {!t.boleto ? (
                          <button
                            className="btn-primary"
                            style={{ padding: '6px 12px', fontSize: '13px' }}
                            onClick={() => emitirBoleto(t)}
                            disabled={processando}
                          >
                            Emitir
                          </button>
                        ) : (
                          <button
                            className="btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            onClick={() => NexusSwal.fire({
                              title: 'Boleto',
                              html: `<div style="text-align:left;font-size:14px">`
                                + `<b>Nosso número:</b> ${t.boleto?.nossoNumero}<br/><br/>`
                                + `<b>Linha digitável:</b><br/><span style="font-family:monospace">${formatarLinhaDigitavel(t.boleto?.linhaDigitavel || '')}</span>`
                                + `</div>`,
                              icon: 'info',
                            })}
                          >
                            <Barcode size={14} /> Ver
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Boletos;

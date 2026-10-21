import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { Archive, Calculator, FileText, Mail, RotateCcw, Search } from 'lucide-react';
import { db } from '../../services/firebase';
import { spedyService } from '../../services/spedyService';
import { bytesParaBase64, enviarAoContador, type AnexoParaContador } from '../../services/envioContadorService';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { escaparHtml, NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { gerarRelatorioPdf } from '../../utils/relatorioPdf';
import { preferenciasPadrao } from '../../utils/relatorioPdfDomain';
import { montarZip, type ArquivoDoZip } from '../../utils/zipDomain';
import {
  INTERVALO_ENTRE_CHAMADAS_MS,
  nomeDoPacote,
  planoDoPacote,
  tempoEstimado,
  type DadosDaEmitidaParaPacote,
} from '../../utils/pacoteContadorDomain';
import { lerComReserva } from '../../services/consultaComReserva';
import { useAuth } from '../../contexts/AuthContext';
import { hasTenantFullAccess } from '../../utils/roles';
import { addDaysToDateInput, dateInputToUtcEnd, dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { LOTE_IN_POR_ID } from '../../utils/firestoreLimites';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { parseNfeXml } from '../../utils/nfeXmlDomain';
import { descompactarXml } from '../../utils/xmlCompactoDomain';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import {
  DIAS_ANTES_PARA_REENVIO,
  FILTROS_PADRAO_CONTADOR,
  MODELOS_FISCAIS,
  OPERACOES_FISCAIS,
  ROTULO_MOVIMENTO,
  ROTULO_OPERACAO,
  ROTULO_SITUACAO,
  SITUACOES_FISCAIS,
  aplicarFiltrosContador,
  formatarCfop,
  instanteDaEmissao,
  linhaDaNotaEmitida,
  linhaDaNotaRecebida,
  montarDocumentoContador,
  opcoesDosFiltros,
  totaisContador,
  type FiltrosContador,
  type LinhaContador,
  type MovimentoFiscal,
} from '../../utils/relatorioContadorDomain';

/**
 * FISCAL › RELATORIO DO CONTADOR (pedido do dono, 20/10/2026). So' leitura:
 * notas emitidas (`notas_fiscais`) e recebidas (`notas_fiscais_entrada`) do
 * periodo, com os filtros que o contador usa (movimento, modelo, operacao,
 * situacao, CFOP, UF, carta de correcao). Regra em relatorioContadorDomain.ts;
 * o PDF e o Excel saem do RelatorioPreview.
 */

export const PERMISSAO_RELATORIO_CONTADOR = 'fiscal.relatorio_contador';

const primeiroDiaDoMes = (dia: string): string => `${dia.slice(0, 7)}-01`;
const ultimoDiaDoMes = (dia: string): string => addDaysToDateInput(primeiroDiaDoMes(addDaysToDateInput(primeiroDiaDoMes(dia), 32)), -1);

const reais = (c: number): string => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (dia: string): string => (dia ? dia.split('-').reverse().join('/') : '');

const millisDe = (v: unknown): number | null => {
  const t = v as { toDate?: () => Date; seconds?: number } | undefined;
  if (typeof t?.toDate === 'function') return t.toDate().getTime();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  return null;
};

/** Le documentos de uma colecao da empresa por id, em lotes (limite do "in"). */
const lerPorIds = async (colecao: string, tenantId: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> => {
  const mapa = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += LOTE_IN_POR_ID) {
    const lote = ids.slice(i, i + LOTE_IN_POR_ID);
    const snap = await getDocs(query(collection(db, colecao), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)));
    snap.docs.forEach((d) => mapa.set(d.id, d.data()));
  }
  return mapa;
};

const estilos = {
  card: { padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' } as React.CSSProperties,
  rotulo: { fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' } as React.CSSProperties,
  campo: { padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', font: 'inherit' } as React.CSSProperties,
};

const Chip: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({ ativo, onClick, children, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={ativo}
    style={{
      padding: '7px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${ativo ? 'var(--accent-purple)' : 'var(--border-color)'}`,
      backgroundColor: ativo ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
      color: ativo ? '#fff' : 'var(--text-primary)',
    }}
  >
    {children}
  </button>
);

const alternar = <T,>(lista: readonly T[], item: T): T[] => (lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]);

const RelatorioContador: React.FC = () => {
  const { tenantId, userRole, isOwner, userPermissions } = useAuth();
  const podeVer = hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_RELATORIO_CONTADOR);
  const hoje = getDateInputInTimeZone();
  // Padrao: o mes passado inteiro (e' o que o contador fecha).
  const mesPassado = addDaysToDateInput(primeiroDiaDoMes(hoje), -1);
  const [de, setDe] = useState(primeiroDiaDoMes(mesPassado));
  const [ate, setAte] = useState(ultimoDiaDoMes(mesPassado));
  const [linhas, setLinhas] = useState<LinhaContador[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [filtros, setFiltros] = useState<FiltrosContador>(FILTROS_PADRAO_CONTADOR);
  const [previewAberto, setPreviewAberto] = useState(false);
  // Pacote de XMLs e envio ao contador (fase 2, 20/10/2026).
  const [dadosEmitidas, setDadosEmitidas] = useState<Map<string, DadosDaEmitidaParaPacote>>(new Map());
  const [xmlsRecebidas, setXmlsRecebidas] = useState<Map<string, string>>(new Map());
  const [progresso, setProgresso] = useState<{ texto: string; feito: number; total: number } | null>(null);
  const cancelarPacoteRef = useRef(false);

  const periodoValido = Boolean(de && ate && de <= ate);

  const carregar = useCallback(async () => {
    if (!tenantId || !periodoValido) return;
    const inicio = dateInputToUtcStart(de);
    const fim = dateInputToUtcEnd(ate);
    if (!inicio || !fim) return;
    setCarregando(true);
    setErro('');
    try {
      const baseSaidas = query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId));
      const baseEntradas = query(collection(db, 'notas_fiscais_entrada'), where('tenantId', '==', tenantId));
      // Notas criadas um pouco antes do periodo tambem: a rejeitada reenviada
      // dentro do periodo conta pela data do reenvio (instanteDaEmissao).
      const inicioCriacao = dateInputToUtcStart(addDaysToDateInput(de, -DIAS_ANTES_PARA_REENVIO)) ?? inicio;
      const [saidasSnap, entradasSnap] = await Promise.all([
        lerComReserva(
          query(baseSaidas, where('createdAt', '>=', Timestamp.fromDate(inicioCriacao)), where('createdAt', '<=', Timestamp.fromDate(fim))),
          baseSaidas,
          'Relatório do contador (notas emitidas)',
        ),
        lerComReserva(
          query(baseEntradas, where('dataEmissao', '>=', de), where('dataEmissao', '<=', ate)),
          baseEntradas,
          'Relatório do contador (notas recebidas)',
        ),
      ]);

      // Dia da emissao (ultima transmissao) no fuso da loja; a consulta de reserva
      // traz tudo, entao o filtro do periodo vale aqui tambem.
      const saidas = saidasSnap.docs.map((d) => {
        const dados = d.data();
        const ms = instanteDaEmissao(dados.data, millisDe(dados.createdAt));
        return { id: d.id, dados, dia: ms !== null ? getDateInputInTimeZone(new Date(ms)) : '' };
      }).filter((n) => n.dia && n.dia >= de && n.dia <= ate);
      const entradasDoPeriodo = entradasSnap.docs
        .map((d) => ({ id: d.id, dados: d.data() }))
        .filter((n) => n.dados.status !== 'excluida' && typeof n.dados.dataEmissao === 'string' && n.dados.dataEmissao >= de && n.dados.dataEmissao <= ate);
      // Itens do XML guardado na entrada: trazem frete, seguro, despesas e
      // desconto de cada item (os itens gravados nao). Sem XML ou XML ilegivel,
      // o relatorio usa os itens gravados e fecha pelo total da nota.
      const entradas = await Promise.all(entradasDoPeriodo.map(async (n) => {
        const xml = typeof n.dados.xmlGzipBase64 === 'string' ? n.dados.xmlGzipBase64 : '';
        if (!xml) return { ...n, itensDoXml: undefined, xmlTexto: '' };
        try {
          const xmlTexto = await descompactarXml(xml);
          return { ...n, itensDoXml: parseNfeXml(xmlTexto).itens, xmlTexto };
        } catch {
          return { ...n, itensDoXml: undefined, xmlTexto: '' };
        }
      }));

      // CPF/CNPJ e UF nao ficam na nota: vem do cadastro do cliente e do fornecedor.
      const idsClientes = [...new Set(saidas.map((n) => n.dados.clienteId).filter((x): x is string => typeof x === 'string' && x !== ''))];
      const idsFornecedores = [...new Set(entradas.map((n) => n.dados.fornecedorId).filter((x): x is string => typeof x === 'string' && x !== ''))];
      const [clientes, fornecedores] = await Promise.all([
        lerPorIds('clientes', tenantId, idsClientes).catch(() => new Map<string, Record<string, unknown>>()),
        lerPorIds('fornecedores', tenantId, idsFornecedores).catch(() => new Map<string, Record<string, unknown>>()),
      ]);

      const novas: LinhaContador[] = [
        ...saidas.map((n) => {
          const cliente = typeof n.dados.clienteId === 'string' ? clientes.get(n.dados.clienteId) : undefined;
          return linhaDaNotaEmitida({
            id: n.id,
            ...n.dados,
            data: n.dia,
            documentoDoCliente: String(cliente?.documento ?? ''),
            ufDoCliente: String(cliente?.estado ?? ''),
          });
        }),
        ...entradas.map((n) => {
          const fornecedor = typeof n.dados.fornecedorId === 'string' ? fornecedores.get(n.dados.fornecedorId) : undefined;
          return linhaDaNotaRecebida({ id: n.id, ...n.dados, itensDoXml: n.itensDoXml, ufDoFornecedor: String(fornecedor?.estado ?? fornecedor?.uf ?? '') });
        }),
      ];
      setLinhas(novas);
      // Para o pacote de XMLs (fase 2): id da Spedy e cartas de correcao das emitidas
      // (na ordem de envio, como no relatorio) e o XML guardado das recebidas.
      setDadosEmitidas(new Map(saidas.map((n) => {
        const cartas = (Array.isArray(n.dados.cartasCorrecao) ? n.dados.cartasCorrecao as Array<Record<string, unknown>> : [])
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({ eventId: String(c.eventId ?? ''), enviadaEm: String(c.enviadaEm ?? '') }))
          .sort((a, b) => a.enviadaEm.localeCompare(b.enviadaEm))
          .map((c, i) => ({ eventId: c.eventId, sequencia: i + 1 }));
        return [n.id, { spedyId: String(n.dados.spedyId ?? ''), cartas }];
      })));
      setXmlsRecebidas(new Map(entradas.filter((n) => n.xmlTexto).map((n) => [n.id, n.xmlTexto])));
    } catch (falha) {
      console.error('Erro ao montar o relatório do contador:', falha);
      setErro('Não foi possível ler as notas do período. Confira a internet e tente de novo.');
    } finally {
      setCarregando(false);
    }
  }, [tenantId, de, ate, periodoValido]);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtradas = useMemo(() => aplicarFiltrosContador(linhas, filtros), [linhas, filtros]);
  const opcoes = useMemo(() => opcoesDosFiltros(linhas), [linhas]);
  const totais = useMemo(() => totaisContador(filtradas), [filtradas]);
  const mudar = (patch: Partial<FiltrosContador>) => setFiltros((atual) => ({ ...atual, ...patch }));

  /**
   * Monta o .zip com os XMLs das notas DA LISTA (respeita os filtros): emitidas e
   * cartas de correcao baixadas da Spedy uma por vez (50 por minuto), recebidas do
   * XML guardado. Falha numa nota nao para o pacote: vira aviso no final.
   */
  const montarPacote = async (): Promise<{ zip: Uint8Array<ArrayBuffer>; avisos: string[]; arquivos: number } | null> => {
    const plano = planoDoPacote(filtradas, dadosEmitidas, new Set(xmlsRecebidas.keys()));
    if (plano.tarefas.length === 0) {
      showWarning('Nenhum XML para o pacote', plano.foraDoPacote.length ? plano.foraDoPacote.slice(0, 5).join(' ') : 'Não há notas na lista com estes filtros.');
      return null;
    }
    if (plano.chamadasSpedy > 0) {
      const ok = await NexusSwal.fire({
        title: 'Montar o pacote de XMLs?',
        html: `${plano.tarefas.length} arquivo(s). Os XMLs das notas emitidas vêm da Spedy, um por vez: leva <strong>${tempoEstimado(plano.chamadasSpedy)}</strong>. Deixe esta tela aberta.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Montar pacote',
        cancelButtonText: 'Voltar',
      });
      if (!ok.isConfirmed) return null;
    }
    cancelarPacoteRef.current = false;
    const codificador = new TextEncoder();
    const arquivos: ArquivoDoZip[] = [];
    const avisos = [...plano.foraDoPacote];
    let ultimaChamada = 0;
    const esperarVez = async () => {
      const espera = ultimaChamada + INTERVALO_ENTRE_CHAMADAS_MS - Date.now();
      if (espera > 0) await new Promise((r) => window.setTimeout(r, espera));
      ultimaChamada = Date.now();
    };
    try {
      for (let i = 0; i < plano.tarefas.length; i += 1) {
        if (cancelarPacoteRef.current) return null;
        const tarefa = plano.tarefas[i];
        setProgresso({ texto: `Baixando ${tarefa.nome.split('/').pop()}`, feito: i, total: plano.tarefas.length });
        try {
          if (tarefa.tipo === 'recebida') {
            arquivos.push({ nome: tarefa.nome, dados: codificador.encode(xmlsRecebidas.get(tarefa.linhaId) ?? '') });
          } else {
            await esperarVez();
            const blob = tarefa.tipo === 'emitida'
              ? await spedyService.baixarArquivoFiscal(tarefa.spedyId, tarefa.spedyTipo, 'xml')
              : await spedyService.baixarArquivoCartaCorrecao(tarefa.spedyId, tarefa.eventId, 'xml');
            arquivos.push({ nome: tarefa.nome, dados: new Uint8Array(await blob.arrayBuffer()) });
          }
        } catch (falha) {
          avisos.push(`${tarefa.nome.split('/').pop()}: ${falha instanceof Error ? falha.message : 'não baixou'}`);
        }
      }
      return { zip: montarZip(arquivos), avisos, arquivos: arquivos.length };
    } finally {
      setProgresso(null);
    }
  };

  const mostrarAvisosDoPacote = (titulo: string, avisos: string[]) => {
    if (avisos.length === 0) return showSuccess(titulo);
    return NexusSwal.fire({
      title: titulo,
      icon: 'warning',
      html: `<p style="margin:0 0 8px">Ficaram de fora:</p><ul style="text-align:left;margin:0;padding-left:18px;max-height:220px;overflow:auto">${avisos.slice(0, 40).map((a) => `<li>${escaparHtml(a)}</li>`).join('')}</ul>${avisos.length > 40 ? `<p>… e mais ${avisos.length - 40}.</p>` : ''}`,
    });
  };

  const baixarPacote = async () => {
    const pacote = await montarPacote();
    if (!pacote) return;
    const url = URL.createObjectURL(new Blob([pacote.zip], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeDoPacote(de, ate);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    void mostrarAvisosDoPacote(`Pacote com ${pacote.arquivos} XML(s) baixado.`, pacote.avisos);
  };

  /** PDF do relatorio (colunas padrao) para anexar ao e-mail. */
  const pdfDoRelatorio = async (): Promise<Uint8Array> => {
    const snap = tenantId ? await getDoc(doc(db, 'configuracoes', tenantId)) : null;
    const config = snap?.exists() ? snap.data() : {};
    const documento = montarDocumentoContador(filtradas, { de, ate, filtros });
    const pdf = gerarRelatorioPdf(
      { ...documento, empresa: { nome: config.nomeOficina || config.razaoSocial || config.nomeFantasia || 'Empresa', cnpj: config.cnpj || '', telefone: config.telefone || '' } },
      preferenciasPadrao(documento.secoes),
    );
    return new Uint8Array(pdf.output('arraybuffer'));
  };

  const enviarParaContador = async () => {
    const snap = tenantId ? await getDoc(doc(db, 'configuracoes', tenantId)).catch(() => null) : null;
    const emailGuardado = snap?.exists() ? String(snap.data().emailContador || '') : '';
    const r = await NexusSwal.fire({
      title: 'Enviar ao contador',
      html: `
        <div style="display:flex;flex-direction:column;gap:10px;text-align:left">
          <label style="font-size:13px;font-weight:600">E-mail do contador
            <input id="contador-email" type="email" class="swal2-input" style="margin:6px 0 0;width:100%" value="${escaparHtml(emailGuardado)}">
          </label>
          <label style="font-size:13px"><input id="contador-pdf" type="checkbox" checked> Relatório em PDF (as notas da lista, com os filtros de agora)</label>
          <label style="font-size:13px"><input id="contador-zip" type="checkbox" checked> XMLs das notas (.zip)</label>
          <span style="font-size:12px;color:var(--text-muted)">Sai do e-mail da empresa, pelo SMTP de Configurações › E-mail das notas.</span>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Enviar',
      cancelButtonText: 'Voltar',
      focusConfirm: false,
      preConfirm: () => {
        const para = (document.getElementById('contador-email') as HTMLInputElement | null)?.value.trim() ?? '';
        const comPdf = (document.getElementById('contador-pdf') as HTMLInputElement | null)?.checked ?? false;
        const comZip = (document.getElementById('contador-zip') as HTMLInputElement | null)?.checked ?? false;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(para)) { NexusSwal.showValidationMessage('Informe um e-mail válido do contador.'); return false; }
        if (!comPdf && !comZip) { NexusSwal.showValidationMessage('Marque o PDF, os XMLs ou os dois.'); return false; }
        return { para, comPdf, comZip };
      },
    });
    if (!r.isConfirmed || !r.value) return;
    const { para, comPdf, comZip } = r.value as { para: string; comPdf: boolean; comZip: boolean };
    const anexos: AnexoParaContador[] = [];
    let avisos: string[] = [];
    try {
      if (comPdf) anexos.push({ tipo: 'pdf', nome: `${nomeArquivoRelatorio('Relatorio do contador', de, ate)}.pdf`, base64: bytesParaBase64(await pdfDoRelatorio()) });
      if (comZip) {
        const pacote = await montarPacote();
        if (!pacote) return;
        avisos = pacote.avisos;
        anexos.push({ tipo: 'zip', nome: nomeDoPacote(de, ate), base64: bytesParaBase64(pacote.zip) });
      }
      setProgresso({ texto: 'Enviando o e-mail ao contador', feito: 0, total: 0 });
      const enviado = await enviarAoContador({ para, periodo: `${dataBr(de)} a ${dataBr(ate)}`, anexos });
      setProgresso(null);
      void mostrarAvisosDoPacote(`Enviado para ${enviado.para}.`, avisos);
    } catch (falha) {
      setProgresso(null);
      showError('Não foi possível enviar ao contador', falha instanceof Error ? falha.message : undefined);
    }
  };

  if (!podeVer) {
    return (
      <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Seu usuário não tem permissão para o relatório do contador. Peça a um responsável liberar &quot;Fiscal: Relatório do Contador&quot; no seu cadastro.
      </div>
    );
  }

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="relatorio-contador"
        documento={montarDocumentoContador(filtradas, { de, ate, filtros })}
        nomeArquivo={nomeArquivoRelatorio('Relatorio do contador', de, ate)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos filtros"
      />
    );
  }

  const cartao = (rotulo: string, valor: string) => (
    <div style={{ ...estilos.card, flex: '1 1 180px', padding: '16px 18px' }}>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{rotulo}</div>
      <div style={{ fontSize: '21px', fontWeight: 700, marginTop: '4px' }}>{valor}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calculator size={28} color="var(--accent-purple)" /> Relatório do Contador
          </h1>
          <p style={{ color: 'var(--text-muted)', maxWidth: '760px' }}>
            Notas emitidas e recebidas do período, com resumo por CFOP e por operação, situação e cartas de correção. Escolha os filtros e gere o PDF ou o Excel.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <MenuMaisOpcoes
            itens={[
              {
                texto: 'Baixar XMLs (.zip)', Icone: Archive,
                titulo: 'Pacote com os XMLs das notas da lista: emitidas (da Spedy), cartas de correção e recebidas',
                desabilitado: carregando || Boolean(progresso) || filtradas.length === 0,
                onClick: () => { void baixarPacote(); },
              },
              {
                texto: 'Enviar ao contador por e-mail', Icone: Mail,
                titulo: 'Manda o PDF do relatório e/ou o .zip dos XMLs para o e-mail do contador',
                desabilitado: carregando || Boolean(progresso) || filtradas.length === 0,
                onClick: () => { void enviarParaContador(); },
              },
            ]}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => setPreviewAberto(true)}
            disabled={carregando || !periodoValido}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            title="Abre a prévia em PDF; de lá dá para imprimir, salvar o PDF ou salvar em Excel"
          >
            <FileText size={20} /> Gerar relatório
          </button>
        </div>
      </div>

      {progresso && (
        <div role="status" style={{ ...estilos.card, display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', borderColor: 'var(--accent-purple)' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px' }}>{progresso.texto}</div>
            {progresso.total > 0 && (
              <>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{progresso.feito} de {progresso.total} arquivo(s)</div>
                <div style={{ height: '6px', borderRadius: '999px', backgroundColor: 'var(--bg-tertiary)', marginTop: '8px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round((progresso.feito / progresso.total) * 100)}%`, height: '100%', backgroundColor: 'var(--accent-purple)' }} />
                </div>
              </>
            )}
          </div>
          {progresso.total > 0 && (
            <button type="button" className="btn-secondary" onClick={() => { cancelarPacoteRef.current = true; }}>Cancelar</button>
          )}
        </div>
      )}

      <div style={{ ...estilos.card, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="contador-de" style={estilos.rotulo}>Emitidas de</label>
            <input id="contador-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} style={estilos.campo} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="contador-ate" style={estilos.rotulo}>Até</label>
            <input id="contador-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={estilos.campo} />
          </div>
          <Chip ativo={de === primeiroDiaDoMes(mesPassado) && ate === ultimoDiaDoMes(mesPassado)} onClick={() => { setDe(primeiroDiaDoMes(mesPassado)); setAte(ultimoDiaDoMes(mesPassado)); }}>Mês passado</Chip>
          <Chip ativo={de === primeiroDiaDoMes(hoje) && ate === hoje} onClick={() => { setDe(primeiroDiaDoMes(hoje)); setAte(hoje); }}>Este mês</Chip>
          {!periodoValido && <span style={{ color: 'var(--status-red)', fontSize: '13px' }}>A data inicial precisa ser igual ou anterior à final.</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={estilos.rotulo}>Movimento</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(['saida', 'entrada'] as MovimentoFiscal[]).map((m) => (
                <Chip key={m} ativo={filtros.movimentos.includes(m)} onClick={() => mudar({ movimentos: alternar(filtros.movimentos, m) })}>{ROTULO_MOVIMENTO[m]}</Chip>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={estilos.rotulo}>Modelo</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {MODELOS_FISCAIS.map((m) => (
                <Chip key={m} ativo={filtros.modelos.includes(m)} onClick={() => mudar({ modelos: alternar(filtros.modelos, m) })}>{m}</Chip>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={estilos.rotulo}>Situação</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SITUACOES_FISCAIS.map((s) => (
                <Chip key={s} ativo={filtros.situacoes.includes(s)} onClick={() => mudar({ situacoes: alternar(filtros.situacoes, s) })}>{ROTULO_SITUACAO[s]}</Chip>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={estilos.rotulo}>Operação</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {OPERACOES_FISCAIS.map((o) => (
              <Chip key={o} ativo={filtros.operacoes.includes(o)} onClick={() => mudar({ operacoes: alternar(filtros.operacoes, o) })}>{ROTULO_OPERACAO[o]}</Chip>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={estilos.rotulo}>CFOP {filtros.cfops.length === 0 ? '(todos)' : `(${filtros.cfops.length} escolhido${filtros.cfops.length > 1 ? 's' : ''})`}</span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {opcoes.cfops.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhum CFOP nas notas do período.</span>}
            {opcoes.cfops.map((c) => (
              <Chip key={c} ativo={filtros.cfops.includes(c)} onClick={() => mudar({ cfops: alternar(filtros.cfops, c) })}>{formatarCfop(c)}</Chip>
            ))}
            {filtros.cfops.length > 0 && <Chip ativo={false} onClick={() => mudar({ cfops: [] })}>Todos os CFOPs</Chip>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              id="contador-busca"
              type="text"
              placeholder="Buscar por cliente, fornecedor, número, CNPJ ou chave..."
              value={filtros.busca}
              onChange={(e) => mudar({ busca: e.target.value })}
              style={{ ...estilos.campo, width: '100%', paddingLeft: '38px', boxSizing: 'border-box' }}
            />
          </div>
          <label htmlFor="contador-uf" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
            UF
            <select id="contador-uf" value={filtros.uf} onChange={(e) => mudar({ uf: e.target.value })} style={estilos.campo}>
              <option value="">Todas</option>
              {opcoes.ufs.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label htmlFor="contador-cce" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
            <input id="contador-cce" type="checkbox" checked={filtros.soComCartaDeCorrecao} onChange={(e) => mudar({ soComCartaDeCorrecao: e.target.checked })} />
            Só notas com carta de correção
          </label>
          <button type="button" className="btn-secondary" onClick={() => setFiltros(FILTROS_PADRAO_CONTADOR)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RotateCcw size={16} /> Limpar filtros
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {cartao('Notas na lista', totais.notas.toLocaleString('pt-BR'))}
        {cartao('Saídas autorizadas', reais(totais.saidasAutorizadas))}
        {cartao('Entradas autorizadas', reais(totais.entradasAutorizadas))}
        {cartao('Canceladas', totais.canceladas.toLocaleString('pt-BR'))}
        {cartao('Com carta de correção', totais.comCartaDeCorrecao.toLocaleString('pt-BR'))}
      </div>

      <div style={{ ...estilos.card, padding: '0', overflow: 'hidden' }}>
        {erro && <div style={{ color: 'var(--status-red)', padding: '16px' }}>{erro}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', background: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '12px' }}>Emissão</th>
                <th style={{ padding: '12px' }}>Mov.</th>
                <th style={{ padding: '12px' }}>Modelo</th>
                <th style={{ padding: '12px' }}>Nº / série</th>
                <th style={{ padding: '12px' }}>Situação</th>
                <th style={{ padding: '12px' }}>Operação</th>
                <th style={{ padding: '12px' }}>Cliente / fornecedor</th>
                <th style={{ padding: '12px' }}>UF</th>
                <th style={{ padding: '12px' }}>CFOP</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Valor</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>ICMS</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>CC-e</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={12} style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>Lendo as notas do período...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={12} style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {linhas.length === 0 ? `Nenhuma nota emitida ou recebida entre ${dataBr(de)} e ${dataBr(ate)}.` : 'Nenhuma nota com estes filtros.'}
                </td></tr>
              ) : filtradas.map((l) => (
                <tr key={`${l.origem}-${l.id}`} style={{ borderTop: '1px solid var(--border-color)', opacity: l.situacao === 'autorizada' ? 1 : 0.7 }}>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{dataBr(l.data)}</td>
                  <td style={{ padding: '10px 12px' }}>{ROTULO_MOVIMENTO[l.movimento]}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{l.modelo}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{l.numero || '—'}{l.serie ? ` / ${l.serie}` : ''}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: l.situacao === 'autorizada' ? 'var(--status-green)' : l.situacao === 'cancelada' ? 'var(--status-red)' : 'var(--status-yellow)' }}>{ROTULO_SITUACAO[l.situacao]}</td>
                  <td style={{ padding: '10px 12px' }}>{ROTULO_OPERACAO[l.operacao]}</td>
                  <td style={{ padding: '10px 12px' }}>{l.participante}</td>
                  <td style={{ padding: '10px 12px' }}>{l.uf}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{l.cfops.map(formatarCfop).join(', ')}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{reais(l.valor)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{reais(l.icms)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{l.cartas.length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RelatorioContador;

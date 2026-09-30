import { useEffect, useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { spedyService, type SpedyInvoice } from '../services/spedyService';
import { notaEmailService } from '../services/notaEmailService';
import { showError } from '../utils/alerts';
import {
  INTERVALO_CONSULTA_MS,
  desfechoDoStatus,
  deveContinuarConsultando,
  type DesfechoEmissao,
  type EtapaEmissao,
} from '../utils/emissaoProgressoDomain';

/**
 * Estado e consulta do pop-up de acompanhamento da emissao de nota
 * (EmissaoProgressoModal). Serve a qualquer tela que emite nota: guarda em que
 * etapa a emissao esta, pergunta a Spedy a cada INTERVALO_CONSULTA_MS ate a nota
 * ter resposta final (ou passar o limite) e grava no Firestore o que a Spedy
 * devolver. A regra de etapas, prazos e textos esta em emissaoProgressoDomain.ts.
 */

export type TipoNotaAcompanhada = 'NFS-e' | 'NF-e' | 'NFC-e';

/** Andamento do e-mail da nota ao cliente (PDF + XML), mostrado no pop-up depois da autorizacao. */
export interface EstadoEmailNota {
  status: 'enviando' | 'enviado' | 'erro';
  /** Para quem foi (e-mail do cadastro do cliente). */
  para?: string;
  /** Mensagem em portugues quando deu erro. */
  mensagem?: string;
}

/** Estado do pop-up. `null` = fechado. */
export interface ProgressoEmissao {
  tipo: TipoNotaAcompanhada;
  clienteNome: string;
  etapa: EtapaEmissao;
  /** null enquanto a emissao ainda esta rodando. */
  desfecho: DesfechoEmissao | null;
  numero?: number | null;
  codigo?: string | null;
  mensagem?: string | null;
  erroEnvio?: string | null;
  /** Id da nota na Spedy -- pra abrir a DANFE quando autorizada. */
  spedyId?: string;
  /** Id do documento em `notas_fiscais` -- o e-mail ao cliente sai por ele quando a nota e' autorizada. */
  docId?: string;
  /** Id da nota em `notas_fiscais` pra "Corrigir na nota" (sempre preenchido; `docId` so' com e-mail pelo sistema). */
  notaIdLocal?: string;
  /** Quando comecou a esperar a SEFAZ (ms) -- base do contador de segundos. */
  transmitindoDesdeMs?: number;
}

export interface ParametrosAcompanhar {
  /** Id do documento em `notas_fiscais` que recebe o status novo. */
  docId: string;
  spedyId: string;
  tipo: TipoNotaAcompanhada;
  statusInicial: string;
  /** Consulta a nota na Spedy (cada tela sabe qual servico chamar por tipo). */
  consultar: (tipo: TipoNotaAcompanhada, spedyId: string) => Promise<SpedyInvoice>;
}

export const useEmissaoAcompanhamento = () => {
  const [progresso, setProgresso] = useState<ProgressoEmissao | null>(null);
  const [segundosEsperando, setSegundosEsperando] = useState(0);
  const [abrindoDanfe, setAbrindoDanfe] = useState(false);
  const [emailNota, setEmailNota] = useState<EstadoEmailNota | null>(null);
  /** Nota cujo e-mail ja foi disparado: a autorizacao aparece em mais de um render, o e-mail sai uma vez. */
  const emailIniciadoRef = useRef<string | null>(null);
  /** Nota que o pop-up esta acompanhando: o sync automatico da lista pula ela,
   * pra nao abrir um segundo aviso por cima. */
  const notaEmAcompanhamentoRef = useRef<string | null>(null);
  /** Numero da espera em curso; fechar o pop-up ou iniciar outra emissao invalida a anterior. */
  const acompanhamentoIdRef = useRef(0);

  // Contador de segundos enquanto espera a SEFAZ responder.
  useEffect(() => {
    if (!progresso || progresso.etapa !== 'transmitindo' || progresso.desfecho !== null || !progresso.transmitindoDesdeMs) return undefined;
    const desde = progresso.transmitindoDesdeMs;
    const atualizar = () => setSegundosEsperando(Math.max(0, Math.round((Date.now() - desde) / 1000)));
    atualizar();
    const timer = setInterval(atualizar, 1000);
    return () => clearInterval(timer);
  }, [progresso]);

  const enviarEmail = async (docId: string, forcar = false) => {
    setEmailNota({ status: 'enviando' });
    try {
      const resultado = await notaEmailService.enviar(docId, forcar);
      setEmailNota({ status: 'enviado', para: resultado.para });
    } catch (erro) {
      setEmailNota({ status: 'erro', mensagem: (erro as Error).message });
    }
  };

  // Nota autorizada => e-mail com PDF e XML ao cliente (so' NF-e; o servidor le o e-mail do cadastro do cliente).
  useEffect(() => {
    if (progresso?.desfecho !== 'autorizada' || progresso.tipo !== 'NF-e' || !progresso.docId) return;
    if (emailIniciadoRef.current === progresso.docId) return;
    emailIniciadoRef.current = progresso.docId;
    void enviarEmail(progresso.docId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progresso]);

  const fechar = () => {
    emailIniciadoRef.current = null;
    setEmailNota(null);
    // Fechar no meio da espera NAO cancela a nota: ela segue na Spedy e a lista
    // atualiza sozinha. So' paramos de perguntar daqui.
    acompanhamentoIdRef.current += 1;
    notaEmAcompanhamentoRef.current = null;
    setProgresso(null);
  };

  const abrirDanfe = async () => {
    if (!progresso?.spedyId) return;
    setAbrindoDanfe(true);
    try {
      const tipoArquivo = progresso.tipo === 'NFS-e' ? 'service' : progresso.tipo === 'NFC-e' ? 'consumer' : 'product';
      await spedyService.openFiscalFile(progresso.spedyId, tipoArquivo, 'pdf');
    } catch (err) {
      showError('Erro ao abrir PDF', (err as Error).message);
    } finally {
      setAbrindoDanfe(false);
    }
  };

  /**
   * Pergunta a Spedy a cada INTERVALO_CONSULTA_MS ate a nota ter resposta final
   * (autorizada/rejeitada) ou passar o limite de espera. Grava no Firestore o que
   * a Spedy devolver, igual ao sync da lista, e mostra o resultado no pop-up.
   */
  const acompanhar = async (params: ParametrosAcompanhar) => {
    acompanhamentoIdRef.current += 1;
    const minhaVez = acompanhamentoIdRef.current;
    const iniciouEmMs = Date.now();
    notaEmAcompanhamentoRef.current = params.docId;
    let statusAtual = params.statusInicial;
    let numeroAtual: number | null | undefined;
    try {
      while (acompanhamentoIdRef.current === minhaVez) {
        await new Promise((resolve) => { setTimeout(resolve, INTERVALO_CONSULTA_MS); });
        if (acompanhamentoIdRef.current !== minhaVez) return; // usuario fechou o pop-up

        let nota: SpedyInvoice | null = null;
        try {
          nota = await params.consultar(params.tipo, params.spedyId);
        } catch (erro) {
          // Instabilidade momentanea nao encerra a espera: tenta de novo no proximo ciclo.
          console.warn('Falha ao consultar a nota na Spedy (tentando de novo):', erro);
        }

        if (nota && (nota.status !== statusAtual || nota.number !== numeroAtual)) {
          statusAtual = nota.status;
          numeroAtual = nota.number;
          await updateDoc(doc(db, 'notas_fiscais', params.docId), {
            status: nota.status,
            number: nota.number,
            accessKey: nota.accessKey || null,
            processingMessage: nota.processingDetail?.message || null,
            processingCode: nota.processingDetail?.code || null,
          }).catch((erro) => console.warn('Nao foi possivel gravar o status da nota:', erro));
        }

        const desfecho = nota ? desfechoDoStatus(nota.status) : null;
        if (nota && desfecho) {
          setProgresso((atual) => (atual ? {
            ...atual,
            desfecho,
            numero: nota.number,
            codigo: nota.processingDetail?.code ?? null,
            mensagem: nota.processingDetail?.message ?? null,
          } : atual));
          return;
        }

        if (!deveContinuarConsultando({ iniciouEmMs, agoraMs: Date.now(), status: statusAtual })) {
          setProgresso((atual) => (atual ? { ...atual, desfecho: 'demorando' } : atual));
          return;
        }
      }
    } finally {
      // Terminou (ou foi fechado): a lista volta a sincronizar essa nota sozinha.
      if (acompanhamentoIdRef.current === minhaVez) notaEmAcompanhamentoRef.current = null;
    }
  };

  const reenviarEmail = () => { if (progresso?.docId) void enviarEmail(progresso.docId, true); };

  return { progresso, setProgresso, segundosEsperando, abrindoDanfe, notaEmAcompanhamentoRef, fechar, abrirDanfe, acompanhar, emailNota, reenviarEmail };
};

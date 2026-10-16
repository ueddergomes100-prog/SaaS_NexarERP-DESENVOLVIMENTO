import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { TabActiveContext } from '../contexts/TabsContext';
import { liberarTrava, pegarTrava, renovarTrava, soltarTrava, TravaError } from '../services/travaEdicaoService';
import { NexusSwal } from '../utils/alerts';
import {
  INTERVALO_DO_SINAL_MS,
  mensagemDeBloqueio,
  travaAtiva,
  type Aparelho,
  type TipoDeTrava,
  type TravaDeEdicao,
} from '../utils/travaEdicaoDomain';
import { hasTenantFullAccess } from '../utils/roles';

/**
 * TRAVA DE EDICAO na tela (15/10/2026) -- regra em travaEdicaoDomain.ts.
 *
 * Ao abrir: pega a vez (ou fica sabendo quem esta com ela). Com a vez:
 * avisa o servidor a cada 30 s, dizendo se a pessoa mexeu na tela. Parada
 * 10 minutos, a vez vence; no primeiro toque depois disso a tela tenta pegar
 * de novo (se ninguem pegou, segue normal). Ao sair, solta.
 */

export type SituacaoDaTrava = 'desligada' | 'pegando' | 'minha' | 'de_outro' | 'sem_servidor';

const novaSessao = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
);

/** App Vendas ou aparelho de toque = celular. */
export const aparelhoAtual = (): Aparelho => {
  if (typeof window === 'undefined') return 'computador';
  if (window.location.pathname.startsWith('/vendedor')) return 'celular';
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches ? 'celular' : 'computador';
};

/** Dono, administrador ou gerente liberam um documento preso com outra pessoa. */
export const usePodeLiberarTrava = () => {
  const { userRole, isOwner, nivelAcesso } = useAuth();
  return hasTenantFullAccess(userRole, isOwner) || nivelAcesso === 'gerente';
};

export const useTravaDeEdicao = ({ tipo, registroId, ativa }: { tipo: TipoDeTrava; registroId: string | null | undefined; ativa: boolean }) => {
  const { tenantId } = useAuth();
  // Uma sessao por abertura (nao por componente): o "soltar" de uma abertura antiga nunca apaga a nova.
  const sessao = useRef('');
  const [estado, setEstado] = useState<{ situacao: SituacaoDaTrava; mensagem?: string; trava?: TravaDeEdicao }>({
    situacao: ativa && registroId ? 'pegando' : 'desligada',
  });
  const mexeu = useRef(false);
  const vencida = useRef(false);
  // So' conta como "mexeu" com a aba deste documento na frente: aberta numa
  // aba esquecida enquanto a pessoa trabalha em outra, a vez vence em 10 min.
  // (No app Vendas nao ha abas: o contexto vale sempre true.)
  const abaNaFrente = useContext(TabActiveContext);
  const abaNaFrenteRef = useRef(abaNaFrente);
  useEffect(() => { abaNaFrenteRef.current = abaNaFrente; }, [abaNaFrente]);
  const pegando = useRef(false);
  const ligada = Boolean(ativa && registroId && tenantId);
  // Pegar, avisar e soltar vao UM DE CADA VEZ: juntos, disputavam o mesmo
  // registro no banco e o pegar chegou a levar 21 s (15/10/2026).
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const emFila = useCallback(<T,>(acao: () => Promise<T>): Promise<T> => {
    const vez = fila.current.then(acao, acao);
    fila.current = vez.catch(() => undefined);
    return vez;
  }, []);

  const pegar = useCallback(async () => {
    if (!registroId) return;
    // A resposta so' vale para a abertura que pediu: uma abertura nova (outro
    // documento, ou o React montando de novo) descarta a resposta da antiga.
    const sessaoDoPedido = sessao.current;
    pegando.current = true;
    try {
      await emFila(() => pegarTrava({ tipo, registroId, sessaoId: sessaoDoPedido, aparelho: aparelhoAtual() }));
      if (sessao.current !== sessaoDoPedido) return;
      vencida.current = false;
      setEstado({ situacao: 'minha' });
    } catch (erro) {
      if (sessao.current !== sessaoDoPedido) return;
      if (erro instanceof TravaError && erro.status === 409) {
        setEstado({ situacao: 'de_outro', mensagem: erro.message, trava: erro.trava });
      } else {
        // Servidor fora: nao trava o trabalho (a gravacao de cada tela continua valendo).
        console.warn('Trava de edição sem confirmação do servidor:', erro);
        setEstado({ situacao: 'sem_servidor', mensagem: erro instanceof Error ? erro.message : undefined });
      }
    } finally {
      pegando.current = false;
    }
  }, [tipo, registroId, emFila]);

  // Abrir e soltar.
  useEffect(() => {
    if (!ligada || !registroId || !tenantId) {
      setEstado({ situacao: 'desligada' });
      return undefined;
    }
    sessao.current = novaSessao();
    setEstado({ situacao: 'pegando' });
    void pegar();
    const alvo = { tipo, registroId, sessaoId: sessao.current, tenantId };
    const aoFecharJanela = () => soltarTrava(alvo, true);
    window.addEventListener('pagehide', aoFecharJanela);
    return () => {
      window.removeEventListener('pagehide', aoFecharJanela);
      void emFila(() => soltarTrava(alvo));
    };
  }, [ligada, tipo, registroId, tenantId, pegar, emFila]);

  // "Continuo aqui" a cada 30 s, enquanto a vez e' desta tela.
  useEffect(() => {
    if (estado.situacao !== 'minha' || !registroId) return undefined;
    const timer = window.setInterval(async () => {
      if (vencida.current) return;
      const mexeuAgora = mexeu.current;
      mexeu.current = false;
      try {
        const sessaoDoAviso = sessao.current;
        const r = await emFila(() => renovarTrava({ tipo, registroId, sessaoId: sessaoDoAviso, mexeu: mexeuAgora }));
        if (sessao.current !== sessaoDoAviso) return;
        if (r.estado === 'perdeu') setEstado({ situacao: 'de_outro', mensagem: r.mensagem, trava: r.trava });
        else if (r.estado === 'venceu') vencida.current = true;
      } catch (erro) {
        console.warn('Não foi possível renovar a trava de edição:', erro);
      }
    }, INTERVALO_DO_SINAL_MS);
    return () => window.clearInterval(timer);
  }, [estado.situacao, tipo, registroId, emFila]);

  // Quem mexe na tela mantem a vez; depois de vencida, o primeiro toque tenta pegar de novo.
  useEffect(() => {
    if (!ligada) return undefined;
    const aoMexer = () => {
      if (!abaNaFrenteRef.current || document.visibilityState === 'hidden') return;
      mexeu.current = true;
      if (vencida.current && !pegando.current) {
        vencida.current = false;
        void pegar();
      }
    };
    const eventos: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'input', 'touchstart'];
    eventos.forEach((e) => window.addEventListener(e, aoMexer, { capture: true, passive: true }));
    return () => eventos.forEach((e) => window.removeEventListener(e, aoMexer, { capture: true }));
  }, [ligada, pegar]);

  const tentarDeNovo = useCallback(() => {
    setEstado({ situacao: 'pegando' });
    void pegar();
  }, [pegar]);

  /** Dono/gerente: tira a vez de quem esta com o documento e abre aqui. */
  const liberarEAbrir = useCallback(async () => {
    if (!registroId) return;
    await liberarTrava({ tipo, registroId });
    tentarDeNovo();
  }, [tipo, registroId, tentarDeNovo]);

  return { ...estado, tentarDeNovo, liberarEAbrir };
};

/**
 * Travas ativas de um tipo na empresa, para pintar a lista de cinza
 * (registroId -> trava). As do proprio usuario nao entram: abrir de novo
 * em outra tela so' passa a vez para ela.
 */
export const useTravasAtivas = (tipo: TipoDeTrava, ligado = true) => {
  const { tenantId, currentUser } = useAuth();
  const [travas, setTravas] = useState<TravaDeEdicao[]>([]);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), INTERVALO_DO_SINAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tenantId || !ligado) {
      setTravas([]);
      return undefined;
    }
    return onSnapshot(
      query(collection(db, 'travas_edicao'), where('tenantId', '==', tenantId), where('tipo', '==', tipo)),
      (snap) => setTravas(snap.docs.map((d) => d.data() as TravaDeEdicao)),
      (erro) => {
        // Regra ainda nao publicada ou sem rede: a lista so' nao fica cinza (abrir continua conferido no servidor).
        console.warn('Não foi possível ler quem está editando:', erro);
        setTravas([]);
      },
    );
  }, [tenantId, tipo, ligado]);

  return useMemo(() => new Map(
    travas
      .filter((t) => travaAtiva(t, agora) && t.usuarioId !== currentUser?.uid)
      .map((t) => [t.registroId, t] as const),
  ), [travas, agora, currentUser?.uid]);
};

/**
 * Lista: outra pessoa esta editando este documento? Mostra quem e desde
 * quando e devolve true (quem chamou NAO abre). Livre: false, pode abrir.
 */
export const avisarSeEmEdicao = (travas: Map<string, TravaDeEdicao>, tipo: TipoDeTrava, registroId: string): boolean => {
  const trava = travas.get(registroId);
  if (!trava) return false;
  void NexusSwal.fire({ title: 'Em edição por outra pessoa', text: mensagemDeBloqueio(tipo, trava), icon: 'info', confirmButtonText: 'Entendi' });
  return true;
};

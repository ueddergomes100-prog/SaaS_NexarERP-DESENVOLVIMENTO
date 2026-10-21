import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showWarning } from '../../utils/alerts';
import { enviarRascunhos, type ContextoDeEnvio } from './envioRascunhos';
import { EVENTO_RASCUNHOS_ALTERADOS, listarRascunhos } from './vendedorRascunhosStore';

/*
 * ENVIO AUTOMATICO DOS RASCUNHOS PRONTOS (app Vendas, 13/10/2026).
 *
 * Decisao do dono: o vendedor marca o pedido como "Pronto para enviar" e o
 * app manda sozinho quando tiver sinal; o que nao esta pronto continua
 * rascunho no celular. Roda na casca do app (fica montado em qualquer tela)
 * e tenta:
 *  - ao abrir o app, ao voltar o sinal e ao voltar para o app: todos os
 *    prontos, inclusive os que falharam antes;
 *  - quando a lista de rascunhos muda (marcou pronto agora): so' os prontos
 *    que ainda nao falharam -- assim uma falha nao vira tentativa sem fim.
 * Nao desenha nada; avisa com um toast quando enviou ou quando falhou.
 */

const ESPERA_APOS_MUDANCA_MS = 1500;

const EnvioAutomaticoDeRascunhos: React.FC = () => {
  const { tenantId, currentUser, userNome, trabalhaComPreVenda, permiteVendaSemEstoque, conferenciaMercadoriaAtiva, modoRotaPreVenda } = useAuth();
  const contexto = useRef<ContextoDeEnvio | null>(null);

  // Declarado antes do efeito do envio: roda primeiro, entao a tentativa de
  // abertura ja' encontra o contexto preenchido.
  useEffect(() => {
    contexto.current = tenantId && currentUser
      ? {
        tenantId,
        usuarioId: currentUser.uid,
        vendedorNome: userNome || currentUser.displayName || 'Vendedor',
        trabalhaComPreVenda: Boolean(trabalhaComPreVenda),
        permiteVendaSemEstoque: Boolean(permiteVendaSemEstoque),
        conferenciaMercadoriaAtiva: Boolean(conferenciaMercadoriaAtiva),
        modoRotaPreVenda,
      }
      : null;
  }, [tenantId, currentUser, userNome, trabalhaComPreVenda, permiteVendaSemEstoque, conferenciaMercadoriaAtiva, modoRotaPreVenda]);

  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | null = null;

    const tentar = async (incluirOsQueFalharam: boolean) => {
      const ctx = contexto.current;
      if (!vivo || !ctx) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const temPronto = listarRascunhos(ctx.tenantId, ctx.usuarioId)
        .some((r) => r.pronto && (incluirOsQueFalharam || !r.ultimoErro));
      if (!temPronto) return;
      const resultados = await enviarRascunhos(ctx, (r) => Boolean(r.pronto) && (incluirOsQueFalharam || !r.ultimoErro));
      if (!vivo || resultados.length === 0) return;
      const enviados = resultados.filter((r) => r.ok);
      const falhas = resultados.filter((r) => !r.ok);
      if (enviados.length > 0) {
        showSuccess(enviados.length === 1 ? `${enviados[0].mensagem}.` : `${enviados.length} rascunhos prontos foram enviados para a loja.`);
      }
      if (falhas.length > 0) {
        showWarning(
          falhas.length === 1 ? 'Um rascunho pronto não foi enviado' : `${falhas.length} rascunhos prontos não foram enviados`,
          `${falhas[0].descricao}: ${falhas[0].mensagem} O app tenta de novo quando o sinal voltar; o motivo fica em Rascunhos.`,
        );
      }
    };

    const aoMudarRascunhos = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => { void tentar(false); }, ESPERA_APOS_MUDANCA_MS);
    };
    const aoVoltarSinal = () => { void tentar(true); };
    const aoVoltarParaOApp = () => { if (document.visibilityState === 'visible') void tentar(true); };

    void tentar(true);
    window.addEventListener(EVENTO_RASCUNHOS_ALTERADOS, aoMudarRascunhos);
    window.addEventListener('online', aoVoltarSinal);
    document.addEventListener('visibilitychange', aoVoltarParaOApp);
    return () => {
      vivo = false;
      if (espera) clearTimeout(espera);
      window.removeEventListener(EVENTO_RASCUNHOS_ALTERADOS, aoMudarRascunhos);
      window.removeEventListener('online', aoVoltarSinal);
      document.removeEventListener('visibilitychange', aoVoltarParaOApp);
    };
    // O contexto vem do ref; reinicia so' quando troca de empresa ou de login.
  }, [tenantId, currentUser?.uid]);

  return null;
};

export default EnvioAutomaticoDeRascunhos;

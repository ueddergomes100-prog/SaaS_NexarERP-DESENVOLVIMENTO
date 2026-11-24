import { useCallback, useRef, useState, type ReactNode } from 'react';
import PdfVisualizador from '../components/common/PdfVisualizador';
import { emitirBoletosDoDocumento } from '../services/boletoEmissaoService';
import { resumoDaEmissaoNaHora } from '../utils/boletoEmissaoDomain';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../utils/alerts';

/*
 * "EMITIR AGORA" DO FIM DA VENDA E DA OS (24/11/2026, pedido do dono).
 *
 * Antes o botao so' abria Financeiro > Boletos e a pessoa clicava em emitir de
 * novo. Agora emite ali mesmo e abre o boleto para imprimir; o titulo aparece
 * sozinho na aba "Emitidos" da tela de Boletos (mesmo caminho de gravacao).
 *
 * `emitirBoletosNaHora` so' termina quando a pessoa fecha a janela do boleto,
 * para o resto do fim da venda (recibo, minuta, nota) continuar depois.
 * A tela precisa renderizar `janelaDoBoleto`.
 */
export const useEmitirBoletosNaHora = (a: { tenantId: string | null | undefined; uid: string | null | undefined }): {
  emitirBoletosNaHora: (alvo: { pedidoId?: string; osId?: string }) => Promise<void>;
  janelaDoBoleto: ReactNode;
} => {
  const { tenantId, uid } = a;
  const [pdf, setPdf] = useState<{ blob: Blob; nome: string } | null>(null);
  const aoFecharRef = useRef<(() => void) | null>(null);

  const fechar = useCallback(() => {
    setPdf(null);
    const continuar = aoFecharRef.current;
    aoFecharRef.current = null;
    continuar?.();
  }, []);

  const emitirBoletosNaHora = useCallback(async (alvo: { pedidoId?: string; osId?: string }) => {
    if (!tenantId || !uid) {
      await showError('Não foi possível emitir o boleto', 'Sessão sem empresa identificada. Atualize a página e emita em Financeiro → Boletos, aba "Aguardando emissão".');
      return;
    }
    void NexusSwal.fire({
      title: 'Emitindo o boleto...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => NexusSwal.showLoading(),
    });
    try {
      const resultado = await emitirBoletosDoDocumento({ tenantId, uid, ...alvo });
      NexusSwal.close();
      const resumo = resumoDaEmissaoNaHora(resultado.emitidos, resultado.pedidos);
      if (resultado.falhas.length > 0) {
        await NexusSwal.fire({
          title: resumo,
          html: `<div style="text-align:left;font-size:14px">${resultado.falhas.map(escaparHtml).join('<br/><br/>')}`
            + (resultado.emitidos < resultado.pedidos ? '<br/><br/>O que não saiu continua em Financeiro → Boletos, aba "Aguardando emissão".' : '')
            + '</div>',
          icon: resultado.emitidos > 0 ? 'warning' : 'error',
          confirmButtonText: 'Entendi',
        });
      } else {
        showSuccess(resumo);
      }
      if (resultado.pdf) {
        const pronto = resultado.pdf;
        await new Promise<void>((resolve) => {
          aoFecharRef.current = resolve;
          setPdf(pronto);
        });
      }
    } catch (erro) {
      NexusSwal.close();
      const semPermissao = (erro as { code?: string })?.code === 'permission-denied';
      await showError('Não foi possível emitir o boleto', semPermissao
        ? 'Seu usuário não tem permissão para emitir boleto. Peça a quem cuida do financeiro para emitir em Financeiro → Boletos.'
        : `${(erro as Error)?.message || 'Tente de novo em instantes.'} A venda foi gravada normalmente.`);
    }
  }, [tenantId, uid]);

  const janelaDoBoleto = pdf
    ? <PdfVisualizador titulo="Boleto" nomeArquivo={pdf.nome} pdf={pdf.blob} onFechar={fechar} />
    : null;

  return { emitirBoletosNaHora, janelaDoBoleto };
};

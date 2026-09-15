import { useEffect, useRef } from 'react';
import { NexusSwal } from '../../utils/alerts';
import { formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';

const INTERVALO_DE_CHECAGEM_MS = 60_000;

/**
 * O sistema fica aberto no balcao por dias seguidos (PC ligado, navegador
 * nunca recarregado), e as telas guardam a data de quando foram montadas --
 * `dataVenda` em PedidoVendaForm.tsx nasce de um `useState` que so roda no
 * mount, e as abas nunca desmontam (ver TabPane.tsx). Resultado: a primeira
 * venda feita depois da virada do dia grava a data de ONTEM, some do
 * relatorio do dia e infla o faturamento do dia anterior. Foi exatamente o
 * que aconteceu com o pedido #0154 do Shopping Rural, gravado com
 * dataVenda=09/09/2026 as 10:02 do dia 10/09/2026.
 *
 * Recarregar e' o unico jeito de garantir que TODAS as telas voltem a
 * concordar com o dia de hoje sem ter que mapear cada campo de data uma a
 * uma. O recarregamento so acontece depois do OK do usuario, nunca sozinho.
 */
const VerificadorDataDoSistema = () => {
  const dataDeReferencia = useRef(getDateInputInTimeZone());
  const avisoNaTela = useRef(false);

  useEffect(() => {
    const verificar = async () => {
      const hoje = getDateInputInTimeZone();
      if (hoje === dataDeReferencia.current || avisoNaTela.current) return;

      avisoNaTela.current = true;
      await NexusSwal.fire({
        icon: 'info',
        title: 'A data mudou',
        html: `Este sistema está aberto desde <b>${formatDateInputPtBr(dataDeReferencia.current)}</b> e hoje já é <b>${formatDateInputPtBr(hoje)}</b>.`
          + '<br><br>Vamos atualizar a data para que suas vendas sejam lançadas no dia de hoje.'
          + '<br><br>Se você tem uma venda montada na tela e ainda não finalizou, anote os itens antes de continuar: a tela será recarregada.',
        confirmButtonText: 'Atualizar agora',
        allowOutsideClick: false,
        allowEscapeKey: false,
      });
      window.location.reload();
    };

    void verificar();

    const aoVoltarParaATela = () => {
      if (document.visibilityState === 'visible') void verificar();
    };
    const aoFocar = () => { void verificar(); };

    const timer = window.setInterval(() => { void verificar(); }, INTERVALO_DE_CHECAGEM_MS);
    document.addEventListener('visibilitychange', aoVoltarParaATela);
    window.addEventListener('focus', aoFocar);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltarParaATela);
      window.removeEventListener('focus', aoFocar);
    };
  }, []);

  return null;
};

export default VerificadorDataDoSistema;

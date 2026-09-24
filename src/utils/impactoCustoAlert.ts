import { NexusSwal } from './alerts';
import { htmlDoImpactoDeCusto, type ResultadoDoRecalculo } from './custoProducaoDomain';

/** Janela com o impacto do custo nos produtos acabados. Nao abre se nada mudou. */
export const mostrarImpactoDeCusto = async (resultado: ResultadoDoRecalculo, titulo = 'Custo dos produtos acabados atualizado') => {
  const html = htmlDoImpactoDeCusto(resultado);
  if (!html) return;
  await NexusSwal.fire({
    icon: resultado.impactos.some((i) => i.vendeAbaixoDoCusto) ? 'warning' : 'info',
    title: titulo,
    html,
    width: 900,
    confirmButtonText: 'Entendi',
  });
};

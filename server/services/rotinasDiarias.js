/*
 * ROTINAS DIARIAS DO SERVIDOR (20/10/2026).
 *
 * Hoje: o resumo de cashback dos clientes cujo lote venceu sem venda nova
 * (services/cashback.js, atualizarResumosVencidos). Roda de madrugada (00h20,
 * horario de Brasilia) e uma vez logo depois que o servidor sobe -- deploy e
 * reinicio da hospedagem nao deixam o dia passar em branco. E' idempotente.
 */
const cron = require('node-cron');
const { atualizarResumosVencidos } = require('./cashback');

let rodando = false;

const rodarRotinas = async () => {
  if (rodando) return null;
  rodando = true;
  try {
    const cashback = await atualizarResumosVencidos();
    if (cashback.encontrados > 0) {
      console.log(`[Rotinas diárias] cashback: ${cashback.atualizados} resumo(s) regravado(s) de ${cashback.encontrados} com lote vencido.`);
    }
    return { cashback };
  } catch (erro) {
    console.error('[Rotinas diárias] falhou:', erro.message);
    return null;
  } finally {
    rodando = false;
  }
};

const iniciarRotinasDiarias = () => {
  cron.schedule('20 0 * * *', () => { void rodarRotinas(); }, { timezone: 'America/Sao_Paulo' });
  setTimeout(() => { void rodarRotinas(); }, 30_000);
};

module.exports = { iniciarRotinasDiarias, rodarRotinas };

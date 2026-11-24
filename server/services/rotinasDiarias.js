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
const { rotinaDiariaDaCobranca } = require('./mensalidades');

let rodando = false;

/*
 * 24/11/2026: mensalidades das empresas clientes -- cria a mensalidade do mes
 * que chegou na antecedencia e recalcula o resumo/bloqueio nos perfis (pega
 * usuario criado depois da ultima acao do SuperAdmin). Falha aqui nao impede
 * as outras rotinas.
 */
const rodarCobranca = async () => {
  try {
    const r = await rotinaDiariaDaCobranca();
    const emails = r.emails || {};
    if (r.criadas || r.alterados || emails.enviados || emails.falhas || emails.vespera) {
      console.log(`[Rotinas diárias] mensalidades: ${r.criadas} criada(s), ${r.alterados} perfil(is) atualizado(s) em ${r.empresas} empresa(s); e-mails: ${emails.enviados || 0} enviado(s), ${emails.falhas || 0} falha(s), véspera ${emails.vespera || 0}.`);
    }
    return r;
  } catch (erro) {
    console.error('[Rotinas diárias] mensalidades falhou:', erro.message);
    return null;
  }
};

const rodarRotinas = async () => {
  if (rodando) return null;
  rodando = true;
  try {
    const cobranca = await rodarCobranca();
    const cashback = await atualizarResumosVencidos();
    if (cashback.encontrados > 0) {
      console.log(`[Rotinas diárias] cashback: ${cashback.atualizados} resumo(s) regravado(s) de ${cashback.encontrados} com lote vencido.`);
    }
    return { cashback, cobranca };
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

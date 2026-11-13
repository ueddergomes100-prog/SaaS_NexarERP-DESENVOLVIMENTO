/**
 * TRANSPORTE NA NOTA DE DEVOLUCAO (13/11/2026, pedido do dono).
 *
 * A nota de devolucao (de venda e ao fornecedor) saia sem o bloco de
 * transporte: nao havia onde informar quem paga o frete, a transportadora, a
 * placa, os volumes e os pesos -- e a mercadoria devolvida viaja.
 *
 * A tela manda o transporte na hora de emitir (mesmo formato do Pedido de
 * Venda, regra em transporteNotaDomain). Aqui o servidor limpa o que veio,
 * busca a transportadora NO CADASTRO (nunca confia em nome/CNPJ do corpo) e
 * monta o grupo de transporte da nota. Cadastro incompleto bloqueia com a
 * mensagem de onde corrigir.
 *
 * O VALOR do frete nao entra aqui de proposito: ele mexeria no total e na base
 * dos impostos da devolucao, que espelham a nota de origem.
 */
const { db } = require('../config/firebase');
const tn = require('../domain/transporteNotaDomain');

const ONDE = 'na janela da nota de devolução';

/**
 * Devolve { transporte, transport, avisos }:
 *  - transporte: o que guardar na devolucao (para a proxima tentativa ja' vir
 *    preenchida), ou null quando nada foi informado;
 *  - transport: o grupo que vai na nota, ou null (a nota sai sem o bloco, como antes).
 * Lanca `new Erro(422, mensagem)` quando o cadastro impede.
 */
async function prepararTransporteDaDevolucao({ tenantId, bruto, Erro }) {
  const transporte = tn.lerTransporte(bruto);
  if (!tn.temTransporte(transporte)) return { transporte: null, transport: null, avisos: [] };

  let transportadora = null;
  if (transporte.transportadoraId) {
    const snap = await db.collection('fornecedores').doc(transporte.transportadoraId).get();
    if (snap.exists && snap.data().tenantId === tenantId) {
      const d = snap.data();
      transportadora = {
        nome: d.nome || '', documento: d.cnpj || '', inscricaoEstadual: d.identidade || '',
        endereco: d.endereco || '', numero: d.numero || '', bairro: d.bairro || '', cep: d.cep || '',
        cidade: d.cidade || '', estado: d.estado || '', codigoIbge: d.codigoIbge || '',
        email: d.email || '', telefone: d.telefone || d.celular || '',
      };
      // O nome guardado e' o do cadastro, nao o que a tela mandou.
      transporte.transportadoraNome = String(d.nome || '').trim().slice(0, 120);
    }
  }

  const montado = tn.montarTransporteDaNota({ transporte, frete: 0, transportadora, onde: ONDE });
  if (!montado.ok) throw new Erro(422, montado.erro);
  return { transporte: tn.transporteParaGravar(transporte), transport: montado.transport, avisos: montado.avisos };
}

module.exports = { prepararTransporteDaDevolucao };

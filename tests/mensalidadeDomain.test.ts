import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRAZOS_PADRAO,
  casarArquivosComMensalidades,
  comoPagarOBoleto,
  competenciasDoCarne,
  competenciasParaGerar,
  ehVesperaDoBloqueio,
  lembreteDoDia,
  textoDaVespera,
  textoDoLembrete,
  deveAbrirJanelaDeCobranca,
  formatarLinhaDigitavel,
  formatarMoeda,
  hojeEmBrasilia,
  inicioDoDiaEmBrasilia,
  lerBoleto,
  lerMensalidade,
  lerPlanoCobranca,
  lerPrazos,
  lerResumoDaCobranca,
  montarResumoDaCobranca,
  primeiraCompetencia,
  situacaoDaCobranca,
  textoDaCobranca,
  textoDoAviso,
  validarBoletoDigitado,
  validarDataDoPagamento,
  validarLiberacao,
  validarPrazos,
  vencimentoDaCompetencia,
  veAvisoDeCobranca,
  type MensalidadeLida,
} from '../src/utils/mensalidadeDomain';

const LINHA = '23793381286000000000300000000400184340000014990';
// Prazos fixos nos testes de datas (o padrao do dono muda; a regra nao).
const P = { diasLembreteAntes: 3, diasAvisoForte: 5, diasBloqueio: 10 };

const mensalidade = (competencia: string, vencimento: string, extra: Partial<MensalidadeLida> = {}): MensalidadeLida => ({
  id: `dono_${competencia}`,
  tenantId: 'dono',
  competencia,
  vencimento,
  valor: 149.9,
  situacao: 'aberta',
  pagoEm: null,
  boleto: { linhaDigitavel: LINHA },
  ...extra,
});

test('vencimento do mes: dia 31 em fevereiro cai no ultimo dia', () => {
  assert.equal(vencimentoDaCompetencia('2026-02', 31), '2026-02-28');
  assert.equal(vencimentoDaCompetencia('2028-02', 30), '2028-02-29');
  assert.equal(vencimentoDaCompetencia('2026-11', 10), '2026-11-10');
});

test('hoje e inicio do dia em Brasilia (UTC-3)', () => {
  assert.equal(hojeEmBrasilia(new Date('2026-11-25T02:59:00Z')), '2026-11-24');
  assert.equal(hojeEmBrasilia(new Date('2026-11-25T03:00:00Z')), '2026-11-25');
  assert.equal(inicioDoDiaEmBrasilia('2026-11-20').toISOString(), '2026-11-20T03:00:00.000Z');
});

test('prazos padrao 3/5/10 e prazos invalidos caem no padrao', () => {
  assert.deepEqual(lerPrazos(undefined), PRAZOS_PADRAO);
  assert.deepEqual(lerPrazos({ diasLembreteAntes: 2, diasAvisoForte: 7, diasBloqueio: 15 }), { diasLembreteAntes: 2, diasAvisoForte: 7, diasBloqueio: 15 });
  assert.deepEqual(lerPrazos({ diasAvisoForte: 20, diasBloqueio: 10 }), PRAZOS_PADRAO, 'aviso depois do bloqueio nao vale');
  assert.match(validarPrazos({ diasLembreteAntes: 3, diasAvisoForte: 12, diasBloqueio: 10 }) || '', /antes do bloqueio/);
});

test('geracao do mes: 10 dias antes do vencimento, a partir do inicio, sem repetir', () => {
  const plano = lerPlanoCobranca({ ativa: true, diaVencimento: 10, inicioCompetencia: '2026-11' });
  assert.deepEqual(competenciasParaGerar({ hoje: '2026-10-30', plano, existentes: [] }), [], 'falta mais de 10 dias');
  assert.deepEqual(competenciasParaGerar({ hoje: '2026-10-31', plano, existentes: [] }), ['2026-11']);
  assert.deepEqual(competenciasParaGerar({ hoje: '2026-11-30', plano, existentes: ['2026-11'] }), ['2026-12']);
  assert.deepEqual(competenciasParaGerar({ hoje: '2027-06-01', plano, existentes: [] }).length, 3, 'no maximo 3 por vez');
  assert.deepEqual(competenciasParaGerar({ hoje: '2026-11-05', plano: { ...plano, ativa: false }, existentes: [] }), []);
});

test('primeira competencia: o proximo vencimento a partir de hoje', () => {
  assert.equal(primeiraCompetencia('2026-11-24', 10), '2026-12');
  assert.equal(primeiraCompetencia('2026-11-24', 24), '2026-11');
  assert.equal(primeiraCompetencia('2026-11-24', 31), '2026-11');
});

test('resumo usa a mensalidade aberta mais antiga e soma as abertas', () => {
  const r = montarResumoDaCobranca({
    matrizId: 'dono',
    abertas: [
      mensalidade('2026-12', '2026-12-10'),
      mensalidade('2026-11', '2026-11-10', { boleto: { linhaDigitavel: LINHA, pdfCaminho: 'cobranca/dono/x.pdf' } }),
      mensalidade('2026-10', '2026-10-10', { situacao: 'paga' }),
    ],
    prazos: P,
    liberadoAte: null,
  });
  assert.ok(r);
  assert.equal(r.mensalidadeId, 'dono_2026-11');
  assert.equal(r.valorEmAberto, 299.8);
  assert.equal(r.quantidadeEmAberto, 2);
  assert.equal(r.lembreteDesde, '2026-11-07');
  assert.equal(r.avisoForteDesde, '2026-11-15');
  assert.equal(r.bloqueioEm, '2026-11-20', 'bloqueio no 10o dia de atraso');
  assert.deepEqual(r.boleto, { linhaDigitavel: LINHA }, 'o caminho do Storage nao vai para a empresa');
  assert.equal('liberadoAte' in r, false, 'sem chave vazia (nunca undefined no Firestore)');
  assert.equal(montarResumoDaCobranca({ matrizId: 'dono', abertas: [], prazos: P, liberadoAte: null }), null);
});

test('liberar ate adia o bloqueio para o dia seguinte; liberacao antiga nao antecipa', () => {
  const abertas = [mensalidade('2026-11', '2026-11-10')];
  const liberado = montarResumoDaCobranca({ matrizId: 'dono', abertas, prazos: P, liberadoAte: '2026-11-25' });
  assert.equal(liberado?.bloqueioEm, '2026-11-26');
  assert.equal(liberado?.liberadoAte, '2026-11-25');
  const antiga = montarResumoDaCobranca({ matrizId: 'dono', abertas, prazos: P, liberadoAte: '2026-11-12' });
  assert.equal(antiga?.bloqueioEm, '2026-11-20');
  assert.equal(antiga && 'liberadoAte' in antiga, false);
});

test('etapas: lembrete, vence hoje, atrasada, aviso forte, bloqueada', () => {
  const r = montarResumoDaCobranca({ matrizId: 'dono', abertas: [mensalidade('2026-11', '2026-11-10')], prazos: P, liberadoAte: null });
  const etapa = (hoje: string) => situacaoDaCobranca(r, hoje).etapa;
  assert.equal(etapa('2026-11-06'), 'em_dia');
  assert.equal(etapa('2026-11-07'), 'lembrete');
  assert.equal(etapa('2026-11-10'), 'vence_hoje');
  assert.equal(etapa('2026-11-11'), 'atrasada');
  assert.equal(etapa('2026-11-15'), 'aviso_forte');
  assert.equal(etapa('2026-11-19'), 'aviso_forte');
  assert.equal(etapa('2026-11-20'), 'bloqueada');
  const s = situacaoDaCobranca(r, '2026-11-17');
  assert.deepEqual([s.diasDeAtraso, s.diasParaBloqueio], [7, 3]);
  assert.equal(situacaoDaCobranca(null, '2026-11-20').etapa, 'em_dia');
});

test('liberada mostra aviso ate o fim da liberacao e bloqueia no dia seguinte', () => {
  const r = montarResumoDaCobranca({ matrizId: 'dono', abertas: [mensalidade('2026-11', '2026-11-10')], prazos: P, liberadoAte: '2026-11-25' });
  assert.equal(situacaoDaCobranca(r, '2026-11-21').etapa, 'liberada');
  assert.equal(situacaoDaCobranca(r, '2026-11-26').etapa, 'bloqueada');
});

test('textos em portugues dizem o que fazer', () => {
  const r = montarResumoDaCobranca({ matrizId: 'dono', abertas: [mensalidade('2026-11', '2026-11-10')], prazos: P, liberadoAte: null })!;
  const forte = textoDoAviso(r, situacaoDaCobranca(r, '2026-11-17'));
  assert.equal(forte.tom, 'perigo');
  assert.match(forte.texto, /será bloqueado em 3 dias, em 20\/11\/2026/);
  assert.match(textoDoAviso(r, situacaoDaCobranca(r, '2026-11-08')).texto, /vence em 2 dias, em 10\/11\/2026\. Copie a linha digitável\.$/);
});

test('padrao do dono: lembrete 3 dias antes, aviso forte com 4, bloqueio no 7o dia', () => {
  assert.deepEqual(PRAZOS_PADRAO, { diasLembreteAntes: 3, diasAvisoForte: 4, diasBloqueio: 7 });
  const r = montarResumoDaCobranca({ matrizId: 'dono', abertas: [mensalidade('2026-11', '2026-11-10')], prazos: PRAZOS_PADRAO, liberadoAte: null });
  assert.equal(r?.bloqueioEm, '2026-11-17');
  assert.equal(r?.avisoForteDesde, '2026-11-14');
});

test('sem boleto anexado nao avisa nem bloqueia (a falta e nossa)', () => {
  const semBoleto = mensalidade('2026-11', '2026-11-10', { boleto: {} });
  assert.equal(montarResumoDaCobranca({ matrizId: 'dono', abertas: [semBoleto], prazos: P, liberadoAte: null }), null);
  const comOutra = montarResumoDaCobranca({ matrizId: 'dono', abertas: [semBoleto, mensalidade('2026-12', '2026-12-10')], prazos: P, liberadoAte: null });
  assert.equal(comOutra?.mensalidadeId, 'dono_2026-12', 'vale a mais antiga COM boleto');
  assert.equal(comOutra?.valorEmAberto, 149.9, 'a sem boleto nao entra na soma');
  assert.equal(lembreteDoDia(semBoleto, P, null, '2026-11-25'), null);
});

test('carne: 12 meses seguidos a partir do primeiro; arquivos casados por ordem', () => {
  assert.deepEqual(competenciasDoCarne('2026-12', 3), ['2026-12', '2027-01', '2027-02']);
  assert.equal(competenciasDoCarne('2026-01', 40).length, 12);
  assert.deepEqual(competenciasDoCarne('2026-13', 2), []);
  const casados = casarArquivosComMensalidades(
    [{ name: 'boleto-10.pdf' }, { name: 'boleto-2.pdf' }],
    [{ id: 'b', vencimento: '2027-01-10' }, { id: 'a', vencimento: '2026-12-10' }, { id: 'c', vencimento: '2027-02-10' }],
  );
  assert.deepEqual(casados.map((c) => [c.mensalidadeId, c.arquivo?.name ?? null]), [['a', 'boleto-2.pdf'], ['b', 'boleto-10.pdf'], ['c', null]]);
});

test('e-mail da rotina: etapa de hoje e vespera do bloqueio', () => {
  const m = mensalidade('2026-11', '2026-11-10');
  const tipo = (hoje: string, liberadoAte: string | null = null) => lembreteDoDia(m, P, liberadoAte, hoje);
  assert.equal(tipo('2026-11-06'), null);
  assert.equal(tipo('2026-11-07'), 'antes');
  assert.equal(tipo('2026-11-10'), 'dia');
  assert.equal(tipo('2026-11-12'), 'dia');
  assert.equal(tipo('2026-11-13'), 'atraso');
  assert.equal(tipo('2026-11-20'), 'bloqueio');
  assert.equal(tipo('2026-11-20', '2026-11-25'), 'atraso', 'liberada: ainda nao bloqueou');
  assert.equal(lembreteDoDia({ ...m, situacao: 'paga' }, P, null, '2026-11-20'), null);
  assert.equal(ehVesperaDoBloqueio(m, P, null, '2026-11-19'), true);
  assert.equal(ehVesperaDoBloqueio(m, P, null, '2026-11-18'), false);
  const t = textoDoLembrete('atraso', { empresa: 'LOJA', competencia: '2026-11', vencimento: '2026-11-10', valor: 149.9, boleto: m.boleto, bloqueioEm: '2026-11-20' });
  assert.match(t.assunto, /em atraso desde 10\/11\/2026/);
  assert.match(t.texto, /^Olá, LOJA!\nA mensalidade de novembro\/2026 venceu em 10\/11\/2026.*20\/11\/2026/);
  assert.match(t.texto, /Linha digitável: 23793/);
  assert.match(textoDaVespera([{ empresa: 'LOJA', valor: 149.9, vencimento: '2026-11-10' }], '2026-11-20').texto, /- LOJA: R\$ 149,90/);
});

test('como pagar segue o que foi anexado (sem PDF, nao manda imprimir)', () => {
  assert.equal(comoPagarOBoleto({ linhaDigitavel: LINHA, link: 'https://x' }), 'Copie a linha digitável ou pague pelo link.');
  assert.equal(comoPagarOBoleto({ pdfUrl: 'https://x', linhaDigitavel: LINHA, link: 'https://y' }), 'Imprima o boleto, copie a linha digitável ou pague pelo link.');
  assert.match(comoPagarOBoleto(undefined), /ainda não foi anexado/);
});

test('resumo lido do perfil: formato errado = sem cobranca', () => {
  const r = montarResumoDaCobranca({ matrizId: 'dono', abertas: [mensalidade('2026-11', '2026-11-10')], prazos: P, liberadoAte: null, contato: { whatsapp: '33999990000' } });
  assert.deepEqual(lerResumoDaCobranca(JSON.parse(JSON.stringify(r))), r);
  assert.equal(lerResumoDaCobranca({ vencimento: 'ontem' }), null);
  assert.equal(lerResumoDaCobranca(null), null);
});

test('boleto: basta um dos itens; linha digitavel conferida', () => {
  assert.deepEqual(validarBoletoDigitado({ linhaDigitavel: '2379 3381 2860 0000 0000 3000 0000 0400 1843 4000 0014 990' }), { boleto: { linhaDigitavel: LINHA } });
  assert.match((validarBoletoDigitado({ linhaDigitavel: '123' }) as { erro: string }).erro, /tem 3 números/);
  assert.match((validarBoletoDigitado({ link: 'picpay.me/x' }) as { erro: string }).erro, /https/);
  assert.match((validarBoletoDigitado({}) as { erro: string }).erro, /Anexe o PDF/);
  assert.deepEqual(lerBoleto({ pdfUrl: 'http://inseguro', link: 'https://picpay.me/x', pixCopiaECola: '' }), { link: 'https://picpay.me/x' });
  assert.equal(formatarLinhaDigitavel(LINHA), '23793.38128 60000.000003 00000.000400 1 84340000014990');
});

test('texto da cobranca leva valor, vencimento e o que estiver anexado', () => {
  const t = textoDaCobranca({ empresa: 'EMBALA MINAS', competencia: '2026-11', vencimento: '2026-11-10', valor: 1499, boleto: { link: 'https://picpay.me/x' } });
  assert.match(t.assunto, /novembro\/2026/);
  assert.match(t.texto, /R\$ 1\.499,00, vencimento em 10\/11\/2026/);
  assert.match(t.texto, /Pagar pelo link: https:\/\/picpay\.me\/x/);
  assert.doesNotMatch(t.texto, /Linha digitável/);
  assert.equal(formatarMoeda(149.9), 'R$ 149,90');
});

test('pagamento e liberacao: datas conferidas', () => {
  assert.equal(validarDataDoPagamento('2026-11-24', '2026-11-24'), null);
  assert.match(validarDataDoPagamento('2026-11-25', '2026-11-24') || '', /depois de hoje/);
  assert.match(validarLiberacao('2026-11-23', '2026-11-24') || '', /antes de hoje/);
  assert.match(validarLiberacao('2027-01-30', '2026-11-24') || '', /no máximo/);
  assert.equal(validarLiberacao('2026-12-01', '2026-11-24'), null);
});

test('quem ve o aviso e quando a janela abre', () => {
  assert.equal(veAvisoDeCobranca('Master'), true);
  assert.equal(veAvisoDeCobranca('Admin'), true);
  assert.equal(veAvisoDeCobranca('Funcionario'), false);
  assert.equal(deveAbrirJanelaDeCobranca('', '2026-11-24', 'atrasada'), true);
  assert.equal(deveAbrirJanelaDeCobranca('2026-11-24', '2026-11-24', 'atrasada'), false);
  assert.equal(deveAbrirJanelaDeCobranca('', '2026-11-24', 'em_dia'), false);
  assert.equal(deveAbrirJanelaDeCobranca('', '2026-11-24', 'bloqueada'), false, 'bloqueada tem a tela propria');
});

test('mensalidade lida do banco: sem campo = valor seguro', () => {
  const m = lerMensalidade('x', { tenantId: 'dono', competencia: '2026-11', vencimento: '2026-11-10', valor: '149.9', situacao: 'outra' });
  assert.equal(m.situacao, 'aberta');
  assert.equal(m.valor, 149.9);
  assert.equal(m.pagoEm, null);
});

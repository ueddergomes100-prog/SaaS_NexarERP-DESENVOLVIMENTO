/*
 * CONFIGURACOES GERAIS (pedido do dono, 15/10/2026) -- ver
 * src/utils/configuracoesGeraisDomain.ts.
 *
 * Alguns campos de `configuracoes/{filial}` valem para o grupo inteiro
 * (plano de contas, validacao de produto e de cliente, limite de credito,
 * transferencia entre filiais). A tela "Configuracoes Gerais" manda salvar
 * aqui e o servidor grava o MESMO valor em todas as filiais do grupo, numa
 * transacao so' -- as firestore.rules so' deixam o navegador gravar a
 * configuracao da filial ativa. Empresa sem filiais: grava so' a dela.
 */
const { db, admin } = require('../config/firebase');
const dominio = require('../domain/configuracoesGeraisDomain');
const filialDominio = require('../domain/filialDomain');
const cashbackDominio = require('../domain/cashbackDomain');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { PERMISSAO_ADMINISTRACAO, PERMISSAO_TROCA_ADMINISTRADOR, permissaoDoCampoGeral } = require('../domain/permissoesNovasDomain');
const { temNoCadastro, mensagemSemPermissao } = require('./permissoesAdministracao');

class ErroConfiguracoesGerais extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const apagar = () => admin.firestore.FieldValue.delete();

const lerGrupo = async (leitor, tenantId) => {
  const configSnap = await leitor.get(db.collection('configuracoes').doc(tenantId));
  const grupoId = configSnap.exists && typeof configSnap.data().grupoId === 'string' ? configSnap.data().grupoId : '';
  if (!grupoId) return null;
  const grupoSnap = await leitor.get(db.collection('grupos').doc(grupoId));
  return grupoSnap.exists ? filialDominio.lerGrupo(grupoSnap.id, grupoSnap.data()) : null;
};

/**
 * Tabelas fiscais (tabelasFiscais.js: ativar/desativar CFOP) gravam em todas
 * as filiais: o dono, ou quem tem "Fiscal: Tabelas Fiscais -- ativar e
 * desativar CFOP" (troca do administrador, 25/11/2026: antes, com filiais, o
 * papel de administrador do grupo bastava; o administrador que o dono ainda
 * nao salvou tem todas). Sem filiais, "Admin: Configuracoes" continua valendo
 * (era a regra de antes). As Configuracoes Gerais deixaram de usar esta (ver
 * valoresPermitidos).
 */
const PERMISSAO_ATIVAR_CFOP = PERMISSAO_TROCA_ADMINISTRADOR.tabelasAtivar;
const exigirPermissao = (user, usuario, grupo) => {
  if (user.isPlatformAdmin) return;
  if (grupo) {
    if (filialDominio.ehGestorDoGrupo(grupo, usuario)) return;
    if (filialDominio.pertenceAoGrupo(grupo, usuario) && temNoCadastro(user, PERMISSAO_ATIVAR_CFOP)) return;
    throw new ErroConfiguracoesGerais(403, mensagemSemPermissao([PERMISSAO_ATIVAR_CFOP]));
  }
  if (user.dono || (user.permissoes || []).includes('administrativo.config') || temNoCadastro(user, PERMISSAO_ATIVAR_CFOP)) return;
  throw new ErroConfiguracoesGerais(403, mensagemSemPermissao([PERMISSAO_ATIVAR_CFOP]));
};

/**
 * Item 15 (fase Administracao, 25/11/2026): cada parte das Configuracoes
 * Gerais pede a sua permissao (PERMISSAO_DO_CAMPO_GERAL): plano de contas,
 * regras do cashback e o resto ("Admin: Configuracoes gerais"). Quem tinha
 * "Admin: Configuracoes" ja' vem com as tres (pacote 'administracao-1').
 * O dono (do grupo, com filiais) segue liberado; o administrador, pelas
 * permissoes (troca do administrador, 25/11/2026). Com filiais, quem nao e' o
 * dono precisa ser de uma filial do grupo.
 */
const podeNoCampo = (user, usuario, grupo, permissao) => {
  if (user.isPlatformAdmin) return true;
  // As permissoes vem do login (req.user), como nas outras rotas; o cadastro lido serve ao grupo.
  if (grupo) {
    return filialDominio.ehGestorDoGrupo(grupo, usuario)
      || (filialDominio.pertenceAoGrupo(grupo, usuario) && temNoCadastro(user, permissao));
  }
  return Boolean(user.dono) || temNoCadastro(user, permissao, { semFiliais: true });
};

/**
 * Sem a permissao do campo, ele NAO e' gravado (fica o que esta' no banco);
 * se a tela mandou um valor diferente do gravado, recusa em portugues. Puro.
 * Devolve `{ erro }` ou `{ valores }` (so' os campos que a pessoa pode gravar).
 */
const valoresPermitidos = ({ user, usuario, grupo, configAtual, valores }) => {
  const permissoes = [...new Set(dominio.CAMPOS_GERAIS.map(permissaoDoCampoGeral))];
  if (!permissoes.some((p) => podeNoCampo(user, usuario, grupo, p))) {
    return { erro: mensagemSemPermissao([PERMISSAO_ADMINISTRACAO.configGerais]) };
  }
  const atual = configAtual || {};
  const mudaram = new Set(dominio.camposDiferentes(atual, valores).filter((c) => atual[c] !== undefined));
  const permitidos = {};
  const faltam = [];
  for (const campo of Object.keys(valores)) {
    const permissao = permissaoDoCampoGeral(campo);
    if (podeNoCampo(user, usuario, grupo, permissao)) permitidos[campo] = valores[campo];
    else if (mudaram.has(campo)) faltam.push(permissao);
  }
  if (faltam.length) return { erro: mensagemSemPermissao(faltam) };
  return { valores: permitidos };
};

/** Grava os campos gerais em todas as filiais do grupo (ou so' na empresa, sem filiais). */
const salvarConfiguracoesGerais = async ({ user, corpo }) => {
  const leitura = dominio.lerConfiguracoesGerais(corpo);
  if (!leitura.ok) throw new ErroConfiguracoesGerais(400, leitura.erro);
  // O administrador da plataforma age na empresa escolhida na tela dele.
  const pedida = typeof corpo?.tenantId === 'string' ? corpo.tenantId.trim() : '';
  const base = user.isPlatformAdmin && pedida ? pedida : user.tenantId;

  return db.runTransaction(async (tx) => {
    const usuarioSnap = await tx.get(db.collection('usuarios').doc(user.uid));
    const dadosUsuario = usuarioSnap.exists ? usuarioSnap.data() : {};
    const usuario = { ...dadosUsuario, uid: user.uid, tenantId: dadosUsuario.tenantId || user.uid, role: user.role };
    const grupo = await lerGrupo(tx, base);
    const baseSnap = await tx.get(db.collection('configuracoes').doc(base));
    const permitidos = valoresPermitidos({ user, usuario, grupo, configAtual: baseSnap.exists ? baseSnap.data() : {}, valores: leitura.valores });
    if (permitidos.erro) throw new ErroConfiguracoesGerais(403, permitidos.erro);
    const valores = permitidos.valores;

    const alvos = grupo ? grupo.filiais.map((f) => f.tenantId) : [base];

    // Cashback (decisao do dono, 20/10/2026): trocar o modelo (R$ <-> pontos)
    // so' sem saldo em aberto no modelo antigo, em nenhuma filial.
    if (valores.cashback) {
      const novo = cashbackDominio.parseConfigCashback(valores.cashback);
      const configs = await tx.getAll(...alvos.map((t) => db.collection('configuracoes').doc(t)));
      const hoje = getDateInputInTimeZone();
      for (let i = 0; i < alvos.length; i += 1) {
        const antigo = cashbackDominio.parseConfigCashback(configs[i].exists ? configs[i].data().cashback : undefined);
        if (antigo.modelo === novo.modelo) continue;
        const lotes = await tx.get(db.collection('cashback_movimentos')
          .where('tenantId', '==', alvos[i])
          .where('tipo', '==', 'gerado')
          .where('modelo', '==', antigo.modelo));
        const clientes = new Set(lotes.docs
          .filter((d) => cashbackDominio.loteVigente({
            centavos: Number(d.data().centavos) || 0,
            pontos: Number(d.data().pontos) || 0,
            restanteCentavos: Number(d.data().restanteCentavos) || 0,
            restantePontos: Number(d.data().restantePontos) || 0,
            validade: d.data().validade || null,
            estornado: d.data().estornado === true,
          }, hoje))
          .map((d) => d.data().clienteId));
        const bloqueio = cashbackDominio.bloqueioDaTrocaDeModelo(antigo, novo, clientes.size);
        if (bloqueio) throw new ErroConfiguracoesGerais(409, bloqueio);
      }
    }

    for (const tenantId of alvos) {
      tx.set(db.collection('configuracoes').doc(tenantId), {
        ...valores,
        tenantId,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Configurações gerais'),
      }, { merge: true });
    }
    // Volta so' o que foi gravado (campo sem permissao fica como estava, na tela tambem).
    return { filiais: alvos.length, grupo: grupo ? grupo.nome : null, valores };
  });
};

const rotuloDaFilial = (filial) => `${filial.codigo} - ${filial.nome}`;

/**
 * Manutencao (Painel da Plataforma): deixa os campos gerais iguais em todas as
 * filiais de cada grupo, pelo valor da matriz (decisao do dono, 15/10/2026).
 * Simular nao grava; aplicar guarda o valor antigo de cada filial em
 * `unificacaoGeraisAnterior`; desfazer volta esse valor e apaga a marca.
 */
const unificarConfiguracoesGerais = async ({ aplicar, desfazer, grupoId = '' }) => {
  const refsDosGrupos = grupoId
    ? [db.collection('grupos').doc(grupoId)]
    : (await db.collection('grupos').get()).docs.map((d) => d.ref);
  const relatorio = [];
  let filiaisAlteradas = 0;
  let gruposLidos = 0;

  // Uma transacao por grupo: ou o grupo inteiro fica igual, ou nada muda nele.
  for (const grupoRef of refsDosGrupos) {
    const linhas = await db.runTransaction(async (tx) => {
      const grupoSnap = await tx.get(grupoRef);
      if (!grupoSnap.exists) return null;
      const grupo = filialDominio.lerGrupo(grupoSnap.id, grupoSnap.data());
      if (!grupo.filiais.length) return null;
      const refs = grupo.filiais.map((f) => db.collection('configuracoes').doc(f.tenantId));
      const snaps = await tx.getAll(...refs);
      const configs = snaps.map((snap) => (snap.exists ? snap.data() : {}));
      const indiceMatriz = grupo.filiais.findIndex((f) => f.tenantId === grupo.matrizTenantId);
      const unificados = dominio.valoresUnificados(indiceMatriz >= 0 ? configs[indiceMatriz] : {}, configs);
      const doGrupo = [];

      grupo.filiais.forEach((filial, i) => {
        const config = configs[i];
        if (desfazer) {
          const anterior = config.unificacaoGeraisAnterior;
          if (!anterior || typeof anterior !== 'object') return;
          const campos = anterior.campos && typeof anterior.campos === 'object' ? anterior.campos : {};
          const ausentes = Array.isArray(anterior.ausentes) ? anterior.ausentes : [];
          doGrupo.push({ filial: rotuloDaFilial(filial), campos: [...Object.keys(campos), ...ausentes].map((c) => dominio.ROTULO_DO_CAMPO_GERAL[c] || c) });
          if (!aplicar) return;
          const volta = { ...campos, unificacaoGeraisAnterior: apagar() };
          for (const campo of ausentes) volta[campo] = apagar();
          tx.set(refs[i], volta, { merge: true });
          return;
        }
        const diferentes = dominio.camposDiferentes(config, unificados);
        if (!diferentes.length) return;
        doGrupo.push({ filial: rotuloDaFilial(filial), campos: diferentes.map((c) => dominio.ROTULO_DO_CAMPO_GERAL[c]) });
        if (!aplicar) return;
        tx.set(refs[i], {
          ...Object.fromEntries(diferentes.map((c) => [c, unificados[c]])),
          unificacaoGeraisAnterior: {
            campos: Object.fromEntries(diferentes.filter((c) => config[c] !== undefined).map((c) => [c, config[c]])),
            ausentes: diferentes.filter((c) => config[c] === undefined),
            em: agora(),
          },
        }, { merge: true });
      });
      return { nome: grupo.nome, filiais: doGrupo };
    });
    if (!linhas) continue;
    gruposLidos += 1;
    if (linhas.filiais.length) {
      relatorio.push({ grupo: linhas.nome, filiais: linhas.filiais });
      filiaisAlteradas += linhas.filiais.length;
    }
  }
  return { gruposLidos, filiaisAlteradas, grupos: relatorio };
};

/**
 * CATEGORIA NOVA PELA TELA DE LANCAMENTO (19/10/2026): acrescenta uma
 * categoria ao plano de contas (receita ou despesa) de todas as filiais do
 * grupo, como as Configuracoes Gerais -- so' acrescenta, nunca apaga nem
 * renomeia. Quem pode: quem lanca a conta (a rota confere a permissao).
 */
const adicionarCategoria = async ({ user, tenantId, corpo }) => {
  const leitura = dominio.lerNovaCategoria(corpo?.tipo, corpo?.nome);
  if (!leitura.ok) throw new ErroConfiguracoesGerais(400, leitura.erro);
  const campo = dominio.CAMPO_DO_PLANO_DE_CONTAS[leitura.tipo];

  return db.runTransaction(async (tx) => {
    const grupo = await lerGrupo(tx, tenantId);
    const alvos = grupo ? grupo.filiais.map((f) => f.tenantId) : [tenantId];
    const snaps = [];
    for (const alvo of alvos) snaps.push(await tx.get(db.collection('configuracoes').doc(alvo)));
    const resultados = snaps.map((snap, i) => ({ tenantId: alvos[i], ...dominio.listaComNovaCategoria(snap.exists ? snap.data()[campo] : undefined, leitura.tipo, leitura.nome) }));
    const daEmpresa = resultados.find((r) => r.tenantId === tenantId) || resultados[0];
    if (daEmpresa.cheia) throw new ErroConfiguracoesGerais(409, dominio.mensagemPlanoCheio(leitura.tipo));
    resultados.forEach((r) => {
      if (r.jaExistia || r.cheia) return;
      tx.set(db.collection('configuracoes').doc(r.tenantId), {
        [campo]: r.lista,
        tenantId: r.tenantId,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Categoria de ${leitura.tipo} "${leitura.nome}" no plano de contas`),
      }, { merge: true });
    });
    return { nome: leitura.nome, tipo: leitura.tipo, lista: daEmpresa.lista, jaExistia: daEmpresa.jaExistia, filiais: alvos.length };
  });
};

module.exports = { ErroConfiguracoesGerais, salvarConfiguracoesGerais, unificarConfiguracoesGerais, adicionarCategoria, lerGrupo, exigirPermissao, valoresPermitidos };

const crypto = require('crypto');
const { admin, db } = require('../config/firebase');
const { onlyDigits } = require('../utils/cnpjLookup');
const { validarPin } = require('./vendedorPin');
const { podeUsarFrenteDeCaixa } = require('../domain/frenteDeCaixaDomain');
const { isTenantManagerRole } = require('../domain/roles');
const { MENSAGEM_SERVIDOR_BLOQUEADO } = require('../domain/mensalidadeDomain');
const { empresaBloqueada } = require('./mensalidades');
const { conferirContaDoCadastro, ErroContaDoCadastro } = require('./contaDoCadastro');
const { encerrarSessoes } = require('./sessoes');

/**
 * COMPUTADOR DO CAIXA + ENTRADA COM CODIGO E SENHA (22/11/2026, pedido do dono:
 * "deixar o app de caixa aberto o dia todo com 3 usuarios caixa diferentes";
 * "digitar e-mail toda hora no login e' desgastante").
 *
 * 1. Um gerente ATIVA o computador uma vez (POST /api/caixa-terminal/ativar,
 *    logado): nasce `terminais_caixa/{id}` com a empresa (tenantId), o nome do
 *    computador ("Caixa 1") e o HASH de um segredo aleatorio. O segredo vai so'
 *    para aquele computador, que o guarda (src/utils/terminalCaixaStorage.ts).
 * 2. No caixa, cada funcionario entra com CODIGO + SENHA (o mesmo do cadastro
 *    em Usuarios -- validarPin, hash scrypt + bloqueio por tentativas). A rota
 *    e' publica, mas so' responde para um computador ativado: sem o segredo,
 *    nao ha' como tentar senha de ninguem pela internet.
 * 3. A conta e' a do PROPRIO funcionario (token do Firebase para o uid dele):
 *    vendas, sangrias, descontos e fechamento ficam no nome e nas permissoes
 *    dele -- igual a entrar com usuario e senha.
 *
 * Senha curta nunca abre conta de dono ou de administrador. Desde 24/11/2026
 * (pedido do dono: "o dono tem que conseguir entrar no caixa com codigo
 * tambem") eles entram no computador ativado; desde o bloco B de seguranca
 * (25/11/2026, decisao do dono) so' com senha de 6 digitos ou mais. Funcionario
 * entra com 4 ou mais (caixa e sistema). Gestor da plataforma nunca entra assim.
 *
 * SEGREDO DO COMPUTADOR (bloco B): troca a cada entrada que da' certo (o
 * servidor devolve o novo e o computador guarda); o anterior ainda vale por
 * alguns minutos, caso a resposta se perca no caminho. Computador parado ha'
 * mais de 180 dias precisa ser ativado de novo. Desativar o computador encerra
 * a sessao de quem entrou por ele.
 */

const COLECAO = 'terminais_caixa';

class ErroTerminal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const hashDoSegredo = (segredo) => crypto.createHash('sha256').update(String(segredo || '')).digest('hex');

const mesmoHash = (a, b) => {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/** Funcionario: senha de 4 digitos ou mais, no caixa e no sistema (canal 'terminal' do validarPin). */
const DIGITOS_MINIMOS_NO_SISTEMA = 4;
/** Dono e administrador: so' com senha de 6 digitos ou mais (bloco B, 25/11/2026, decisao do dono). */
const DIGITOS_MINIMOS_GESTOR = 6;
/** Por quanto tempo o segredo anterior ainda vale depois da troca (resposta perdida no caminho). */
const SEGREDO_ANTERIOR_VALE_MS = 10 * 60 * 1000;
/** Computador sem uso ha' mais que isto precisa ser ativado de novo. */
const VALIDADE_SEM_USO_MS = 180 * 24 * 60 * 60 * 1000;
/** Quantos operadores o computador lembra para encerrar a sessao ao desativar. */
const MAX_OPERADORES_LEMBRADOS = 50;

const MENSAGEM_TERMINAL_VENCIDO = 'Este computador ficou mais de 6 meses sem ninguém entrar com código e senha e precisa ser ativado de novo. Entre com usuário e senha, ou peça ao dono ou a um administrador para ativar ("Ativar de novo", embaixo do login).';

const MENSAGEM_TERMINAL_INVALIDO = 'Este computador não está mais ativado para entrar com código e senha. Entre com usuário e senha, ou peça ao dono ou a um administrador para ativar de novo ("Ativar de novo", embaixo do login).';

/** Gerente: dono, administrador da empresa ou equipe da plataforma. */
const ehGerente = (user) => Boolean(user && (user.dono || user.isTenantManager || user.isPlatformAdmin));

const exigirBanco = () => {
  if (!db || !admin) throw new ErroTerminal(503, 'O servidor está sem acesso ao banco de dados. Tente de novo em instantes.');
};

const nomeDaEmpresa = (config) => String(config.nomeFantasia || config.razaoSocial || config.nomeEmpresa || config.nome || '').trim();

/** Nome do computador: obrigatorio, curto, sem espacos sobrando. */
const limparNome = (nome) => String(nome || '').replace(/\s+/g, ' ').trim().slice(0, 40);

async function ativarTerminal({ user, nome }) {
  exigirBanco();
  if (!ehGerente(user)) {
    throw new ErroTerminal(403, 'Só o dono ou um administrador da empresa ativa um computador como caixa. Peça a um deles para entrar aqui.');
  }
  const nomeLimpo = limparNome(nome);
  if (!nomeLimpo) throw new ErroTerminal(400, 'Dê um nome para este computador (por exemplo, "Caixa 1") para saber depois qual é qual.');

  const tenantId = String(user.tenantId || '');
  const configSnap = await db.collection('configuracoes').doc(tenantId).get();
  const config = configSnap.exists ? configSnap.data() : {};
  const cnpj = onlyDigits(config.cnpj);

  const segredo = crypto.randomBytes(32).toString('hex');
  const ref = db.collection(COLECAO).doc();
  await ref.set({
    tenantId,
    // Onde ficam os cadastros dos funcionarios (matriz do grupo de filiais): o
    // codigo + senha e' procurado aqui; o caixa abre na filial do computador.
    tenantDosUsuarios: String(user.homeTenantId || tenantId),
    nome: nomeLimpo,
    segredoHash: hashDoSegredo(segredo),
    ativo: true,
    criadoPor: user.uid,
    criadoPorNome: user.nome || '',
    criadoEm: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { terminalId: ref.id, segredo, tenantId, cnpj, empresa: nomeDaEmpresa(config), nome: nomeLimpo };
}

const emMs = (t) => {
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  return t instanceof Date ? t.getTime() : 0;
};

/**
 * Confere o computador. `segredoAtual` diz se veio o segredo de agora (true) ou
 * o anterior, ainda dentro da folga (false) -- so' o de agora gera troca.
 */
async function conferirTerminal({ terminalId, segredo }) {
  exigirBanco();
  const id = String(terminalId || '').trim();
  if (!id || !segredo || id.includes('/')) throw new ErroTerminal(401, MENSAGEM_TERMINAL_INVALIDO);
  const snap = await db.collection(COLECAO).doc(id).get();
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.ativo !== true) throw new ErroTerminal(401, MENSAGEM_TERMINAL_INVALIDO);
  const hash = hashDoSegredo(segredo);
  const segredoAtual = mesmoHash(hash, dados.segredoHash);
  const anteriorNaFolga = !segredoAtual
    && mesmoHash(hash, dados.segredoHashAnterior)
    && Date.now() - emMs(dados.segredoTrocadoEm) <= SEGREDO_ANTERIOR_VALE_MS;
  if (!segredoAtual && !anteriorNaFolga) throw new ErroTerminal(401, MENSAGEM_TERMINAL_INVALIDO);
  const ultimoUsoMs = emMs(dados.ultimoUsoEm) || emMs(dados.criadoEm);
  if (ultimoUsoMs && Date.now() - ultimoUsoMs > VALIDADE_SEM_USO_MS) throw new ErroTerminal(401, MENSAGEM_TERMINAL_VENCIDO);
  return { id, ...dados, segredoAtual };
}

/**
 * `destino`: 'caixa' (Frente de Caixa: exige acesso ao caixa) ou 'sistema'
 * (sistema completo, 22/11/2026: senha de 4 digitos ou mais; vendedor de
 * balcao, que nao tem acesso ao sistema, fica de fora).
 */
async function entrarComCodigo({ terminalId, segredo, codigo, pin, destino = 'caixa' }) {
  const noSistema = destino === 'sistema';
  const terminal = await conferirTerminal({ terminalId, segredo });

  // Hash scrypt + status Ativo + bloqueio por tentativas + senha de 4 digitos
  // ou mais: tudo do validarPin, no canal do computador (contador proprio).
  const identificado = await validarPin({ tenantId: terminal.tenantDosUsuarios, codigo, pin, canal: 'terminal' });

  const usuarioSnap = await db.collection('usuarios').doc(identificado.vendedorId).get();
  const usuario = usuarioSnap.exists ? usuarioSnap.data() : {};
  const papel = usuario.role || 'Funcionario';
  const gestor = isTenantManagerRole(papel);
  if (papel !== 'Funcionario' && !gestor) {
    throw new ErroTerminal(403, 'Este cadastro não entra com código e senha: entre pelo usuário e senha ("Entrar com usuário e senha", logo abaixo).');
  }
  // Dono e administrador (bloco B, 25/11/2026): so' com senha de 6 digitos ou mais, no caixa e no sistema.
  if (gestor && String(pin || '').length < DIGITOS_MINIMOS_GESTOR) {
    throw new ErroTerminal(403, `Dono e administrador entram com código só com senha de ${DIGITOS_MINIMOS_GESTOR} dígitos ou mais. Cadastre uma senha maior em Administração › Usuários (lápis na sua linha), ou entre pelo usuário e senha.`);
  }
  const permissoes = Array.isArray(usuario.permissoes) ? usuario.permissoes : [];
  if (noSistema && usuario.tipoRegistro === 'vendedor') {
    throw new ErroTerminal(403, `${identificado.vendedorNome} é vendedor de balcão: a senha dele serve para identificar a venda, não para entrar no sistema.`);
  }
  if (noSistema && String(pin || '').length < DIGITOS_MINIMOS_NO_SISTEMA) {
    throw new ErroTerminal(403, `A sua senha tem menos de ${DIGITOS_MINIMOS_NO_SISTEMA} dígitos. Para entrar no sistema com código e senha, peça ao responsável uma senha nova de ${DIGITOS_MINIMOS_NO_SISTEMA} dígitos ou mais, em Usuários (ou entre com usuário e senha).`);
  }
  if (!noSistema && !gestor && !podeUsarFrenteDeCaixa({ role: papel, isOwner: false, permissoes })) {
    throw new ErroTerminal(403, `${identificado.vendedorNome} não tem acesso à Frente de Caixa. Peça ao administrador para liberar "Vendas: Frente de Caixa (PDV)" ou "Vendas: Só a Frente de Caixa" no cadastro dele, em Usuários.`);
  }
  // Mensalidade em atraso (24/11/2026): funcionario nem entra; dono e
  // administrador entram e veem a tela de bloqueio com o boleto.
  if (!gestor && await empresaBloqueada(terminal.tenantDosUsuarios)) {
    throw new ErroTerminal(402, MENSAGEM_SERVIDOR_BLOQUEADO);
  }

  // O login sai para a CONTA com o id do cadastro: ela tem de ser mesmo dele (ver contaDoCadastro.js).
  try {
    await conferirContaDoCadastro({ id: identificado.vendedorId, usuario });
  } catch (erro) {
    if (erro instanceof ErroContaDoCadastro) throw new ErroTerminal(erro.status, erro.message);
    throw erro;
  }

  // Vendedor de balcao (sem login de e-mail) so' entra com a marca isVendedorBalcao (middleware/auth.js).
  const marcas = { viaTerminalCaixa: terminal.id, ...(!noSistema && usuario.tipoRegistro === 'vendedor' ? { isVendedorBalcao: true } : {}) };
  const token = await admin.auth().createCustomToken(identificado.vendedorId, marcas);

  // Segredo novo a cada entrada (so' quando veio o de agora: duas entradas ao
  // mesmo tempo nao trocam duas vezes). O anterior vale mais alguns minutos.
  const novoSegredo = terminal.segredoAtual ? crypto.randomBytes(32).toString('hex') : '';
  const operadores = Array.isArray(terminal.operadoresIds) ? terminal.operadoresIds : [];
  await db.collection(COLECAO).doc(terminal.id).update({
    ultimoUsoEm: admin.firestore.FieldValue.serverTimestamp(),
    ultimoOperadorId: identificado.vendedorId,
    ultimoOperadorNome: identificado.vendedorNome,
    ...(operadores.includes(identificado.vendedorId) ? {} : {
      operadoresIds: [...operadores, identificado.vendedorId].slice(-MAX_OPERADORES_LEMBRADOS),
    }),
    ...(novoSegredo ? {
      segredoHash: hashDoSegredo(novoSegredo),
      segredoHashAnterior: terminal.segredoHash,
      segredoTrocadoEm: admin.firestore.Timestamp.now(),
    } : {}),
  });

  return {
    token,
    operadorNome: identificado.vendedorNome,
    tenantId: terminal.tenantId,
    ...(novoSegredo ? { novoSegredo } : {}),
  };
}

async function listarTerminais({ user }) {
  exigirBanco();
  if (!ehGerente(user)) throw new ErroTerminal(403, 'Só o dono ou um administrador da empresa vê os computadores do caixa.');
  const snap = await db.collection(COLECAO).where('tenantId', '==', String(user.tenantId || '')).get();
  const paraMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      nome: x.nome || '',
      ativo: x.ativo === true,
      criadoPorNome: x.criadoPorNome || '',
      criadoEmMs: paraMs(x.criadoEm),
      ultimoUsoEmMs: paraMs(x.ultimoUsoEm),
      ultimoOperadorNome: x.ultimoOperadorNome || '',
    };
  }).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function desativarTerminal({ user, terminalId }) {
  exigirBanco();
  if (!ehGerente(user)) throw new ErroTerminal(403, 'Só o dono ou um administrador da empresa desativa um computador do caixa.');
  const ref = db.collection(COLECAO).doc(String(terminalId || ''));
  const snap = await ref.get();
  if (!snap.exists || snap.data().tenantId !== user.tenantId) throw new ErroTerminal(404, 'Computador não encontrado nesta empresa.');
  await ref.update({
    ativo: false,
    desativadoPor: user.uid,
    desativadoPorNome: user.nome || '',
    desativadoEm: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Bloco B (25/11/2026): quem entrou por este computador sai (em ate' 1 hora no
  // banco; no servidor, na hora). Antes desativar so' impedia entradas novas.
  const operadores = Array.isArray(snap.data().operadoresIds) ? snap.data().operadoresIds : [];
  const encerradas = await encerrarSessoes(operadores, 'computador do caixa desativado');
  return { id: ref.id, nome: snap.data().nome || '', sessoesEncerradas: encerradas };
}

module.exports = {
  ativarTerminal,
  conferirTerminal,
  entrarComCodigo,
  listarTerminais,
  desativarTerminal,
  ErroTerminal,
  COLECAO,
  DIGITOS_MINIMOS_NO_SISTEMA,
  DIGITOS_MINIMOS_GESTOR,
  SEGREDO_ANTERIOR_VALE_MS,
  VALIDADE_SEM_USO_MS,
  // expostos pros testes
  hashDoSegredo,
  ehGerente,
};

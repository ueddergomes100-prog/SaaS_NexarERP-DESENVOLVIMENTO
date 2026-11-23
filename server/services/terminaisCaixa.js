const crypto = require('crypto');
const { admin, db } = require('../config/firebase');
const { onlyDigits } = require('../utils/cnpjLookup');
const { validarPin } = require('./vendedorPin');
const { podeUsarFrenteDeCaixa } = require('../domain/frenteDeCaixaDomain');

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
 * Senha curta (a partir de 2 digitos) nunca abre conta de dono ou de
 * administrador: esses entram pelo usuario e senha (mesma regra do app Vendas).
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

/** Entrar no SISTEMA completo (nao so' no caixa) pede senha mais longa (decisao do dono, 22/11/2026). */
const DIGITOS_MINIMOS_NO_SISTEMA = 4;

const MENSAGEM_TERMINAL_INVALIDO = 'Este computador não está mais ativado como caixa. Peça ao responsável para ativar de novo (na tela de entrada do caixa, "Ativar este computador").';

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

async function conferirTerminal({ terminalId, segredo }) {
  exigirBanco();
  const id = String(terminalId || '').trim();
  if (!id || !segredo || id.includes('/')) throw new ErroTerminal(401, MENSAGEM_TERMINAL_INVALIDO);
  const snap = await db.collection(COLECAO).doc(id).get();
  const dados = snap.exists ? snap.data() : null;
  if (!dados || dados.ativo !== true || !mesmoHash(hashDoSegredo(segredo), dados.segredoHash)) {
    throw new ErroTerminal(401, MENSAGEM_TERMINAL_INVALIDO);
  }
  return { id, ...dados };
}

/**
 * `destino`: 'caixa' (Frente de Caixa: exige acesso ao caixa) ou 'sistema'
 * (sistema completo, 22/11/2026: senha de 4 digitos ou mais; vendedor de
 * balcao, que nao tem acesso ao sistema, fica de fora).
 */
async function entrarComCodigo({ terminalId, segredo, codigo, pin, destino = 'caixa' }) {
  const noSistema = destino === 'sistema';
  const terminal = await conferirTerminal({ terminalId, segredo });

  // Hash scrypt + status Ativo + bloqueio por tentativas: tudo do validarPin.
  const identificado = await validarPin({ tenantId: terminal.tenantDosUsuarios, codigo, pin });

  const usuarioSnap = await db.collection('usuarios').doc(identificado.vendedorId).get();
  const usuario = usuarioSnap.exists ? usuarioSnap.data() : {};
  const papel = usuario.role || 'Funcionario';
  if (papel !== 'Funcionario') {
    throw new ErroTerminal(403, 'Este cadastro é de administrador: entre pelo usuário e senha ("Entrar com usuário e senha", logo abaixo).');
  }
  const permissoes = Array.isArray(usuario.permissoes) ? usuario.permissoes : [];
  if (noSistema && usuario.tipoRegistro === 'vendedor') {
    throw new ErroTerminal(403, `${identificado.vendedorNome} é vendedor de balcão: a senha dele serve para identificar a venda, não para entrar no sistema.`);
  }
  if (noSistema && String(pin || '').length < DIGITOS_MINIMOS_NO_SISTEMA) {
    throw new ErroTerminal(403, `A sua senha tem menos de ${DIGITOS_MINIMOS_NO_SISTEMA} dígitos. Para entrar no sistema com código e senha, peça ao responsável uma senha nova de ${DIGITOS_MINIMOS_NO_SISTEMA} dígitos ou mais, em Usuários (ou entre com usuário e senha).`);
  }
  if (!noSistema && !podeUsarFrenteDeCaixa({ role: papel, isOwner: false, permissoes })) {
    throw new ErroTerminal(403, `${identificado.vendedorNome} não tem acesso à Frente de Caixa. Peça ao administrador para liberar "Vendas: Frente de Caixa (PDV)" ou "Vendas: Só a Frente de Caixa" no cadastro dele, em Usuários.`);
  }

  // Vendedor de balcao (sem login de e-mail) so' entra com a marca isVendedorBalcao (middleware/auth.js).
  const marcas = { viaTerminalCaixa: terminal.id, ...(!noSistema && usuario.tipoRegistro === 'vendedor' ? { isVendedorBalcao: true } : {}) };
  const token = await admin.auth().createCustomToken(identificado.vendedorId, marcas);

  await db.collection(COLECAO).doc(terminal.id).update({
    ultimoUsoEm: admin.firestore.FieldValue.serverTimestamp(),
    ultimoOperadorId: identificado.vendedorId,
    ultimoOperadorNome: identificado.vendedorNome,
  }).catch((erro) => console.warn('[TerminaisCaixa] nao foi possivel registrar o ultimo uso:', erro.message));

  return { token, operadorNome: identificado.vendedorNome, tenantId: terminal.tenantId };
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
  return { id: ref.id, nome: snap.data().nome || '' };
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
  // expostos pros testes
  hashDoSegredo,
  ehGerente,
};

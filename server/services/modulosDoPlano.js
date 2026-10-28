const { admin, db } = require('../config/firebase');

/**
 * MODULOS DO PLANO pelo SuperAdmin (28/10/2026, pedido do dono).
 *
 * O plano (modulos bloqueados) mora em tres lugares: usuarios/{dono}
 * (o AuthContext le dali), configuracoes/{empresa} (copia antiga que a tela
 * de Configuracoes ainda le) e grupos/{id} (as filiais leem do grupo). O grupo
 * so' recebia o plano quando uma filial era criada -- bloquear ou liberar
 * depois nao chegava as filiais. Aqui grava os tres de uma vez.
 *
 * So' o administrador da plataforma usa (a rota confere). Os grupos nao aceitam
 * gravacao do navegador, por isso passa pelo servidor.
 */
class ErroModulos extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agora = () => admin.firestore.FieldValue.serverTimestamp();

const MODULO_VALIDO = /^[a-zA-Z_]+\.[a-zA-Z_]+$/;
const MAXIMO_DE_MODULOS = 200;

/** Lista limpa, sem repeticao. Id fora do formato "grupo.modulo" e' recusado. */
const lerModulos = (valor) => {
  if (!Array.isArray(valor)) throw new ErroModulos(400, 'Envie a lista de módulos bloqueados.');
  if (valor.length > MAXIMO_DE_MODULOS) throw new ErroModulos(400, 'Lista de módulos grande demais.');
  const modulos = [];
  for (const item of valor) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (!MODULO_VALIDO.test(id)) throw new ErroModulos(400, `Módulo inválido: "${String(item)}".`);
    if (!modulos.includes(id)) modulos.push(id);
  }
  return modulos.sort();
};

/**
 * Grava os modulos bloqueados da empresa e de todas as filiais dela. Empresa
 * que e' filial resolve para a matriz: o plano e' do grupo inteiro.
 */
const salvarModulosBloqueados = async ({ user, tenantId: pedido, modulos: brutos }) => {
  const modulos = lerModulos(brutos);
  const alvo = typeof pedido === 'string' ? pedido.trim() : '';
  if (!alvo) throw new ErroModulos(400, 'Escolha a empresa.');

  return db.runTransaction(async (tx) => {
    const configAlvo = await tx.get(db.collection('configuracoes').doc(alvo));
    const grupoId = configAlvo.exists && typeof configAlvo.data().grupoId === 'string' ? configAlvo.data().grupoId : '';
    const grupoRef = grupoId ? db.collection('grupos').doc(grupoId) : null;
    const grupoSnap = grupoRef ? await tx.get(grupoRef) : null;
    const grupo = grupoSnap && grupoSnap.exists ? grupoSnap.data() : null;
    const matriz = grupo && typeof grupo.matrizTenantId === 'string' && grupo.matrizTenantId ? grupo.matrizTenantId : alvo;

    const usuarioRef = db.collection('usuarios').doc(matriz);
    const configRef = db.collection('configuracoes').doc(matriz);
    const [usuarioSnap, configSnap] = await tx.getAll(usuarioRef, configRef);
    if (!usuarioSnap.exists) {
      throw new ErroModulos(404, 'O cadastro do dono desta empresa não foi encontrado. Recarregue o painel e tente de novo.');
    }

    const marca = { alteradoPor: user.uid, alteradoEm: agora(), ultimaAlteracao: 'Módulos bloqueados atualizados' };
    tx.update(usuarioRef, { modulosBloqueados: modulos, updatedAt: agora(), ...marca });
    tx.set(configRef, configSnap.exists
      ? { modulosBloqueados: modulos, updatedAt: agora(), ...marca }
      : { tenantId: matriz, modulosBloqueados: modulos, updatedAt: agora(), ...marca }, { merge: true });
    if (grupo) tx.update(grupoRef, { modulosBloqueados: modulos, atualizadoEm: agora() });

    const filiais = grupo && Array.isArray(grupo.filiais) ? grupo.filiais.filter((f) => f && f.tenantId !== matriz).length : 0;
    return { tenantId: matriz, modulosBloqueados: modulos, filiais };
  });
};

module.exports = { ErroModulos, lerModulos, salvarModulosBloqueados };

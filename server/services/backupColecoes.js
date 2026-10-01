/**
 * Colecoes da empresa (filtradas por `tenantId`) que entram no backup e na
 * restauracao. Lista UNICA, usada pelos dois lados -- antes cada arquivo tinha
 * a sua copia, e as duas ficaram paradas em 16 colecoes enquanto o sistema
 * crescia: bancos, fornecedores, materia-prima, lotes, notas de entrada,
 * caixas, notas avulsas, producao etc. nao entravam no backup. Restaurar um
 * backup assim voltava as vendas e o financeiro no tempo, mas deixava saldo de
 * banco, lote e custo como estavam hoje (auditoria de 2026-09-29).
 *
 * Ficam de FORA de proposito:
 *  - configuracoes_privadas, usuarios_pin: segredos (senha do SMTP, chave da
 *    Spedy, hash do PIN) -- voltar um segredo antigo quebra a integracao;
 *  - usernames, vendedores_mobile_login: indices globais de login;
 *  - contadores (sequencias): manter o contador ATUAL evita repetir numero de
 *    pedido/OS depois de restaurar;
 *  - empresas/{id}/logs: auditoria nao se apaga nem se reescreve.
 *
 * Coleção nova do sistema que guarde dado da empresa ENTRA aqui.
 */
const COLECOES_DA_EMPRESA = [
  'clientes',
  'veiculos',
  'produtos',
  'estoque',
  'estoque_lotes',
  'produtos_composicao',
  'materias_primas',
  'insumos',
  'categorias',
  'marcas',
  'servicos',
  'unidades_medida',
  'fornecedores',
  'bancos',
  'bandeiras_cartao',
  'lancamentos_bancarios',
  'transacoes',
  'creditos_cliente',
  'caixas_pdv',
  'ordens_de_servico',
  'lembretes',
  'agendamentos',
  'pedidos_venda',
  'orcamentos',
  'devolucoes_venda',
  'trocas',
  'expedicoes',
  'entregas',
  'romaneios',
  'romaneio_pedidos',
  'promocoes',
  'notas_fiscais',
  'notas_fiscais_entrada',
  'notas_avulsas',
  'ajustes_estoque',
  'historico_custos',
  'cotacoes_compra',
  'pedidos_compra',
  'recebimentos_compra',
  'ordens_producao',
  'motoristas',
  'frota',
  'rotas',
  'integracoes_canais',
  'integracoes_produtos',
  'integracoes_fila',
  'pedidos_externos',
  'integracoes_logs',
];

/**
 * Campos comerciais e de integracao que a restauracao NAO volta no tempo:
 * plano, modulos, limites e o cadastro da empresa na Spedy sao decididos pela
 * plataforma DEPOIS do backup -- restaurar nao pode desbloquear modulo nem
 * desligar a nota fiscal. Mesma lista de platformManagedFields() das
 * firestore.rules, mais os campos da Spedy gravados pelo servidor.
 */
const CAMPOS_DA_PLATAFORMA = [
  'modulosBloqueados',
  'modulosContratados',
  'plano',
  'valorMensalidade',
  'limiteUsuarios',
  'limiteAcessoMobile',
  'limites',
  'statusSaas',
  'billingStatus',
  'trialEndsAt',
  'spedyCompanyId',
  'spedyEnabled',
  'spedyEnvironment',
  'spedyApiKeyConfigured',
];

module.exports = { COLECOES_DA_EMPRESA, CAMPOS_DA_PLATAFORMA };

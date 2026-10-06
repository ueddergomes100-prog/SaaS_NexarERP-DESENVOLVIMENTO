"use strict";
/**
 * FILIAIS (2026-10-06) -- regras puras, usadas pela tela e pelo servidor
 * (compiladas para server/domain por scripts/build-server-domain.mjs).
 *
 * Desenho (docs/PLANO_FILIAIS.md):
 *  - Cada filial e' uma empresa (tenant) propria: vendas, OS, notas,
 *    financeiro, caixa, bancos e numeracao separados.
 *  - As filiais de uma mesma empresa formam um GRUPO (`grupos/{grupoId}`).
 *    A configuracao de cada filial guarda `grupoId` (so' o servidor grava).
 *  - O usuario pertence a uma filial (`usuarios/{uid}.tenantId`, a "casa"
 *    dele) e trabalha na `filialAtiva` (so' o servidor grava). As
 *    firestore.rules e o servidor usam a filial ativa como empresa da vez.
 *  - Quem entra em outras filiais: dono e administrador do grupo (role
 *    Master/Admin), e funcionario com a permissao "Utiliza outras filiais".
 *    Decisao do dono (06/10): as permissoes valem iguais em todas as filiais.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matrizAPartirDaConfiguracao = exports.filialParaGravar = exports.configuracaoInicialDaFilial = exports.CAMPOS_DE_IDENTIDADE_DA_EMPRESA = exports.validarDadosDaFilial = exports.validarNomeECodigoDaFilial = exports.proximoCodigoDeFilial = exports.cnpjValido = exports.validarEdicaoDaFilial = exports.identidadeParaConfiguracao = exports.dadosDaFilialNaConfiguracao = exports.lerDadosDaFilial = exports.filialAtivaParaGravar = exports.validarTrocaDeFilial = exports.filiaisDoUsuario = exports.podeUsarOutrasFiliais = exports.pertenceAoGrupo = exports.ehGestorDoGrupo = exports.filialAtivaDoUsuario = exports.rotuloFilial = exports.mensalidadeComFiliais = exports.filiaisCobradas = exports.lerGrupo = exports.lerFilial = exports.UFS = exports.PERMISSAO_UTILIZA_OUTRAS_FILIAIS = void 0;
exports.PERMISSAO_UTILIZA_OUTRAS_FILIAIS = 'filiais.utilizar';
const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');
const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');
const lista = (valor) => (Array.isArray(valor) ? valor.filter((v) => typeof v === 'string') : []);
const PAPEIS_GESTORES = ['Master', 'Admin'];
exports.UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
    'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];
const lerFilial = (dados) => {
    const f = (dados && typeof dados === 'object' ? dados : {});
    const tenantId = texto(f.tenantId);
    if (!tenantId)
        return null;
    return {
        tenantId,
        codigo: texto(f.codigo),
        nome: texto(f.nome).toUpperCase(),
        cnpj: soDigitos(f.cnpj),
        uf: texto(f.uf).toUpperCase(),
        cidade: texto(f.cidade).toUpperCase(),
        tipo: f.tipo === 'mesmo_cnpj' ? 'mesmo_cnpj' : 'cnpj_proprio',
        matriz: f.matriz === true,
        ativa: f.ativa !== false,
    };
};
exports.lerFilial = lerFilial;
const lerGrupo = (id, dados) => {
    const g = (dados && typeof dados === 'object' ? dados : {});
    const filiais = (Array.isArray(g.filiais) ? g.filiais : [])
        .map(exports.lerFilial)
        .filter((f) => Boolean(f))
        .sort((a, b) => ordenarCodigo(a.codigo, b.codigo));
    return {
        id,
        nome: texto(g.nome).toUpperCase(),
        donoUid: texto(g.donoUid),
        matrizTenantId: texto(g.matrizTenantId),
        filiais,
        modulosBloqueados: lista(g.modulosBloqueados),
        valorFilialAdicional: Math.max(0, Number(g.valorFilialAdicional) || 0),
    };
};
exports.lerGrupo = lerGrupo;
/**
 * COBRANCA DAS FILIAIS (fase 5 -- 2026-10-06). Decisao do dono: cada filial
 * paga um valor menor que a mensalidade da matriz. Conta so' filial ATIVA e
 * que nao e' a matriz (a matriz ja' paga a mensalidade normal).
 */
const filiaisCobradas = (grupo) => (grupo ? grupo.filiais.filter((f) => f.ativa && !f.matriz).length : 0);
exports.filiaisCobradas = filiaisCobradas;
const mensalidadeComFiliais = (valorDaMatriz, grupo) => {
    const base = Math.max(0, Number(valorDaMatriz) || 0);
    const filiais = (0, exports.filiaisCobradas)(grupo);
    const valorPorFilial = grupo ? Math.max(0, Number(grupo.valorFilialAdicional) || 0) : 0;
    const adicional = Math.round(filiais * valorPorFilial * 100) / 100;
    return { filiais, valorPorFilial, adicional, total: Math.round((base + adicional) * 100) / 100 };
};
exports.mensalidadeComFiliais = mensalidadeComFiliais;
const ordenarCodigo = (a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b);
const rotuloFilial = (filial) => (filial ? `${filial.codigo} · ${filial.nome}` : '');
exports.rotuloFilial = rotuloFilial;
/** Filial em que o usuario esta trabalhando agora (a ativa ou, sem ela, a casa). */
const filialAtivaDoUsuario = (usuario) => texto(usuario.filialAtiva) || texto(usuario.tenantId) || usuario.uid;
exports.filialAtivaDoUsuario = filialAtivaDoUsuario;
const ehGestorDoGrupo = (grupo, usuario) => {
    if (!grupo)
        return false;
    if (grupo.donoUid && grupo.donoUid === usuario.uid)
        return true;
    return PAPEIS_GESTORES.includes(texto(usuario.role)) && (0, exports.pertenceAoGrupo)(grupo, usuario);
};
exports.ehGestorDoGrupo = ehGestorDoGrupo;
const pertenceAoGrupo = (grupo, usuario) => (Boolean(grupo) && grupo.filiais.some((f) => f.tenantId === texto(usuario.tenantId)));
exports.pertenceAoGrupo = pertenceAoGrupo;
const podeUsarOutrasFiliais = (grupo, usuario) => {
    if (!grupo || !(0, exports.pertenceAoGrupo)(grupo, usuario))
        return false;
    return (0, exports.ehGestorDoGrupo)(grupo, usuario) || lista(usuario.permissoes).includes(exports.PERMISSAO_UTILIZA_OUTRAS_FILIAIS);
};
exports.podeUsarOutrasFiliais = podeUsarOutrasFiliais;
/** Filiais em que o usuario pode entrar (ativas), na ordem do codigo. Sem a permissao, so' a casa dele. */
const filiaisDoUsuario = (grupo, usuario) => {
    if (!grupo || !(0, exports.pertenceAoGrupo)(grupo, usuario))
        return [];
    if ((0, exports.podeUsarOutrasFiliais)(grupo, usuario))
        return grupo.filiais.filter((f) => f.ativa);
    return grupo.filiais.filter((f) => f.tenantId === texto(usuario.tenantId));
};
exports.filiaisDoUsuario = filiaisDoUsuario;
/** Mensagem para o usuario quando a troca nao pode acontecer; null = pode trocar. */
const validarTrocaDeFilial = (grupo, usuario, destino) => {
    if (!grupo || !(0, exports.pertenceAoGrupo)(grupo, usuario))
        return 'Sua empresa não tem filiais cadastradas.';
    const filial = grupo.filiais.find((f) => f.tenantId === destino);
    if (!filial)
        return 'Essa filial não faz parte da sua empresa.';
    if (!(0, exports.podeUsarOutrasFiliais)(grupo, usuario) && destino !== texto(usuario.tenantId)) {
        return 'Você não tem a permissão "Utiliza outras filiais". Peça ao responsável para liberar no seu usuário (Administração → Usuários).';
    }
    if (!filial.ativa)
        return `A filial ${(0, exports.rotuloFilial)(filial)} está inativa. Reative em Configurações → Filiais para entrar nela.`;
    return null;
};
exports.validarTrocaDeFilial = validarTrocaDeFilial;
/**
 * O que gravar no usuario ao trocar de filial: voltar para a casa apaga o
 * campo (null), outra filial grava o tenant dela.
 */
const filialAtivaParaGravar = (usuario, destino) => (destino === texto(usuario.tenantId) ? null : destino);
exports.filialAtivaParaGravar = filialAtivaParaGravar;
const lerDadosDaFilial = (dados) => {
    const d = (dados && typeof dados === 'object' ? dados : {});
    return {
        codigo: soDigitos(d.codigo),
        nome: texto(d.nome).toUpperCase(),
        tipo: d.tipo === 'mesmo_cnpj' ? 'mesmo_cnpj' : 'cnpj_proprio',
        cnpj: soDigitos(d.cnpj),
        razaoSocial: texto(d.razaoSocial).toUpperCase(),
        inscricaoEstadual: texto(d.inscricaoEstadual).toUpperCase(),
        inscricaoMunicipal: texto(d.inscricaoMunicipal).toUpperCase(),
        uf: texto(d.uf).toUpperCase(),
        cidade: texto(d.cidade).toUpperCase(),
        rua: texto(d.rua).toUpperCase(),
        numero: texto(d.numero).toUpperCase(),
        complemento: texto(d.complemento).toUpperCase(),
        bairro: texto(d.bairro).toUpperCase(),
        cep: soDigitos(d.cep),
        telefone: texto(d.telefone),
        email: texto(d.email).toLowerCase(),
        contato: texto(d.contato).toUpperCase(),
    };
};
exports.lerDadosDaFilial = lerDadosDaFilial;
/** Dados do cadastro a partir da configuracao da filial (para abrir a edicao). */
const dadosDaFilialNaConfiguracao = (filial, config) => (0, exports.lerDadosDaFilial)({
    codigo: filial.codigo,
    nome: filial.nome,
    tipo: filial.tipo,
    cnpj: filial.cnpj || config.cnpj,
    razaoSocial: config.razaoSocial,
    inscricaoEstadual: config.inscricaoEstadual,
    inscricaoMunicipal: config.nfseInscricaoMunicipal,
    uf: config.uf || filial.uf,
    cidade: config.cidade || filial.cidade,
    rua: config.rua,
    numero: config.numero,
    complemento: config.complemento,
    bairro: config.bairro,
    cep: config.cep,
    telefone: config.telefone,
    email: config.email,
    contato: config.nomeUsuario,
});
exports.dadosDaFilialNaConfiguracao = dadosDaFilialNaConfiguracao;
/**
 * Campos de identidade que a configuracao da filial recebe do cadastro
 * (criar e editar). CNPJ e tipo ficam de fora: so' mudam na criacao.
 */
const identidadeParaConfiguracao = (dados) => ({
    filialCodigo: dados.codigo,
    nomeOficina: dados.nome,
    nomeFantasia: dados.nome,
    inscricaoEstadual: dados.inscricaoEstadual,
    nfseInscricaoMunicipal: dados.inscricaoMunicipal,
    uf: dados.uf,
    cidade: dados.cidade,
    rua: dados.rua,
    numero: dados.numero,
    complemento: dados.complemento,
    bairro: dados.bairro,
    cep: dados.cep,
    telefone: dados.telefone,
    email: dados.email,
    nomeUsuario: dados.contato,
});
exports.identidadeParaConfiguracao = identidadeParaConfiguracao;
/** Edicao: o que muda (nome, codigo, endereco, contato) precisa continuar valido. */
const validarEdicaoDaFilial = (dados, grupo, tenantId) => {
    const erro = (0, exports.validarNomeECodigoDaFilial)(dados, grupo, tenantId);
    if (erro)
        return erro;
    if (!exports.UFS.includes(dados.uf))
        return 'Escolha o estado (UF) da filial.';
    if (!dados.cidade)
        return 'Informe a cidade da filial.';
    return null;
};
exports.validarEdicaoDaFilial = validarEdicaoDaFilial;
const cnpjValido = (valor) => {
    const c = soDigitos(valor);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c))
        return false;
    const digito = (base, pesos) => {
        const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };
    const d1 = digito(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = digito(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === Number(c[12]) && d2 === Number(c[13]);
};
exports.cnpjValido = cnpjValido;
/** Proximo codigo livre de 10 em 10 (10, 20, 30...), como no Integra. */
const proximoCodigoDeFilial = (grupo) => {
    const maior = (grupo?.filiais ?? []).reduce((m, f) => Math.max(m, Number(f.codigo) || 0), 0);
    return String(Math.max(10, (Math.floor(maior / 10) + 1) * 10));
};
exports.proximoCodigoDeFilial = proximoCodigoDeFilial;
/**
 * Valida a filial nova (ou a edicao de uma existente, passando `ignorarTenantId`).
 * `cnpjMatriz` e' o CNPJ da empresa que vira (ou ja' e') a matriz.
 */
/** Nome e codigo (o que a edicao de uma filial muda). */
const validarNomeECodigoDaFilial = (dados, grupo, ignorarTenantId) => {
    const outras = (grupo?.filiais ?? []).filter((f) => f.tenantId !== ignorarTenantId);
    if (!dados.nome)
        return 'Informe o nome da filial (ex.: o nome da loja ou do bairro).';
    if (!/^\d{1,3}$/.test(dados.codigo))
        return 'O código da filial é um número de 1 a 3 dígitos (10, 20, 30...).';
    const mesmoCodigo = outras.find((f) => f.codigo === dados.codigo);
    if (mesmoCodigo)
        return `O código ${dados.codigo} já é da filial ${(0, exports.rotuloFilial)(mesmoCodigo)}. Escolha outro.`;
    return null;
};
exports.validarNomeECodigoDaFilial = validarNomeECodigoDaFilial;
const validarDadosDaFilial = (dados, grupo, cnpjMatriz, ignorarTenantId) => {
    const outras = (grupo?.filiais ?? []).filter((f) => f.tenantId !== ignorarTenantId);
    const erroNomeCodigo = (0, exports.validarNomeECodigoDaFilial)(dados, grupo, ignorarTenantId);
    if (erroNomeCodigo)
        return erroNomeCodigo;
    if (!exports.UFS.includes(dados.uf))
        return 'Escolha o estado (UF) da filial.';
    if (!dados.cidade)
        return 'Informe a cidade da filial.';
    if (dados.tipo === 'mesmo_cnpj') {
        if (soDigitos(cnpjMatriz) && dados.cnpj && dados.cnpj !== soDigitos(cnpjMatriz)) {
            return 'Filial "mesmo CNPJ" usa o CNPJ da matriz. Para outro CNPJ, escolha "CNPJ próprio".';
        }
        return null;
    }
    if (!(0, exports.cnpjValido)(dados.cnpj))
        return 'O CNPJ da filial não é válido. Confira os números (14 dígitos).';
    if (dados.cnpj === soDigitos(cnpjMatriz)) {
        return 'Esse é o CNPJ da matriz. Se a filial usa o mesmo CNPJ (loja ou depósito), escolha "Mesmo CNPJ da matriz".';
    }
    const mesmoCnpj = outras.find((f) => f.tipo === 'cnpj_proprio' && f.cnpj === dados.cnpj);
    if (mesmoCnpj)
        return `Esse CNPJ já é da filial ${(0, exports.rotuloFilial)(mesmoCnpj)}.`;
    return null;
};
exports.validarDadosDaFilial = validarDadosDaFilial;
// ---------------------------------------------------------------------------
// Configuracao inicial da filial (copiada da matriz)
// ---------------------------------------------------------------------------
/**
 * Campos que sao a IDENTIDADE da empresa (ou segredos dela) e por isso nunca
 * sao copiados da matriz para a filial: CNPJ, razao social, IE, endereco,
 * contato, Spedy e NFS-e (inscricao municipal e cidade). O resto (formas de
 * pagamento, regras de venda, modelos de impressao, plano de contas...) vem da
 * matriz e a filial ajusta depois.
 */
exports.CAMPOS_DE_IDENTIDADE_DA_EMPRESA = [
    'tenantId', 'grupoId', 'filialCodigo', 'createdAt', 'updatedAt', 'alteradoPor', 'alteradoEm', 'ultimaAlteracao',
    'nomeOficina', 'razaoSocial', 'nomeFantasia', 'nomeUsuario', 'cnpj', 'inscricaoEstadual',
    'telefone', 'whatsapp', 'instagram', 'email',
    'rua', 'numero', 'complemento', 'bairro', 'cep', 'endereco', 'cidade', 'uf', 'codigoIbge',
    'spedyEnabled', 'spedyApiKey', 'spedyEnvironment', 'spedyCompanyId',
    'nfseCidadeCodigo', 'nfseCidadeNome', 'nfseCidadeEstado', 'nfseInscricaoMunicipal',
];
const configuracaoInicialDaFilial = (configMatriz, dados, contexto) => {
    const copia = {};
    for (const [campo, valor] of Object.entries(configMatriz || {})) {
        if (exports.CAMPOS_DE_IDENTIDADE_DA_EMPRESA.includes(campo) || valor === undefined)
            continue;
        copia[campo] = valor;
    }
    const mesmoCnpj = dados.tipo === 'mesmo_cnpj';
    return {
        ...copia,
        ...(0, exports.identidadeParaConfiguracao)(dados),
        tenantId: contexto.tenantId,
        grupoId: contexto.grupoId,
        razaoSocial: mesmoCnpj ? contexto.razaoSocialMatriz : (dados.razaoSocial || dados.nome),
        cnpj: mesmoCnpj ? soDigitos(contexto.cnpjMatriz) : dados.cnpj,
        // A filial precisa ser cadastrada na Spedy (CNPJ dela) antes de emitir nota.
        spedyEnabled: false,
    };
};
exports.configuracaoInicialDaFilial = configuracaoInicialDaFilial;
/** Entrada da filial no documento do grupo. */
const filialParaGravar = (tenantId, dados, cnpjMatriz, matriz) => ({
    tenantId,
    codigo: dados.codigo,
    nome: dados.nome,
    cnpj: dados.tipo === 'mesmo_cnpj' ? soDigitos(cnpjMatriz) : dados.cnpj,
    uf: dados.uf,
    cidade: dados.cidade,
    tipo: dados.tipo,
    matriz,
    ativa: true,
});
exports.filialParaGravar = filialParaGravar;
/** A empresa atual vira a matriz (codigo 10) quando a primeira filial e' criada. */
const matrizAPartirDaConfiguracao = (tenantId, config) => ({
    tenantId,
    codigo: '10',
    nome: (texto(config.nomeOficina) || texto(config.nomeFantasia) || texto(config.razaoSocial) || 'MATRIZ').toUpperCase(),
    cnpj: soDigitos(config.cnpj),
    uf: texto(config.uf).toUpperCase(),
    cidade: texto(config.cidade).toUpperCase(),
    tipo: 'cnpj_proprio',
    matriz: true,
    ativa: true,
});
exports.matrizAPartirDaConfiguracao = matrizAPartirDaConfiguracao;

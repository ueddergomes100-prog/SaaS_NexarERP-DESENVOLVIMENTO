"use strict";
/*
 * CLIENTE A CADASTRAR (27/11/2026, Ivan da Embala Minas: "um cliente a
 * cadastrar ... coloco o nome nele na hora, ou a cidade ... vai pagar a vista";
 * "o que eu nao gosto e' do sistema aceitar fechar a venda de um cliente sem
 * cadastrar no prazo"). Decisoes do dono: no Pedido de Venda / pre-venda e no
 * app Vendas; nome, cidade e telefone.
 *
 * O pedido continua sendo do CONSUMIDOR FINAL (clienteId do cadastro padrao,
 * clienteNome 'CONSUMIDOR FINAL'): todas as travas de quem nao tem cadastro
 * continuam valendo -- sem Boleto e sem Pagamento a Prazo, sem credito, sem
 * cashback. So' ganha `clienteSemCadastro` ({ nome, cidade?, telefone? }), que
 * sai no papel, na minuta, no romaneio e nas listas no lugar de "CONSUMIDOR
 * FINAL". Nao cria cadastro.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.erroDasFormasSemCadastro = exports.complementoDoClienteSemCadastro = exports.nomeDoClienteDoPedido = exports.telefoneFormatado = exports.lerClienteSemCadastro = exports.FORMAS_PROIBIDAS_SEM_CADASTRO = exports.CIDADE_SEM_CADASTRO_MAX = exports.NOME_SEM_CADASTRO_MAX = exports.CAMPO_CLIENTE_SEM_CADASTRO = void 0;
exports.CAMPO_CLIENTE_SEM_CADASTRO = 'clienteSemCadastro';
exports.NOME_SEM_CADASTRO_MAX = 60;
exports.CIDADE_SEM_CADASTRO_MAX = 40;
exports.FORMAS_PROIBIDAS_SEM_CADASTRO = ['Boleto', 'Pagamento a Prazo'];
const limpo = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Le o que veio da tela ou do banco. null = nao ha' (ou sem nome). Nunca grava chave vazia. */
const lerClienteSemCadastro = (valor) => {
    if (!valor || typeof valor !== 'object')
        return null;
    const v = valor;
    const nome = limpo(v.nome, exports.NOME_SEM_CADASTRO_MAX).toUpperCase();
    if (nome.length < 2)
        return null;
    const cidade = limpo(v.cidade, exports.CIDADE_SEM_CADASTRO_MAX).toUpperCase();
    const telefone = String(v.telefone ?? '').replace(/\D/g, '').slice(0, 13);
    return {
        nome,
        ...(cidade ? { cidade } : {}),
        ...(telefone.length >= 8 ? { telefone } : {}),
    };
};
exports.lerClienteSemCadastro = lerClienteSemCadastro;
/** Telefone para o papel: (33) 99999-0000. */
const telefoneFormatado = (digitos) => {
    const d = String(digitos || '').replace(/\D/g, '');
    if (d.length === 11)
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10)
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
};
exports.telefoneFormatado = telefoneFormatado;
/** Nome que sai no papel e nas listas: o do cliente a cadastrar, ou o do pedido. */
const nomeDoClienteDoPedido = (pedido, padrao = 'Consumidor Final') => {
    const semCadastro = (0, exports.lerClienteSemCadastro)(pedido?.[exports.CAMPO_CLIENTE_SEM_CADASTRO]);
    if (semCadastro)
        return semCadastro.nome;
    return String(pedido?.clienteNome ?? '').trim() || padrao;
};
exports.nomeDoClienteDoPedido = nomeDoClienteDoPedido;
/** Linha de complemento no papel: "Cliente a cadastrar · MANHUACU · (33) 99999-0000". */
const complementoDoClienteSemCadastro = (pedido) => {
    const c = (0, exports.lerClienteSemCadastro)(pedido?.[exports.CAMPO_CLIENTE_SEM_CADASTRO]);
    if (!c)
        return '';
    return ['Cliente a cadastrar', c.cidade || '', c.telefone ? (0, exports.telefoneFormatado)(c.telefone) : ''].filter(Boolean).join(' · ');
};
exports.complementoDoClienteSemCadastro = complementoDoClienteSemCadastro;
/** Por que a venda nao pode sair com estas formas, ou null. */
const erroDasFormasSemCadastro = (formas, semCadastro) => {
    if (!semCadastro)
        return null;
    const proibida = formas.map((f) => String(f ?? '').trim()).find((f) => exports.FORMAS_PROIBIDAS_SEM_CADASTRO.includes(f));
    if (!proibida)
        return null;
    return `"${semCadastro.nome}" não tem cadastro: não dá para vender em ${proibida}. Receba à vista (dinheiro, Pix ou cartão) ou cadastre o cliente e escolha ele no pedido.`;
};
exports.erroDasFormasSemCadastro = erroDasFormasSemCadastro;

"use strict";
/*
 * SENHA DE ACESSO FORTE (27/11/2026, comparacao com Bling/Tiny pedida pelo dono).
 *
 * Antes: 6 caracteres de qualquer jeito ("111111" passava). Agora, para toda
 * senha NOVA de funcionario (criar login ou trocar a senha pelo cadastro):
 *  - pelo menos 8 caracteres;
 *  - pelo menos uma letra e um numero;
 *  - nao pode ser sequencia ou repeticao obvia (12345678, aaaaaaaa, senha123...).
 * Senha antiga continua valendo ate' ser trocada: ninguem fica trancado fora.
 * A mesma regra roda na tela e no servidor (server/domain e' gerado deste arquivo).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.problemaDaSenha = exports.SENHA_MINIMO_CARACTERES = void 0;
exports.SENHA_MINIMO_CARACTERES = 8;
const OBVIAS = new Set([
    'senha123', 'senha1234', 'senha12345', 'mudar123', 'trocar123', 'admin123', 'abc12345', 'abcd1234',
    'qwerty123', 'password1', 'hennder123', 'nexar123', '1234abcd', '12345abc', 'a1b2c3d4',
]);
const SEQUENCIAS = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl'];
const ehSequenciaOuRepeticao = (senha) => {
    const s = senha.toLowerCase();
    if (new Set(s).size <= 2)
        return true;
    return SEQUENCIAS.some((seq) => seq.includes(s));
};
/** Problema da senha, em portugues para o usuario; null quando a senha serve. */
const problemaDaSenha = (senhaBruta) => {
    const senha = typeof senhaBruta === 'string' ? senhaBruta : '';
    if (senha.length < exports.SENHA_MINIMO_CARACTERES) {
        return `A senha precisa ter pelo menos ${exports.SENHA_MINIMO_CARACTERES} caracteres, com letras e números.`;
    }
    if (senha.length > 128)
        return 'A senha pode ter no máximo 128 caracteres.';
    if (!/\p{L}/u.test(senha) || !/\d/.test(senha)) {
        return 'A senha precisa ter letras e números (por exemplo, uma palavra e alguns números juntos).';
    }
    if (OBVIAS.has(senha.toLowerCase()) || ehSequenciaOuRepeticao(senha)) {
        return 'Essa senha é fácil demais de adivinhar. Escolha outra, misturando letras e números.';
    }
    return null;
};
exports.problemaDaSenha = problemaDaSenha;

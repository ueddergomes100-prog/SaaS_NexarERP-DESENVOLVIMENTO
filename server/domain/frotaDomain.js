"use strict";
/*
 * FROTA PROPRIA (pedido do dono, 2026-09-25): veiculos da EMPRESA (caminhao de
 * entrega, carro, moto), separados do cadastro de Veiculos de CLIENTE (que serve
 * a Ordem de Servico e exige o cliente). Cada despesa do Contas a Pagar pode
 * apontar para um veiculo da frota, e o relatorio de custo por veiculo soma isso.
 *
 * Regra pura: sem tela, sem Firestore.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.erroDoVeiculo = exports.rotuloDoVeiculo = exports.formatarPlaca = exports.placaValida = exports.normalizarPlaca = exports.TIPOS_DE_VEICULO = void 0;
exports.TIPOS_DE_VEICULO = ['Carro', 'Caminhão', 'Caminhonete', 'Van', 'Moto', 'Outro'];
/** Placa em maiuscula, sem espaco nem hifen ("abc-1d23" -> "ABC1D23"). */
const normalizarPlaca = (placa) => String(placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
exports.normalizarPlaca = normalizarPlaca;
/** 7 caracteres: formato antigo (ABC1234) ou Mercosul (ABC1D23). */
const placaValida = (placa) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test((0, exports.normalizarPlaca)(placa));
exports.placaValida = placaValida;
const formatarPlaca = (placa) => {
    const p = (0, exports.normalizarPlaca)(placa);
    return p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
};
exports.formatarPlaca = formatarPlaca;
/** Como o veiculo aparece nas listas e nos titulos: "VW DELIVERY — ABC-1D23". */
const rotuloDoVeiculo = (veiculo) => (`${String(veiculo.modelo || '').trim()}${veiculo.modelo && veiculo.placa ? ' — ' : ''}${(0, exports.formatarPlaca)(veiculo.placa)}`.trim());
exports.rotuloDoVeiculo = rotuloDoVeiculo;
/** Problema que impede salvar (em portugues, dizendo o que fazer), ou null. */
const erroDoVeiculo = (dados, existentes, idEmEdicao) => {
    const placa = (0, exports.normalizarPlaca)(dados.placa);
    if (!placa)
        return 'Informe a placa do veículo.';
    if (!(0, exports.placaValida)(placa))
        return 'A placa precisa ter 7 letras e números (ex.: ABC-1234 ou ABC-1D23). Confira o que foi digitado.';
    if (!String(dados.modelo ?? '').trim())
        return 'Informe o modelo do veículo (ex.: VW Delivery).';
    if (existentes.some((v) => v.id !== idEmEdicao && (0, exports.normalizarPlaca)(v.placa) === placa)) {
        return `Já existe um veículo com a placa ${(0, exports.formatarPlaca)(placa)} na frota. Edite o cadastro dele em vez de criar outro.`;
    }
    const ano = String(dados.ano ?? '').trim();
    if (ano && !/^(19|20)\d{2}$/.test(ano))
        return 'O ano precisa ter 4 números (ex.: 2021).';
    const km = String(dados.kmAtual ?? '').trim();
    if (km && !(Number(km.replace(',', '.')) >= 0))
        return 'O KM atual precisa ser um número (zero ou maior).';
    return null;
};
exports.erroDoVeiculo = erroDoVeiculo;

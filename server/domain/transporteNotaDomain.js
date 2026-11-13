"use strict";
/**
 * FRETE E TRANSPORTE NA NOTA DE VENDA (27/10/2026, pedido urgente do dono).
 *
 * O que estava errado: o frete do Pedido de Venda entrava no TOTAL da nota,
 * mas a nota nao dizia que era frete (sem vFrete) e ia sem transportadora,
 * modalidade, placa ou volumes. E o campo de frete so' aceitava numero
 * inteiro.
 *
 * Agora o pedido guarda o transporte (modalidade, transportadora = um
 * fornecedor do tipo Transportadora, placa e volumes) e a NF-e leva tudo: o
 * grupo [transp] da SEFAZ, o frete [vFrete] e os encargos como "outras
 * despesas" [vOutro], rateados entre os itens pelo valor de cada um (a SEFAZ
 * soma o dos itens). Formato da Spedy conferido em
 * https://docs.spedy.com.br/openapi/v1.json (SefazInvoiceTransportDto) em
 * 27/10/2026.
 *
 * Cadastro incompleto da transportadora BLOQUEIA com a mensagem de onde
 * corrigir (CLAUDE.md, regra 1) -- a nota nao sai com dado inventado.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumoDoTransporte = exports.ratearPorPeso = exports.montarTransporteDaNota = exports.modalidadeEfetiva = exports.diferencasDoTransporte = exports.notaTravaOTransporte = exports.STATUS_DE_NOTA_QUE_TRAVA_O_TRANSPORTE = exports.transporteParaGravar = exports.temTransporte = exports.lerTransporte = exports.valorDigitado = exports.UFS_BRASIL = exports.placaValida = exports.normalizarPlaca = exports.NUMERO_DO_ENDERECO_MAX = exports.TRANSPORTE_VAZIO = exports.VOLUMES_VAZIOS = exports.ROTULO_MODALIDADE_FRETE_DEVOLUCAO = exports.ROTULO_MODALIDADE_FRETE = exports.MODALIDADES_FRETE = void 0;
exports.MODALIDADES_FRETE = ['byIssuer', 'byReceiver', 'byThirdParties', 'byIssuerOwnTransport', 'byReceiverOwnTransport', 'free'];
/** Texto da tela (com o codigo modFrete da SEFAZ entre parenteses, que o contador conhece). */
exports.ROTULO_MODALIDADE_FRETE = {
    byIssuer: 'Por conta da loja — CIF (0)',
    byReceiver: 'Por conta do cliente — FOB (1)',
    byThirdParties: 'Por conta de terceiros (2)',
    byIssuerOwnTransport: 'Transporte próprio da loja (3)',
    byReceiverOwnTransport: 'Transporte próprio do cliente (4)',
    free: 'Sem frete / sem transporte (9)',
};
/**
 * Os mesmos codigos, sem falar em "loja" e "cliente": na NOTA DE DEVOLUCAO
 * (13/11/2026) quem emite e quem recebe mudam de papel -- na devolucao ao
 * fornecedor quem recebe e' o fornecedor; na devolucao de venda a nota e' de
 * entrada da propria loja.
 */
exports.ROTULO_MODALIDADE_FRETE_DEVOLUCAO = {
    byIssuer: 'Por conta de quem emite a nota — CIF (0)',
    byReceiver: 'Por conta de quem recebe — FOB (1)',
    byThirdParties: 'Por conta de terceiros (2)',
    byIssuerOwnTransport: 'Transporte próprio de quem emite (3)',
    byReceiverOwnTransport: 'Transporte próprio de quem recebe (4)',
    free: 'Sem frete / sem transporte (9)',
};
exports.VOLUMES_VAZIOS = { quantidade: 0, especie: '', marca: '', numeracao: '', pesoBrutoKg: 0, pesoLiquidoKg: 0 };
exports.TRANSPORTE_VAZIO = { modalidade: '', transportadoraId: '', transportadoraNome: '', placa: '', placaUf: '', volumes: exports.VOLUMES_VAZIOS };
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
/**
 * Tamanho maximo do numero do endereco na Spedy (AddressDto/AddressCreateDto
 * `number`, maxLength 10 no openapi, conferido em 07/11/2026). Passar disso a
 * Spedy recusa a nota inteira com "The field Number must be a string with a
 * maximum length of 10" -- caso da transportadora com "2809, SALA ADM 2" no
 * Numero. Vale para o destinatario e para a transportadora.
 */
exports.NUMERO_DO_ENDERECO_MAX = 10;
/** Numero digitado ("1.234,5" ou "1234.5"); lixo/negativo = 0. Com virgula, ponto e' milhar. */
const numero = (v) => {
    const s = String(v ?? '').trim();
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const arred2 = (n) => Math.round(n * 100) / 100;
const arred3 = (n) => Math.round(n * 1000) / 1000;
/** Placa no padrao antigo (ABC1234) ou Mercosul (ABC1D23), sem traco. */
const normalizarPlaca = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
exports.normalizarPlaca = normalizarPlaca;
const placaValida = (placa) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa);
exports.placaValida = placaValida;
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
exports.UFS_BRASIL = UFS;
/** Valor de dinheiro digitado ("180,50", "1.234,56", "180.5") -> numero com 2 casas; lixo/negativo = 0. */
const valorDigitado = (v, casas = 2) => {
    const s = String(v ?? '').trim();
    if (!s)
        return 0;
    // Com virgula: ponto e' milhar. Sem virgula: ponto e' decimal.
    const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = Number(normal);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    // Peso em kg vai com 3 casas na NF-e (pesoL/pesoB); dinheiro com 2 (07/11/2026: 0,537 kg virava 0,54).
    return casas === 3 ? arred3(n) : arred2(n);
};
exports.valorDigitado = valorDigitado;
/** O que veio gravado no pedido (ou do corpo do servidor), limpo. Nunca devolve undefined. */
const lerTransporte = (raw) => {
    const t = (raw && typeof raw === 'object' ? raw : {});
    const v = (t.volumes && typeof t.volumes === 'object' ? t.volumes : {});
    const modalidade = exports.MODALIDADES_FRETE.includes(t.modalidade) ? t.modalidade : '';
    const uf = texto(t.placaUf, 2).toUpperCase();
    return {
        modalidade,
        transportadoraId: /^[A-Za-z0-9_-]{1,128}$/.test(String(t.transportadoraId ?? '')) ? String(t.transportadoraId) : '',
        transportadoraNome: texto(t.transportadoraNome, 120),
        placa: (0, exports.normalizarPlaca)(t.placa),
        placaUf: UFS.includes(uf) ? uf : '',
        volumes: {
            quantidade: Math.floor(numero(v.quantidade)),
            especie: texto(v.especie, 60),
            marca: texto(v.marca, 60),
            numeracao: texto(v.numeracao, 60),
            pesoBrutoKg: arred3(numero(v.pesoBrutoKg)),
            pesoLiquidoKg: arred3(numero(v.pesoLiquidoKg)),
        },
    };
};
exports.lerTransporte = lerTransporte;
const volumesPreenchidos = (v) => (v.quantidade > 0 || Boolean(v.especie || v.marca || v.numeracao) || v.pesoBrutoKg > 0 || v.pesoLiquidoKg > 0);
/** Alguma informacao de transporte preenchida? */
const temTransporte = (t) => (Boolean(t.modalidade || t.transportadoraId || t.placa) || volumesPreenchidos(t.volumes));
exports.temTransporte = temTransporte;
/** Para gravar no pedido: so' o que tem valor; null = nada (a chave fica de fora). */
const transporteParaGravar = (t) => ((0, exports.temTransporte)(t) ? { ...(0, exports.lerTransporte)(t) } : null);
exports.transporteParaGravar = transporteParaGravar;
/**
 * TRANSPORTE DA VENDA FINALIZADA (07/11/2026, pedido do dono): volumes, pesos,
 * transportadora e placa sao dados da nota, nao do valor -- muitas vezes so'
 * se sabem na expedicao, depois de fechar a venda (caso real: peso liquido
 * digitado errado numa exportacao ja' finalizada). Ajusta-se enquanto a venda
 * nao tem nota transmitida; nota nesses status trava (rejeitada ou cancelada
 * nao trava: a nota sai de novo com o transporte novo).
 */
exports.STATUS_DE_NOTA_QUE_TRAVA_O_TRANSPORTE = ['authorized', 'enqueued', 'processing', 'created'];
const notaTravaOTransporte = (status) => (exports.STATUS_DE_NOTA_QUE_TRAVA_O_TRANSPORTE.includes(String(status ?? '')));
exports.notaTravaOTransporte = notaTravaOTransporte;
/** O que mudou no transporte, em portugues, para o historico da venda. */
const diferencasDoTransporte = (antes, depois) => {
    const a = (0, exports.lerTransporte)(antes);
    const d = (0, exports.lerTransporte)(depois);
    const kg = (n) => (n > 0 ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg` : '—');
    const quem = (t) => (t.modalidade ? exports.ROTULO_MODALIDADE_FRETE[t.modalidade] : 'Automático');
    const placa = (t) => (t.placa ? `${t.placa}${t.placaUf ? `/${t.placaUf}` : ''}` : '—');
    const linhas = [
        ['Quem paga o frete', quem(a), quem(d)],
        ['Transportadora', a.transportadoraNome || '—', d.transportadoraNome || '—'],
        ['Placa do veículo', placa(a), placa(d)],
        ['Volumes', a.volumes.quantidade > 0 ? String(a.volumes.quantidade) : '—', d.volumes.quantidade > 0 ? String(d.volumes.quantidade) : '—'],
        ['Espécie', a.volumes.especie || '—', d.volumes.especie || '—'],
        ['Marca', a.volumes.marca || '—', d.volumes.marca || '—'],
        ['Numeração', a.volumes.numeracao || '—', d.volumes.numeracao || '—'],
        ['Peso bruto', kg(a.volumes.pesoBrutoKg), kg(d.volumes.pesoBrutoKg)],
        ['Peso líquido', kg(a.volumes.pesoLiquidoKg), kg(d.volumes.pesoLiquidoKg)],
    ];
    return linhas
        .filter(([, x, y]) => x !== y)
        .map(([campo, valorAnterior, valorNovo]) => ({ campo, valorAnterior, valorNovo }));
};
exports.diferencasDoTransporte = diferencasDoTransporte;
/** Modalidade que vai para a nota: a escolhida; sem escolha, com frete = por conta da loja, sem frete = sem frete. */
const modalidadeEfetiva = (t, frete) => (t.modalidade || (frete > 0 ? 'byIssuer' : 'free'));
exports.modalidadeEfetiva = modalidadeEfetiva;
/**
 * Grupo [transp] da NF-e no formato da Spedy. `transportadora` e' o cadastro
 * lido agora (null = nao achou); so' e' consultado quando o pedido tem uma.
 */
const montarTransporteDaNota = (a) => {
    const t = a.transporte;
    const onde = a.onde || 'no Pedido de Venda';
    const avisos = [];
    const modalidade = (0, exports.modalidadeEfetiva)(t, a.frete);
    if (a.frete > 0 && modalidade === 'free') {
        return { ok: false, erro: 'A venda tem frete, mas o transporte está como "Sem frete". No Pedido de Venda, em Frete e Encargos › Transporte, escolha quem paga o frete (por conta da loja ou do cliente).' };
    }
    const transport = { freightModality: modalidade };
    if (t.transportadoraId) {
        const c = a.transportadora;
        const nome = t.transportadoraNome || 'escolhida no pedido';
        if (!c)
            return { ok: false, erro: `A transportadora ${nome} não foi encontrada no cadastro. Confira em Cadastros › Fornecedores ou escolha outra ${onde}.` };
        const doc = soDigitos(c.documento);
        if (doc.length !== 11 && doc.length !== 14) {
            return { ok: false, erro: `A transportadora ${c.nome || nome} está sem CNPJ/CPF válido. Edite em Cadastros › Fornecedores e informe o documento.` };
        }
        const ie = String(c.inscricaoEstadual ?? '').trim().toUpperCase();
        const carrier = {
            name: texto(c.nome, 60),
            federalTaxNumber: doc,
            ...(ie === 'ISENTO' ? { stateTaxNumber: 'ISENTO' } : soDigitos(ie) ? { stateTaxNumber: soDigitos(ie) } : {}),
            ...(c.email ? { email: texto(c.email, 60) } : {}),
            ...(soDigitos(c.telefone) ? { phone: soDigitos(c.telefone) } : {}),
        };
        const uf = String(c.estado ?? '').trim().toUpperCase();
        const numeroEndereco = String(c.numero ?? '').trim();
        if (c.endereco && c.cidade && UFS.includes(uf)) {
            if (numeroEndereco.length > exports.NUMERO_DO_ENDERECO_MAX) {
                return { ok: false, erro: `O número do endereço da transportadora ${c.nome || nome} ("${numeroEndereco}") tem ${numeroEndereco.length} caracteres e a nota fiscal aceita no máximo ${exports.NUMERO_DO_ENDERECO_MAX}. Edite em Cadastros › Fornecedores e deixe no Número só o número do imóvel.` };
            }
            carrier.address = {
                street: texto(c.endereco, 60),
                ...(numeroEndereco ? { number: numeroEndereco } : {}),
                ...(c.bairro ? { district: texto(c.bairro, 60) } : {}),
                ...(soDigitos(c.cep) ? { postalCode: soDigitos(c.cep) } : {}),
                city: { ...(soDigitos(c.codigoIbge).length === 7 ? { code: soDigitos(c.codigoIbge) } : {}), name: texto(c.cidade, 60), state: uf },
            };
        }
        else {
            avisos.push(`A transportadora ${c.nome || nome} está sem endereço completo no cadastro; a nota sai sem o endereço dela.`);
        }
        transport.carrier = carrier;
    }
    if (t.placa) {
        if (!(0, exports.placaValida)(t.placa))
            return { ok: false, erro: `A placa "${t.placa}" não é válida. Use o formato ABC1234 ou ABC1D23 ${onde}, em Transporte.` };
        if (!t.placaUf)
            return { ok: false, erro: `Informe a UF da placa ${t.placa} ${onde}, em Transporte.` };
        transport.vehicle = { plate: t.placa, state: t.placaUf.toLowerCase() };
    }
    const v = t.volumes;
    if (volumesPreenchidos(v)) {
        transport.volume = {
            ...(v.quantidade > 0 ? { quantity: v.quantidade } : {}),
            ...(v.especie ? { species: v.especie } : {}),
            ...(v.marca ? { brand: v.marca } : {}),
            ...(v.numeracao ? { volumeNumeration: v.numeracao } : {}),
            ...(v.pesoLiquidoKg > 0 ? { netWeight: v.pesoLiquidoKg } : {}),
            ...(v.pesoBrutoKg > 0 ? { grossWeight: v.pesoBrutoKg } : {}),
        };
    }
    return { ok: true, transport, avisos };
};
exports.montarTransporteDaNota = montarTransporteDaNota;
/**
 * Rateia um valor (frete, outras despesas) entre os itens pelo peso (valor de
 * cada item), em centavos exatos: a soma das partes e' sempre o total.
 */
const ratearPorPeso = (total, pesos) => {
    const totalCent = Math.round(Math.max(0, total) * 100);
    if (pesos.length === 0)
        return [];
    if (totalCent === 0)
        return pesos.map(() => 0);
    const somaPesos = pesos.reduce((s, p) => s + Math.max(0, p), 0);
    const base = somaPesos > 0 ? pesos.map((p) => Math.max(0, p) / somaPesos) : pesos.map(() => 1 / pesos.length);
    const brutas = base.map((f) => f * totalCent);
    const inteiras = brutas.map((b) => Math.floor(b));
    let resto = totalCent - inteiras.reduce((s, n) => s + n, 0);
    const ordem = brutas.map((b, i) => ({ i, frac: b - Math.floor(b) })).sort((x, y) => y.frac - x.frac);
    for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto -= 1)
        inteiras[ordem[k].i] += 1;
    return inteiras.map((c) => c / 100);
};
exports.ratearPorPeso = ratearPorPeso;
/** Resumo de uma linha para a tela de NF-e ("Frete R$ 180,50 · Por conta da loja · TRANSPORTADORA X"). */
const resumoDoTransporte = (t, frete) => {
    const partes = [];
    if (frete > 0)
        partes.push(`Frete ${frete.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    partes.push(exports.ROTULO_MODALIDADE_FRETE[(0, exports.modalidadeEfetiva)(t, frete)]);
    if (t.transportadoraNome)
        partes.push(t.transportadoraNome);
    if (t.placa)
        partes.push(`placa ${t.placa}${t.placaUf ? `/${t.placaUf}` : ''}`);
    if (t.volumes.quantidade > 0)
        partes.push(`${t.volumes.quantidade} vol.${t.volumes.especie ? ` ${t.volumes.especie}` : ''}`);
    return partes.join(' · ');
};
exports.resumoDoTransporte = resumoDoTransporte;

/**
 * MINUTA DE ENTREGA NO LAYOUT DO SISTEMA ANTIGO (2026-09-21) -- formatacao.
 *
 * A Sol Natus pediu a minuta identica a que ja' imprimia no ERP anterior
 * (quantidade com 4 casas, CPF/telefone formatados, "Total de Peca(s)" e
 * data/hora de emissao). Estas funcoes so' formatam; quem busca os dados e'
 * MinutaPrint.tsx e quem desenha e' MinutaPrintDocument.tsx.
 */

const somenteDigitos = (valor: unknown): string => String(valor ?? '').replace(/\D/g, '');

/** CPF (11 digitos) ou CNPJ (14). Qualquer outro tamanho volta como veio --
 * documento mal digitado aparece como esta' no cadastro, nunca "consertado". */
export const formatarDocumentoMinuta = (valor: unknown): string => {
  const d = somenteDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return String(valor ?? '').trim();
};

export const rotuloDocumentoMinuta = (valor: unknown): 'CPF' | 'CNPJ' => (
  somenteDigitos(valor).length === 14 ? 'CNPJ' : 'CPF'
);

/** (33) 3333-3333 ou (33) 98414-5675. Sem DDD ou de tamanho estranho volta
 * como veio. */
export const formatarTelefoneMinuta = (valor: unknown): string => {
  const d = somenteDigitos(valor);
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  return String(valor ?? '').trim();
};

export const formatarCepMinuta = (valor: unknown): string => {
  const d = somenteDigitos(valor);
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : String(valor ?? '').trim();
};

/** "5,0000": a minuta antiga sempre mostrou 4 casas na quantidade. */
export const formatarQuantidadeMinuta = (valor: unknown): string => (
  Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
);

/** "15,00": total de pecas com 2 casas. */
export const formatarTotalPecasMinuta = (itens: Array<{ quantidade: unknown }>): string => (
  itens.reduce((soma, item) => soma + Number(item.quantidade || 0), 0)
    .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

const dataHoraPartes = (data: Date) => {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(data);
  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    data: `${pega('day')}/${pega('month')}/${pega('year')}`,
    hora: `${pega('hour')}:${pega('minute')}`,
    horaCompleta: `${pega('hour')}:${pega('minute')}:${pega('second')}`,
  };
};

/** "21/09/26" (fuso de Sao Paulo) -- data curta da pre-venda. */
export const formatarDataCurtaMinuta = (data: Date | null | undefined): string => {
  if (!data || Number.isNaN(data.getTime())) return '';
  const p = dataHoraPartes(data);
  return `${p.data.slice(0, 6)}${p.data.slice(8)}`;
};

/** "09:59" (fuso de Sao Paulo). */
export const formatarHoraMinuta = (data: Date | null | undefined): string => {
  if (!data || Number.isNaN(data.getTime())) return '';
  return dataHoraPartes(data).hora;
};

/** Emissao: "21/09/2026 09:59" (fuso de Sao Paulo). */
export const formatarEmissaoMinuta = (data: Date | null | undefined): string => {
  if (!data || Number.isNaN(data.getTime())) return '';
  const p = dataHoraPartes(data);
  return `${p.data} ${p.hora}`;
};

/** Rodape: "21/09/2026 as 10:27:31". */
export const formatarGeradoEmMinuta = (data: Date): string => {
  const p = dataHoraPartes(data);
  return `${p.data} as ${p.horaCompleta}`;
};

/** Condicao de pagamento da venda: as formas usadas, sem repetir
 * ("Pix / Boleto"). Pre-venda ainda sem pagamento definido volta vazio. */
export const condicaoPagamentoMinuta = (pagamentos: unknown): string => {
  if (!Array.isArray(pagamentos)) return '';
  const formas: string[] = [];
  pagamentos.forEach((pagamento) => {
    const forma = String((pagamento && (pagamento.forma || pagamento.formaPagamento)) || '').trim();
    if (forma && !formas.includes(forma)) formas.push(forma);
  });
  return formas.join(' / ');
};

/** "2913 DAVI ..." -- codigo e nome; sem codigo, so' o nome. */
export const codigoENomeMinuta = (codigo: unknown, nome: unknown): string => (
  [String(codigo ?? '').trim(), String(nome ?? '').trim()].filter(Boolean).join(' ')
);

/** "1 - DAVI JORGE" (vendedor). */
export const vendedorMinuta = (codigo: unknown, nome: unknown): string => (
  [String(codigo ?? '').trim(), String(nome ?? '').trim()].filter(Boolean).join(' - ')
);

/** Rua e numero: "AV. TRINTA DE MARCO, 22". */
export const enderecoMinuta = (cliente: { endereco?: string; numero?: string } | null | undefined): string => {
  const rua = String(cliente?.endereco ?? '').trim();
  const numero = String(cliente?.numero ?? '').trim();
  if (rua && numero) return `${rua}, ${numero}`;
  return rua || numero;
};

// Funcoes puras do Ajuste Manual de Estoque. Sem Firestore -- a
// leitura/escrita fica em applyAjusteEstoqueManual (src/utils/firestoreAtomic.ts),
// chamada pela tela AjusteEstoque.tsx.
//
// Existe porque nao havia caminho oficial pra corrigir a quantidade de um
// produto ja cadastrado quando a empresa esta com "Permitir Venda Sem
// Estoque" = Nao (o campo quantidade do cadastro fica bloqueado nesse caso,
// ver EstoqueForm.tsx). O ajuste manual e' esse caminho, com motivo obrigatorio
// e trilha em ajustes_estoque pra dar transparencia (Relatorio de Ajustes).

export type TipoAjusteEstoque = 'entrada' | 'saida';

export interface MotivoAjusteEstoqueOption {
  value: string;
  label: string;
}

export const MOTIVOS_AJUSTE_ENTRADA: MotivoAjusteEstoqueOption[] = [
  { value: 'sobra_inventario', label: 'Sobra de inventário' },
  { value: 'devolucao_cliente', label: 'Devolução de cliente' },
  { value: 'correcao_cadastro', label: 'Correção de cadastro' },
  { value: 'bonificacao', label: 'Bonificação / brinde do fornecedor' },
  { value: 'outro', label: 'Outro' },
];

export const MOTIVOS_AJUSTE_SAIDA: MotivoAjusteEstoqueOption[] = [
  { value: 'perda', label: 'Perda' },
  { value: 'quebra_avaria', label: 'Quebra / avaria' },
  { value: 'furto_roubo', label: 'Furto / roubo' },
  { value: 'vencimento', label: 'Vencimento' },
  { value: 'uso_interno', label: 'Uso interno' },
  { value: 'correcao_inventario', label: 'Correção de inventário' },
  { value: 'devolucao_fornecedor', label: 'Devolução ao fornecedor' },
  { value: 'outro', label: 'Outro' },
];

export const motivosAjusteEstoquePorTipo = (tipo: TipoAjusteEstoque): MotivoAjusteEstoqueOption[] =>
  (tipo === 'entrada' ? MOTIVOS_AJUSTE_ENTRADA : MOTIVOS_AJUSTE_SAIDA);

export const labelMotivoAjusteEstoque = (tipo: TipoAjusteEstoque, value: string): string =>
  motivosAjusteEstoquePorTipo(tipo).find((motivo) => motivo.value === value)?.label || value;

export interface LoteEstoque {
  id: string;
  lote: string;
  validade?: string | null;
  quantidade: number;
}

/** Estado minimo do formulario de ajuste que a validacao precisa enxergar. */
export interface AjusteEstoqueFormState {
  tipo: TipoAjusteEstoque;
  motivo: string;
  quantidade: number;
  controlarLote: boolean;
  saldoProduto: number;
  /** Saida em produto com lote: id do lote escolhido pra dar baixa. */
  loteSelecionadoId?: string;
  saldoLoteSelecionado?: number;
  /** Entrada em produto com lote: codigo de um lote novo (quando nao esta
   * reaproveitando um lote existente via loteSelecionadoId). */
  loteNovoCodigo?: string;
}

/** Devolve a mensagem de erro em portugues, ou null se o ajuste pode ser
 * salvo. Nao acessa Firestore -- so valida o que ja esta no estado da tela. */
export const validarAjusteEstoque = (form: AjusteEstoqueFormState): string | null => {
  if (!Number.isFinite(form.quantidade) || form.quantidade <= 0) {
    return 'Informe uma quantidade maior que zero.';
  }

  if (!form.motivo) {
    return 'Selecione o motivo do ajuste.';
  }

  if (form.controlarLote) {
    if (form.tipo === 'saida') {
      if (!form.loteSelecionadoId) {
        return 'Este produto controla lote e validade. Selecione qual lote está saindo.';
      }
      const saldoLote = form.saldoLoteSelecionado ?? 0;
      if (form.quantidade > saldoLote) {
        return `Quantidade maior que o saldo do lote selecionado (${saldoLote} disponível).`;
      }
    } else {
      if (!form.loteSelecionadoId && !form.loteNovoCodigo?.trim()) {
        return 'Este produto controla lote e validade. Selecione um lote existente ou informe um lote novo.';
      }
    }
    return null;
  }

  if (form.tipo === 'saida' && form.quantidade > form.saldoProduto) {
    return `Estoque insuficiente. Disponível: ${form.saldoProduto}.`;
  }

  return null;
};

export const computeQuantidadeDepoisAjuste = (
  quantidadeAntes: number,
  tipo: TipoAjusteEstoque,
  quantidade: number,
): number => (tipo === 'entrada' ? quantidadeAntes + quantidade : quantidadeAntes - quantidade);

export interface AjusteEstoqueDocInput {
  tenantId: string;
  produtoId: string;
  produtoNome: string;
  produtoCodigo?: string;
  tipo: TipoAjusteEstoque;
  quantidade: number;
  motivo: string;
  observacao?: string;
  loteId?: string;
  lote?: string;
  validade?: string | null;
  quantidadeAntes: number;
  quantidadeDepois: number;
  usuarioId: string;
  usuarioNome: string;
}

/** Monta o doc de ajustes_estoque sem nunca gravar chave com `undefined`
 * (Firestore recusa o save inteiro se isso acontecer). Campo opcional sem
 * valor e' omitido, nao gravado como undefined/null. */
export const buildAjusteEstoqueDoc = (input: AjusteEstoqueDocInput): Record<string, unknown> => {
  const doc: Record<string, unknown> = {
    tenantId: input.tenantId,
    produtoId: input.produtoId,
    produtoNome: input.produtoNome,
    tipo: input.tipo,
    quantidade: input.quantidade,
    motivo: input.motivo,
    quantidadeAntes: input.quantidadeAntes,
    quantidadeDepois: input.quantidadeDepois,
    usuarioId: input.usuarioId,
    usuarioNome: input.usuarioNome,
  };

  if (input.produtoCodigo) doc.produtoCodigo = input.produtoCodigo;
  if (input.observacao?.trim()) doc.observacao = input.observacao.trim();
  if (input.loteId) doc.loteId = input.loteId;
  if (input.lote) doc.lote = input.lote;
  if (input.validade) doc.validade = input.validade;

  return doc;
};

import Swal, { type SweetAlertOptions } from 'sweetalert2';

/**
 * Escapa texto pra ir dentro do `html:` de um pop-up. OBRIGATORIO em todo
 * dado que veio de cadastro (nome de cliente, produto, fornecedor, descricao):
 * o SweetAlert2 monta `html`, `footer`, os textos dos botoes e as opcoes de
 * `inputOptions` como HTML de verdade. Sem escapar, um nome cadastrado como
 * `<img src=x onerror=...>` roda codigo no navegador de quem abrir o pop-up,
 * com a sessao dele -- e esse nome pode vir de fora da empresa (XML de
 * fornecedor, pedido do agente de WhatsApp).
 */
export const escaparHtml = (valor: unknown): string => String(valor ?? '')
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const SwalBase = Swal.mixin({
  background: '#1c1c1f',
  color: '#ffffff',
  confirmButtonColor: '#8b5cf6',
  cancelButtonColor: '#3f3f46',
});

/**
 * TITULO SEMPRE COMO TEXTO (auditoria de 2026-09-29). O `title` do
 * SweetAlert2 tambem e' HTML, e o sistema inteiro poe nome de cadastro no
 * titulo ("Inativar \"{produto}\"?", "{cliente} tem credito"...). Em vez de
 * corrigir chamada por chamada, o NexusSwal troca `title` por `titleText` (mesma
 * aparencia, mas vai como texto puro). Nenhum titulo do sistema usa marcacao
 * -- se um dia precisar, use `html:` com escaparHtml nos dados.
 */
const fireOriginal = SwalBase.fire.bind(SwalBase) as (opcoes: SweetAlertOptions) => ReturnType<typeof Swal.fire>;
SwalBase.fire = ((...args: unknown[]) => {
  const [opcoes, texto, icone] = args;
  // Forma posicional fire(titulo, html, icone): o 2o argumento tambem e' HTML.
  // Vai como texto puro, pelo mesmo motivo do titulo.
  if (typeof opcoes === 'string') {
    return fireOriginal({
      titleText: opcoes,
      ...(texto !== undefined ? { text: String(texto) } : {}),
      ...(icone ? { icon: icone as SweetAlertOptions['icon'] } : {}),
    });
  }
  if (opcoes && typeof opcoes === 'object' && typeof (opcoes as SweetAlertOptions).title === 'string') {
    const { title, ...resto } = opcoes as SweetAlertOptions;
    return fireOriginal({ ...resto, titleText: resto.titleText ?? (title as string) });
  }
  return (fireOriginal as (...a: unknown[]) => ReturnType<typeof Swal.fire>)(...args);
}) as typeof Swal.fire;

// Mesmo problema na mensagem de validacao (tambem montada como HTML): varias
// citam o nome do produto ("Informe o lote de \"{produto}\""). Nenhuma usa marcacao.
const validacaoOriginal = SwalBase.showValidationMessage;
SwalBase.showValidationMessage = (mensagem: string) => validacaoOriginal(escaparHtml(mensagem));

export const NexusSwal = SwalBase;

// Toast para sucesso rápido (ex: cadastro, edição)
export const showSuccess = (title: string) => {
  return NexusSwal.fire({
    icon: 'success',
    title,
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
  });
};

// Alerta de Erro
export const showError = (title: string, text?: string) => {
  return NexusSwal.fire({
    icon: 'error',
    title,
    text,
    confirmButtonText: 'Entendi',
  });
};

// Aviso nao bloqueante: o sistema completou/ajustou alguma coisa sozinho e o
// usuario precisa ficar sabendo, mas a operacao segue normal. Toast em vez de
// modal de proposito -- quem adiciona 10 itens seguidos nao pode ser obrigado
// a dar 10 cliques em "Entendi". Fica 6s na tela (o dobro do showSuccess)
// porque o texto aqui e' instrucao, nao confirmacao.
export const showWarning = (title: string, text?: string) => {
  return NexusSwal.fire({
    icon: 'warning',
    title,
    text,
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 6000,
    timerProgressBar: true,
  });
};

// Pop-up de Confirmação para exclusão
export const confirmDelete = async (itemName: string) => {
  const result = await NexusSwal.fire({
    title: 'Excluir registro?',
    text: `Você está prestes a excluir ${itemName}. Essa ação não pode ser desfeita.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444', // Vermelho
    cancelButtonColor: '#3f3f46',
    confirmButtonText: 'Sim, excluir!',
    cancelButtonText: 'Cancelar',
    reverseButtons: true
  });

  return result.isConfirmed;
};

// Pop-up de 3 vias ao fechar uma aba com dados nao salvos (Sistema de
// Abas, F19). Mesmo padrao ja usado em PedidoVendaForm (showDenyButton)
// pra oferecer uma terceira opcao alem de confirmar/cancelar.
export const confirmUnsavedChanges = async (): Promise<'save' | 'discard' | 'cancel'> => {
  const result = await NexusSwal.fire({
    title: 'Fechar aba com dados não salvos?',
    text: 'Essa aba tem informações digitadas que ainda não foram salvas.',
    icon: 'warning',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'Salvar e fechar',
    denyButtonText: 'Fechar sem salvar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    denyButtonColor: '#ef4444',
  });

  if (result.isConfirmed) return 'save';
  if (result.isDenied) return 'discard';
  return 'cancel';
};

// Bloqueio de fechamento quando a aba abriu outra(s) aba(s) a partir de
// dentro dela (ver TabsContext.tsx, parentTabId) -- fecha primeiro a(s)
// aba(s) filha(s), so depois a aba de origem pode ser fechada.
export const warnBlockedTabClose = async (childLabels: string[]) => {
  const items = childLabels.map((label) => `• ${escaparHtml(label)}`).join('<br/>');
  return NexusSwal.fire({
    icon: 'warning',
    title: 'Não é possível fechar esta aba',
    html: `Existe(m) tela(s) aberta(s) a partir dela. Feche primeiro:<br/><br/>${items}`,
    confirmButtonText: 'Entendi',
  });
};

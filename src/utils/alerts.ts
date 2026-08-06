import Swal from 'sweetalert2';

export const NexusSwal = Swal.mixin({
  background: '#1c1c1f',
  color: '#ffffff',
  confirmButtonColor: '#8b5cf6',
  cancelButtonColor: '#3f3f46',
});

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
  const items = childLabels.map((label) => `• ${label}`).join('<br/>');
  return NexusSwal.fire({
    icon: 'warning',
    title: 'Não é possível fechar esta aba',
    html: `Existe(m) tela(s) aberta(s) a partir dela. Feche primeiro:<br/><br/>${items}`,
    confirmButtonText: 'Entendi',
  });
};

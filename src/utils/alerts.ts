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

export const isFunctionOrEscapeKey = (key: string): boolean => (
  key === 'Escape' || /^F\d{1,2}$/.test(key)
);

export interface EditableElementLike {
  tagName: string;
  isContentEditable?: boolean;
}

export const isEditableElement = (el: EditableElementLike | null | undefined): boolean => {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
};

export interface ShortcutBindingLike {
  key: string;
  when?: boolean;
}

export const matchShortcut = <T extends ShortcutBindingLike>(
  bindings: T[],
  key: string,
): T | undefined => bindings.find((binding) => binding.key === key && binding.when !== false);

/**
 * Pilha de camadas fechaveis por Esc (modal, dropdown, painel).
 * closeTop() aciona somente a funcao de fechar registrada por ultimo,
 * sem remove-la: a remocao acontece quando o consumidor (useEscapeLayer)
 * detecta isOpen=false e limpa seu proprio efeito.
 */
export function createEscapeStack() {
  let stack: Array<() => void> = [];

  return {
    push(closeFn: () => void): void {
      stack.push(closeFn);
    },
    remove(closeFn: () => void): void {
      stack = stack.filter((fn) => fn !== closeFn);
    },
    closeTop(): boolean {
      const top = stack[stack.length - 1];
      if (!top) return false;
      top();
      return true;
    },
    size(): number {
      return stack.length;
    },
    clear(): void {
      stack = [];
    },
  };
}

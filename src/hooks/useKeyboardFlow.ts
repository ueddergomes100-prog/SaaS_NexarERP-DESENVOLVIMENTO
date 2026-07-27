import { useEffect, useRef, type RefObject } from 'react';
import { createEscapeStack, isEditableElement, isFunctionOrEscapeKey, matchShortcut } from '../utils/keyboardFlow';

export type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutBinding {
  key: string;
  handler: ShortcutHandler;
  when?: boolean;
  preventDefault?: boolean;
}

/**
 * Registra atalhos de teclado em nivel de janela para uma tela (F1-F2 do
 * plano de evolucao). Teclas de letra/numero sao ignoradas quando o foco
 * esta em campo de texto editavel, para nao atrapalhar digitacao normal.
 * F1-F12 e Escape sempre disparam, mesmo com foco em um input.
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target as HTMLElement | null) && !isFunctionOrEscapeKey(event.key)) {
        return;
      }

      const binding = matchShortcut(bindingsRef.current, event.key);
      if (!binding) return;

      if (binding.preventDefault !== false) event.preventDefault();
      binding.handler(event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

const globalEscapeStack = createEscapeStack();

/**
 * Registra uma camada fechavel por Esc (modal, dropdown, painel). Esc
 * fecha somente a camada aberta mais recentemente (topo da pilha), nunca
 * todas de uma vez.
 */
export function useEscapeLayer(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeFn = () => onCloseRef.current();
    globalEscapeStack.push(closeFn);
    return () => globalEscapeStack.remove(closeFn);
  }, [isOpen]);
}

/** Fecha a camada Esc mais recente. Retorna false se a pilha estiver vazia. */
export function closeTopEscapeLayer(): boolean {
  return globalEscapeStack.closeTop();
}

/** Leva o foco para o proximo campo logico apos concluir uma acao. */
export function focusField(ref: RefObject<HTMLElement | null> | null | undefined): void {
  ref?.current?.focus();
}

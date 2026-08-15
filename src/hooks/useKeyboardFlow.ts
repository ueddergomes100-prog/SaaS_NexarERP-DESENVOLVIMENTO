import { useContext, useEffect, useRef, type RefObject } from 'react';
import { createEscapeStack, isEditableElement, isFunctionOrEscapeKey, matchShortcut } from '../utils/keyboardFlow';
import { TabActiveContext } from '../contexts/TabsContext';

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
 *
 * Respeita TabActiveContext (Sistema de Abas, F19 fase B): abas escondidas
 * continuam montadas (preservam estado), entao sem essa checagem os
 * atalhos de uma tela em segundo plano disparariam junto com os da aba
 * visivel. So a aba ativa recebe os eventos de teclado.
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings);
  const isTabActive = useContext(TabActiveContext);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!isTabActive) return undefined;

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
  }, [isTabActive]);
}

const globalEscapeStack = createEscapeStack();

/**
 * Registra uma camada fechavel por Esc (modal, dropdown, painel). Esc
 * fecha somente a camada aberta mais recentemente (topo da pilha), nunca
 * todas de uma vez.
 *
 * Tambem respeita TabActiveContext: uma camada de uma aba escondida se
 * remove da pilha global enquanto a aba nao estiver ativa (senao Esc na
 * aba visivel poderia fechar um modal de outra aba em segundo plano) e
 * volta a entrar na pilha se a aba ficar ativa de novo com o modal ainda
 * aberto.
 */
export function useEscapeLayer(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  const isTabActive = useContext(TabActiveContext);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || !isTabActive) return undefined;

    const closeFn = () => onCloseRef.current();
    globalEscapeStack.push(closeFn);
    return () => globalEscapeStack.remove(closeFn);
  }, [isOpen, isTabActive]);
}

/** Fecha a camada Esc mais recente. Retorna false se a pilha estiver vazia. */
export function closeTopEscapeLayer(): boolean {
  return globalEscapeStack.closeTop();
}

/**
 * Conecta a pilha de Esc (globalEscapeStack/useEscapeLayer) a tecla Esc de
 * verdade. Achado em validacao manual (2026-08-15): useEscapeLayer sempre
 * empilhou as camadas corretamente, mas nenhuma tela registrava um binding
 * de 'Escape' chamando closeTopEscapeLayer() -- a pilha nunca era fechada
 * por Esc em lugar nenhum do sistema (Bandeiras de Cartao, Bancos,
 * Unidades de Medida, ClientAutocomplete, ProductSearchModal, dropdowns
 * internos de OSForm). Chamar uma unica vez, no componente raiz da area
 * autenticada (AppLayout), corrige todas as telas de uma vez -- nao repete
 * o erro de exigir que cada tela lembre de registrar o binding sozinha.
 */
export function useGlobalEscapeKey(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (closeTopEscapeLayer()) event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/** Leva o foco para o proximo campo logico apos concluir uma acao. */
export function focusField(ref: RefObject<HTMLElement | null> | null | undefined): void {
  ref?.current?.focus();
}

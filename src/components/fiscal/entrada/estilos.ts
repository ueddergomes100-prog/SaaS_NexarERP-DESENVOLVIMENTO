import type React from 'react';

/** Estilos compartilhados pelos blocos da entrada de nota. */
export const campoLabelStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' };
export const campoInputStyle: React.CSSProperties = { padding: '8px 10px', fontSize: '13px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', width: '100%' };
export const cartaoStyle: React.CSSProperties = { padding: '24px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' };
export const tituloDoCartaoStyle: React.CSSProperties = { margin: 0, fontSize: '15px', fontWeight: 600 };
export const grupoStyle: React.CSSProperties = { padding: '14px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' };

export const moeda = (valor: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
export const moeda4 = (valor: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(valor);
export const percentual = (valor: number | null): string => (valor === null ? '—' : `${valor.toFixed(1).replace('.', ',')}%`);
export const dataBr = (iso: string): string => (iso ? iso.split('-').reverse().join('/') : '—');

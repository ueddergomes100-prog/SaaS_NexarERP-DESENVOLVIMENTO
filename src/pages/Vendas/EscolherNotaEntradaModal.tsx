import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Search, X } from 'lucide-react';
import { notasDeEntradaParaEscolha, rotuloDaNotaDeEntrada, type NotaEntradaParaEscolha } from '../../utils/pedidoDaNotaEntradaDomain';

/*
 * ESCOLHER A NF-e DE ENTRADA para montar o pedido de venda (07/11/2026).
 * So' de tela: quem le as notas e monta os itens e' o Pedido de Venda.
 */

interface Props<T extends NotaEntradaParaEscolha> {
  notas: T[];
  carregando: boolean;
  erro?: string;
  onEscolher: (nota: T) => void;
  onFechar: () => void;
}

const EscolherNotaEntradaModal = <T extends NotaEntradaParaEscolha>({ notas, carregando, erro, onEscolher, onFechar }: Props<T>) => {
  const [termo, setTermo] = useState('');
  const lista = useMemo(() => notasDeEntradaParaEscolha(notas, termo), [notas, termo]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Montar o pedido a partir de uma NF-e de entrada" onClick={onFechar} style={{ position: 'fixed', inset: 0, zIndex: 1500, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 40px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '18px 22px', borderBottom: '1px solid var(--border-color)' }}>
          <FileText size={20} color="var(--accent-purple)" />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Montar o pedido a partir de uma NF-e de entrada</h2>
            <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--text-muted)' }}>Os produtos e as quantidades vêm da nota; o preço é o de venda do cadastro. Depois ajuste o que precisar.</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}><X size={22} /></button>
        </div>
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '34px', top: '24px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar…"
            title="Número da nota ou nome do fornecedor"
            autoFocus
            style={{ width: '100%', padding: '10px 12px 10px 38px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 12px 14px' }}>
          {carregando ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '20px 10px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spin-icon" /> Buscando as notas de entrada...</div>
          ) : erro ? (
            <div style={{ padding: '20px 10px', color: 'var(--status-red)' }}>{erro}</div>
          ) : lista.length === 0 ? (
            <div style={{ padding: '20px 10px', color: 'var(--text-muted)' }}>{termo ? `Nenhuma nota de entrada encontrada para "${termo}".` : 'Nenhuma NF-e de entrada lançada nos últimos 90 dias. Lance a nota em Fiscal › Entrada de XML.'}</div>
          ) : (
            lista.map((nota) => {
              const rotulo = rotuloDaNotaDeEntrada(nota);
              return (
                <button
                  key={nota.id}
                  type="button"
                  onClick={() => onEscolher(nota)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', margin: '4px 0', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>{rotulo.titulo}</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>{rotulo.detalhe}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default EscolherNotaEntradaModal;

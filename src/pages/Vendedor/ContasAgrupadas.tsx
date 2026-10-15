import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { differenceInCalendarDays, formatDateInputPtBr } from '../../utils/dateTime';
import { agruparContasPorNome, type ContaParaAgrupar } from '../../utils/contasAgrupadasDomain';

/**
 * Lista do Contas a Receber / a Pagar do app Vendas agrupada por cliente ou
 * fornecedor (pedido do dono, 15/10/2026): uma linha por nome, com quantas
 * notas e o total; ao tocar, as notas abrem uma embaixo da outra. So' para
 * ver -- a baixa continua no sistema do computador.
 */

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// flexShrink 0: a tela e' uma coluna flex com rolagem; com overflow hidden o cartao encolheria ate sumir.
const cartao: React.CSSProperties = {
  borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', flexShrink: 0,
};

interface ContasAgrupadasProps {
  contas: ContaParaAgrupar[];
  hoje: string;
  carregando: boolean;
  /** "Total a receber" / "Total pendente". */
  rotuloTotal: string;
  /** "cliente" / "fornecedor" (singular). */
  rotuloNome: string;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const ContasAgrupadas: React.FC<ContasAgrupadasProps> = ({ contas, hoje, carregando, rotuloTotal, rotuloNome }) => {
  const grupos = useMemo(() => agruparContasPorNome(contas, hoje), [contas, hoje]);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const total = grupos.reduce((soma, g) => soma + Math.round(g.total * 100), 0) / 100;

  const alternar = (chave: string) => setAbertos((atual) => {
    const novo = new Set(atual);
    if (novo.has(chave)) novo.delete(chave);
    else novo.add(chave);
    return novo;
  });

  if (carregando) {
    return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>;
  }
  if (grupos.length === 0) {
    return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Nenhuma conta pendente.</div>;
  }

  return (
    <>
      <div style={{ ...cartao, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 600 }}>{rotuloTotal}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {plural(grupos.length, rotuloNome, `${rotuloNome}s`)} · {plural(contas.length, 'nota', 'notas')}
          </div>
        </div>
        <span style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatarMoeda(total)}</span>
      </div>

      {grupos.map((grupo) => {
        const aberto = abertos.has(grupo.chave);
        const atrasoMaior = grupo.vencimentoMaisAntigo ? differenceInCalendarDays(grupo.vencimentoMaisAntigo, hoje) ?? 0 : 0;
        return (
          <div key={grupo.chave} style={{ ...cartao, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => alternar(grupo.chave)}
              aria-expanded={aberto}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                  {grupo.nome}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {plural(grupo.quantidade, 'nota', 'notas')}
                  {grupo.vencidas > 0 && (
                    <span style={{ color: '#ef4444', fontWeight: 700 }}>
                      {' · '}{plural(grupo.vencidas, 'vencida', 'vencidas')}{atrasoMaior > 0 ? ` (até ${atrasoMaior}d)` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatarMoeda(grupo.total)}</div>
              <ChevronDown size={18} style={{ color: 'var(--text-muted)', flex: 'none', transition: 'transform 0.18s ease', transform: aberto ? 'rotate(180deg)' : 'none' }} />
            </button>

            {aberto && (
              <div style={{ borderTop: '1px solid var(--border-color)', padding: '4px 14px 6px' }}>
                {grupo.contas.map((conta, i) => {
                  const diasAtraso = conta.vencimento ? differenceInCalendarDays(conta.vencimento, hoje) ?? 0 : 0;
                  const vencida = diasAtraso > 0;
                  return (
                    <div key={conta.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--border-color)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                          {conta.descricao || 'Sem descrição'}
                        </div>
                        <div style={{ fontSize: '12px', color: vencida ? '#ef4444' : 'var(--text-muted)', marginTop: '2px', fontWeight: vencida ? 700 : 500 }}>
                          {conta.vencimento ? `Vence ${formatDateInputPtBr(conta.vencimento)}` : 'Sem vencimento'}{vencida ? ` · ${diasAtraso}d atrasada` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{formatarMoeda(conta.valor)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

export default ContasAgrupadas;

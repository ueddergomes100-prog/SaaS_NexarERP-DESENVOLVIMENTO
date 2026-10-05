import React, { useMemo, useState } from 'react';
import { AlertTriangle, Eye, Plus, Search, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { hasTenantFullAccess } from '../../utils/roles';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  MENSAGEM_CONDICIONAL_DESLIGADO,
  PERMISSAO_CONDICIONAL,
  ROTULO_STATUS_CONDICIONAL,
  estaVencido,
  resumirCondicional,
  type StatusCondicional,
} from '../../utils/condicionalDomain';
import { ESTILO_STATUS, dataBr, moeda, type CondicionalDoc } from './condicionalTipos';

/**
 * Lista dos CONDICIONAIS (2026-10-05). Mercadoria com o cliente para provar:
 * a loja acompanha o prazo, registra o que voltou e fecha -- o que ficou vira
 * pré-venda. Quem grava é o servidor; aqui só se lê.
 */

type Aba = StatusCondicional | 'todos' | 'vencidos';

const ABAS: Array<{ valor: Aba; rotulo: string }> = [
  { valor: 'aberto', rotulo: 'Com o cliente' },
  { valor: 'vencidos', rotulo: 'Vencidos' },
  { valor: 'finalizado', rotulo: 'Viraram pré-venda' },
  { valor: 'devolvido', rotulo: 'Tudo devolvido' },
  { valor: 'cancelado', rotulo: 'Cancelados' },
  { valor: 'todos', rotulo: 'Todos' },
];

const millis = (c: CondicionalDoc) => (typeof c.createdAt?.toMillis === 'function' ? c.createdAt.toMillis() : (c.createdAt?.seconds || 0) * 1000);

export const MensagemCondicionalDesligado: React.FC = () => (
  <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
    {MENSAGEM_CONDICIONAL_DESLIGADO}
  </div>
);

export const MensagemSemPermissaoCondicional: React.FC = () => (
  <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
    Seu usuário não tem permissão para usar o condicional. Peça a um responsável liberar &quot;Vendas: Condicional&quot; no seu cadastro.
  </div>
);

export const usePodeUsarCondicional = () => {
  const { userRole, isOwner, userPermissions } = useAuth();
  return hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_CONDICIONAL);
};

const CondicionaisList: React.FC = () => {
  const { tenantId, trabalhaComCondicional } = useAuth();
  const podeUsar = usePodeUsarCondicional();
  const { openTab } = useTabs();
  const { linha } = useLinhaSelecionavel();
  const { items, loading } = useTenantCollection<CondicionalDoc>('condicionais', tenantId, { enabled: trabalhaComCondicional && podeUsar });
  const [aba, setAba] = useState<Aba>('aberto');
  const [busca, setBusca] = useState('');
  const hoje = getDateInputInTimeZone();

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: items.length, vencidos: items.filter((x) => estaVencido(x, hoje)).length };
    (['aberto', 'finalizado', 'devolvido', 'cancelado'] as const).forEach((s) => { c[s] = items.filter((x) => x.status === s).length; });
    return c;
  }, [items, hoje]);

  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(() => items
    .filter((c) => (aba === 'todos' ? true : aba === 'vencidos' ? estaVencido(c, hoje) : c.status === aba))
    .filter((c) => !termo
      || String(c.numeroCondicional || '').includes(termo)
      || String(c.clienteNome || '').toLowerCase().includes(termo))
    .sort((a, b) => (aba === 'aberto' || aba === 'vencidos'
      ? String(a.prazoDevolucao).localeCompare(String(b.prazoDevolucao))
      : millis(b) - millis(a))), [items, aba, termo, hoje]);

  if (!trabalhaComCondicional) return <MensagemCondicionalDesligado />;
  if (!podeUsar) return <MensagemSemPermissaoCondicional />;

  const abrir = (c: CondicionalDoc) => openTab(`/vendas/condicional/${c.id}`, `Condicional #${c.numeroCondicional}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingBag size={28} color="var(--accent-purple)" /> Condicional
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Peças que o cliente levou para provar. Registre o que voltou e feche: o que ficou vira pré-venda para finalizar com o pagamento.
          </p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/vendas/condicional/novo', 'Novo condicional')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Novo condicional
        </button>
      </div>

      {contagem.vencidos > 0 && (
        <button
          type="button"
          onClick={() => setAba('vencidos')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.4)', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', cursor: 'pointer', textAlign: 'left' }}
        >
          <AlertTriangle size={18} />
          <span><strong>{contagem.vencidos}</strong> condicional(is) passaram do prazo de devolução. Clique para ver.</span>
        </button>
      )}

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número ou cliente..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {ABAS.map(({ valor, rotulo }) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                style={{
                  padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${aba === valor ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                  backgroundColor: aba === valor ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                  color: aba === valor ? '#fff' : 'var(--text-primary)',
                }}
              >
                {rotulo} ({contagem[valor] || 0})
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Nº</th>
                <th style={{ padding: '14px' }}>Saída</th>
                <th style={{ padding: '14px' }}>Devolver até</th>
                <th style={{ padding: '14px' }}>Cliente</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Peças com o cliente</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Valor com o cliente</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum condicional nesta lista.</td></tr>
              ) : filtrados.map((c) => {
                const resumo = resumirCondicional(c.itens || []);
                const vencido = estaVencido(c, hoje);
                const estilo = ESTILO_STATUS[c.status] || ESTILO_STATUS.cancelado;
                return (
                  <tr key={c.id} {...linha(c.id, () => abrir(c))} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px', fontWeight: 700 }}>#{c.numeroCondicional}</td>
                    <td style={{ padding: '14px' }}>{dataBr(c.dataSaida)}</td>
                    <td style={{ padding: '14px', color: vencido ? '#ef4444' : undefined, fontWeight: vencido ? 700 : undefined }}>
                      {dataBr(c.prazoDevolucao)}{vencido ? ' (vencido)' : ''}
                    </td>
                    <td style={{ padding: '14px' }}>{c.clienteNome}</td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>{resumo.pecasComCliente.toLocaleString('pt-BR')}</td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>{moeda(resumo.valorComCliente)}</td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, color: estilo.cor, backgroundColor: estilo.fundo }}>
                        {ROTULO_STATUS_CONDICIONAL[c.status] || c.status}
                      </span>
                      {c.status === 'finalizado' && c.numeroPedido && (
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>pré-venda #{c.numeroPedido}</span>
                      )}
                    </td>
                    <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                      <button type="button" className="icon-btn" title="Abrir o condicional" onClick={() => abrir(c)} style={{ color: '#3b82f6' }}><Eye size={18} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CondicionaisList;

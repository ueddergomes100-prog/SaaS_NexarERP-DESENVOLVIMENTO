import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { devolucaoAppService, type DevolucaoDoVendedor } from '../../services/devolucaoAppService';
import { ROTULO_DESTINO_DEVOLUCAO, ROTULO_SITUACAO_DEVOLUCAO, type StatusDevolucao } from '../../utils/devolucaoVendaDomain';
import VendedorHeader from './VendedorHeader';
import { useVoltarPara } from './navegacaoApp';

/**
 * "Minhas Devolucoes" (24/11/2026): as devolucoes que ESTE vendedor pediu pelo
 * app e a situacao de cada uma (aguardando, confirmada, recusada -- com o
 * motivo --, estornada). Lidas pelo servidor: o app nao le a colecao direto.
 */

const ESTILO: Record<StatusDevolucao, { cor: string; fundo: string; explicacao: string }> = {
  aguardando_confirmacao: { cor: '#d97706', fundo: 'rgba(245,158,11,0.18)', explicacao: 'A loja ainda vai conferir. Nada mudou no estoque nem no dinheiro.' },
  concluida: { cor: '#10b981', fundo: 'rgba(16,185,129,0.18)', explicacao: 'Confirmada: a mercadoria voltou ao estoque e o valor foi para o destino escolhido.' },
  recusada: { cor: '#ef4444', fundo: 'rgba(239,68,68,0.18)', explicacao: 'A loja recusou. Nada mudou no estoque nem no dinheiro.' },
  estornada: { cor: 'var(--text-muted)', fundo: 'rgba(148,163,184,0.18)', explicacao: 'Foi confirmada e depois desfeita pela loja.' },
};

const formatarData = (millis: number | null) => (millis ? new Date(millis).toLocaleDateString('pt-BR') : '');
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorDevolucoes: React.FC = () => {
  const voltarPara = useVoltarPara();
  const [lista, setLista] = useState<DevolucaoDoVendedor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro('');
    devolucaoAppService.minhas()
      .then((r) => setLista(r.devolucoes))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar as devoluções.'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo="Minhas Devoluções"
        aoVoltar={() => voltarPara('/vendedor')}
        acao={(
          <button
            type="button"
            aria-label="Atualizar"
            onClick={carregar}
            disabled={carregando}
            style={{ width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            <RefreshCw size={18} />
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>{erro}</div>
        ) : lista.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
            Você ainda não fez nenhuma devolução.<br />Para devolver, abra o pedido em "Meus Pedidos" e toque em "Devolver itens".
          </div>
        ) : lista.map((d) => {
          const estilo = ESTILO[d.status] || ESTILO.aguardando_confirmacao;
          const expandida = aberta === d.id;
          return (
            <div key={d.id} style={{ borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setAberta(expandida ? null : d.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Pedido #{d.numeroPedido} · {d.clienteNome}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px' }}>
                    {moeda(d.valorTotal)} · {ROTULO_DESTINO_DEVOLUCAO[d.destino]} · {formatarData(d.criadaEmMillis)}
                  </div>
                  <span style={{ display: 'inline-block', marginTop: '7px', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, backgroundColor: estilo.fundo, color: estilo.cor }}>
                    {ROTULO_SITUACAO_DEVOLUCAO[d.status]}
                  </span>
                </div>
                {expandida ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
              </button>

              {expandida && (
                <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '13.5px', color: estilo.cor, fontWeight: 600, marginTop: '10px' }}>{estilo.explicacao}</div>
                  {d.status === 'recusada' && d.motivoRecusa && (
                    <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.45)', fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      <strong>Motivo da recusa:</strong> {d.motivoRecusa}
                    </div>
                  )}
                  {d.itens.map((item, i) => (
                    <div key={`${d.id}-${i}`} style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{item.quantidade.toLocaleString('pt-BR')} {item.unidadeMedidaSigla}</strong> {item.nome}
                    </div>
                  ))}
                  <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Motivo:</strong> {d.motivo}
                    {d.destino === 'banco' && d.bancoNome ? ` · Banco ${d.bancoNome}` : ''}
                  </div>
                  {d.observacao && (
                    <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}><strong style={{ color: 'var(--text-primary)' }}>Obs.:</strong> {d.observacao}</div>
                  )}
                  {d.decididaEmMillis && d.status !== 'aguardando_confirmacao' && (
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Decidida em {formatarData(d.decididaEmMillis)}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VendedorDevolucoes;

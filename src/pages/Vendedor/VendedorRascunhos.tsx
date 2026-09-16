import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Send, Trash2, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError } from '../../utils/alerts';
import { criarOrcamentoExterno, criarPreVendaExterna } from '../../services/vendedorExternoVendaService';
import VendedorHeader from './VendedorHeader';
import {
  listarRascunhos,
  marcarErroRascunho,
  removerRascunho,
  type RascunhoVenda,
} from './vendedorRascunhosStore';

interface ResultadoEnvio {
  localId: string;
  descricao: string;
  ok: boolean;
  mensagem: string;
}

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const totalDoRascunho = (rascunho: RascunhoVenda) => rascunho.itens.reduce((soma, item) => soma + item.subtotal, 0);

const rotuloTipo = (rascunho: RascunhoVenda) => (rascunho.tipo === 'pedido' ? 'Pedido' : 'Orçamento');

/**
 * Rascunhos guardados no aparelho + "Enviar dados".
 *
 * O envio vai um de cada vez, nunca em paralelo, e so' apaga o rascunho
 * depois de a base confirmar a gravacao. Falha fica na lista com o motivo,
 * pra tentar de novo -- nada some sozinho. Reenviar um rascunho que chegou a
 * gravar antes de a conexao cair nao duplica: o id do rascunho e' o id do
 * documento (ver `idDocumento` em vendedorExternoVendaService.ts).
 */
const VendedorRascunhos: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser, userNome, trabalhaComPreVenda } = useAuth();
  const [rascunhos, setRascunhos] = useState<RascunhoVenda[]>(() => (
    tenantId && currentUser ? listarRascunhos(tenantId, currentUser.uid) : []
  ));
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoEnvio[]>([]);

  const recarregar = () => {
    if (tenantId && currentUser) setRascunhos(listarRascunhos(tenantId, currentUser.uid));
  };

  const handleExcluir = async (rascunho: RascunhoVenda) => {
    if (!tenantId || !currentUser) return;
    const confirmacao = await NexusSwal.fire({
      title: 'Excluir este rascunho?',
      text: `${rotuloTipo(rascunho)} de ${rascunho.cliente.nome} ainda não foi enviado. Excluindo, ele some do aparelho.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Excluir',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      reverseButtons: true,
    });
    if (!confirmacao.isConfirmed) return;
    try {
      removerRascunho(tenantId, currentUser.uid, rascunho.localId);
      recarregar();
    } catch (error) {
      showError('Não foi possível excluir', error instanceof Error ? error.message : 'Tente novamente.');
    }
  };

  const enviarUm = async (rascunho: RascunhoVenda): Promise<string> => {
    if (!tenantId || !currentUser) throw new Error('Sessão expirada. Entre novamente.');
    if (rascunho.tipo === 'pedido') {
      if (!trabalhaComPreVenda) {
        throw new Error('A opção "Pré-venda" está desligada nas Configurações da empresa. Peça pro administrador habilitar.');
      }
      const { numeroPedido } = await criarPreVendaExterna({
        tenantId,
        usuarioId: currentUser.uid,
        vendedorId: currentUser.uid,
        vendedorNome: userNome || currentUser.displayName || 'Vendedor',
        clienteId: rascunho.cliente.id,
        clienteNome: rascunho.cliente.nome,
        itens: rascunho.itens,
        permitirVendaSemEstoque: false,
        idDocumento: rascunho.localId,
      });
      return `Pré-venda #${numeroPedido} enviada`;
    }
    const { numeroOrcamento } = await criarOrcamentoExterno({
      tenantId,
      usuarioId: currentUser.uid,
      clienteId: rascunho.cliente.id,
      clienteNome: rascunho.cliente.nome,
      clienteTelefone: rascunho.cliente.telefone || '',
      itens: rascunho.itens,
      idDocumento: rascunho.localId,
    });
    return `Orçamento #${numeroOrcamento} enviado`;
  };

  const handleEnviar = async () => {
    if (!tenantId || !currentUser || enviando) return;
    const pendentes = listarRascunhos(tenantId, currentUser.uid);
    if (pendentes.length === 0) return;

    setEnviando(true);
    setResultados([]);
    const log: ResultadoEnvio[] = [];

    for (const rascunho of pendentes) {
      const descricao = `${rotuloTipo(rascunho)} — ${rascunho.cliente.nome}`;
      try {
        const mensagem = await enviarUm(rascunho);
        // So' agora, com a base confirmando, o rascunho sai do aparelho.
        removerRascunho(tenantId, currentUser.uid, rascunho.localId);
        log.push({ localId: rascunho.localId, descricao, ok: true, mensagem });
      } catch (error) {
        const mensagem = error instanceof Error && error.message
          ? error.message
          : 'Não foi possível enviar. Verifique a internet e tente de novo.';
        try {
          marcarErroRascunho(tenantId, currentUser.uid, rascunho.localId, mensagem);
        } catch {
          // O rascunho continua salvo do jeito que estava; so' o motivo nao gravou.
        }
        log.push({ localId: rascunho.localId, descricao, ok: false, mensagem });
      }
      setResultados([...log]);
    }

    recarregar();
    setEnviando(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Rascunhos" aoVoltar={() => navigate('/vendedor')} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {rascunhos.length > 0 && (
          <button
            type="button"
            onClick={() => void handleEnviar()}
            disabled={enviando}
            style={{
              height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff',
              cursor: enviando ? 'default' : 'pointer', opacity: enviando ? 0.7 : 1,
              background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
            }}
          >
            <Send size={18} />
            {enviando ? 'Enviando...' : `Enviar dados (${rascunhos.length})`}
          </button>
        )}

        {resultados.length > 0 && (
          <div style={{ padding: '12px 14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Resultado do envio
            </div>
            {resultados.map((r) => (
              <div key={r.localId} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                {r.ok
                  ? <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '1px' }} />
                  : <XCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />}
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{r.descricao}</strong><br />
                  {r.mensagem}
                </div>
              </div>
            ))}
          </div>
        )}

        {rascunhos.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Nenhum rascunho pendente. Tudo o que você montou já foi enviado.
          </div>
        ) : (
          rascunhos.map((rascunho) => (
            <div
              key={rascunho.localId}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: `1px solid ${rascunho.ultimoErro ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'}` }}
            >
              <button
                type="button"
                disabled={enviando}
                onClick={() => navigate(`/vendedor/${rascunho.tipo === 'pedido' ? 'pedido' : 'orcamento'}/rascunho/${rascunho.localId}`)}
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rascunho.cliente.nome}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {rotuloTipo(rascunho)} · {rascunho.itens.length} {rascunho.itens.length === 1 ? 'item' : 'itens'} · {formatarMoeda(totalDoRascunho(rascunho))}
                </div>
                {rascunho.ultimoErro && (
                  <div style={{ fontSize: '11.5px', color: '#f87171', marginTop: '4px', lineHeight: 1.35 }}>
                    Não enviado: {rascunho.ultimoErro}
                  </div>
                )}
              </button>
              <button
                type="button"
                aria-label="Excluir rascunho"
                disabled={enviando}
                onClick={() => void handleExcluir(rascunho)}
                style={{
                  width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)',
                  color: '#f87171', cursor: 'pointer',
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default VendedorRascunhos;

import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { showError, showSuccess } from '../../utils/alerts';
import type { SearchableClient } from '../../utils/clientSearch';
import VendedorHeader from './VendedorHeader';
import VendedorSeletorCliente from './VendedorSeletorCliente';
import type { ClienteConfirmavel } from './VendedorConfirmarClienteModal';
import {
  OBSERVACAO_PEDIDO_MAX,
  clienteComCodigo,
  erroDaEscolhaNotaFiscal,
  normalizarObservacaoPedido,
  type EscolhaNotaFiscal,
} from '../../utils/pedidoVendedorDomain';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import { podeCadastrarClienteNoApp } from './vendedorPermissoes';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';

interface ClienteVendedor extends SearchableClient, ClienteConfirmavel {
  id: string;
  nome: string;
  telefone?: string;
}

/**
 * Monta o pedido e guarda como RASCUNHO no aparelho -- nao envia pra base.
 * Quem envia de verdade e' "Enviar dados" (VendedorRascunhos.tsx). Com
 * `:localId` na rota, reabre um rascunho ja salvo pra editar.
 */
const VendedorNovoPedido: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { localId } = useParams();
  const estadoNavegacao = (location.state as VendedorNovoPedidoNavState | null) || null;
  const { tenantId, currentUser, trabalhaComPreVenda, permiteVendaSemEstoque, userPermissions, controlaFiscal } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  // VendedorShell so' renderiza depois do login carregado, entao tenantId e
  // currentUser ja existem aqui -- da pra ler o rascunho direto no estado
  // inicial.
  const [rascunhoAberto] = useState(() => (
    localId && tenantId && currentUser ? buscarRascunho(tenantId, currentUser.uid, localId) : null
  ));

  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(() => {
    if (rascunhoAberto) return { ...rascunhoAberto.cliente };
    return estadoNavegacao?.clientePreSelecionado
      ? { id: estadoNavegacao.clientePreSelecionado.id, nome: estadoNavegacao.clientePreSelecionado.nome }
      : null;
  });
  const [itens, setItens] = useState<ItemVendaExterna[]>(() => {
    if (rascunhoAberto) return rascunhoAberto.itens;
    return estadoNavegacao?.itemPreAdicionado ? [estadoNavegacao.itemPreAdicionado] : [];
  });

  const [observacao, setObservacao] = useState(() => rascunhoAberto?.observacao || '');
  // O rascunho e' fonte de verdade ao reabrir; empresa sem nota fiscal nem pergunta.
  const [notaFiscal, setNotaFiscal] = useState<EscolhaNotaFiscal | null>(() => rascunhoAberto?.notaFiscal || null);

  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  if (localId && !rascunhoAberto) {
    // Rascunho ja enviado (ou apagado) -- nao ha mais o que editar aqui.
    return <Navigate to="/vendedor/rascunhos" replace />;
  }

  const handleSalvar = () => {
    if (!trabalhaComPreVenda) {
      showError(
        'Pré-venda não está habilitada',
        'O pedido do vendedor externo precisa da opção "Pré-venda" ligada em Configurações → Configurações Avançadas. Peça pro administrador habilitar antes de montar pedidos pelo aplicativo.',
      );
      return;
    }
    if (!clienteSelecionado) {
      showError('Atenção', 'Selecione o cliente.');
      return;
    }
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item.');
      return;
    }
    // Nao se assume "sem nota": pedido sem resposta e' cliente que queria nota e ficou sem.
    const erroNota = erroDaEscolhaNotaFiscal(notaFiscal, Boolean(controlaFiscal));
    if (erroNota) {
      showError('Nota fiscal', erroNota);
      return;
    }
    if (!tenantId || !currentUser) return;

    const agora = new Date().toISOString();
    try {
      salvarRascunho(tenantId, currentUser.uid, {
        localId: rascunhoAberto?.localId || novoLocalId(),
        tipo: 'pedido',
        cliente: {
          id: clienteSelecionado.id,
          nome: clienteSelecionado.nome,
          ...(clienteSelecionado.telefone ? { telefone: clienteSelecionado.telefone } : {}),
        },
        itens,
        ...(normalizarObservacaoPedido(observacao) ? { observacao: normalizarObservacaoPedido(observacao) } : {}),
        ...(controlaFiscal && notaFiscal ? { notaFiscal } : {}),
        criadoEm: rascunhoAberto?.criadoEm || agora,
        atualizadoEm: agora,
      });
      showSuccess('Rascunho salvo! Toque em "Enviar dados" quando o pedido estiver fechado.');
      navigate('/vendedor/rascunhos', { replace: true });
    } catch (error) {
      showError('Não foi possível salvar', error instanceof RascunhoStorageError ? error.message : 'Tente novamente.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={localId ? 'Editar Rascunho' : 'Novo Pedido'} />

      <div style={{ padding: '16px 20px 0' }}>
        {clienteSelecionado ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px',
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{clienteComCodigo(clienteSelecionado)}</div>
            </div>
            <button
              type="button"
              onClick={() => setClienteSelecionado(null)}
              style={{ fontSize: '13.5px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <VendedorSeletorCliente clientes={clientes} onConfirmar={setClienteSelecionado} />
        )}
        {!clienteSelecionado && podeCadastrarClienteNoApp(userPermissions) && (
          <button
            type="button"
            onClick={() => navigate('/vendedor/cliente/novo', { state: { retornarPara: 'pedido' } })}
            style={{ marginTop: '10px', fontSize: '14px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          >
            + Cadastrar novo cliente
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <VendedorItemPicker produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque={permiteVendaSemEstoque} />

        <div style={{ marginTop: '22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="pedido-observacao" style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Observação
            </label>
            <textarea
              id="pedido-observacao"
              value={observacao}
              onChange={(evento) => setObservacao(evento.target.value)}
              maxLength={OBSERVACAO_PEDIDO_MAX}
              rows={3}
              placeholder="Ex.: entregar de manhã, ligar antes de chegar"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '16px',
                backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'none',
              }}
            />
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textAlign: 'right' }}>{observacao.length}/{OBSERVACAO_PEDIDO_MAX}</div>
          </div>

          {controlaFiscal && (
            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <legend style={{ padding: 0, marginBottom: '8px', fontSize: '13.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Nota fiscal
              </legend>
              <div style={{ display: 'flex', gap: '10px' }}>
                {([['com', 'Com nota fiscal'], ['sem', 'Sem nota fiscal']] as const).map(([valor, rotulo]) => {
                  const marcado = notaFiscal === valor;
                  return (
                    <label
                      key={valor}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 12px', borderRadius: '14px', cursor: 'pointer',
                        border: `1.5px solid ${marcado ? 'var(--brand-500)' : 'var(--border-color)'}`,
                        backgroundColor: marcado ? 'rgba(153,100,240,0.14)' : 'var(--bg-elevated)',
                        fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => setNotaFiscal(marcado ? null : valor)}
                        style={{ width: '20px', height: '20px', accentColor: 'var(--brand-500)', flexShrink: 0 }}
                      />
                      {rotulo}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </div>

      <div style={{ padding: '16px 20px calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button
          type="button"
          onClick={handleSalvar}
          style={{
            width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '16px', fontWeight: 700, color: '#fff', cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
          }}
        >
          <Save size={18} />
          Salvar rascunho
        </button>
      </div>
    </div>
  );
};

export default VendedorNovoPedido;

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Repeat, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { hasTenantFullAccess } from '../../utils/roles';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { resolveUnidadeMedidaProduto } from '../../utils/unidadeMedidaDomain';
import { normalizarObservacaoPedido, OBSERVACAO_PEDIDO_MAX } from '../../utils/pedidoVendedorDomain';
import {
  DESCRICAO_MOTIVO_MAX,
  MOTIVOS_TROCA,
  PERMISSAO_TROCA_GERENCIAR,
  PERMISSAO_TROCA_SOLICITAR,
  errosDoRascunhoDeTroca,
  rotuloDoMotivoTroca,
  type ItemTrocaRascunho,
} from '../../utils/trocaDomain';
import { trocaService, TrocaError } from '../../services/trocaService';
import type { ProdutoVendedorExterno } from '../Vendedor/VendedorItemPicker';

/**
 * TROCA LANCADA PELO DESKTOP (2026-09-23, pedido do dono).
 *
 * Ate aqui a troca so' nascia no app do vendedor. Agora a loja tambem lanca
 * direto na retaguarda -- por exemplo quando o vendedor mandou como pre-venda
 * algo que era troca. Usa EXATAMENTE o mesmo caminho do app (trocaService ->
 * servidor): a troca nasce "Solicitada" e segue o fluxo normal (aprovar,
 * separar, entregar). Nada de estoque e' mexido aqui.
 */

interface ClienteTroca { id: string; nome: string; codigo?: string; telefone?: string; documento?: string }

const campo: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
  padding: '10px 12px', color: 'var(--text-primary)', width: '100%',
};

const TrocaForm: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, userPermissions, userRole, isOwner } = useAuth();
  const { items: clientes } = useTenantCollection<ClienteTroca & { ativo?: boolean }>('clientes', tenantId);
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean; statusAtivo?: boolean }>('estoque', tenantId);
  const produtosAtivos = produtos.filter((p) => p.ativo !== false && p.statusAtivo !== false);
  const clientesAtivos = clientes.filter((c) => c.ativo !== false);

  const podeLancar = hasTenantFullAccess(userRole, isOwner)
    || userPermissions.includes(PERMISSAO_TROCA_SOLICITAR)
    || userPermissions.includes(PERMISSAO_TROCA_GERENCIAR);

  const [clienteBusca, setClienteBusca] = useState('');
  const [cliente, setCliente] = useState<ClienteTroca | null>(null);
  const [itens, setItens] = useState<ItemTrocaRascunho[]>([]);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);

  // linha de "adicionar item"
  const [produtoBusca, setProdutoBusca] = useState('');
  const [produto, setProduto] = useState<ProdutoVendedorExterno | null>(null);
  const [quantidade, setQuantidade] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [motivoDescricao, setMotivoDescricao] = useState('');

  const adicionarItem = () => {
    if (!produto) { showError('Atenção', 'Busque e selecione o produto da troca na lista.'); return; }
    const qtd = Number(quantidade.replace(',', '.')) || 0;
    if (qtd <= 0) { showError('Atenção', 'A quantidade deve ser maior que zero.'); return; }
    const unidade = resolveUnidadeMedidaProduto(produto);
    if (!isValidSaleQuantity(qtd, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
      showError('Quantidade inválida', unidade.unidadeMedidaFracionado
        ? `A quantidade de ${produto.nome} aceita no máximo ${unidade.unidadeMedidaCasasDecimais} casa(s) decimal(is).`
        : `${produto.nome} é contado em ${unidade.unidadeMedidaSigla}, que não permite quantidade fracionada. Use um número inteiro.`);
      return;
    }
    if (!motivo) { showError('Atenção', 'Escolha o motivo da troca.'); return; }
    if (motivo === 'outro' && motivoDescricao.trim().length < 3) { showError('Atenção', 'Descreva o motivo (você escolheu "Outro").'); return; }

    setItens((atuais) => [...atuais, {
      id: produto.id,
      nome: produto.nome,
      ...(produto.codigo ? { codigo: produto.codigo } : {}),
      quantidade: qtd,
      unidadeMedidaSigla: unidade.unidadeMedidaSigla,
      motivo,
      ...(motivo === 'outro' ? { motivoDescricao: motivoDescricao.trim() } : {}),
    }]);
    setProduto(null);
    setProdutoBusca('');
    setQuantidade('1');
    setMotivo('');
    setMotivoDescricao('');
  };

  const registrar = async () => {
    if (salvando) return;
    const erros = errosDoRascunhoDeTroca({ clienteId: cliente?.id, itens });
    if (erros.length > 0 || !cliente) { showError('Confira a troca', erros.join('\n')); return; }

    const pedido = {
      clienteId: cliente.id,
      itens: itens.map((i) => ({ id: i.id, quantidade: i.quantidade, motivo: i.motivo, ...(i.motivoDescricao ? { motivoDescricao: i.motivoDescricao } : {}) })),
      ...(normalizarObservacaoPedido(observacao) ? { observacao: normalizarObservacaoPedido(observacao) } : {}),
    };

    setSalvando(true);
    try {
      // Mesma conferencia do app: avisa (sem bloquear) quando o cliente nao
      // comprou o produto nos ultimos 60 dias.
      const previa = await trocaService.previa(pedido);
      if (!previa.ok) { showError('Confira a troca', previa.erros.join('\n')); return; }
      if (previa.avisos.length > 0) {
        const escolha = await NexusSwal.fire({
          icon: 'warning',
          title: 'Confira antes de registrar',
          html: `<div style="text-align:left;font-size:14px">${previa.avisos.map((a) => a.mensagem.replace(/[<>&]/g, '')).join('<br/><br/>')}</div>`,
          showCancelButton: true,
          confirmButtonText: 'Registrar mesmo assim',
          cancelButtonText: 'Voltar e revisar',
        });
        if (!escolha.isConfirmed) return;
      }

      const resposta = await trocaService.solicitar(pedido);
      showSuccess(`Troca #${resposta.numeroTroca} registrada — aguardando aprovação.`);
      navigate('/vendas/trocas');
    } catch (erro) {
      showError('Não foi possível registrar a troca', erro instanceof TrocaError ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  if (!podeLancar) {
    return (
      <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
        Seu usuário não tem permissão para lançar troca. Peça ao administrador para liberar &quot;Trocas&quot; no seu cadastro.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn back-btn" onClick={() => navigate('/vendas/trocas')} title="Voltar"><ArrowLeft size={20} /></button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Repeat size={26} color="var(--accent-purple)" /> Nova Troca
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Reposição sem cobrança de produto estragado. Nasce &quot;Solicitada&quot; e segue o fluxo: aprovar, separar e entregar.</p>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="input-group">
          <label>Cliente *</label>
          <ClientAutocomplete
            value={clienteBusca}
            onChange={(valor) => { setClienteBusca(valor); if (cliente && valor !== cliente.nome) setCliente(null); }}
            clients={clientesAtivos}
            onSelect={(c) => { setCliente(c); setClienteBusca(c.nome); }}
            renderItem={(c) => (
              <>
                <span>{c.codigo ? `#${c.codigo} — ${c.nome}` : c.nome}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.telefone}</span>
              </>
            )}
            placeholder="Buscar cliente por nome ou código"
            ariaLabel="Cliente da troca"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 1.2fr', gap: '12px', alignItems: 'end' }}>
          <div className="input-group">
            <label>Produto estragado *</label>
            <ProductAutocomplete
              value={produtoBusca}
              onChange={(valor) => { setProdutoBusca(valor); if (produto && valor !== produto.nome) setProduto(null); }}
              products={produtosAtivos}
              onSelect={(p) => { setProduto(p); setProdutoBusca(p.nome); }}
              renderItem={renderProdutoOpcaoBusca}
              placeholder="Buscar produto por nome ou código"
              ariaLabel="Produto da troca"
            />
          </div>
          <div className="input-group">
            <label>Qtd.</label>
            <input type="text" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/[^0-9,.]/g, ''))} style={campo} />
          </div>
          <div className="input-group">
            <label>Motivo *</label>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} style={campo}>
              <option value="">Escolha...</option>
              {MOTIVOS_TROCA.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        {motivo === 'outro' && (
          <div className="input-group">
            <label>Descreva o motivo *</label>
            <input type="text" maxLength={DESCRICAO_MOTIVO_MAX} value={motivoDescricao} onChange={(e) => setMotivoDescricao(e.target.value)} style={campo} />
          </div>
        )}
        <div>
          <button type="button" className="btn-secondary" onClick={adicionarItem} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={16} /> Adicionar item
          </button>
        </div>

        {itens.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum item adicionado ainda.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px' }}>Produto</th>
                <th style={{ padding: '8px' }}>Qtd.</th>
                <th style={{ padding: '8px' }}>Motivo</th>
                <th style={{ padding: '8px' }} />
              </tr>
            </thead>
            <tbody>
              {itens.map((item, indice) => (
                <tr key={`${item.id}-${indice}`} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 8px' }}>{item.nome}</td>
                  <td style={{ padding: '10px 8px' }}>{item.quantidade} {item.unidadeMedidaSigla}</td>
                  <td style={{ padding: '10px 8px' }}>{rotuloDoMotivoTroca(item.motivo)}{item.motivoDescricao ? ` — ${item.motivoDescricao}` : ''}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                    <button type="button" className="icon-btn" onClick={() => setItens((atuais) => atuais.filter((_, i) => i !== indice))} title="Remover item" style={{ color: '#ef4444' }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="input-group">
          <label>Observação</label>
          <input type="text" maxLength={OBSERVACAO_PEDIDO_MAX} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" style={campo} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button type="button" className="btn-secondary" onClick={() => navigate('/vendas/trocas')}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={salvando} onClick={() => void registrar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {salvando ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} />}
          {salvando ? 'Registrando...' : 'Registrar troca'}
        </button>
      </div>
    </div>
  );
};

export default TrocaForm;

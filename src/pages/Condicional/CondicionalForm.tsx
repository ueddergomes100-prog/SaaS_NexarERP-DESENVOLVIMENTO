import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Save, ShoppingBag, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import { renderProdutoOpcaoBusca } from '../../components/common/ProdutoOpcaoBusca';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import { resolveUnidadeMedidaProduto } from '../../utils/unidadeMedidaDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  OBSERVACAO_MAX,
  PRAZO_MAXIMO_DIAS,
  prazoPadrao,
  produtoPermiteCondicional,
  validarPrazoDevolucao,
} from '../../utils/condicionalDomain';
import { CondicionalError, condicionalService, novoIdDeCondicional } from '../../services/condicionalService';
import { MensagemCondicionalDesligado, MensagemSemPermissaoCondicional, usePodeUsarCondicional } from './CondicionaisList';
import { moeda } from './condicionalTipos';

/**
 * NOVO CONDICIONAL (2026-10-05). A tela só junta cliente, peças, quantidades e
 * prazo; o servidor confere tudo de novo (produto liberado, estoque,
 * configuração), reserva o estoque e numera.
 */

interface ClienteBusca { id: string; nome: string; codigo?: string; telefone?: string; ativo?: boolean }
interface ProdutoBusca {
  id: string;
  nome: string;
  codigo?: string;
  precoVenda: number;
  quantidade: number;
  quantidadeReservada?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  ativo?: boolean;
  statusAtivo?: boolean;
  permiteCondicional?: boolean;
}
interface ItemRascunho { id: string; nome: string; codigo?: string; quantidade: number; unidade: string; preco: number }

const campo: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
  padding: '10px 12px', color: 'var(--text-primary)', width: '100%',
};

const disponivel = (p: ProdutoBusca) => Math.max(0, Number(p.quantidade || 0) - Number(p.quantidadeReservada || 0));

const CondicionalForm: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { tenantId, trabalhaComCondicional, permiteVendaSemEstoque } = useAuth();
  const podeUsar = usePodeUsarCondicional();
  const ativo = trabalhaComCondicional && podeUsar;
  const { items: clientes } = useTenantCollection<ClienteBusca>('clientes', tenantId, { enabled: ativo });
  const { items: produtos } = useTenantCollection<ProdutoBusca>('estoque', tenantId, { enabled: ativo });
  const clientesAtivos = useMemo(() => clientes.filter((c) => c.ativo !== false), [clientes]);
  // Só aparecem os produtos liberados no cadastro ("Permite condicional").
  const produtosLiberados = useMemo(
    () => produtos.filter((p) => p.ativo !== false && p.statusAtivo !== false && produtoPermiteCondicional(p)),
    [produtos],
  );

  const hoje = getDateInputInTimeZone();
  const [idDocumento] = useState(novoIdDeCondicional);
  const [clienteBusca, setClienteBusca] = useState('');
  const [cliente, setCliente] = useState<ClienteBusca | null>(null);
  const [itens, setItens] = useState<ItemRascunho[]>([]);
  const [prazo, setPrazo] = useState(() => prazoPadrao(hoje));
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [produtoBusca, setProdutoBusca] = useState('');
  const [produto, setProduto] = useState<ProdutoBusca | null>(null);
  const [quantidade, setQuantidade] = useState('1');

  if (!trabalhaComCondicional) return <MensagemCondicionalDesligado />;
  if (!podeUsar) return <MensagemSemPermissaoCondicional />;

  const adicionarItem = () => {
    if (!produto) { showError('Atenção', 'Busque e selecione o produto na lista.'); return; }
    const qtd = Number(quantidade.replace(',', '.')) || 0;
    if (qtd <= 0) { showError('Atenção', 'A quantidade deve ser maior que zero.'); return; }
    const unidade = resolveUnidadeMedidaProduto(produto);
    if (!isValidSaleQuantity(qtd, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
      showError('Quantidade inválida', unidade.unidadeMedidaFracionado
        ? `A quantidade de ${produto.nome} aceita no máximo ${unidade.unidadeMedidaCasasDecimais} casa(s) decimal(is).`
        : `${produto.nome} é contado em ${unidade.unidadeMedidaSigla}, que não permite quantidade fracionada. Use um número inteiro.`);
      return;
    }
    const jaNaLista = itens.filter((i) => i.id === produto.id).reduce((s, i) => s + i.quantidade, 0);
    if (!permiteVendaSemEstoque && jaNaLista + qtd > disponivel(produto)) {
      showError('Estoque insuficiente', `"${produto.nome}" tem ${disponivel(produto)} disponível (descontado o que já está reservado). Dê entrada no Estoque ou diminua a quantidade.`);
      return;
    }
    if (!String(produto.unidadeMedidaSigla || '').trim()) {
      showWarning('Produto sem unidade de medida', `"${produto.nome}" entrou como UN. Para corrigir, edite o produto em Estoque e informe a unidade.`);
    }
    setItens((atuais) => [...atuais, {
      id: produto.id,
      nome: produto.nome,
      ...(produto.codigo ? { codigo: produto.codigo } : {}),
      quantidade: qtd,
      unidade: unidade.unidadeMedidaSigla,
      preco: Number(produto.precoVenda || 0),
    }]);
    setProduto(null);
    setProdutoBusca('');
    setQuantidade('1');
  };

  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);

  const registrar = async () => {
    if (salvando || !tenantId) return;
    if (!cliente) { showError('Confira o condicional', 'Selecione o cliente na lista.'); return; }
    if (itens.length === 0) { showError('Confira o condicional', 'Adicione pelo menos um produto.'); return; }
    const erroPrazo = validarPrazoDevolucao(prazo, hoje);
    if (erroPrazo) { showError('Confira o prazo', erroPrazo); return; }

    setSalvando(true);
    try {
      const resposta = await condicionalService.criar({
        clienteId: cliente.id,
        itens: itens.map((i) => ({ id: i.id, quantidade: i.quantidade })),
        prazoDevolucao: prazo,
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
        idDocumento,
        tenantId,
      });
      showSuccess(`Condicional #${resposta.numeroCondicional} registrado. As peças ficaram reservadas no estoque.`);
      openTab(`/vendas/condicional/${resposta.id}`, `Condicional #${resposta.numeroCondicional}`);
    } catch (erro) {
      showError('Não foi possível registrar o condicional', erro instanceof CondicionalError ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn back-btn" onClick={() => navigate('/vendas/condicional')} title="Voltar"><ArrowLeft size={20} /></button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingBag size={26} color="var(--accent-purple)" /> Novo condicional
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>As peças ficam reservadas no estoque até o cliente devolver ou decidir.</p>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(160px, 1fr)', gap: '12px' }}>
          <div className="input-group">
            <label>Cliente *</label>
            <ClientAutocomplete
              value={clienteBusca}
              onChange={(valor) => { setClienteBusca(valor); if (cliente && valor !== cliente.nome) setCliente(null); }}
              clients={clientesAtivos}
              onSelect={(c) => { setCliente(c); setClienteBusca(c.nome); }}
              buscaDeCliente
              placeholder="Nome, CPF/CNPJ, telefone ou código"
              ariaLabel="Cliente do condicional"
            />
          </div>
          <div className="input-group">
            <label>Devolver até *</label>
            <input type="date" value={prazo} min={hoje} onChange={(e) => setPrazo(e.target.value)} style={campo} aria-label="Prazo de devolução" />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Máximo de {PRAZO_MAXIMO_DIAS} dias.</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 100px auto', gap: '12px', alignItems: 'end' }}>
          <div className="input-group">
            <label>Produto *</label>
            <ProductAutocomplete
              value={produtoBusca}
              onChange={(valor) => { setProdutoBusca(valor); if (produto && valor !== produto.nome) setProduto(null); }}
              products={produtosLiberados}
              onSelect={(p) => { setProduto(p); setProdutoBusca(p.nome); }}
              renderItem={renderProdutoOpcaoBusca}
              placeholder="Buscar produto liberado para condicional"
              ariaLabel="Produto do condicional"
            />
          </div>
          <div className="input-group">
            <label>Qtd.</label>
            <input type="text" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/[^0-9,.]/g, ''))} style={campo} aria-label="Quantidade" />
          </div>
          <button type="button" className="btn-secondary" onClick={adicionarItem} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '42px' }}>
            <Plus size={16} /> Adicionar
          </button>
        </div>
        {produto && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Disponível: <strong>{disponivel(produto).toLocaleString('pt-BR')}</strong> · Preço: <strong>{moeda(Number(produto.precoVenda || 0))}</strong>
          </div>
        )}
        {produtosLiberados.length === 0 && (
          <div style={{ fontSize: '13px', color: '#f59e0b' }}>
            Nenhum produto está liberado para condicional. Marque &quot;Permite condicional&quot; no cadastro do produto (Estoque → aba Avançado).
          </div>
        )}

        {itens.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma peça adicionada ainda.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px' }}>Produto</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Qtd.</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Preço</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '8px' }} />
              </tr>
            </thead>
            <tbody>
              {itens.map((item, indice) => (
                <tr key={`${item.id}-${indice}`} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 8px' }}>{item.codigo ? `${item.codigo} — ` : ''}{item.nome}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>{item.quantidade.toLocaleString('pt-BR')} {item.unidade}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>{moeda(item.preco)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>{moeda(item.preco * item.quantidade)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                    <button type="button" className="icon-btn" onClick={() => setItens((atuais) => atuais.filter((_, i) => i !== indice))} title="Remover peça" style={{ color: '#ef4444' }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
                <td style={{ padding: '10px 8px' }}>Total</td>
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>{itens.reduce((s, i) => s + i.quantidade, 0).toLocaleString('pt-BR')}</td>
                <td />
                <td style={{ padding: '10px 8px', textAlign: 'right' }}>{moeda(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}

        <div className="input-group">
          <label>Observação</label>
          <input type="text" maxLength={OBSERVACAO_MAX} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" style={campo} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <button type="button" className="btn-secondary" onClick={() => navigate('/vendas/condicional')}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={salvando} onClick={() => void registrar()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {salvando ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} />}
          {salvando ? 'Registrando...' : 'Registrar saída'}
        </button>
      </div>
    </div>
  );
};

export default CondicionalForm;

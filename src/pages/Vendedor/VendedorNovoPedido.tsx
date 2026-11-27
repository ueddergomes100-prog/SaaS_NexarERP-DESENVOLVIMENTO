import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { formasDaEmpresa, parseFormasOcultas, parseOrdemFormasPagamento } from '../../utils/formasPagamentoDomain';
import {
  diasDasParcelas,
  diasUniformes,
  erroDosDiasDasParcelas,
  FORMAS_COM_PRAZO_NO_APP,
  MAX_DIAS_DA_PARCELA,
  MAX_PARCELAS_DO_BOLETO_NO_APP,
  parcelasDoBoleto,
} from '../../utils/vendaFechamentoDomain';
import { addDaysToDateInput, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { usePromocoesVigentes } from '../../hooks/usePromocoesVigentes';
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
import { MENSAGEM_SO_BONIFICADO, PERMISSAO_BONIFICAR, resumoDaBonificacao } from '../../utils/bonificacaoDomain';
import { hasTenantFullAccess } from '../../utils/roles';
import { podeAlterarPrecoNoApp } from '../../utils/permissoesAppDomain';
import { podeCadastrarClienteNoApp } from './vendedorPermissoes';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';
import VendedorRodapeRascunho, { camposDePronto, mensagemDeRascunhoSalvo } from './VendedorRodapeRascunho';
import { useEscolhaDeRota } from '../../hooks/useEscolhaDeRota';
import { textoDaRotaEscolhida, type RotaEscolhida } from '../../utils/rotaPreVendaDomain';

/** Abatimentos do cliente e formas da loja que nao se combinam no pedido do vendedor. */
const FORMAS_FORA_DO_APP: string[] = ['Crédito de Devolução', 'Cashback'];

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
  const { tenantId, currentUser, trabalhaComPreVenda, permiteVendaSemEstoque, venderPorEmbalagem, userPermissions, controlaFiscal, modoRotaPreVenda, configBonificacao, userRole, isOwner } = useAuth();
  // Bonificacao (30/10/2026): a empresa ligou e a pessoa pode bonificar.
  const podeBonificar = configBonificacao.ativa && (hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_BONIFICAR));
  // Rota na pre-venda (21/10/2026): ao marcar "Pronto para enviar", pergunta a rota quando ha' mais de uma em montagem.
  const { escolherRota, modalDeRota } = useEscolhaDeRota(modoRotaPreVenda);
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);
  // Promocoes de hoje (19/10/2026): o pedido do app entra no preco da promocao e consome a quota.
  const promocoesVigentes = usePromocoesVigentes(tenantId);

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

  // Forma de pagamento (25/11/2026, pedido do dono): o vendedor escolhe com o cliente;
  // a pre-venda ja' nasce com ela e trocar no faturamento pede permissao. Opcional.
  const [formaPagamento, setFormaPagamento] = useState(() => rascunhoAberto?.formaPagamento || '');
  // Boleto (26/11/2026): em quantas parcelas, como no Pedido de Venda; a pre-venda ja' nasce com elas.
  const [diasDoRascunho] = useState(() => diasDasParcelas(rascunhoAberto?.diasDasParcelas));
  const [parcelasBoleto, setParcelasBoleto] = useState<number>(() => diasDoRascunho.length || parcelasDoBoleto(rascunhoAberto?.parcelasBoleto) || 1);
  // Prazo das parcelas (27/11/2026, Embala Minas): como no Pedido de Venda -- intervalo e,
  // no boleto, os dias de cada um editaveis (7, 14, 21/28/35...). Vazio = prazo padrao da loja.
  const [intervaloPrazo, setIntervaloPrazo] = useState(() => (diasDoRascunho.length ? String(diasDoRascunho[0]) : ''));
  const [diasLinhas, setDiasLinhas] = useState<string[]>(() => diasDoRascunho.map(String));
  const temPrazo = FORMAS_COM_PRAZO_NO_APP.includes(formaPagamento);
  const hojeNoApp = getDateInputInTimeZone();
  const recalcularDias = (parcelas: number, intervalo: string) => {
    const dias = Number.parseInt(intervalo, 10);
    setDiasLinhas(Number.isInteger(dias) && dias >= 1 ? diasUniformes(parcelas, Math.min(dias, MAX_DIAS_DA_PARCELA)).map(String) : []);
  };
  const [formasDaFilial, setFormasDaFilial] = useState<string[]>(() => formasDaEmpresa([], []).filter((f) => !FORMAS_FORA_DO_APP.includes(f)));
  useEffect(() => {
    if (!tenantId) return undefined;
    let vivo = true;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        if (!vivo || !snap.exists()) return;
        const config = snap.data();
        setFormasDaFilial(formasDaEmpresa(parseOrdemFormasPagamento(config.ordemFormasPagamento), parseFormasOcultas(config.formasPagamentoOcultas))
          .filter((f) => !FORMAS_FORA_DO_APP.includes(f)));
      })
      .catch(() => { /* sem sinal: fica a lista padrao */ });
    return () => { vivo = false; };
  }, [tenantId]);

  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  if (localId && !rascunhoAberto) {
    // Rascunho ja enviado (ou apagado) -- nao ha mais o que editar aqui.
    return <Navigate to="/vendedor/rascunhos" replace />;
  }

  const handleSalvar = async (pronto: boolean) => {
    if (!trabalhaComPreVenda) {
      showError(
        'Pré-venda não está habilitada',
        'O pedido do vendedor externo precisa da opção "Pré-venda" ligada em Configurações da filial → Configurações Avançadas. Peça pro administrador habilitar antes de montar pedidos pelo aplicativo.',
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
    const bonificacao = resumoDaBonificacao(itens);
    if (bonificacao.quantidadeDeItens > 0 && bonificacao.vendidoCentavos <= 0) {
      showError('Pedido só com bonificação', MENSAGEM_SO_BONIFICADO);
      return;
    }
    if (!tenantId || !currentUser) return;
    const comDias = temPrazo && intervaloPrazo.trim() !== '';
    if (comDias) {
      const erroDosDias = diasLinhas.length !== parcelasBoleto ? 'Informe o intervalo das parcelas.' : erroDosDiasDasParcelas(diasLinhas);
      if (erroDosDias) {
        showError('Prazo das parcelas', erroDosDias);
        return;
      }
    }

    // Rota de entrega: so' quando o pedido esta' pronto (e' quando ele vai pra
    // loja). Sem sinal, a rota fica por conta do servidor na hora do envio.
    let rota: RotaEscolhida | null = null;
    let avisoDaRota = '';
    if (pronto && navigator.onLine !== false) {
      const escolha = await escolherRota();
      if (escolha.cancelou) return;
      rota = escolha.rota ? { id: escolha.rota.id, titulo: escolha.rota.titulo } : null;
      avisoDaRota = escolha.semLista ? '' : textoDaRotaEscolhida(rota, modoRotaPreVenda);
    }

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
        ...(formaPagamento ? { formaPagamento } : {}),
        ...(formaPagamento === 'Boleto' ? { parcelasBoleto } : {}),
        ...(comDias ? { diasDasParcelas: diasLinhas.map((d) => Number.parseInt(d, 10)) } : {}),
        criadoEm: rascunhoAberto?.criadoEm || agora,
        atualizadoEm: agora,
        ...camposDePronto(pronto, agora),
        ...(pronto && rota ? { rota } : {}),
      });
      showSuccess(`${mensagemDeRascunhoSalvo(pronto, 'pedido')}${avisoDaRota ? ` ${avisoDaRota}` : ''}`);
      navigate('/vendedor/rascunhos', { replace: true });
    } catch (error) {
      showError('Não foi possível salvar', error instanceof RascunhoStorageError ? error.message : 'Tente novamente.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={localId ? 'Editar Rascunho' : 'Novo Pedido'} />
      {modalDeRota}

      <div style={{ padding: '16px 20px 0' }}>
        {clienteSelecionado ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: 'var(--app-raio-linha)',
              backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
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
        <VendedorItemPicker venderPorEmbalagem={venderPorEmbalagem} produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque={permiteVendaSemEstoque} precos={promocoesVigentes} consomeQuota podeBonificar={podeBonificar} podeAlterarPreco={podeAlterarPrecoNoApp({ role: userRole, isOwner, permissoes: userPermissions })} />

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
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 'var(--app-raio-linha)', border: '1px solid var(--border-color)', fontSize: '16px',
                backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'none',
              }}
            />
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textAlign: 'right' }}>{observacao.length}/{OBSERVACAO_PEDIDO_MAX}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="pedido-forma" style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Forma de pagamento
            </label>
            <select
              id="pedido-forma"
              value={formaPagamento}
              onChange={(evento) => {
                setFormaPagamento(evento.target.value);
                // A prazo no sistema so' tem intervalo fixo: dias personalizados do boleto voltam ao intervalo.
                if (evento.target.value === 'Pagamento a Prazo') recalcularDias(parcelasBoleto, intervaloPrazo);
              }}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 'var(--app-raio-linha)', border: '1px solid var(--border-color)', fontSize: '16px',
                backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            >
              <option value="">A loja escolhe ao faturar</option>
              {[...new Set([...formasDaFilial, ...(formaPagamento ? [formaPagamento] : [])])].map((forma) => (
                <option key={forma} value={forma}>{forma}</option>
              ))}
            </select>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>A pré-venda já chega com esta forma. Trocar na loja só com permissão.</div>
          </div>

          {temPrazo && (() => {
            const estiloCampo: React.CSSProperties = {
              width: '100%', padding: '12px 14px', borderRadius: 'var(--app-raio-linha)', border: '1px solid var(--border-color)', fontSize: '16px',
              backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', color: 'var(--text-primary)', fontFamily: 'inherit', boxSizing: 'border-box',
            };
            const estiloRotulo: React.CSSProperties = { fontSize: '13.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' };
            const ehBoleto = formaPagamento === 'Boleto';
            const varias = parcelasBoleto > 1;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="pedido-parcelas-boleto" style={estiloRotulo}>Parcelas</label>
                    <select
                      id="pedido-parcelas-boleto"
                      value={parcelasBoleto}
                      onChange={(evento) => {
                        const n = parcelasDoBoleto(evento.target.value) || 1;
                        setParcelasBoleto(n);
                        recalcularDias(n, intervaloPrazo);
                      }}
                      style={estiloCampo}
                    >
                      {Array.from({ length: MAX_PARCELAS_DO_BOLETO_NO_APP }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n === 1 ? (ehBoleto ? '1 boleto' : '1 parcela') : `${n} ${ehBoleto ? 'boletos' : 'parcelas'}`}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label htmlFor="pedido-intervalo" style={estiloRotulo}>{varias ? 'Intervalo (dias)' : 'Prazo (dias)'}</label>
                    <input
                      id="pedido-intervalo"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_DIAS_DA_PARCELA}
                      value={intervaloPrazo}
                      onChange={(evento) => {
                        const valor = evento.target.value.replace(/\D/g, '').slice(0, 3);
                        setIntervaloPrazo(valor);
                        recalcularDias(parcelasBoleto, valor);
                      }}
                      style={estiloCampo}
                    />
                  </div>
                </div>
                {diasLinhas.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {diasLinhas.map((dias, posicao) => {
                      const n = Number.parseInt(dias, 10);
                      const vence = Number.isInteger(n) && n >= 1 ? formatDateInputPtBr(addDaysToDateInput(hojeNoApp, n)) : '—';
                      return (
                        <div key={posicao} style={{ display: 'grid', gridTemplateColumns: 'auto 84px 1fr', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--text-primary)' }}>
                          <span style={{ fontWeight: 700, minWidth: '72px' }}>{posicao + 1}º {ehBoleto ? 'boleto' : 'parcela'}</span>
                          {ehBoleto ? (
                            <input
                              aria-label={`Dias do ${posicao + 1}º boleto`}
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={MAX_DIAS_DA_PARCELA}
                              value={dias}
                              onChange={(evento) => {
                                const valor = evento.target.value.replace(/\D/g, '').slice(0, 3);
                                setDiasLinhas((atual) => atual.map((d, i) => (i === posicao ? valor : d)));
                              }}
                              style={{ ...estiloCampo, padding: '9px 10px' }}
                            />
                          ) : (
                            <span style={{ fontWeight: 600 }}>{dias} dias</span>
                          )}
                          <span style={{ color: 'var(--text-muted)' }}>vence {vence}</span>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {ehBoleto && varias ? 'Mude os dias de cada boleto se precisar (ex.: 14 e 21, ou 21, 28 e 35). ' : ''}Dias contados do faturamento; a pré-venda já chega com estes vencimentos.
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sem os dias, os vencimentos seguem o prazo padrão da loja.</div>
                )}
              </div>
            );
          })()}

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

      <VendedorRodapeRascunho aoSalvar={handleSalvar} />
    </div>
  );
};

export default VendedorNovoPedido;

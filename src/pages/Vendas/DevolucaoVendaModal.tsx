import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Receipt, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { PARAMETROS_VENDA_PADRAO, checarPrazoDevolucao, parseParametrosVenda, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, NexusSwal } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { isPlatformAdminRole } from '../../utils/roles';
import DevolucaoNfeModal from '../../components/common/DevolucaoNfeModal';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  FORMAS_BANCARIAS_DEVOLUCAO,
  MOTIVOS_DEVOLUCAO,
  disponivelParaDevolver,
  montarItensDevolvidos,
  type FormaBancariaDevolucao,
} from '../../utils/devolucaoVendaDomain';
import { efetivarDevolucaoVenda, lerQuantidadesEmAguardo, registrarHistoricoDaDevolucao } from '../../services/devolucaoVendaService';

type FormaBancaria = FormaBancariaDevolucao;

interface BancoOption {
  id: string;
  nome: string;
}

interface DevolucaoItem {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  quantidadeJaDevolvida?: number;
  selecionado: boolean;
  quantidadeSelecionada: number;
  /** Fator da embalagem em que o item foi vendido -- devolver 1 saco tem que
   * repor 20kg no estoque, nao 1. Ausente = venda na unidade base (fator 1). */
  fatorConversao?: number;
  unidadeMedidaSigla?: string;
}

interface DevolucaoVendaModalProps {
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  itens: Array<{ id: string; nome: string; precoUnitario: number; quantidade: number; desconto: number; quantidadeJaDevolvida?: number; fatorConversao?: number; unidadeMedidaSigla?: string }>;
  onClose: () => void;
  onSuccess: () => void;
  /** Abre o comprovante da devolucao recem-gravada (25/11/2026). */
  onComprovante?: (devolucaoId: string) => void;
  /** Data da venda ('AAAA-MM-DD'), para o prazo de devolucao da filial (parametros de venda). */
  dataVenda?: string;
}

/**
 * Devolucao de um pedido de venda ja carregado (aberta de dentro da tela do
 * proprio pedido ou da tela de Devolucoes). O que a devolucao grava mora em
 * services/devolucaoVendaService.ts -- o MESMO codigo do "Confirmar" da
 * devolucao pedida pelo app --, com a regra em utils/devolucaoVendaDomain.ts.
 */
const DevolucaoVendaModal: React.FC<DevolucaoVendaModalProps> = ({ pedidoId, numeroPedido, clienteNome, itens: itensOriginais, onClose, onSuccess, onComprovante, dataVenda }) => {
  const { currentUser, tenantId, controlaFiscal, isOwner, userRole, userPermissions, userNome } = useAuth();
  const podeEmitirNota = Boolean(controlaFiscal) && (isOwner || isPlatformAdminRole(userRole) || Boolean(userPermissions?.includes('fiscal.emitir')));
  /** Devolucao recem-registrada cuja NF-e de devolucao esta sendo emitida (abre o pop-up fiscal). */
  const [devolucaoParaNota, setDevolucaoParaNota] = useState<string | null>(null);
  const [itens, setItens] = useState<DevolucaoItem[]>([]);
  /** Quanto de cada linha ja' esta' numa devolucao do app aguardando confirmacao (por indice). */
  const [emAguardo, setEmAguardo] = useState<Map<number, number>>(new Map());
  const [destinoValor, setDestinoValor] = useState<'credito' | 'caixa' | 'banco'>('credito');
  const [formaBancaria, setFormaBancaria] = useState<FormaBancaria>('Pix');
  const [bancoId, setBancoId] = useState('');
  const [parametrosVenda, setParametrosVenda] = useState<ParametrosVenda>(PARAMETROS_VENDA_PADRAO);
  const [bancos, setBancos] = useState<BancoOption[]>([]);
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const returnLockRef = useRef(false);

  useEffect(() => {
    setItens(itensOriginais.map((item) => ({
      ...item,
      quantidadeJaDevolvida: item.quantidadeJaDevolvida || 0,
      quantidadeSelecionada: 0,
      selecionado: false,
    })));
  }, [itensOriginais]);

  useEffect(() => {
    if (!tenantId || !pedidoId) return;
    lerQuantidadesEmAguardo(tenantId, pedidoId)
      .then(setEmAguardo)
      .catch((error) => console.error('Erro ao ler as devoluções aguardando confirmação:', error));
  }, [tenantId, pedidoId]);

  useEffect(() => {
    if (!tenantId) return;
    // Parametros de venda da filial (fase A): prazo para devolucao.
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => setParametrosVenda(parseParametrosVenda(snap.exists() ? snap.data().parametrosVenda : undefined)))
      .catch(() => setParametrosVenda(PARAMETROS_VENDA_PADRAO));
    getDocs(query(collection(db, 'bancos'), where('tenantId', '==', tenantId), where('ativo', '==', true)))
      .then((snap) => setBancos(snap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') }))))
      .catch((error) => console.error('Erro ao carregar bancos:', error));
  }, [tenantId]);

  const disponivelDa = (item: DevolucaoItem, index: number) => disponivelParaDevolver(item, emAguardo.get(index) || 0);

  const handleToggleItem = (index: number) => {
    setItens((current) => current.map((item, idx) => {
      if (idx !== index) return item;
      const disponivel = disponivelDa(item, idx);
      if (!item.selecionado && disponivel > 0) return { ...item, selecionado: true, quantidadeSelecionada: Math.min(1, disponivel) };
      return { ...item, selecionado: false, quantidadeSelecionada: 0 };
    }));
  };

  const handleQtdChange = (index: number, novaQtd: number) => {
    setItens((current) => current.map((item, idx) => {
      if (idx !== index) return item;
      const maxPermitido = disponivelDa(item, idx);
      const qtd = Math.max(0, Math.min(Number.isFinite(novaQtd) ? novaQtd : 0, maxPermitido));
      return { ...item, quantidadeSelecionada: qtd, selecionado: qtd > 0 };
    }));
  };

  const valorTotalCalculado = itens.reduce((total, item) => {
    if (!item.selecionado || item.quantidadeSelecionada <= 0) return total;
    const proporcao = item.quantidadeSelecionada / item.quantidade;
    const subtotalBase = item.quantidadeSelecionada * item.precoUnitario;
    const descontoProporcional = item.desconto * proporcao;
    return total + (subtotalBase - descontoProporcional);
  }, 0);

  /** O pedido tem NF-e ou NFC-e autorizada (que nao seja ela mesma uma devolucao)? */
  const pedidoTemNotaAutorizada = async (): Promise<boolean> => {
    try {
      const snap = await getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId), where('pedidoId', '==', pedidoId)));
      return snap.docs.some((d) => {
        const nota = d.data();
        return nota.status === 'authorized' && ['NF-e', 'NFC-e'].includes(nota.tipo) && nota.finalidade !== 'devolucao';
      });
    } catch (erro) {
      // Sem conseguir consultar, nao atrapalha a devolucao: o botao em Notas Fiscais continua disponivel.
      console.error('Erro ao consultar as notas do pedido:', erro);
      return false;
    }
  };

  const handleConfirmarDevolucao = async () => {
    if (returnLockRef.current) return;
    if (!currentUser || !tenantId) return;

    if (valorTotalCalculado <= 0) {
      showError('Atenção', 'Selecione pelo menos um item com quantidade válida para devolução.');
      return;
    }
    if (!motivo) {
      showError('Atenção', 'Selecione o motivo da devolução.');
      return;
    }
    if (destinoValor === 'banco' && !bancoId) {
      showError('Atenção', 'Selecione de qual banco o dinheiro está saindo.');
      return;
    }
    const montagem = montarItensDevolvidos(
      itens,
      itens.map((item, indice) => ({ indice, id: item.id, nome: item.nome, quantidade: item.selecionado ? item.quantidadeSelecionada : 0 })),
      emAguardo,
    );
    if (!montagem.ok) {
      showError('Atenção', montagem.erro);
      return;
    }
    // Prazo de devolucao da filial (parametros de venda, fase A).
    const prazo = checarPrazoDevolucao(parametrosVenda, dataVenda, getDateInputInTimeZone());
    if (prazo.foraDoPrazo) {
      if (prazo.acao === 'bloquear') {
        showError('Devolução fora do prazo', prazo.mensagem);
        return;
      }
      const seguir = await NexusSwal.fire({
        title: 'Devolução fora do prazo',
        text: prazo.mensagem,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Registrar mesmo assim',
        cancelButtonText: 'Voltar',
      });
      if (!seguir.isConfirmed) return;
    }

    returnLockRef.current = true;
    setIsProcessing(true);

    try {
      const quem = { tenantId, usuarioId: currentUser.uid, usuarioNome: userNome || currentUser.email || currentUser.uid };
      const resultado = await efetivarDevolucaoVenda(quem, {
        nova: {
          pedidoId,
          numeroPedido,
          clienteNome,
          itensDevolvidos: montagem.itensDevolvidos,
          valorTotal: montagem.valorTotal,
          destino: destinoValor,
          formaBancaria,
          bancoId: destinoValor === 'banco' ? bancoId : '',
          bancoNome: destinoValor === 'banco' ? (bancos.find((b) => b.id === bancoId)?.nome || '') : '',
          motivo,
          observacao,
        },
      });
      registrarHistoricoDaDevolucao({ ...quem, usuarioEmail: currentUser.email || currentUser.uid }, resultado, 'feita');

      onSuccess();

      // Pedido com NF-e/NFC-e autorizada: a devolucao tambem precisa de nota fiscal.
      if (podeEmitirNota && await pedidoTemNotaAutorizada()) {
        const escolha = await NexusSwal.fire({
          icon: 'question',
          title: 'Emitir a NF-e de devolução agora?',
          text: 'Este pedido tem nota fiscal autorizada. Para o fisco, a devolução também precisa ser documentada com uma NF-e de devolução. Você pode emitir agora ou depois, em Notas Fiscais.',
          showCancelButton: true,
          confirmButtonText: 'Emitir agora',
          cancelButtonText: 'Depois',
        });
        if (escolha.isConfirmed) {
          setDevolucaoParaNota(resultado.devolucaoId);
          return;
        }
      }
      // Comprovante (25/11/2026, Jomarly): botao na mensagem de sucesso, sem
      // pergunta a mais; tambem sai depois pela lista de devolucoes do pedido.
      const fim = await NexusSwal.fire({
        icon: 'success',
        title: 'Devolução registrada',
        text: destinoValor === 'credito'
          ? 'O valor ficou como crédito do cliente.'
          : 'O valor saiu do caixa/banco escolhido.',
        showCancelButton: Boolean(onComprovante),
        showConfirmButton: true,
        confirmButtonText: onComprovante ? 'Imprimir comprovante' : 'OK',
        cancelButtonText: 'Fechar',
      });
      onClose();
      if (fim.isConfirmed && onComprovante) onComprovante(resultado.devolucaoId);
    } catch (err) {
      console.error(err);
      showError('Não foi possível registrar a devolução', err instanceof Error ? err.message : 'Ocorreu um problema ao processar a devolução. Tente de novo.');
    } finally {
      returnLockRef.current = false;
      setIsProcessing(false);
    }
  };

  if (devolucaoParaNota) {
    return <DevolucaoNfeModal devolucaoId={devolucaoParaNota} numeroPedido={numeroPedido} onClose={onClose} />;
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }}>
      <div className="card" style={{
        backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={20} color="#3b82f6" />
            Devolução - Pedido #{numeroPedido}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Selecione os Itens para Devolução</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {itens.map((item, idx) => {
                const disponivelParaDevolucao = disponivelDa(item, idx);
                const aguardando = emAguardo.get(idx) || 0;
                const esgotado = disponivelParaDevolucao <= 0;

                return (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 16px',
                    backgroundColor: esgotado ? 'rgba(255,255,255,0.02)' : 'var(--bg-tertiary)',
                    border: `1px solid ${item.selecionado ? '#3b82f6' : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    opacity: esgotado ? 0.6 : 1
                  }}>
                    <input
                      type="checkbox"
                      checked={item.selecionado}
                      onChange={() => handleToggleItem(idx)}
                      disabled={esgotado}
                      style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: esgotado ? 'not-allowed' : 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: '14px', display: 'block' }}>{item.nome}</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Preço Un: R$ {item.precoUnitario.toFixed(2)} | Vendido: {item.quantidade} {item.unidadeMedidaSigla || 'un.'} {(item.quantidadeJaDevolvida || 0) > 0 && `(Já devolvido: ${item.quantidadeJaDevolvida})`} {aguardando > 0 && `(Aguardando confirmação: ${aguardando})`}
                      </span>
                    </div>
                    {!esgotado && item.selecionado && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Qtd a devolver:</label>
                        <input
                          type="number"
                          min="1"
                          max={disponivelParaDevolucao}
                          value={item.quantidadeSelecionada}
                          onChange={(e) => handleQtdChange(idx, Number(e.target.value))}
                          style={{ width: '60px', padding: '4px 8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'center' }}
                        />
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>/ {disponivelParaDevolucao}</span>
                      </div>
                    )}
                    {esgotado && (
                      <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>Totalmente devolvido</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {valorTotalCalculado > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Valor Total a Devolver (com dedução proporcional de descontos):</span>
                <strong style={{ fontSize: '24px', color: '#10b981' }}>R$ {valorTotalCalculado.toFixed(2)}</strong>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, display: 'block', marginBottom: '12px' }}>O que deseja fazer com o valor?</label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'credito' ? '#8b5cf6' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'credito' ? 'rgba(139, 92, 246, 0.1)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="radio" name="destino" checked={destinoValor === 'credito'} onChange={() => setDestinoValor('credito')} style={{ display: 'none' }} />
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'credito' ? '#8b5cf6' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {destinoValor === 'credito' && <div style={{ width: '10px', height: '10px', backgroundColor: '#8b5cf6', borderRadius: '50%' }} />}
                      </div>
                      <strong style={{ color: destinoValor === 'credito' ? '#8b5cf6' : 'white' }}>Gerar Crédito do Cliente</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Fica como saldo para uso em Contas a Receber futuras.</span>
                  </label>

                  <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'caixa' ? '#10b981' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'caixa' ? 'rgba(16, 185, 129, 0.1)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="radio" name="destino" checked={destinoValor === 'caixa'} onChange={() => setDestinoValor('caixa')} style={{ display: 'none' }} />
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'caixa' ? '#10b981' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {destinoValor === 'caixa' && <div style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '50%' }} />}
                      </div>
                      <strong style={{ color: destinoValor === 'caixa' ? '#10b981' : 'white' }}>Devolver em Dinheiro</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Sai do caixa físico e lança uma despesa no fluxo de caixa hoje.</span>
                  </label>

                  <label style={{ flex: 1, padding: '16px', border: `2px solid ${destinoValor === 'banco' ? '#3b82f6' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer', backgroundColor: destinoValor === 'banco' ? 'rgba(59, 130, 246, 0.1)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input type="radio" name="destino" checked={destinoValor === 'banco'} onChange={() => setDestinoValor('banco')} style={{ display: 'none' }} />
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${destinoValor === 'banco' ? '#3b82f6' : 'var(--text-muted)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {destinoValor === 'banco' && <div style={{ width: '10px', height: '10px', backgroundColor: '#3b82f6', borderRadius: '50%' }} />}
                      </div>
                      <strong style={{ color: destinoValor === 'banco' ? '#3b82f6' : 'white' }}>Devolver pelo Banco</strong>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '26px' }}>Pix ou transferência: debita o saldo do banco escolhido.</span>
                  </label>
                </div>

                {destinoValor === 'banco' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '16px' }}>
                    <div className="input-group">
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Forma *</label>
                      <select
                        value={formaBancaria}
                        onChange={(e) => setFormaBancaria(e.target.value as FormaBancaria)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      >
                        {FORMAS_BANCARIAS_DEVOLUCAO.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                      </select>
                    </div>
                    <div className="input-group">
                      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>De qual banco está saindo o dinheiro? *</label>
                      <select
                        value={bancoId}
                        onChange={(e) => setBancoId(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: `1px solid ${bancoId ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '4px', color: 'var(--text-primary)' }}
                      >
                        <option value="">Selecione o banco...</option>
                        {bancos.map((banco) => <option key={banco.id} value={banco.id}>{banco.nome}</option>)}
                      </select>
                      {bancos.length === 0 && (
                        <small style={{ color: '#f59e0b' }}>Nenhum banco ativo cadastrado. Cadastre um em Cadastros → Bancos.</small>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '8px' }}>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Motivo *</label>
                  <select
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                  >
                    <option value="">Selecione...</option>
                    {MOTIVOS_DEVOLUCAO.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Observação (opcional)</label>
                  <input
                    type="text"
                    title="Detalhes adicionais..."
                    value={observacao}
                    onChange={e => setObservacao(aplicarCaixaAltaCadastro(e.target, e.target.value))}
                    style={{ width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
            </div>
          )}

          {itens.length > 0 && itens.every((item, idx) => disponivelDa(item, idx) <= 0) && (
            <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <AlertTriangle size={24} />
              <div>
                <strong>Todos os itens já foram devolvidos!</strong>
                <p style={{ margin: 0, fontSize: '13px' }}>Não há mais nada disponível para devolução neste pedido.</p>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={valorTotalCalculado <= 0 || !motivo || isProcessing || (destinoValor === 'banco' && !bancoId)}
            onClick={handleConfirmarDevolucao}
            style={{ backgroundColor: '#ef4444', border: 'none', opacity: (valorTotalCalculado <= 0 || !motivo || isProcessing || (destinoValor === 'banco' && !bancoId)) ? 0.5 : 1 }}
          >
            {isProcessing ? 'Processando...' : 'Confirmar Devolução'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DevolucaoVendaModal;

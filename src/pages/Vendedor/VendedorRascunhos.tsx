import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, MessageCircle, Send, Trash2, XCircle } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { criarOrcamentoExterno, criarPreVendaExterna } from '../../services/vendedorExternoVendaService';
import { trocaService } from '../../services/trocaService';
import VendedorHeader from './VendedorHeader';
import type { MinutaCliente } from '../Expedicao/MinutaPrintDocument';
import { enviarMinutaPorWhatsApp, gerarMinutaRascunhoPdf, nomeArquivoMinutaRascunho } from './vendedorMinutaPdf';
import { comNotaFiscalDaEscolha } from '../../utils/pedidoVendedorDomain';
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

const rotuloTipo = (rascunho: RascunhoVenda) => (rascunho.tipo === 'pedido' ? 'Pedido' : rascunho.tipo === 'troca' ? 'Troca' : 'Orçamento');

/** Quantidade de itens do rascunho (a troca guarda os dela em `itensTroca`). */
const quantidadeDeItens = (rascunho: RascunhoVenda) => (rascunho.tipo === 'troca' ? (rascunho.itensTroca || []).length : rascunho.itens.length);

const caminhoDeEdicao = (rascunho: RascunhoVenda) => `/vendedor/${rascunho.tipo === 'pedido' ? 'pedido' : rascunho.tipo === 'troca' ? 'troca' : 'orcamento'}/rascunho/${rascunho.localId}`;

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
  const { tenantId, currentUser, userNome, trabalhaComPreVenda, permiteVendaSemEstoque, conferenciaMercadoriaAtiva } = useAuth();
  const [rascunhos, setRascunhos] = useState<RascunhoVenda[]>(() => (
    tenantId && currentUser ? listarRascunhos(tenantId, currentUser.uid) : []
  ));
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoEnvio[]>([]);
  const [gerandoMinuta, setGerandoMinuta] = useState<string | null>(null);

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

  /**
   * Manda a minuta do rascunho (PDF, sem valores) pro WhatsApp do cliente
   * conferir o pedido antes de ele ir pra loja. Nao envia nem altera o
   * rascunho. Cadastro do cliente e nome da empresa sao complemento: se nao
   * carregarem (sem internet, por exemplo), a minuta sai com o que o
   * rascunho ja tem.
   */
  const handleEnviarMinuta = async (rascunho: RascunhoVenda) => {
    if (!tenantId || gerandoMinuta) return;
    setGerandoMinuta(rascunho.localId);
    try {
      let cliente: MinutaCliente | null = null;
      try {
        const clienteSnap = await getDoc(doc(db, 'clientes', rascunho.cliente.id));
        if (clienteSnap.exists() && clienteSnap.data().tenantId === tenantId) cliente = clienteSnap.data() as MinutaCliente;
      } catch {
        // Sai so' com o nome e o telefone que o rascunho guardou.
      }
      let nomeEmpresa = '';
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        nomeEmpresa = String(configSnap.data()?.nomeOficina || '').trim();
      } catch {
        // Cabecalho sem o nome da filial.
      }

      const telefone = cliente?.celular || cliente?.telefone || rascunho.cliente.telefone || '';
      const pdf = gerarMinutaRascunhoPdf({
        rascunho,
        cliente,
        nomeEmpresa,
        vendedorNome: userNome || currentUser?.displayName || 'Vendedor',
        geradoEm: new Date(),
      });
      const resultado = await enviarMinutaPorWhatsApp(
        pdf,
        nomeArquivoMinutaRascunho(rascunho.cliente.nome),
        telefone,
        `Olá, ${rascunho.cliente.nome}! Segue a minuta do seu pedido para conferência.`,
      );
      if (resultado === 'baixado') {
        showWarning(
          'Minuta baixada',
          telefone
            ? 'Abrimos a conversa do cliente no WhatsApp. Anexe o PDF que acabou de ser baixado.'
            : 'Este cliente não tem telefone cadastrado. Abra o WhatsApp e anexe o PDF que acabou de ser baixado.',
        );
      } else if (resultado === 'compartilhado') {
        showSuccess('Minuta enviada para o compartilhamento.');
      }
    } catch (error) {
      showError('Não foi possível gerar a minuta', error instanceof Error && error.message ? error.message : 'Tente novamente.');
    } finally {
      setGerandoMinuta(null);
    }
  };

  const enviarUm = async (rascunho: RascunhoVenda): Promise<string> => {
    if (!tenantId || !currentUser) throw new Error('Sessão expirada. Entre novamente.');
    if (rascunho.tipo === 'troca') {
      // Troca vai pelo servidor (a loja aprova depois); reenviar o mesmo rascunho nao duplica.
      const resposta = await trocaService.solicitar({
        idDocumento: rascunho.localId,
        clienteId: rascunho.cliente.id,
        observacao: rascunho.observacao,
        itens: (rascunho.itensTroca || []).map((item) => ({
          id: item.id,
          quantidade: item.quantidade,
          motivo: item.motivo,
          ...(item.motivoDescricao ? { motivoDescricao: item.motivoDescricao } : {}),
        })),
      });
      return `Troca #${resposta.numeroTroca} enviada — aguarde a loja aprovar`;
    }
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
        observacao: rascunho.observacao,
        ...(rascunho.notaFiscal ? { comNotaFiscal: comNotaFiscalDaEscolha(rascunho.notaFiscal) } : {}),
        // Segue a config da empresa "Permitir venda sem estoque", como as
        // demais telas de venda -- antes estava fixo em false.
        permitirVendaSemEstoque: permiteVendaSemEstoque,
        idDocumento: rascunho.localId,
        conferenciaMercadoriaAtiva,
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
              justifyContent: 'center', gap: '8px', fontSize: '16px', fontWeight: 700, color: '#fff',
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
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Resultado do envio
            </div>
            {resultados.map((r) => (
              <div key={r.localId} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                {r.ok
                  ? <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '1px' }} />
                  : <XCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />}
                <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{r.descricao}</strong><br />
                  {r.mensagem}
                </div>
              </div>
            ))}
          </div>
        )}

        {rascunhos.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
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
                onClick={() => navigate(caminhoDeEdicao(rascunho))}
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rascunho.cliente.nome}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {rotuloTipo(rascunho)} · {quantidadeDeItens(rascunho)} {quantidadeDeItens(rascunho) === 1 ? 'item' : 'itens'}{rascunho.tipo === 'troca' ? ' · sem cobrança' : ` · ${formatarMoeda(totalDoRascunho(rascunho))}`}
                </div>
                {rascunho.notaFiscal && (
                  <div style={{ marginTop: '6px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                      backgroundColor: rascunho.notaFiscal === 'com' ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.18)',
                      color: rascunho.notaFiscal === 'com' ? '#10b981' : 'var(--text-muted)',
                    }}>
                      {rascunho.notaFiscal === 'com' ? 'COM NOTA FISCAL' : 'SEM NOTA FISCAL'}
                    </span>
                  </div>
                )}
                {rascunho.ultimoErro && (
                  <div style={{ fontSize: '11.5px', color: '#f87171', marginTop: '4px', lineHeight: 1.35 }}>
                    Não enviado: {rascunho.ultimoErro}
                  </div>
                )}
              </button>
              {rascunho.tipo === 'pedido' && (
                <button
                  type="button"
                  aria-label="Enviar minuta pelo WhatsApp"
                  title="Enviar minuta pelo WhatsApp"
                  disabled={enviando || gerandoMinuta !== null}
                  onClick={() => void handleEnviarMinuta(rascunho)}
                  style={{
                    width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)',
                    color: '#22c55e', cursor: 'pointer', opacity: gerandoMinuta === rascunho.localId ? 0.5 : 1,
                  }}
                >
                  <MessageCircle size={16} />
                </button>
              )}
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

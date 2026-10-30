import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, MessageCircle, Send, Trash2, XCircle } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError, showSuccess, showWarning } from '../../utils/alerts';
import { useEscolhaDeRota } from '../../hooks/useEscolhaDeRota';
import { textoDaRotaEscolhida, type RotaEscolhida } from '../../utils/rotaPreVendaDomain';
import VendedorHeader from './VendedorHeader';
import type { MinutaCliente } from '../Expedicao/MinutaPrintDocument';
import { enviarMinutaPorWhatsApp, gerarMinutaRascunhoPdf, nomeArquivoMinutaRascunho } from './vendedorMinutaPdf';
import {
  EVENTO_RASCUNHOS_ALTERADOS,
  listarRascunhos,
  marcarProntoRascunho,
  removerRascunho,
  type RascunhoVenda,
} from './vendedorRascunhosStore';
import { enviarRascunhos, rotuloTipoRascunho, type ResultadoEnvio } from './envioRascunhos';
import { parseValoresNaMinutaDoApp } from '../../utils/minutaDomain';

/** Resposta em ate' `ms`; passou disso (ou deu erro), devolve null -- a minuta segue sem esse dado. */
const comTempoLimite = <T,>(promessa: Promise<T>, ms = 3000): Promise<T | null> => Promise.race([
  promessa.catch(() => null),
  new Promise<null>((resolver) => { setTimeout(() => resolver(null), ms); }),
]);

const formatarMoeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const totalDoRascunho = (rascunho: RascunhoVenda) => rascunho.itens.reduce((soma, item) => soma + item.subtotal, 0);

const rotuloTipo = rotuloTipoRascunho;

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
  const { tenantId, currentUser, userNome, trabalhaComPreVenda, permiteVendaSemEstoque, conferenciaMercadoriaAtiva, modoRotaPreVenda, valoresNaMinutaDoApp } = useAuth();
  // Rota na pre-venda (21/10/2026): ao marcar "Pronto", pergunta a rota quando ha' mais de uma em montagem.
  const { escolherRota, modalDeRota } = useEscolhaDeRota(modoRotaPreVenda);
  const [rascunhos, setRascunhos] = useState<RascunhoVenda[]>(() => (
    tenantId && currentUser ? listarRascunhos(tenantId, currentUser.uid) : []
  ));
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoEnvio[]>([]);
  const [gerandoMinuta, setGerandoMinuta] = useState<string | null>(null);

  const recarregar = () => {
    if (tenantId && currentUser) setRascunhos(listarRascunhos(tenantId, currentUser.uid));
  };

  // O envio automatico dos prontos (EnvioAutomaticoDeRascunhos) tira o
  // rascunho do aparelho com esta tela aberta: a lista acompanha.
  useEffect(() => {
    const aoMudar = () => recarregar();
    window.addEventListener(EVENTO_RASCUNHOS_ALTERADOS, aoMudar);
    return () => window.removeEventListener(EVENTO_RASCUNHOS_ALTERADOS, aoMudar);
  }, [tenantId, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAlternarPronto = async (rascunho: RascunhoVenda) => {
    if (!tenantId || !currentUser) return;
    try {
      let rota: RotaEscolhida | null = null;
      let avisoDaRota = '';
      if (!rascunho.pronto && rascunho.tipo === 'pedido' && navigator.onLine !== false) {
        const escolha = await escolherRota();
        if (escolha.cancelou) return;
        rota = escolha.rota ? { id: escolha.rota.id, titulo: escolha.rota.titulo } : null;
        avisoDaRota = escolha.semLista ? '' : textoDaRotaEscolhida(rota, modoRotaPreVenda);
      }
      marcarProntoRascunho(tenantId, currentUser.uid, rascunho.localId, !rascunho.pronto, rota);
      recarregar();
      if (!rascunho.pronto) {
        showSuccess(`${navigator.onLine === false
          ? 'Pronto para enviar. Sem sinal agora: o app envia sozinho quando a internet voltar.'
          : 'Pronto para enviar. O app envia para a loja em instantes.'}${avisoDaRota ? ` ${avisoDaRota}` : ''}`);
      }
    } catch (error) {
      showError('Não foi possível marcar o rascunho', error instanceof Error ? error.message : 'Tente novamente.');
    }
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
   * Manda a minuta do rascunho (PDF; com ou sem valores, conforme a empresa
   * configurou -- 30/10/2026) pro WhatsApp do cliente
   * conferir o pedido antes de ele ir pra loja. Nao envia nem altera o
   * rascunho. Cadastro do cliente e nome da empresa sao complemento: se nao
   * carregarem (sem internet, por exemplo), a minuta sai com o que o
   * rascunho ja tem.
   */
  const handleEnviarMinuta = async (rascunho: RascunhoVenda) => {
    if (!tenantId || gerandoMinuta) return;
    // Valores na minuta (30/10/2026): troca nao tem preco; nos demais vale a configuracao da filial.
    let comValores = rascunho.tipo !== 'troca' && valoresNaMinutaDoApp === 'sempre';
    if (rascunho.tipo !== 'troca' && valoresNaMinutaDoApp === 'vendedor_escolhe') {
      const escolha = await NexusSwal.fire({
        icon: 'question',
        title: 'Minuta com valores?',
        text: 'Com valores, o cliente recebe o preço de cada item e o total do pedido. Sem valores, só os produtos e as quantidades.',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Com valores',
        denyButtonText: 'Sem valores',
        cancelButtonText: 'Voltar',
      });
      if (!escolha.isConfirmed && !escolha.isDenied) return;
      comValores = escolha.isConfirmed;
    }
    setGerandoMinuta(rascunho.localId);
    try {
      // As duas buscas correm juntas e com tempo limite (2026-10-02): com sinal
      // fraco elas demoravam e o Android recusava o menu de compartilhar, que
      // so' abre logo depois do toque ("Permission denied"). Sem resposta em 3 s,
      // a minuta sai com o que o rascunho ja' tem.
      const [clienteSnap, configSnap] = await Promise.all([
        comTempoLimite(getDoc(doc(db, 'clientes', rascunho.cliente.id))),
        comTempoLimite(getDoc(doc(db, 'configuracoes', tenantId))),
      ]);
      const cliente: MinutaCliente | null = clienteSnap?.exists() && clienteSnap.data().tenantId === tenantId
        ? clienteSnap.data() as MinutaCliente
        : null;
      const nomeEmpresa = String(configSnap?.data()?.nomeOficina || '').trim();
      // A empresa desligou os valores depois que o app carregou: vale o que esta' gravado agora.
      if (comValores && configSnap?.exists() && parseValoresNaMinutaDoApp(configSnap.data().appMinutaValores) === 'nunca') comValores = false;

      const telefone = cliente?.celular || cliente?.telefone || rascunho.cliente.telefone || '';
      const pdf = gerarMinutaRascunhoPdf({
        rascunho,
        cliente,
        nomeEmpresa,
        vendedorNome: userNome || currentUser?.displayName || 'Vendedor',
        geradoEm: new Date(),
        comValores,
      });
      const nomeArquivo = nomeArquivoMinutaRascunho(rascunho.cliente.nome);
      const mensagem = `Olá, ${rascunho.cliente.nome}! Segue a minuta do seu pedido para conferência.`;
      let resultado = await enviarMinutaPorWhatsApp(pdf, nomeArquivo, telefone, mensagem);
      if (resultado === 'precisa_toque') {
        // O toque de agora libera o compartilhamento de novo. Se ainda assim o
        // aparelho recusar, baixa o PDF e abre a conversa do cliente.
        const confirmacao = await NexusSwal.fire({
          icon: 'info',
          title: 'Minuta pronta',
          text: 'Toque em "Enviar" para escolher o WhatsApp e mandar a minuta ao cliente.',
          showCancelButton: true,
          confirmButtonText: 'Enviar',
          cancelButtonText: 'Agora não',
        });
        if (!confirmacao.isConfirmed) return;
        resultado = await enviarMinutaPorWhatsApp(pdf, nomeArquivo, telefone, mensagem, true);
      }
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
      // Nunca o texto cru do navegador ("Permission denied" nao diz nada ao vendedor).
      console.error('Erro ao gerar/enviar a minuta do rascunho:', error);
      showError('Não foi possível enviar a minuta', 'O celular não deixou abrir o compartilhamento. Toque de novo no botão verde; se continuar, feche e abra o app e tente outra vez.');
    } finally {
      setGerandoMinuta(null);
    }
  };

  const handleEnviar = async () => {
    if (!tenantId || !currentUser || enviando) return;
    if (listarRascunhos(tenantId, currentUser.uid).length === 0) return;

    setEnviando(true);
    setResultados([]);
    try {
      // O botao manda TODOS (pronto ou nao): e' o vendedor decidindo na hora.
      await enviarRascunhos({
        tenantId,
        usuarioId: currentUser.uid,
        vendedorNome: userNome || currentUser.displayName || 'Vendedor',
        trabalhaComPreVenda: Boolean(trabalhaComPreVenda),
        permiteVendaSemEstoque: Boolean(permiteVendaSemEstoque),
        conferenciaMercadoriaAtiva: Boolean(conferenciaMercadoriaAtiva),
        modoRotaPreVenda,
      }, () => true, (parcial) => setResultados(parcial));
    } finally {
      recarregar();
      setEnviando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Rascunhos" aoVoltar={() => navigate('/vendedor')} />
      {modalDeRota}

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
          <div style={{ padding: '12px 14px', borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: `1px solid ${rascunho.ultimoErro ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'}` }}
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
                {rascunho.pronto && !rascunho.ultimoErro && (
                  <div style={{ fontSize: '11.5px', color: '#10b981', marginTop: '4px', lineHeight: 1.35, fontWeight: 600 }}>
                    Pronto: vai sozinho para a loja quando tiver sinal
                  </div>
                )}
                {rascunho.ultimoErro && (
                  <div style={{ fontSize: '11.5px', color: '#f87171', marginTop: '4px', lineHeight: 1.35 }}>
                    Não enviado: {rascunho.ultimoErro}
                  </div>
                )}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(rascunho.pronto)}
                aria-label={rascunho.pronto ? 'Desmarcar pronto para enviar' : 'Marcar pronto para enviar'}
                title={rascunho.pronto ? 'Pronto para enviar (toque para desmarcar)' : 'Marcar pronto para enviar'}
                disabled={enviando}
                onClick={() => handleAlternarPronto(rascunho)}
                style={{
                  height: '38px', padding: '0 10px', borderRadius: '10px', flexShrink: 0, display: 'flex', alignItems: 'center',
                  gap: '5px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${rascunho.pronto ? 'rgba(16,185,129,0.6)' : 'var(--border-color)'}`,
                  backgroundColor: rascunho.pronto ? 'rgba(16,185,129,0.16)' : 'var(--bg-tertiary)',
                  color: rascunho.pronto ? '#10b981' : 'var(--text-secondary)',
                }}
              >
                {rascunho.pronto ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                Pronto
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

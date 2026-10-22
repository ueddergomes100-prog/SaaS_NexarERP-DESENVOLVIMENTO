import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { showError, showSuccess } from '../../utils/alerts';
import { confirmarSenhaDoUsuario, ehSenhaErrada } from '../../services/confirmacaoSenhaService';
import { listarLiberacoesPendentes, responderLiberacao, type LiberacaoRemota } from '../../services/liberacaoRemotaService';
import {
  INTERVALO_CONSULTA_APP_MS,
  NOME_DA_TELA_REMOTA,
  formatarReais,
  segundosRestantes,
  textoDoTempoRestante,
  type CredencialDoGerente,
} from '../../utils/liberacaoRemotaDomain';

/**
 * LIBERACOES (app Vendas, 21/10/2026): os pedidos de desconto acima do limite
 * que os vendedores mandaram ao gerente. Quem pode liberar aprova ou recusa
 * aqui, confirmando com a propria senha (login) ou o PIN (vendedor) -- decisao
 * do dono: mesmo nivel de seguranca da senha na estacao. A lista e' lida pela
 * API (a colecao e' so' do servidor) e atualiza a cada 10 s e ao voltar ao app.
 */
const VendedorLiberacoes: React.FC = () => {
  const { currentUser } = useAuth();
  const [lista, setLista] = useState<LiberacaoRemota[] | null>(null);
  const [erro, setErro] = useState('');
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  const [respondendo, setRespondendo] = useState<{ item: LiberacaoRemota; decisao: 'aprovar' | 'recusar' } | null>(null);
  const [senha, setSenha] = useState('');
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Login por e-mail confirma com a senha; login por codigo (vendedor) confirma com o PIN.
  const usaSenha = Boolean(currentUser?.email);

  const carregar = useCallback(async () => {
    try {
      setLista(await listarLiberacoesPendentes());
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler os pedidos. Confira a conexão.');
    }
  }, []);

  useEffect(() => {
    void carregar();
    const consulta = window.setInterval(() => { void carregar(); }, INTERVALO_CONSULTA_APP_MS);
    const relogio = window.setInterval(() => setAgoraMs(Date.now()), 1000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') void carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(consulta);
      window.clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [carregar]);

  const fecharResposta = () => { setRespondendo(null); setSenha(''); setMotivoRecusa(''); };

  const confirmar = async () => {
    if (!respondendo) return;
    if (!senha) {
      showError('Confirme quem você é', usaSenha ? 'Digite a sua senha para responder.' : 'Digite o seu PIN para responder.');
      return;
    }
    setEnviando(true);
    try {
      const credencial: CredencialDoGerente = usaSenha
        ? { tipo: 'login', idToken: (await confirmarSenhaDoUsuario(currentUser?.email || '', senha)).idToken }
        : { tipo: 'pin', pin: senha };
      const r = await responderLiberacao(respondendo.item.id, {
        decisao: respondendo.decisao,
        ...(respondendo.decisao === 'recusar' && motivoRecusa.trim() ? { motivoRecusa: motivoRecusa.trim() } : {}),
        credencial,
      });
      showSuccess(r.decisao === 'aprovar' ? 'Desconto liberado. A venda segue na loja.' : 'Desconto recusado. O vendedor foi avisado na tela.');
      fecharResposta();
      void carregar();
    } catch (e) {
      showError('Não foi possível responder', ehSenhaErrada(e) ? 'Senha incorreta.' : (e instanceof Error ? e.message : 'Tente de novo.'));
    } finally {
      setEnviando(false);
    }
  };

  const botao = (texto: string, cor: string, fundo: string, Icone: typeof Check, aoTocar: () => void) => (
    <button
      type="button"
      onClick={aoTocar}
      style={{ flex: 1, height: '44px', borderRadius: '12px', border: `1px solid ${cor}55`, backgroundColor: fundo, color: cor, fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer' }}
    >
      <Icone size={17} /> {texto}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo="Liberações"
        subtitulo="Descontos pedidos ao gerente"
        acao={(
          <button type="button" onClick={() => void carregar()} aria-label="Atualizar" className="app-topo__acao" style={{ width: '40px', height: '40px', borderRadius: '12px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <RefreshCw size={18} />
          </button>
        )}
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {erro && (
          <div style={{ borderRadius: '14px', padding: '12px 14px', backgroundColor: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: '13px' }}>{erro}</div>
        )}
        {lista === null && !erro && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '14px', padding: '20px 0', justifyContent: 'center' }}>
            <Loader2 size={18} className="spin-icon" /> Buscando pedidos...
          </div>
        )}
        {lista !== null && lista.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--text-muted)' }}>
            <ShieldCheck size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Nenhum pedido aguardando</div>
            <div style={{ fontSize: '13px', marginTop: '6px' }}>Quando um vendedor pedir desconto acima do limite, ele aparece aqui (e chega um aviso no celular, se os avisos estiverem ativos no Perfil).</div>
          </div>
        )}
        {(lista || []).map((item) => {
          const restam = segundosRestantes(item, agoraMs);
          return (
            <div key={item.id} style={{ borderRadius: '18px', padding: '16px', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                <strong style={{ fontSize: '16px', color: 'var(--text-primary)' }}>{item.solicitanteNome || 'Vendedor'}</strong>
                <span style={{ fontSize: '12px', fontWeight: 700, color: restam <= 60 ? '#ef4444' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {restam > 0 ? `vence em ${textoDoTempoRestante(restam)}` : 'venceu'}
                </span>
              </div>
              <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--brand-600)', lineHeight: 1.1 }}>
                {item.percentual.toLocaleString('pt-BR')}% <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>({formatarReais(item.descontoCentavos)} em {formatarReais(item.baseCentavos)})</span>
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                {NOME_DA_TELA_REMOTA[item.tela]}{item.documento ? ` · ${item.documento}` : ''}
              </div>
              {item.motivo && <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>{item.motivo}</div>}
              <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                {botao('Recusar', '#ef4444', 'rgba(239,68,68,0.10)', X, () => setRespondendo({ item, decisao: 'recusar' }))}
                {botao('Aprovar', '#10b981', 'rgba(16,185,129,0.14)', Check, () => setRespondendo({ item, decisao: 'aprovar' }))}
              </div>
            </div>
          );
        })}
      </div>

      {respondendo && (
        <div role="dialog" aria-modal="true" aria-label={respondendo.decisao === 'aprovar' ? 'Aprovar desconto' : 'Recusar desconto'} onClick={fecharResposta} style={{ position: 'fixed', inset: 0, zIndex: 2600, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '16px' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '440px', borderRadius: '18px', padding: '18px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', boxShadow: '0 18px 50px rgba(0,0,0,0.35)', marginBottom: 'max(8vh, 16px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <strong style={{ fontSize: '17px', color: 'var(--text-primary)' }}>
              {respondendo.decisao === 'aprovar' ? 'Aprovar o desconto?' : 'Recusar o desconto?'}
            </strong>
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{respondendo.item.texto}</div>
            {respondendo.decisao === 'recusar' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Motivo (opcional, o vendedor vê)
                <input value={motivoRecusa} onChange={(e) => setMotivoRecusa(e.target.value)} maxLength={200} style={{ height: '44px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '0 12px', fontSize: '15px' }} />
              </label>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {usaSenha ? 'Sua senha' : 'Seu PIN'}
              <input
                type="password"
                autoFocus
                inputMode={usaSenha ? undefined : 'numeric'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirmar(); } }}
                style={{ height: '48px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '0 12px', fontSize: '18px', letterSpacing: usaSenha ? undefined : '0.3em' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={fecharResposta} disabled={enviando} style={{ flex: 1, height: '46px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontWeight: 700, cursor: 'pointer' }}>Voltar</button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={enviando}
                style={{ flex: 1, height: '46px', borderRadius: '12px', border: 'none', color: '#fff', fontWeight: 700, cursor: enviando ? 'default' : 'pointer', opacity: enviando ? 0.7 : 1, background: respondendo.decisao === 'aprovar' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}
              >
                {enviando ? 'Enviando...' : respondendo.decisao === 'aprovar' ? 'Aprovar' : 'Recusar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorLiberacoes;

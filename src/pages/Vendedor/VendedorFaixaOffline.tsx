import React, { useCallback, useEffect, useState } from 'react';
import { CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, escaparHtml, showSuccess } from '../../utils/alerts';
import { ROTULO_PENDENCIA, resumoPendencias, textoDaFaixaOffline } from '../../utils/offlineDomain';
import { assinarFilaOffline, listarPendencias, removerPendencia, type PendenciaGuardada } from '../../utils/filaOffline';
import { sincronizarPendencias } from '../../services/sincronizacaoOfflineService';
import type { UsuarioDoCampo } from '../../services/osCampoService';

/*
 * FAIXA DE CONEXAO E PENDENCIAS (app do tecnico, fase 4 -- 2026-10-08).
 *
 * Aparece so' quando ha' algo a dizer: sem sinal, ou com pendencias
 * guardadas no aparelho, ou enviando. Sincroniza sozinha quando a rede
 * volta, ao abrir o app e a cada minuto enquanto houver pendencia; o botao
 * "Enviar agora" forca. Tocar na faixa lista as pendencias (e deixa apagar
 * uma travada, com confirmacao).
 */

export const useFilaOffline = (tenantId: string | null | undefined, usuario: UsuarioDoCampo | null) => {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [pendencias, setPendencias] = useState<PendenciaGuardada[]>([]);
  const [enviando, setEnviando] = useState(false);

  const recarregar = useCallback(async () => {
    if (!tenantId || !usuario) { setPendencias([]); return; }
    setPendencias(await listarPendencias(tenantId, usuario.id));
  }, [tenantId, usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sincronizar = useCallback(async () => {
    if (!tenantId || !usuario || !online) return;
    setEnviando(true);
    try {
      const r = await sincronizarPendencias({ tenantId, usuario });
      if (r.enviadas > 0) showSuccess(r.enviadas === 1 ? '1 pendência enviada.' : `${r.enviadas} pendências enviadas.`);
    } finally {
      setEnviando(false);
      await recarregar();
    }
  }, [tenantId, usuario?.id, online, recarregar]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ligou = () => setOnline(true);
    const caiu = () => setOnline(false);
    window.addEventListener('online', ligou);
    window.addEventListener('offline', caiu);
    return () => { window.removeEventListener('online', ligou); window.removeEventListener('offline', caiu); };
  }, []);

  useEffect(() => { void recarregar(); return assinarFilaOffline(() => { void recarregar(); }); }, [recarregar]);

  // Rede voltou / app abriu com pendencia: envia sozinho; depois tenta a cada minuto enquanto sobrar algo.
  useEffect(() => {
    if (!online || pendencias.length === 0) return;
    void sincronizar();
    const timer = window.setInterval(() => { void sincronizar(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [online, pendencias.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { online, pendencias, enviando, sincronizar, recarregar };
};

const VendedorFaixaOffline: React.FC = () => {
  const { tenantId, currentUser, userNome } = useAuth();
  const usuario: UsuarioDoCampo | null = currentUser ? { id: currentUser.uid, nome: userNome || currentUser.displayName || 'Técnico', email: currentUser.email || '' } : null;
  const { online, pendencias, enviando, sincronizar } = useFilaOffline(tenantId, usuario);
  const resumo = resumoPendencias(pendencias);
  const texto = textoDaFaixaOffline(online, resumo, enviando);
  if (!texto) return null;

  const listar = async () => {
    if (pendencias.length === 0) return;
    const linhas = pendencias.map((p) => `<li style="margin:4px 0;">${escaparHtml(ROTULO_PENDENCIA[p.tipo])}${p.tipo === 'foto' && p.legenda ? ` — ${escaparHtml(p.legenda)}` : ''}${p.ultimoErro ? `<br><small style="color:#fbbf24;">${escaparHtml(p.ultimoErro)} (${p.tentativas}ª tentativa)</small>` : ''}</li>`).join('');
    const travadas = pendencias.filter((p) => p.ultimoErro);
    const r = await NexusSwal.fire({
      title: resumo.texto,
      html: `<div style="text-align:left;font-size:14px;"><ul style="padding-left:18px;margin:0;">${linhas}</ul>${travadas.length ? '<p style="margin:10px 0 0;font-size:13px;color:#9ca3af;">Pendência com erro repetido pode ser descartada; o que já estava gravado na OS continua lá.</p>' : ''}</div>`,
      icon: 'info',
      showCancelButton: travadas.length > 0,
      confirmButtonText: 'Fechar',
      cancelButtonText: 'Descartar as com erro',
    });
    if (r.dismiss === 'cancel' && travadas.length > 0) {
      const confirma = await NexusSwal.fire({ title: 'Descartar pendências com erro?', text: `${travadas.length} item(ns) deixarão de ser enviados. Fotos e assinatura descartadas se perdem.`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Descartar', cancelButtonText: 'Manter' });
      if (confirma.isConfirmed) for (const p of travadas) await removerPendencia(p.id);
    }
  };

  return (
    <div
      role="status"
      onClick={() => void listar()}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', fontSize: '13px', fontWeight: 600,
        backgroundColor: online ? 'rgba(124,58,237,0.16)' : 'rgba(245,158,11,0.16)', color: online ? '#c4b5fd' : '#fbbf24',
        borderBottom: '1px solid var(--border-color)', cursor: pendencias.length > 0 ? 'pointer' : 'default',
      }}
    >
      {online ? <CloudUpload size={16} /> : <CloudOff size={16} />}
      <span style={{ flex: 1 }}>{texto}</span>
      {online && resumo.total > 0 && !enviando && (
        <button type="button" onClick={(e) => { e.stopPropagation(); void sincronizar(); }}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px', padding: '0 10px', borderRadius: '8px', border: '1px solid currentColor', backgroundColor: 'transparent', color: 'inherit', fontWeight: 700, fontSize: '12px' }}>
          <RefreshCw size={13} /> Enviar agora
        </button>
      )}
    </div>
  );
};

export default VendedorFaixaOffline;

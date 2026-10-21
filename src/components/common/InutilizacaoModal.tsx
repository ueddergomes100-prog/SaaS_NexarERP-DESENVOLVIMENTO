import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Loader2, RefreshCw, X } from 'lucide-react';
import { NexusSwal, escaparHtml } from '../../utils/alerts';
import {
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  ROTULO_DO_MODELO,
  ROTULO_STATUS_INUTILIZACAO,
  lerPedidoDeInutilizacao,
  normalizarMotivo,
  textoDaFaixa,
  type ModeloInutilizacao,
  type StatusInutilizacao,
} from '../../utils/inutilizacaoDomain';
import { consultarInutilizacao, listarInutilizacoes, pedirInutilizacao, type Inutilizacao } from '../../services/inutilizacaoService';

/**
 * Inutilizar numeracao de NF-e/NFC-e (21/10/2026): pede a SEFAZ (pela Spedy)
 * que uma faixa de numeros que pulou nao sera usada, e mostra as ja pedidas.
 * A regra e' de inutilizacaoDomain.ts; quem confere de verdade e manda e' o
 * servidor (services/inutilizacao.js).
 */

interface InutilizacaoModalProps {
  aberto: boolean;
  /** Serie configurada de cada modelo (Configuracao de Nota Fiscal); vazio = nao configurada. */
  seriePadrao: Record<ModeloInutilizacao, string>;
  onFechar: () => void;
}

const COR_DO_STATUS: Record<StatusInutilizacao, string> = {
  inProcessing: '#f59e0b',
  registered: '#10b981',
  rejected: '#ef4444',
  error: '#ef4444',
};

const campo: React.CSSProperties = {
  padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '14px', width: '100%',
};
const rotulo: React.CSSProperties = { fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' };

const InutilizacaoModal: React.FC<InutilizacaoModalProps> = ({ aberto, seriePadrao, onFechar }) => {
  const [modelo, setModelo] = useState<ModeloInutilizacao>('nfe');
  const [serie, setSerie] = useState('');
  const [inicial, setInicial] = useState('');
  const [final, setFinal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [lista, setLista] = useState<Inutilizacao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [consultando, setConsultando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setLista(await listarInutilizacoes());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setModelo('nfe');
    setSerie(seriePadrao.nfe);
    setInicial('');
    setFinal('');
    setMotivo('');
    setErro(null);
    void carregar();
  }, [aberto, seriePadrao.nfe, carregar]);

  useEffect(() => {
    if (!aberto || enviando) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, enviando, onFechar]);

  if (!aberto) return null;

  const trocarModelo = (novo: ModeloInutilizacao) => {
    setModelo(novo);
    setSerie(seriePadrao[novo]);
    setErro(null);
  };

  const enviar = async () => {
    const lido = lerPedidoDeInutilizacao({ modelo, serie, inicial, final: final || inicial, motivo });
    if ('erro' in lido) {
      setErro(lido.erro);
      return;
    }
    const p = lido.pedido;
    const confirmacao = await NexusSwal.fire({
      icon: 'warning',
      title: 'Inutilizar a numeração?',
      html: `<p style="text-align:left;margin:0 0 8px">${ROTULO_DO_MODELO[p.modelo]} série <strong>${p.serie}</strong>, <strong>${escaparHtml(textoDaFaixa(p.inicial, p.final))}</strong>.</p>`
        + '<p style="text-align:left;margin:0">A SEFAZ registra que esses números nunca serão usados. Não dá para desfazer.</p>',
      showCancelButton: true,
      confirmButtonText: 'Inutilizar',
      cancelButtonText: 'Voltar',
    });
    if (!confirmacao.isConfirmed) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await pedirInutilizacao({ modelo, serie, inicial, final: final || inicial, motivo });
      setLista((atual) => [r, ...atual.filter((i) => i.id !== r.id)]);
      setInicial('');
      setFinal('');
      setMotivo('');
      if (r.status === 'rejected' || r.status === 'error') {
        setErro(`A SEFAZ não aceitou: ${r.mensagemSefaz || 'motivo não informado'}${r.codigoSefaz ? ` (código ${r.codigoSefaz})` : ''}.`);
      }
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível pedir a inutilização. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  };

  const consultar = async (id: string) => {
    setConsultando(id);
    try {
      const r = await consultarInutilizacao(id);
      setLista((atual) => atual.map((i) => (i.id === id ? { ...i, ...r } : i)));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConsultando(null);
    }
  };

  const tamanhoMotivo = normalizarMotivo(motivo).length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1250, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inutilizacao-titulo"
        className="card"
        style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '680px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
      >
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h2 id="inutilizacao-titulo" style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>Inutilizar numeração</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Para número de NF-e ou NFC-e que pulou e nunca foi autorizado. Nota autorizada não se inutiliza: cancela-se.
            </p>
          </div>
          <button type="button" onClick={onFechar} disabled={enviando} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '18px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
            <div>
              <label htmlFor="inu-modelo" style={rotulo}>Documento</label>
              <select id="inu-modelo" value={modelo} onChange={(e) => trocarModelo(e.target.value as ModeloInutilizacao)} disabled={enviando} style={campo}>
                <option value="nfe">NF-e</option>
                <option value="nfce">NFC-e (cupom)</option>
              </select>
            </div>
            <div>
              <label htmlFor="inu-serie" style={rotulo}>Série</label>
              <input id="inu-serie" inputMode="numeric" value={serie} onChange={(e) => setSerie(e.target.value.replace(/\D/g, ''))} disabled={enviando} style={campo}
                title="A mesma série da Configuração de Nota Fiscal" />
            </div>
            <div>
              <label htmlFor="inu-inicial" style={rotulo}>Número inicial</label>
              <input id="inu-inicial" inputMode="numeric" value={inicial} onChange={(e) => setInicial(e.target.value.replace(/\D/g, ''))} disabled={enviando} style={campo} />
            </div>
            <div>
              <label htmlFor="inu-final" style={rotulo}>Número final</label>
              <input id="inu-final" inputMode="numeric" value={final} onChange={(e) => setFinal(e.target.value.replace(/\D/g, ''))} disabled={enviando} style={campo}
                title="Para um número só, deixe em branco ou repita o inicial" />
            </div>
          </div>
          <div>
            <label htmlFor="inu-motivo" style={rotulo}>Motivo (de {MOTIVO_MINIMO} a {MOTIVO_MAXIMO} caracteres)</label>
            <textarea id="inu-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={enviando}
              style={{ ...campo, resize: 'vertical' }} title='Ex.: "Quebra de sequência por falha antes do envio"' />
            <div style={{ fontSize: '12px', color: tamanhoMotivo > MOTIVO_MAXIMO ? '#ef4444' : 'var(--text-muted)', textAlign: 'right' }}>{tamanhoMotivo}/{MOTIVO_MAXIMO}</div>
          </div>

          {erro && (
            <div role="alert" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', color: 'var(--text-primary)', fontSize: '13px', lineHeight: 1.5 }}>
              {erro}
            </div>
          )}

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>Inutilizações pedidas</h3>
            {carregando ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Carregando...</p>
            ) : lista.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Nenhuma inutilização pedida ainda.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {lista.map((i) => (
                  <li key={i.id} style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                        {ROTULO_DO_MODELO[i.modelo] || i.modelo} série {i.serie} · {textoDaFaixa(i.inicial, i.final)}
                      </strong>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: COR_DO_STATUS[i.status] || 'var(--text-muted)' }}>{ROTULO_STATUS_INUTILIZACAO[i.status] || i.status}</span>
                        {i.status === 'inProcessing' && (
                          <button type="button" className="btn-secondary" onClick={() => consultar(i.id)} disabled={consultando !== null}
                            title="Consultar de novo na SEFAZ" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', fontSize: '12px' }}>
                            {consultando === i.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />} Atualizar
                          </button>
                        )}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {i.criadoEmMs ? `${new Date(i.criadoEmMs).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ` : ''}
                      {i.solicitadoPorNome ? `${i.solicitadoPorNome} · ` : ''}{i.motivo}
                      {i.protocolo ? ` · Protocolo ${i.protocolo}` : ''}
                      {(i.status === 'rejected' || i.status === 'error') && i.mensagemSefaz ? ` · ${i.mensagemSefaz}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-secondary" onClick={onFechar} disabled={enviando}>Fechar</button>
          <button type="button" className="btn-primary" onClick={enviar} disabled={enviando || !inicial} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {enviando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Ban size={16} />}
            {enviando ? 'Enviando...' : 'Inutilizar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InutilizacaoModal;

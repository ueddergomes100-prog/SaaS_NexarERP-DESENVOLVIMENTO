import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle, CloudOff, Images, Loader2, XCircle } from 'lucide-react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { podeUsarEntregasNoApp } from './vendedorPermissoes';
import { lerRomaneio } from '../../services/romaneioService';
import { anexarCanhoto, registrarEntregaNoApp } from '../../services/entregaCampoService';
import type { UsuarioDoCampo } from '../../services/osCampoService';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import {
  FORMAS_RECEBIDAS_NA_ENTREGA,
  MOTIVOS_NAO_ENTREGA_PADRAO,
  centavosDoTexto,
  diferencaDoRecebido,
  parseMotivosNaoEntrega,
  textoDaDiferenca,
  textoDosCentavos,
  type EntregaRomaneio,
  type StatusEntrega,
} from '../../utils/romaneioDomain';
import { canhotosPendentesDaRota } from '../../utils/offlineDomain';
import { assinarFilaOffline, listarPendencias, type PendenciaGuardada } from '../../utils/filaOffline';
import type { RotaDoApp } from './VendedorEntregas';

/*
 * REGISTRAR UMA ENTREGA NO APP (2026-10-08).
 *
 * Entregue (quem recebeu, documento) ou nao entregue (motivo da lista que a
 * loja configurou), quanto o motorista recebeu e como, e a foto do canhoto.
 * Valor recebido diferente do valor do pedido exige a explicacao para o
 * administrativo (romaneioDomain.ts, erroDoRegistroDeEntrega). Tudo
 * funciona sem sinal: o registro fica na fila do SDK e a foto na fila do
 * aparelho (entregaCampoService.ts).
 */

const formatarMoeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const cardStyle: React.CSSProperties = {
  padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
};

const rotulo: React.CSSProperties = { fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };

const campo: React.CSSProperties = {
  width: '100%', height: '46px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)',
  color: 'var(--text-primary)', padding: '0 14px', boxSizing: 'border-box', fontSize: '15px',
};

const VendedorEntregaRegistrar: React.FC = () => {
  const { id, pedidoId } = useParams();
  const navigate = useNavigate();
  const { tenantId, currentUser, userNome, userRole, isOwner, userPermissions } = useAuth();
  const pode = podeUsarEntregasNoApp(userRole, isOwner, userPermissions);
  const usuario: UsuarioDoCampo | null = currentUser
    ? { id: currentUser.uid, nome: userNome || currentUser.displayName || 'Motorista', email: currentUser.email || '' }
    : null;

  const [rota, setRota] = useState<RotaDoApp | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [motivos, setMotivos] = useState<string[]>(MOTIVOS_NAO_ENTREGA_PADRAO);
  const [pendencias, setPendencias] = useState<PendenciaGuardada[]>([]);

  const [preenchido, setPreenchido] = useState(false);
  const [status, setStatus] = useState<StatusEntrega>('entregue');
  const [recebedorNome, setRecebedorNome] = useState('');
  const [recebedorDocumento, setRecebedorDocumento] = useState('');
  const [motivo, setMotivo] = useState('');
  const [recebido, setRecebido] = useState('');
  const [recebidoForma, setRecebidoForma] = useState<string>('Dinheiro');
  const [observacao, setObservacao] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputCamera = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id || !tenantId || !pode) return;
    const parar = onSnapshot(doc(db, 'romaneios', id), (snap) => {
      const dados = snap.exists() ? snap.data() : null;
      if (!dados || dados.tenantId !== tenantId) {
        setErro('Rota não encontrada.');
        setCarregando(false);
        return;
      }
      setRota({ id: snap.id, ...lerRomaneio(dados) });
      setErro('');
      setCarregando(false);
    }, (e) => {
      console.error('Erro ao abrir a rota:', e);
      setErro('Não foi possível abrir a rota. Verifique a internet e tente de novo.');
      setCarregando(false);
    });
    return parar;
  }, [id, tenantId, pode]);

  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => { if (snap.exists()) setMotivos(parseMotivosNaoEntrega(snap.data().motivosNaoEntrega)); })
      .catch(() => { /* sem sinal e sem cache: fica a lista padrao */ });
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const carregar = () => { void listarPendencias(tenantId, currentUser.uid).then(setPendencias); };
    carregar();
    return assinarFilaOffline(carregar);
  }, [tenantId, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrega: EntregaRomaneio | undefined = rota?.entregas.find((e) => e.pedidoId === pedidoId);

  // Preenche o formulario UMA vez com o que ja' esta' registrado (Alterar).
  useEffect(() => {
    if (preenchido || !entrega) return;
    setStatus(entrega.status === 'pendente' ? 'entregue' : entrega.status);
    setRecebedorNome(entrega.recebedorNome);
    setRecebedorDocumento(entrega.recebedorDocumento);
    setMotivo(entrega.motivo);
    setRecebido(textoDosCentavos(entrega.recebidoCentavos));
    setRecebidoForma(entrega.recebidoForma || 'Dinheiro');
    setObservacao(entrega.observacao);
    setJustificativa(entrega.justificativaValor);
    setPreenchido(true);
  }, [entrega, preenchido]);

  if (!pode) return <Navigate to="/vendedor" replace />;

  const emRota = rota?.status === 'em_rota';
  const recebidoCentavos = status === 'pendente' ? 0 : centavosDoTexto(recebido);
  const diferenca = entrega && status !== 'pendente' ? diferencaDoRecebido({ recebidoCentavos, valorTotalCentavos: entrega.valorTotalCentavos }) : 0;
  const canhotoPendente = Boolean(pedidoId && canhotosPendentesDaRota(pendencias, id || '').has(pedidoId));

  const voltar = () => navigate(`/vendedor/entregas/${id}`, { replace: true });

  const salvar = async () => {
    if (!tenantId || !usuario || !id || !entrega) return;
    setSalvando(true);
    try {
      await registrarEntregaNoApp({
        tenantId,
        usuario,
        romaneioId: id,
        entrega,
        registro: { status, recebedorNome, recebedorDocumento, motivo, recebidoCentavos, recebidoForma, observacao, justificativaValor: justificativa },
      });
      showSuccess(status === 'entregue' ? 'Entrega registrada.' : status === 'nao_entregue' ? 'Tentativa registrada.' : 'Entrega voltou para "falta entregar".');
      voltar();
    } catch (e) {
      showError('Não foi possível registrar', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const enviarFoto = async (arquivos: FileList | null) => {
    const arquivo = arquivos?.[0];
    if (inputCamera.current) inputCamera.current.value = '';
    if (inputGaleria.current) inputGaleria.current.value = '';
    if (!arquivo || !tenantId || !usuario || !id || !pedidoId) return;
    setEnviandoFoto(true);
    try {
      const url = await anexarCanhoto({ tenantId, usuario, romaneioId: id, pedidoId, arquivo });
      if (url) showSuccess('Canhoto enviado.');
      else showWarning('Sem sinal', 'A foto ficou guardada no aparelho e sobe sozinha quando a rede voltar.');
    } catch (e) {
      showError('Não foi possível anexar o canhoto', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setEnviandoFoto(false);
    }
  };

  const opcao = (valor: StatusEntrega, texto: string, icone: React.ReactNode, cor: string) => (
    <button
      type="button"
      onClick={() => setStatus(valor)}
      style={{
        flex: 1, height: '52px', borderRadius: '12px', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        border: `2px solid ${status === valor ? cor : 'var(--border-color)'}`,
        backgroundColor: status === valor ? `${cor}22` : 'var(--bg-elevated)',
        color: status === valor ? cor : 'var(--text-primary)',
      }}
    >
      {icone} {texto}
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <VendedorHeader titulo={entrega?.status === 'pendente' || !entrega ? 'Registrar entrega' : 'Alterar entrega'} aoVoltar={voltar} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {carregando ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Carregando...</div>
        ) : erro || !rota || !entrega ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>{erro || 'Este pedido não está nesta rota.'}</div>
        ) : !emRota ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
            Esta rota foi encerrada pela loja. Não dá mais para registrar entrega nela.
          </div>
        ) : (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>{entrega.clienteNome}</div>
              {(entrega.endereco || entrega.cidade) && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{entrega.endereco}{entrega.endereco && entrega.cidade ? ' · ' : ''}{entrega.cidade}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Pedido #{entrega.numeroPedido}{entrega.notaNumero ? ` · NF ${entrega.notaNumero}` : ''}{entrega.formaPagamento ? ` · ${entrega.formaPagamento}` : ''}</span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>{formatarMoeda(entrega.valorTotalCentavos)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {opcao('entregue', 'Entregue', <CheckCircle size={18} />, '#22c55e')}
              {opcao('nao_entregue', 'Não entregue', <XCircle size={18} />, '#ef4444')}
            </div>
            {entrega.status !== 'pendente' && (
              <button type="button" onClick={() => setStatus('pendente')} style={{ background: 'none', border: 'none', color: status === 'pendente' ? 'var(--brand-400)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: 0 }}>
                <ArrowLeft size={14} /> Voltar para "falta entregar"
              </button>
            )}

            {status === 'entregue' && (
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={rotulo}>Quem recebeu *</span>
                  <input value={recebedorNome} onChange={(e) => setRecebedorNome(e.target.value.toUpperCase())} placeholder="Nome de quem recebeu" style={{ ...campo, textTransform: 'uppercase' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={rotulo}>Documento (RG/CPF)</span>
                  <input value={recebedorDocumento} onChange={(e) => setRecebedorDocumento(e.target.value)} placeholder="Opcional" inputMode="numeric" style={campo} />
                </label>
              </div>
            )}

            {status === 'nao_entregue' && (
              <label style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={rotulo}>Motivo *</span>
                <select value={motivo} onChange={(e) => setMotivo(e.target.value)} style={campo}>
                  <option value="">Escolha o motivo...</option>
                  {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
                  {motivo && !motivos.includes(motivo) && <option value={motivo}>{motivo}</option>}
                </select>
              </label>
            )}

            {status !== 'pendente' && (
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <span style={rotulo}>Recebeu (R$)</span>
                    <input inputMode="decimal" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder="0,00 se não recebeu" style={campo} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <span style={rotulo}>Como</span>
                    <select value={recebidoForma} onChange={(e) => setRecebidoForma(e.target.value)} style={campo}>
                      {FORMAS_RECEBIDAS_NA_ENTREGA.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                </div>
                {diferenca !== 0 && (
                  <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #f59e0b', backgroundColor: '#f59e0b1a', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b' }}>
                      Valor diferente do pedido: {textoDaDiferenca(diferenca)}
                    </div>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={rotulo}>Explique para o administrativo *</span>
                      <textarea
                        value={justificativa}
                        onChange={(e) => setJustificativa(e.target.value)}
                        rows={3}
                        placeholder="Pagamento parcial, abatimento de outra nota, troco..."
                        style={{ ...campo, height: 'auto', padding: '10px 14px', resize: 'vertical', fontSize: '14px' }}
                      />
                    </label>
                  </div>
                )}
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Só registro para o acerto. A baixa do título é feita pela loja.</div>
              </div>
            )}

            <label style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={rotulo}>Observação</span>
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" style={campo} />
            </label>

            <div style={cardStyle}>
              <div style={{ ...rotulo, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}><Camera size={14} /> Foto do canhoto (opcional)</div>
              {entrega.canhotoUrl ? (
                <a href={entrega.canhotoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginBottom: '10px' }}>
                  <img src={entrega.canhotoUrl} alt="Canhoto" style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', borderRadius: '10px', border: '1px solid var(--border-color)' }} />
                </a>
              ) : canhotoPendente ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '13px', color: 'var(--text-muted)' }}>
                  <CloudOff size={15} /> Foto guardada no aparelho — sobe sozinha quando a rede voltar.
                </div>
              ) : null}
              <input ref={inputCamera} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void enviarFoto(e.target.files)} />
              <input ref={inputGaleria} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void enviarFoto(e.target.files)} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn-secondary" disabled={enviandoFoto} onClick={() => inputCamera.current?.click()} style={{ flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  {enviandoFoto ? <Loader2 size={16} className="spin-icon" /> : <Camera size={16} />} {entrega.canhotoUrl || canhotoPendente ? 'Tirar outra' : 'Tirar foto'}
                </button>
                <button type="button" className="btn-secondary" disabled={enviandoFoto} onClick={() => inputGaleria.current?.click()} style={{ flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Images size={16} /> Da galeria
                </button>
              </div>
            </div>

            <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ height: '52px', fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {salvando ? <Loader2 size={18} className="spin-icon" /> : <CheckCircle size={18} />} Salvar registro
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VendedorEntregaRegistrar;

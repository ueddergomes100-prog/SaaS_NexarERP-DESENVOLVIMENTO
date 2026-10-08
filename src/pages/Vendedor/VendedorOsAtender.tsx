import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { Camera, CheckCircle2, ClipboardList, Images, PenLine, Plus, Printer, Save, Trash2, Truck, Wrench } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { useModoOficina } from '../../hooks/useModoOficina';
import { NexusSwal, escaparHtml, showError, showSuccess, showWarning } from '../../utils/alerts';
import { DEFAULT_MOMENTO_BAIXA_ESTOQUE, type MomentoBaixaEstoque } from '../../utils/estoqueReservaDomain';
import { DESLOCAMENTO_VAZIO, aplicarDeslocamentoNosServicos, kmDoDeslocamento, parseDeslocamento, valorDeslocamentoCentavos, type Deslocamento } from '../../utils/oficinaDomain';
import {
  LIMITE_FOTOS_OS,
  descricaoDoEquipamento,
  itemPickerParaPeca,
  osEncerrada,
  pecaParaItemPicker,
  podeAdicionarFotos,
  servicoDeCatalogo,
  totalDoAtendimentoCentavos,
  validarConclusaoAtendimento,
  type AssinaturaOS,
  type FotoOS,
  type PecaCampo,
  type ServicoCampo,
} from '../../utils/osCampoDomain';
import { adicionarFotoOs, concluirAtendimento, removerFotoOs, salvarAssinaturaOs, salvarAtendimento, salvarLegendasDasFotos, type UsuarioDoCampo } from '../../services/osCampoService';
import VendedorHeader from './VendedorHeader';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import VendedorAssinaturaModal from './VendedorAssinaturaModal';

/*
 * ATENDIMENTO DA OS NO CAMPO (app do tecnico, fase 3 -- 2026-10-08).
 *
 * O talao inteiro no celular: pecas (com a mesma busca de produto do app),
 * servicos do catalogo com horas, deslocamento em km (vira o servico
 * "Deslocamento -- N km" pelo preco da filial), horimetro, observacao do
 * servico, fotos e assinatura do cliente. "Salvar" grava o que esta' na
 * tela; "Concluir atendimento" grava e deixa a OS "Aguardando conferencia"
 * para a oficina finalizar no desktop. Fotos e assinatura sobem na hora.
 * Valores em R$ aparecem conforme Configuracoes (tecnicoVeValores).
 */

interface ServicoCatalogo { id: string; nome: string; preco?: number; ativo?: boolean; }

interface OsDoc {
  numeroOS: string;
  status: string;
  clienteNome: string;
  clienteTelefone: string;
  defeitoRelatado: string;
  equipamento: string;
  pecas: PecaCampo[];
  servicos: ServicoCampo[];
  deslocamento: Deslocamento;
  horimetro: string;
  relatorioTecnico: string;
  fotos: FotoOS[];
  assinaturaCliente: AssinaturaOS | null;
}

const cardStyle: React.CSSProperties = { padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' };
const tituloSecao: React.CSSProperties = { fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' };
const campo: React.CSSProperties = { width: '100%', height: '42px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', padding: '0 12px', boxSizing: 'border-box', fontSize: '15px' };
const rotulo: React.CSSProperties = { fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' };
const moeda = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VendedorOsAtender: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantId, currentUser, userNome, userPermissions, permiteVendaSemEstoque } = useAuth();
  const { modo, rotulos, configMaquinas } = useModoOficina();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: catalogoServicos } = useTenantCollection<ServicoCatalogo>('servicos', tenantId);

  const [os, setOs] = useState<OsDoc | null>(null);
  const [erro, setErro] = useState('');
  const [momentoBaixaEstoque, setMomentoBaixaEstoque] = useState<MomentoBaixaEstoque>(DEFAULT_MOMENTO_BAIXA_ESTOQUE);
  // Copia local do que o tecnico edita; fotos e assinatura vem direto do documento.
  const [pecas, setPecas] = useState<PecaCampo[]>([]);
  const [servicos, setServicos] = useState<ServicoCampo[]>([]);
  const [deslocamento, setDeslocamento] = useState<Deslocamento>(DESLOCAMENTO_VAZIO);
  const [horimetro, setHorimetro] = useState('');
  const [relatorio, setRelatorio] = useState('');
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [buscaServico, setBuscaServico] = useState('');
  const [enviandoFotos, setEnviandoFotos] = useState('');
  const [assinando, setAssinando] = useState(false);
  const carregouLocal = useRef(false);
  const inputCamera = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  const usuario: UsuarioDoCampo | null = currentUser
    ? { id: currentUser.uid, nome: userNome || currentUser.displayName || 'Técnico', email: currentUser.email || '' }
    : null;

  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => setMomentoBaixaEstoque(((snap.exists() ? snap.data().momentoBaixaEstoque : undefined) ?? DEFAULT_MOMENTO_BAIXA_ESTOQUE) as MomentoBaixaEstoque))
      .catch(() => undefined);
  }, [tenantId]);

  useEffect(() => {
    if (!id || !tenantId) return;
    const parar = onSnapshot(doc(db, 'ordens_de_servico', id), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (!d || d.tenantId !== tenantId) {
        setErro('Ordem de serviço não encontrada.');
        return;
      }
      const lida: OsDoc = {
        numeroOS: String(d.numeroOS || snap.id.slice(0, 6).toUpperCase()),
        status: String(d.status || ''),
        clienteNome: String(d.clienteNome || ''),
        clienteTelefone: String(d.clienteTelefone || ''),
        defeitoRelatado: String(d.defeitoRelatado || ''),
        equipamento: descricaoDoEquipamento(modo, d),
        pecas: Array.isArray(d.pecas) ? d.pecas : [],
        servicos: Array.isArray(d.servicos) ? d.servicos : [],
        deslocamento: parseDeslocamento(d.deslocamento),
        horimetro: d.horimetro ? String(d.horimetro) : '',
        relatorioTecnico: String(d.relatorioTecnico || ''),
        fotos: Array.isArray(d.fotos) ? d.fotos : [],
        assinaturaCliente: d.assinaturaCliente || null,
      };
      setOs(lida);
      // A copia local so' entra na primeira leitura: o que o tecnico esta' digitando nao pode ser atropelado pelo snapshot.
      if (!carregouLocal.current) {
        carregouLocal.current = true;
        setPecas(lida.pecas);
        setServicos(lida.servicos);
        setDeslocamento(lida.deslocamento);
        setHorimetro(lida.horimetro);
        setRelatorio(lida.relatorioTecnico);
      }
    }, () => setErro('Não foi possível abrir a ordem de serviço. Verifique a internet e tente de novo.'));
    return () => parar();
  }, [id, tenantId, modo]);

  const produtosAtivos = useMemo(() => produtos.filter((p) => p.ativo !== false), [produtos]);
  const servicosEncontrados = useMemo(() => {
    const termo = buscaServico.trim().toLowerCase();
    if (!termo) return [];
    return catalogoServicos.filter((s) => s.ativo !== false && s.nome.toLowerCase().includes(termo)).slice(0, 8);
  }, [buscaServico, catalogoServicos]);
  const totalCentavos = totalDoAtendimentoCentavos(pecas, servicos);
  const veValores = configMaquinas.tecnicoVeValores;

  if (!userPermissions.includes('mecanica.os')) return <Navigate to="/vendedor" replace />;
  if (erro) return <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>{erro}</div>;
  if (!os || !id || !tenantId || !usuario) return <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando…</div>;
  if (osEncerrada(os.status)) return <Navigate to={`/vendedor/os/${id}`} replace />;

  const marcar = () => setSujo(true);

  const atualizarDeslocamento = (parte: Partial<Deslocamento>) => {
    const novo = { ...deslocamento, ...parte };
    setDeslocamento(novo);
    setServicos((atual) => aplicarDeslocamentoNosServicos(atual, kmDoDeslocamento(novo), configMaquinas));
    marcar();
  };

  const adicionarServico = (s: ServicoCatalogo) => {
    if (servicos.some((x) => x.id === s.id)) {
      showWarning('Serviço já lançado', `"${s.nome}" já está na OS; ajuste as horas na linha dele.`);
    } else {
      setServicos((atual) => [...atual, servicoDeCatalogo(s, 1)]);
      marcar();
    }
    setBuscaServico('');
  };

  const salvar = async (silencioso = false): Promise<boolean> => {
    setSalvando(true);
    try {
      await salvarAtendimento({
        tenantId, usuario, osId: id, pecas, servicos, deslocamento, horimetro, relatorioTecnico: relatorio,
        momentoBaixaEstoque, permitirVendaSemEstoque: Boolean(permiteVendaSemEstoque),
      });
      setSujo(false);
      if (!silencioso) showSuccess('Atendimento salvo.');
      return true;
    } catch (e) {
      showError('Não foi possível salvar', e instanceof Error ? e.message : 'Tente de novo.');
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const concluir = async () => {
    const checagem = validarConclusaoAtendimento({
      status: os.status, relatorioTecnico: relatorio, temAssinatura: !!os.assinaturaCliente, exigirAssinatura: configMaquinas.exigirAssinatura, pecas, servicos,
    });
    if (!checagem.ok) {
      showError('Ainda não dá para concluir', checagem.erros.join(' '));
      return;
    }
    const confirmou = await NexusSwal.fire({
      title: 'Concluir o atendimento?',
      html: `<div style="text-align:left;font-size:14px;">A OS #${escaparHtml(os.numeroOS)} vai para <b>Aguardando conferência</b>: a oficina confere, lança o pagamento e finaliza. Depois disso o app não altera mais esta OS.`
        + (checagem.avisos.length ? `<p style="margin:10px 0 0;color:#fbbf24;">${checagem.avisos.map(escaparHtml).join('<br>')}</p>` : '') + '</div>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Concluir atendimento',
      cancelButtonText: 'Voltar',
    });
    if (!confirmou.isConfirmed) return;
    if (!(await salvar(true))) return;
    setSalvando(true);
    try {
      await concluirAtendimento({ tenantId, usuario, osId: id });
      showSuccess(`OS #${os.numeroOS} concluída no campo. A oficina finaliza no sistema.`);
      navigate('/vendedor/os', { replace: true });
    } catch (e) {
      showError('Não foi possível concluir', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const voltar = async () => {
    if (!sujo) { navigate(`/vendedor/os/${id}`); return; }
    const r = await NexusSwal.fire({
      title: 'Sair sem salvar?',
      text: 'Há alterações no atendimento que ainda não foram salvas.',
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Salvar e sair',
      denyButtonText: 'Sair sem salvar',
      cancelButtonText: 'Ficar',
    });
    if (r.isConfirmed) { if (await salvar(true)) navigate(`/vendedor/os/${id}`); }
    else if (r.isDenied) navigate(`/vendedor/os/${id}`);
  };

  const enviarFotos = async (arquivos: FileList | null) => {
    if (!arquivos || arquivos.length === 0) return;
    const lista = Array.from(arquivos);
    const cabe = podeAdicionarFotos(os.fotos, lista.length);
    if (!cabe.ok) { showError('Limite de fotos', cabe.erro); return; }
    let atuais = [...os.fotos];
    for (let i = 0; i < lista.length; i++) {
      setEnviandoFotos(`Enviando foto ${i + 1} de ${lista.length}…`);
      try {
        const foto = await adicionarFotoOs({ tenantId, usuario, osId: id, arquivo: lista[i], legenda: '', fotosAtuais: atuais, indice: atuais.length });
        atuais = [...atuais, foto];
      } catch (e) {
        showError('Foto não enviada', e instanceof Error ? e.message : 'Tente de novo.');
        break;
      }
    }
    setEnviandoFotos('');
    if (inputCamera.current) inputCamera.current.value = '';
    if (inputGaleria.current) inputGaleria.current.value = '';
  };

  const apagarFoto = async (foto: FotoOS) => {
    const r = await NexusSwal.fire({ title: 'Apagar esta foto?', text: 'Ela sai da OS e do arquivo da empresa.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Apagar', cancelButtonText: 'Manter' });
    if (!r.isConfirmed) return;
    try { await removerFotoOs({ usuario, osId: id, foto }); } catch (e) { showError('Não foi possível apagar', e instanceof Error ? e.message : 'Tente de novo.'); }
  };

  const salvarLegenda = async (indice: number, legenda: string) => {
    const novas = os.fotos.map((f, i) => (i === indice ? { ...f, legenda: legenda.trim() } : f));
    if (novas[indice].legenda === os.fotos[indice].legenda) return;
    try { await salvarLegendasDasFotos({ usuario, osId: id, fotos: novas }); } catch (e) { showError('Legenda não salva', e instanceof Error ? e.message : 'Tente de novo.'); }
  };

  const kmAtual = kmDoDeslocamento(deslocamento);
  const valorDeslocamento = valorDeslocamentoCentavos(kmAtual, configMaquinas);
  const cobraDeslocamento = configMaquinas.precoKmCentavos > 0 || configMaquinas.valorVisitaCentavos > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader
        titulo={`Atender OS #${os.numeroOS}`}
        aoVoltar={() => void voltar()}
        acao={(
          <button type="button" aria-label="Imprimir" onClick={() => navigate(`/vendedor/os/${id}/imprimir`)}
            style={{ width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
            <Printer size={18} />
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '16px' }}>{os.clienteNome}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{os.equipamento}</div>
              {os.clienteTelefone && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{os.clienteTelefone}</div>}
            </div>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', backgroundColor: 'rgba(14,165,233,0.16)', color: '#38bdf8', whiteSpace: 'nowrap' }}>{os.status}</span>
          </div>
          {os.defeitoRelatado && (
            <p style={{ margin: '10px 0 0', fontSize: '14px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}><b style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{rotulos.defeito}:</b> {os.defeitoRelatado}</p>
          )}
          {modo === 'maquinas_pesadas' && (
            <div style={{ marginTop: '12px', maxWidth: '200px' }}>
              <label style={rotulo}>Horímetro (h)</label>
              <input type="number" inputMode="decimal" step="0.1" min="0" value={horimetro} onChange={(e) => { setHorimetro(e.target.value); marcar(); }} style={campo} />
            </div>
          )}
        </section>

        <section style={cardStyle} className={veValores ? undefined : 'os-campo-sem-valores'}>
          <div style={tituloSecao}><Wrench size={15} /> Peças usadas</div>
          <VendedorItemPicker
            produtos={produtosAtivos}
            itens={pecas.map(pecaParaItemPicker)}
            onItensChange={(itens) => { setPecas(itens.map(itemPickerParaPeca)); marcar(); }}
            permitirVendaSemEstoque={Boolean(permiteVendaSemEstoque)}
            mostrarValores={veValores}
          />
        </section>

        <section style={cardStyle}>
          <div style={tituloSecao}><ClipboardList size={15} /> Serviços</div>
          {servicos.length === 0 && <p style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum serviço lançado.</p>}
          {servicos.map((s) => {
            const fixo = s.id === 'deslocamento';
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nome}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {fixo ? (s.detalhamento || 'Calculado pelos km') : (veValores ? `${moeda(Math.round(Number(s.preco || 0) * 100))}/h` : 'por hora')}
                  </div>
                </div>
                {!fixo && (
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    h
                    <input type="number" inputMode="decimal" min="0" step="0.5" value={s.tempoHoras}
                      onChange={(e) => { const h = Number(e.target.value) || 0; setServicos((atual) => atual.map((x) => (x.id === s.id ? { ...x, tempoHoras: h } : x))); marcar(); }}
                      style={{ ...campo, width: '70px', height: '38px', padding: '0 8px' }} />
                  </label>
                )}
                {veValores && <div style={{ fontWeight: 700, fontSize: '14px', minWidth: '84px', textAlign: 'right' }}>{moeda(Math.round(Number(s.preco || 0) * (fixo ? 1 : Number(s.tempoHoras || 0)) * 100))}</div>}
                {!fixo && (
                  <button type="button" aria-label="Remover serviço" onClick={() => { setServicos((atual) => atual.filter((x) => x.id !== s.id)); marcar(); }}
                    style={{ width: '36px', height: '36px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: '10px', position: 'relative' }}>
            <input type="search" value={buscaServico} onChange={(e) => setBuscaServico(e.target.value)} placeholder="Buscar serviço do catálogo para adicionar" style={campo} />
            {servicosEncontrados.length > 0 && (
              <div style={{ marginTop: '6px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                {servicosEncontrados.map((s) => (
                  <button key={s.id} type="button" onClick={() => adicionarServico(s)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', textAlign: 'left' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Plus size={14} /> {s.nome}</span>
                    {veValores && <span style={{ color: 'var(--text-muted)' }}>{moeda(Math.round(Number(s.preco || 0) * 100))}/h</span>}
                  </button>
                ))}
              </div>
            )}
            {buscaServico.trim() && servicosEncontrados.length === 0 && <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Nenhum serviço com esse nome no catálogo.</p>}
          </div>
        </section>

        {modo === 'maquinas_pesadas' && (
          <section style={cardStyle}>
            <div style={tituloSecao}><Truck size={15} /> Deslocamento</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div><label style={rotulo}>KM inicial</label><input type="number" inputMode="numeric" min="0" value={deslocamento.kmInicial ?? ''} onChange={(e) => atualizarDeslocamento({ kmInicial: e.target.value === '' ? null : Number(e.target.value) })} style={campo} /></div>
              <div><label style={rotulo}>KM final</label><input type="number" inputMode="numeric" min="0" value={deslocamento.kmFinal ?? ''} onChange={(e) => atualizarDeslocamento({ kmFinal: e.target.value === '' ? null : Number(e.target.value) })} style={campo} /></div>
              <div><label style={rotulo}>KM rodados</label><input type="number" inputMode="decimal" min="0" step="0.1" value={deslocamento.kmInicial !== null && deslocamento.kmFinal !== null ? kmAtual : (deslocamento.km || '')} disabled={deslocamento.kmInicial !== null && deslocamento.kmFinal !== null} onChange={(e) => atualizarDeslocamento({ km: Number(e.target.value) || 0 })} style={campo} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={rotulo}>Local</label><input type="text" value={deslocamento.local} onChange={(e) => atualizarDeslocamento({ local: e.target.value })} style={campo} /></div>
              <div><label style={rotulo}>Saída</label><input type="time" value={deslocamento.horaSaida} onChange={(e) => atualizarDeslocamento({ horaSaida: e.target.value })} style={campo} /></div>
              <div><label style={rotulo}>Chegada</label><input type="time" value={deslocamento.horaChegada} onChange={(e) => atualizarDeslocamento({ horaChegada: e.target.value })} style={campo} /></div>
              <div><label style={rotulo}>Veículo</label><input type="text" value={deslocamento.veiculoEmpresa} onChange={(e) => atualizarDeslocamento({ veiculoEmpresa: e.target.value })} placeholder="Placa ou nome" style={campo} /></div>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              {cobraDeslocamento
                ? (kmAtual > 0 ? `${kmAtual} km → serviço "Deslocamento" ${veValores ? `de ${moeda(valorDeslocamento)}` : 'lançado'} automaticamente.` : 'Informe os km e o deslocamento entra sozinho como serviço.')
                : 'A empresa não configurou preço por km: o deslocamento fica só registrado.'}
            </p>
          </section>
        )}

        <section style={cardStyle}>
          <div style={tituloSecao}><ClipboardList size={15} /> Serviço executado / observações</div>
          <textarea value={relatorio} onChange={(e) => { setRelatorio(e.target.value); marcar(); }} rows={4} placeholder="O que foi encontrado e o que foi feito no equipamento…" style={{ ...campo, height: 'auto', padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit' }} />
        </section>

        <section style={cardStyle}>
          <div style={{ ...tituloSecao, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Images size={15} /> Fotos ({os.fotos.length}/{LIMITE_FOTOS_OS})</span>
            {enviandoFotos && <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--brand-400)' }}>{enviandoFotos}</span>}
          </div>
          {os.fotos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
              {os.fotos.map((foto, i) => (
                <div key={foto.caminho} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ position: 'relative' }}>
                    <a href={foto.url} target="_blank" rel="noreferrer"><img src={foto.url} alt={foto.legenda || `Foto ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '10px', display: 'block' }} /></a>
                    <button type="button" aria-label="Apagar foto" onClick={() => void apagarFoto(foto)} style={{ position: 'absolute', top: '4px', right: '4px', width: '28px', height: '28px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(0,0,0,0.6)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={14} /></button>
                  </div>
                  <input type="text" defaultValue={foto.legenda} placeholder="Legenda" onBlur={(e) => void salvarLegenda(i, e.target.value)} style={{ ...campo, height: '32px', fontSize: '12px', padding: '0 8px' }} />
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input ref={inputCamera} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void enviarFotos(e.target.files)} />
            <input ref={inputGaleria} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => void enviarFotos(e.target.files)} />
            <button type="button" className="btn-secondary" disabled={!!enviandoFotos} onClick={() => inputCamera.current?.click()} style={{ flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><Camera size={17} /> Tirar foto</button>
            <button type="button" className="btn-secondary" disabled={!!enviandoFotos} onClick={() => inputGaleria.current?.click()} style={{ flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><Images size={17} /> Da galeria</button>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={tituloSecao}><PenLine size={15} /> Assinatura do cliente{configMaquinas.exigirAssinatura ? ' (obrigatória)' : ''}</div>
          {os.assinaturaCliente ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src={os.assinaturaCliente.url} alt="Assinatura do cliente" style={{ height: '64px', maxWidth: '55%', objectFit: 'contain', backgroundColor: '#f8fafc', borderRadius: '10px', padding: '4px' }} />
              <div style={{ flex: 1, fontSize: '12px', color: 'var(--text-muted)' }}>
                {os.assinaturaCliente.nomeAssinante || 'Cliente'}<br />{new Date(os.assinaturaCliente.em).toLocaleString('pt-BR')}
              </div>
              <button type="button" className="btn-secondary" onClick={() => setAssinando(true)} style={{ height: '40px' }}>Refazer</button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setAssinando(true)} style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><PenLine size={17} /> Colher assinatura na tela</button>
          )}
        </section>

        {veValores && (
          <section style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '0.06em' }}>Total do atendimento</span>
            <span style={{ fontWeight: 800, fontSize: '20px' }}>{moeda(totalCentavos)}</span>
          </section>
        )}
      </div>

      <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', display: 'flex', gap: '10px' }}>
        <button type="button" className="btn-secondary" onClick={() => void salvar()} disabled={salvando} style={{ flex: 1, height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}>
          <Save size={18} /> {salvando ? 'Salvando…' : sujo ? 'Salvar' : 'Salvo'}
        </button>
        <button type="button" className="btn-primary" onClick={() => void concluir()} disabled={salvando} style={{ flex: 1.4, height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}>
          <CheckCircle2 size={18} /> Concluir atendimento
        </button>
      </div>

      {assinando && (
        <VendedorAssinaturaModal
          nomeSugerido={os.assinaturaCliente?.nomeAssinante || os.clienteNome}
          onFechar={() => setAssinando(false)}
          onConfirmar={async (png, nomeAssinante) => {
            await salvarAssinaturaOs({ tenantId, usuario, osId: id, png, nomeAssinante });
            setAssinando(false);
            showSuccess('Assinatura guardada.');
          }}
        />
      )}
    </div>
  );
};

export default VendedorOsAtender;

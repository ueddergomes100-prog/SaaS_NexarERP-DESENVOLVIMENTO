import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle, ClipboardList, Loader2, Plus, Printer, Save,
  Send, Settings2, Trash2, Truck, X, XCircle,
} from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { hasTenantFullAccess } from '../../utils/roles';
import { erroDeAcessoNegado } from '../../utils/erroFirestoreDomain';
import { addDaysToDateInput, getDateInputInTimeZone } from '../../utils/dateTime';
import { rotuloDoVeiculo, type VeiculoDaFrota } from '../../utils/frotaDomain';
import {
  cancelarRomaneio,
  carregarPedidosParaRomaneio,
  fecharRomaneio,
  lerRomaneio,
  liberarRomaneio,
  registrarEntrega,
  salvarDadosEmRota,
  salvarRomaneioEmMontagem,
  type PedidoDisponivel,
  type RegistroDeEntrega,
} from '../../services/romaneioService';
import {
  erroParaCancelar,
  erroParaFechar,
  erroParaLiberar,
  FORMAS_RECEBIDAS_NA_ENTREGA,
  centavosDoTexto,
  diferencaDoRecebido,
  linhasDoAcerto,
  montarDocumentoRomaneio,
  moverEntrega,
  normalizarNomeCadastro,
  ordenarPorCidade,
  parseMotivosNaoEntrega,
  parseTiposAcerto,
  precisaJustificarValor,
  resumoDoRomaneio,
  ROTULO_NATUREZA_ACERTO,
  ROTULO_STATUS_ENTREGA,
  ROTULO_STATUS_ROMANEIO,
  textoDaDiferenca,
  textoDosCentavos,
  tituloDoRomaneio,
  type EntregaRomaneio,
  type NaturezaAcerto,
  type Romaneio,
  type StatusEntrega,
  type TipoAcerto,
} from '../../utils/romaneioDomain';

/**
 * UM ROMANEIO DE ENTREGA (2026-10-01). Ver romaneioDomain.ts para o fluxo
 * (montagem -> em rota -> fechado) e as decisoes do dono.
 *
 * Quem registra a entrega aqui e' a LOJA (motorista que voltou com o canhoto
 * assinado, ou ligou avisando). O app do motorista vai gravar nos mesmos
 * campos; por isso, com a rota na rua, a lista de entregas acompanha o banco
 * em tempo real, sem apagar o que a pessoa esta digitando no acerto.
 */

const moeda = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((centavos || 0) / 100);
const dataBr = (data: string) => (data ? data.slice(0, 10).split('-').reverse().join('/') : '');
const kmDoTexto = (texto: string): number | null => {
  const limpo = texto.replace(/\D/g, '');
  return limpo ? Number(limpo) : null;
};

const COR_ENTREGA: Record<StatusEntrega, string> = { pendente: '#f59e0b', entregue: '#10b981', nao_entregue: '#ef4444' };

const estiloCampo: React.CSSProperties = {
  padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
};
const estiloCartao: React.CSSProperties = {
  padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)',
};
const estiloRotulo: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };
const estiloFundoModal: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px',
};
const estiloModal = (largura: number): React.CSSProperties => ({
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
  width: '100%', maxWidth: `${largura}px`, maxHeight: '90vh', overflowY: 'auto', padding: '24px',
});

const romaneioVazio = (): Romaneio => ({
  numero: 0, nome: '', status: 'montagem', dataSaida: getDateInputInTimeZone(), horarioSaida: '07:00',
  motoristaId: '', motoristaNome: '', veiculoId: '', veiculoDescricao: '', veiculoPlaca: '',
  kmSaida: null, kmChegada: null, horarioChegada: '', observacao: '', entregas: [], acerto: [], observacaoAcerto: '',
});

/** Mensagem pra tela: as nossas ja' vem em portugues; erro cru do Firebase vira texto que diz o que fazer. */
const mensagemDoErro = (erro: unknown, padrao: string): string => {
  if (erroDeAcessoNegado(erro)) return 'Você não tem permissão para esta operação. Peça ao administrador a permissão "Romaneio de Entrega" (e, para lançar despesas, uma permissão do Financeiro).';
  if ((erro as { code?: string })?.code) return padrao;
  return (erro as Error)?.message || padrao;
};

interface MotoristaBasico { id: string; nome?: string; ativo?: boolean }

const RomaneioForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { currentUser, tenantId, userRole, isOwner, userNome } = useAuth();
  const podeConfigurar = hasTenantFullAccess(userRole, isOwner);
  const { items: motoristas } = useTenantCollection<MotoristaBasico>('motoristas', tenantId);
  const { items: frota } = useTenantCollection<VeiculoDaFrota & { id: string }>('frota', tenantId);

  const [romaneio, setRomaneio] = useState<Romaneio>(romaneioVazio);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [motivos, setMotivos] = useState<string[]>(parseMotivosNaoEntrega(null));
  const [tiposAcerto, setTiposAcerto] = useState<TipoAcerto[]>(parseTiposAcerto(null));
  const [configAberta, setConfigAberta] = useState(false);
  const [adicionarAberto, setAdicionarAberto] = useState(false);
  const [registrando, setRegistrando] = useState<EntregaRomaneio | null>(null);
  const [lancarDespesas, setLancarDespesas] = useState(true);
  const carregouRef = useRef(false);

  // Configuracao da empresa: motivos de nao entrega e linhas do acerto.
  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        const dados = snap.exists() ? snap.data() : {};
        setMotivos(parseMotivosNaoEntrega(dados.motivosNaoEntrega));
        setTiposAcerto(parseTiposAcerto(dados.tiposAcertoRomaneio));
      })
      .catch((erro) => console.error('Erro ao carregar a configuração do romaneio:', erro));
  }, [tenantId]);

  // Documento: a primeira leitura traz tudo; depois, so' as entregas e a
  // situacao acompanham o banco (o resto e' o que a pessoa esta editando).
  useEffect(() => {
    if (!id || !tenantId) return undefined;
    carregouRef.current = false;
    const parar = onSnapshot(doc(db, 'romaneios', id), (snap) => {
      if (!snap.exists() || snap.data().tenantId !== tenantId) {
        showError('Romaneio não encontrado', 'Este romaneio não existe ou é de outra empresa.');
        navigate('/operacoes/romaneios');
        return;
      }
      const lido = lerRomaneio(snap.data());
      if (!carregouRef.current) {
        carregouRef.current = true;
        setRomaneio(lido);
        setCarregando(false);
        return;
      }
      setRomaneio((atual) => (atual.status === 'montagem' && lido.status === 'montagem'
        ? atual
        : { ...atual, status: lido.status, numero: lido.numero, entregas: lido.entregas }));
    }, (erro) => {
      console.error('Erro ao abrir o romaneio:', erro);
      showError('Erro ao abrir', mensagemDoErro(erro, 'Não foi possível carregar este romaneio. Tente de novo.'));
      setCarregando(false);
    });
    return () => parar();
  }, [id, tenantId, navigate]);

  const resumo = useMemo(() => resumoDoRomaneio(romaneio), [romaneio]);
  const acertoNaTela = useMemo(() => linhasDoAcerto(tiposAcerto, romaneio.acerto), [tiposAcerto, romaneio.acerto]);
  const motoristasAtivos = motoristas.filter((m) => m.ativo !== false || m.id === romaneio.motoristaId);
  const veiculosAtivos = frota.filter((v) => v.ativo !== false || v.id === romaneio.veiculoId);
  const emMontagem = romaneio.status === 'montagem';
  const emRota = romaneio.status === 'em_rota';
  const encerrado = romaneio.status === 'fechado' || romaneio.status === 'cancelado';
  const titulo = id ? tituloDoRomaneio(romaneio.numero, romaneio.nome) : `Novo romaneio${romaneio.nome ? ` — ${romaneio.nome.toUpperCase()}` : ''}`;

  const mudar = (mudanca: Partial<Romaneio>) => setRomaneio((atual) => ({ ...atual, ...mudanca }));

  const escolherMotorista = (motoristaId: string) => {
    const m = motoristasAtivos.find((x) => x.id === motoristaId);
    // O veiculo que tem esse motorista como padrao ja' vem escolhido (pode trocar).
    const veiculoPadrao = !romaneio.veiculoId ? veiculosAtivos.find((v) => v.motoristaPadraoId === motoristaId) : undefined;
    mudar({
      motoristaId,
      motoristaNome: m?.nome || '',
      ...(veiculoPadrao ? { veiculoId: veiculoPadrao.id, veiculoDescricao: rotuloDoVeiculo(veiculoPadrao), veiculoPlaca: veiculoPadrao.placa } : {}),
    });
  };

  const escolherVeiculo = (veiculoId: string) => {
    const v = veiculosAtivos.find((x) => x.id === veiculoId);
    mudar({
      veiculoId,
      veiculoDescricao: v ? rotuloDoVeiculo(v) : '',
      veiculoPlaca: v?.placa || '',
      ...(v && romaneio.kmSaida === null && Number.isFinite(Number(v.kmAtual)) && Number(v.kmAtual) > 0 ? { kmSaida: Number(v.kmAtual) } : {}),
    });
  };

  const executar = async (rotulo: string, acao: () => Promise<void>, padraoErro: string) => {
    if (!tenantId || !currentUser) return;
    setOcupado(rotulo);
    try {
      await acao();
    } catch (erro) {
      console.error(`${rotulo}:`, erro);
      showError('Não foi possível concluir', mensagemDoErro(erro, padraoErro));
    } finally {
      setOcupado(null);
    }
  };

  /** Grava a montagem; na primeira vez, cria o romaneio (numero) e troca a tela pro endereco dele. */
  const salvarMontagem = async (): Promise<string | null> => {
    if (!tenantId || !currentUser) return null;
    const resultado = await salvarRomaneioEmMontagem({ tenantId, uid: currentUser.uid, id, romaneio });
    mudar({ numero: resultado.numero });
    if (!id) navigate(`/operacoes/romaneios/${resultado.id}`, { replace: true });
    return resultado.id;
  };

  const salvar = () => executar('Salvando', async () => {
    if (emMontagem) {
      await salvarMontagem();
      showSuccess('Romaneio salvo.');
    } else if (emRota && id) {
      await salvarDadosEmRota(tenantId!, currentUser!.uid, id, { ...romaneio, acerto: acertoNaTela });
      showSuccess('Dados da rota salvos.');
    }
  }, 'Não foi possível salvar o romaneio. Confira sua conexão e tente de novo.');

  const liberar = async () => {
    const erro = erroParaLiberar(romaneio);
    if (erro) { showError('Ainda não dá para liberar', erro); return; }
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: 'Liberar a rota para entrega?',
      html: `${resumo.totalEntregas} pedido(s), ${moeda(resumo.valorTotalCentavos)}, motorista <strong>${romaneio.motoristaNome}</strong>.<br/><br/>Depois de liberada, a lista de pedidos não muda mais: só se registram as entregas.`,
      showCancelButton: true,
      confirmButtonText: 'Liberar',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;
    await executar('Liberando', async () => {
      const idSalvo = await salvarMontagem();
      if (idSalvo) await liberarRomaneio(tenantId!, currentUser!.uid, idSalvo);
      showSuccess('Rota liberada. Boa viagem!');
    }, 'Não foi possível liberar a rota. Tente de novo.');
  };

  const fechar = async () => {
    const paraFechar = { ...romaneio, acerto: acertoNaTela };
    const erro = erroParaFechar(paraFechar);
    if (erro) { showError('Ainda não dá para fechar o acerto', erro); return; }
    const resumoFinal = resumoDoRomaneio(paraFechar);
    const despesas = acertoNaTela.filter((l) => l.natureza === 'despesa' && l.valorCentavos > 0).length;
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: 'Fechar o acerto desta rota?',
      html: [
        `Entregues: <strong>${resumoFinal.entregues}</strong> · Não entregues: <strong>${resumoFinal.naoEntregues}</strong> (voltam a ficar livres para outra rota).`,
        `Saldo a prestar pelo motorista: <strong>${moeda(resumoFinal.saldoAPrestarCentavos)}</strong>.`,
        ...(resumoFinal.comDiferenca > 0 ? [`<strong>${resumoFinal.comDiferenca}</strong> entrega(s) com valor recebido diferente do pedido — confira a justificativa de cada uma antes de fechar.`] : []),
        lancarDespesas && despesas > 0 ? `${despesas} despesa(s) serão lançadas como pagas em "DESPESAS DE ROTA".` : 'Nenhuma despesa será lançada no financeiro.',
        'A baixa dos títulos dos clientes continua em Contas a Receber.',
      ].join('<br/><br/>'),
      showCancelButton: true,
      confirmButtonText: 'Fechar acerto',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed || !id) return;
    await executar('Fechando', async () => {
      const r = await fecharRomaneio({ tenantId: tenantId!, uid: currentUser!.uid, id, romaneio: paraFechar, lancarDespesas });
      setRomaneio((atual) => ({ ...atual, status: 'fechado', acerto: paraFechar.acerto.filter((l) => l.valorCentavos > 0) }));
      showSuccess(r.despesasLancadas > 0 ? `Acerto fechado. ${r.despesasLancadas} despesa(s) lançada(s) no financeiro.` : 'Acerto fechado.');
    }, 'Não foi possível fechar o acerto. Tente de novo.');
  };

  const cancelar = async () => {
    const erro = erroParaCancelar(romaneio);
    if (erro) { showError('Não dá para cancelar', erro); return; }
    if (!id) { navigate('/operacoes/romaneios'); return; }
    const confirma = await NexusSwal.fire({
      icon: 'warning',
      title: 'Cancelar este romaneio?',
      text: 'Os pedidos voltam a ficar livres para outra rota. O romaneio continua na lista, como cancelado.',
      showCancelButton: true,
      confirmButtonText: 'Cancelar romaneio',
      cancelButtonText: 'Voltar',
    });
    if (!confirma.isConfirmed) return;
    await executar('Cancelando', async () => {
      await cancelarRomaneio(tenantId!, currentUser!.uid, id);
      setRomaneio((atual) => ({ ...atual, status: 'cancelado' }));
      showSuccess('Romaneio cancelado.');
    }, 'Não foi possível cancelar. Tente de novo.');
  };

  const tirarPedido = (pedidoId: string) => mudar({ entregas: romaneio.entregas.filter((e) => e.pedidoId !== pedidoId) });

  const mudarAcerto = (tipo: string, campo: 'valorCentavos' | 'descricao', valor: number | string) => {
    const linhas = acertoNaTela.map((l) => (l.tipo === tipo ? { ...l, [campo]: valor } : l));
    mudar({ acerto: linhas });
  };

  if (carregando) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando romaneio...</div>;

  if (imprimindo) {
    return (
      <RelatorioPreview
        relatorioId="romaneio-entrega"
        documento={montarDocumentoRomaneio({ ...romaneio, acerto: emMontagem ? romaneio.acerto : acertoNaTela.filter((l) => l.valorCentavos > 0) })}
        nomeArquivo={`${tituloDoRomaneio(romaneio.numero, romaneio.nome)} ${dataBr(romaneio.dataSaida).replace(/\//g, '-')}.pdf`}
        onFechar={() => setImprimindo(false)}
        rotuloFechar="Voltar ao romaneio"
      />
    );
  }

  const botao = (rotulo: string, icone: React.ReactNode, acao: () => void, primario = false, cor?: string) => (
    <button
      type="button"
      className={primario ? 'btn-primary' : 'btn-secondary'}
      onClick={acao}
      disabled={Boolean(ocupado)}
      style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: ocupado ? 0.6 : 1, ...(cor ? { color: cor } : {}) }}
    >
      {ocupado === rotulo ? <Loader2 size={17} className="spin-icon" /> : icone} {rotulo}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" onClick={() => navigate('/operacoes/romaneios')} title="Voltar" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <ClipboardList size={26} color="var(--accent-purple)" />
              {titulo}
              <span style={{ fontSize: '13px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                {ROTULO_STATUS_ROMANEIO[romaneio.status]}
              </span>
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              {emMontagem && 'Escolha o motorista e os pedidos faturados, ponha na ordem de entrega e libere a rota.'}
              {emRota && 'Rota na rua: registre cada entrega e, na volta, preencha o retorno e feche o acerto.'}
              {romaneio.status === 'fechado' && 'Acerto fechado. Os pedidos não entregues voltaram a ficar livres para outra rota.'}
              {romaneio.status === 'cancelado' && 'Romaneio cancelado. Os pedidos voltaram a ficar livres.'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {podeConfigurar && !encerrado && botao('Configurar', <Settings2 size={17} />, () => setConfigAberta(true))}
          {botao('Imprimir', <Printer size={17} />, () => setImprimindo(true))}
          {!encerrado && (romaneio.entregas.every((e) => e.status === 'pendente')) && id && botao('Cancelar', <Trash2 size={17} />, () => void cancelar(), false, '#ef4444')}
          {!encerrado && botao('Salvar', <Save size={17} />, () => void salvar())}
          {emMontagem && botao('Liberar para entrega', <Send size={17} />, () => void liberar(), true)}
          {emRota && botao('Fechar acerto', <CheckCircle size={17} />, () => void fechar(), true)}
        </div>
      </div>

      {/* Dados da rota */}
      <fieldset disabled={encerrado || Boolean(ocupado)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="card" style={{ ...estiloCartao, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Nome da rota</span>
            <input value={romaneio.nome} maxLength={40} onChange={(e) => mudar({ nome: e.target.value.toUpperCase() })} style={{ ...estiloCampo, textTransform: 'uppercase' }} />
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>O número ({romaneio.numero ? String(romaneio.numero).padStart(2, '0') : 'automático'}) vem antes: "{tituloDoRomaneio(romaneio.numero || 1, romaneio.nome)}".</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Motorista *</span>
            <select value={romaneio.motoristaId} onChange={(e) => escolherMotorista(e.target.value)} style={estiloCampo} disabled={!emMontagem}>
              <option value="">Escolha o motorista...</option>
              {motoristasAtivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            {motoristasAtivos.length === 0 && <span style={{ fontSize: '11.5px', color: '#f59e0b' }}>Nenhum motorista cadastrado. Cadastre em Operações › Motoristas.</span>}
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Veículo</span>
            <select value={romaneio.veiculoId} onChange={(e) => escolherVeiculo(e.target.value)} style={estiloCampo}>
              <option value="">Sem veículo da frota</option>
              {veiculosAtivos.map((v) => <option key={v.id} value={v.id}>{rotuloDoVeiculo(v)}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Data de saída *</span>
            <input type="date" value={romaneio.dataSaida} onChange={(e) => mudar({ dataSaida: e.target.value })} style={estiloCampo} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>Horário de saída</span>
            <input type="time" value={romaneio.horarioSaida} onChange={(e) => mudar({ horarioSaida: e.target.value })} style={estiloCampo} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={estiloRotulo}>KM de saída</span>
            <input inputMode="numeric" value={romaneio.kmSaida ?? ''} onChange={(e) => mudar({ kmSaida: kmDoTexto(e.target.value) })} placeholder="Em branco = preencher à mão" style={estiloCampo} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
            <span style={estiloRotulo}>Observação</span>
            <input value={romaneio.observacao} onChange={(e) => mudar({ observacao: e.target.value })} placeholder="Opcional — sai impressa no romaneio" style={estiloCampo} />
          </label>
        </div>
      </fieldset>

      {/* Pedidos da rota */}
      <div className="card" style={estiloCartao}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Pedidos da rota ({resumo.totalEntregas})</h3>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Total {moeda(resumo.valorTotalCentavos)}
              {!emMontagem && <> · Entregues {resumo.entregues} · Não entregues {resumo.naoEntregues} · Faltam {resumo.pendentes}</>}
            </div>
          </div>
          {emMontagem && (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {romaneio.entregas.length > 1 && botao('Ordenar por cidade', <ArrowDown size={16} />, () => mudar({ entregas: ordenarPorCidade(romaneio.entregas) }))}
              {botao('Adicionar pedidos', <Plus size={16} />, () => setAdicionarAberto(true), true)}
            </div>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 8px' }}>#</th>
                <th style={{ padding: '10px 8px' }}>N/F</th>
                <th style={{ padding: '10px 8px' }}>Pedido</th>
                <th style={{ padding: '10px 8px' }}>Cliente</th>
                <th style={{ padding: '10px 8px' }}>Cidade</th>
                <th style={{ padding: '10px 8px' }}>Vendedor</th>
                <th style={{ padding: '10px 8px' }}>Pagamento</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Total</th>
                {!emMontagem && <th style={{ padding: '10px 8px' }}>Entrega</th>}
                <th style={{ padding: '10px 8px', textAlign: 'center' }} />
              </tr>
            </thead>
            <tbody>
              {romaneio.entregas.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <Truck size={40} style={{ margin: '0 auto 12px', opacity: 0.25 }} />
                    <div>Nenhum pedido nesta rota. Clique em "Adicionar pedidos" para escolher entre os faturados.</div>
                  </td>
                </tr>
              ) : romaneio.entregas.map((e, i) => (
                <tr key={e.pedidoId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td style={{ padding: '8px' }}>{e.notaNumero || <span style={{ color: 'var(--text-muted)' }}>S/N</span>}</td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{e.numeroPedido}</td>
                  <td style={{ padding: '8px' }}>
                    <div style={{ fontWeight: 600 }}>{e.clienteCodigo ? `${e.clienteCodigo} · ` : ''}{e.clienteNome}</div>
                    {e.endereco && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{e.endereco}</div>}
                  </td>
                  <td style={{ padding: '8px' }}>{e.cidade || '—'}</td>
                  <td style={{ padding: '8px', fontSize: '13px' }}>{e.vendedorNome || '—'}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{e.formaPagamento || '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{moeda(e.valorTotalCentavos)}</td>
                  {!emMontagem && (
                    <td style={{ padding: '8px', fontSize: '13px' }}>
                      <span style={{ fontWeight: 700, color: COR_ENTREGA[e.status] }}>{ROTULO_STATUS_ENTREGA[e.status]}</span>
                      {e.status === 'entregue' && <div style={{ color: 'var(--text-muted)' }}>{e.recebedorNome}{e.registradoEm ? ` · ${new Date(e.registradoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</div>}
                      {e.status === 'nao_entregue' && <div style={{ color: 'var(--text-muted)' }}>{e.motivo}</div>}
                      {e.recebidoCentavos > 0 && <div style={{ color: 'var(--text-muted)' }}>Recebeu {moeda(e.recebidoCentavos)} ({e.recebidoForma})</div>}
                      {precisaJustificarValor(e) && (
                        <div style={{ color: '#f59e0b', fontWeight: 600 }} title="Valor recebido diferente do valor do pedido">
                          Diferença {textoDaDiferenca(diferencaDoRecebido(e))}: <span style={{ fontWeight: 400 }}>{e.justificativaValor}</span>
                        </div>
                      )}
                      {(e.registradoVia === 'app' || e.canhotoUrl) && (
                        <div style={{ color: 'var(--text-muted)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {e.registradoVia === 'app' && <span>Pelo app do motorista</span>}
                          {e.canhotoUrl && <a href={e.canhotoUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>Ver canhoto</a>}
                        </div>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '8px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                    {emMontagem && (
                      <>
                        <button type="button" className="icon-btn" title="Subir" disabled={i === 0} onClick={() => mudar({ entregas: moverEntrega(romaneio.entregas, i, -1) })}><ArrowUp size={16} /></button>
                        <button type="button" className="icon-btn" title="Descer" disabled={i === romaneio.entregas.length - 1} onClick={() => mudar({ entregas: moverEntrega(romaneio.entregas, i, 1) })}><ArrowDown size={16} /></button>
                        <button type="button" className="icon-btn" title="Tirar da rota" onClick={() => tirarPedido(e.pedidoId)} style={{ color: '#ef4444' }}><X size={16} /></button>
                      </>
                    )}
                    {emRota && (
                      <button type="button" className="btn-secondary" onClick={() => setRegistrando(e)} style={{ padding: '6px 10px', fontSize: '12.5px' }}>
                        {e.status === 'pendente' ? 'Registrar' : 'Alterar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Retorno e acerto */}
      {!emMontagem && (
        <fieldset disabled={encerrado || Boolean(ocupado)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="card" style={estiloCartao}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>Retorno e acerto</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={estiloRotulo}>KM de chegada</span>
                <input inputMode="numeric" value={romaneio.kmChegada ?? ''} onChange={(e) => mudar({ kmChegada: kmDoTexto(e.target.value) })} style={estiloCampo} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={estiloRotulo}>Horário de chegada</span>
                <input type="time" value={romaneio.horarioChegada} onChange={(e) => mudar({ horarioChegada: e.target.value })} style={estiloCampo} />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={estiloRotulo}>KM rodados</span>
                <strong style={{ fontSize: '20px', paddingTop: '6px' }}>{resumo.kmRodados === null ? '—' : new Intl.NumberFormat('pt-BR').format(resumo.kmRodados)}</strong>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 8px' }}>Item</th>
                    <th style={{ padding: '10px 8px' }}>Tipo</th>
                    <th style={{ padding: '10px 8px' }}>Observação</th>
                    <th style={{ padding: '10px 8px', textAlign: 'right', width: '150px' }}>Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {acertoNaTela.map((l) => (
                    <tr key={l.tipo} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{l.tipo}</td>
                      <td style={{ padding: '8px', fontSize: '12.5px', color: 'var(--text-muted)' }}>{ROTULO_NATUREZA_ACERTO[l.natureza]}</td>
                      <td style={{ padding: '8px' }}>
                        <input value={l.descricao} onChange={(e) => mudarAcerto(l.tipo, 'descricao', e.target.value)} placeholder="Opcional" style={{ ...estiloCampo, padding: '8px 10px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          inputMode="decimal"
                          defaultValue={textoDosCentavos(l.valorCentavos)}
                          key={`${l.tipo}-${l.valorCentavos}`}
                          onBlur={(e) => mudarAcerto(l.tipo, 'valorCentavos', centavosDoTexto(e.target.value))}
                          style={{ ...estiloCampo, padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recebido nas entregas</div>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>{moeda(resumo.recebidoCentavos)}</div>
                {resumo.recebidoPorForma.map((f) => <div key={f.forma} style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>{f.forma}: {moeda(f.centavos)}</div>)}
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Vale / adiantamento</div>
                <div style={{ fontSize: '18px', fontWeight: 700 }}>{moeda(resumoDoRomaneio({ ...romaneio, acerto: acertoNaTela }).adiantamentoCentavos)}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Despesas do motorista</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#ef4444' }}>{moeda(resumoDoRomaneio({ ...romaneio, acerto: acertoNaTela }).despesasCentavos)}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Saldo a prestar</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent-purple)' }}>{moeda(resumoDoRomaneio({ ...romaneio, acerto: acertoNaTela }).saldoAPrestarCentavos)}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>recebido + vale − despesas</div>
              </div>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '16px' }}>
              <span style={estiloRotulo}>Observação do acerto</span>
              <input value={romaneio.observacaoAcerto} onChange={(e) => mudar({ observacaoAcerto: e.target.value })} placeholder="Opcional — ex.: pendência do cliente X, cheque a compensar" style={estiloCampo} />
            </label>

            {emRota && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '16px', fontSize: '13.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={lancarDespesas} onChange={(e) => setLancarDespesas(e.target.checked)} style={{ marginTop: '3px' }} />
                <span>
                  Ao fechar, lançar as despesas do motorista no financeiro, já como pagas, em "DESPESAS DE ROTA" (aparecem em Rotas e Despesas e no Custo por Veículo).
                  A baixa dos títulos dos clientes continua em Contas a Receber.
                </span>
              </label>
            )}
            {emRota && resumo.pendentes > 0 && (
              <div style={{ marginTop: '16px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '13px', display: 'flex', gap: '10px' }}>
                <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div>Para fechar o acerto, registre o que aconteceu com as {resumo.pendentes} entrega(s) que ainda aparecem como "Falta entregar".</div>
              </div>
            )}
          </div>
        </fieldset>
      )}

      {adicionarAberto && tenantId && (
        <AdicionarPedidosModal
          tenantId={tenantId}
          romaneioId={id}
          jaNaRota={romaneio.entregas.map((e) => e.pedidoId)}
          onFechar={() => setAdicionarAberto(false)}
          onAdicionar={(novos) => { mudar({ entregas: [...romaneio.entregas, ...novos] }); setAdicionarAberto(false); }}
        />
      )}

      {registrando && id && tenantId && currentUser && (
        <RegistrarEntregaModal
          entrega={registrando}
          motivos={motivos}
          onFechar={() => setRegistrando(null)}
          onSalvar={async (registro) => {
            try {
              await registrarEntrega({ tenantId, uid: currentUser.uid, nomeUsuario: userNome || currentUser.email || '', id, pedidoId: registrando.pedidoId, registro });
              setRegistrando(null);
            } catch (erro) {
              console.error('Erro ao registrar a entrega:', erro);
              showError('Não foi possível registrar', mensagemDoErro(erro, 'Não foi possível registrar esta entrega. Tente de novo.'));
            }
          }}
        />
      )}

      {configAberta && tenantId && (
        <ConfiguracaoRomaneioModal
          tenantId={tenantId}
          motivos={motivos}
          tipos={tiposAcerto}
          onFechar={() => setConfigAberta(false)}
          onSalvo={(m, t) => { setMotivos(m); setTiposAcerto(t); setConfigAberta(false); }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ADICIONAR PEDIDOS
// ---------------------------------------------------------------------------

const AdicionarPedidosModal: React.FC<{
  tenantId: string;
  romaneioId?: string;
  jaNaRota: string[];
  onFechar: () => void;
  onAdicionar: (entregas: EntregaRomaneio[]) => void;
}> = ({ tenantId, romaneioId, jaNaRota, onFechar, onAdicionar }) => {
  const hoje = getDateInputInTimeZone();
  const [de, setDe] = useState(addDaysToDateInput(hoje, -1));
  const [ate, setAte] = useState(hoje);
  const [lista, setLista] = useState<PedidoDisponivel[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');
  const [comNota, setComNota] = useState<'todos' | 'com' | 'sem'>('todos');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const buscar = async () => {
    if (!de || !ate || de > ate) { showError('Período inválido', 'Informe a data inicial e a final, com a inicial antes da final.'); return; }
    setBuscando(true);
    try {
      const pedidos = await carregarPedidosParaRomaneio(tenantId, de, ate, romaneioId);
      setLista(pedidos.filter((p) => !jaNaRota.includes(p.pedidoId)));
      setMarcados(new Set());
    } catch (erro) {
      console.error('Erro ao buscar pedidos para o romaneio:', erro);
      showError('Não foi possível buscar os pedidos', mensagemDoErro(erro, 'Confira sua conexão e tente de novo.'));
    } finally {
      setBuscando(false);
    }
  };

  // Abre ja' buscando os faturados de ontem e hoje -- o caso de todo dia.
  useEffect(() => { void buscar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const termo = busca.trim().toLowerCase();
  const visiveis = (lista || []).filter((p) => (
    (comNota === 'todos' || (comNota === 'com' ? Boolean(p.notaNumero) : !p.notaNumero))
    && (!termo || p.numeroPedido.includes(termo) || p.notaNumero.includes(termo) || p.clienteNome.toLowerCase().includes(termo)
      || p.cidade.toLowerCase().includes(termo) || p.vendedorNome.toLowerCase().includes(termo))
  ));
  const livres = visiveis.filter((p) => !p.emOutraRota);
  const todosMarcados = livres.length > 0 && livres.every((p) => marcados.has(p.pedidoId));

  const alternar = (pedidoId: string) => setMarcados((atual) => {
    const novo = new Set(atual);
    if (novo.has(pedidoId)) novo.delete(pedidoId); else novo.add(pedidoId);
    return novo;
  });

  return (
    <div style={estiloFundoModal} onClick={onFechar}>
      <div style={estiloModal(980)} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Adicionar pedidos à rota">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <h3 style={{ margin: 0, fontSize: '17px' }}>Adicionar pedidos faturados</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Só aparecem vendas faturadas (com e sem nota), pela data da venda. Pré-venda e pedido cancelado não entram. Pedido que já está em outra rota aparece apagado.
        </p>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '12px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={estiloRotulo}>Faturados de</span>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ ...estiloCampo, width: 'auto' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={estiloRotulo}>até</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ ...estiloCampo, width: 'auto' }} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => void buscar()} disabled={buscando} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {buscando && <Loader2 size={16} className="spin-icon" />} Buscar
          </button>
          <select value={comNota} onChange={(e) => setComNota(e.target.value as typeof comNota)} style={{ ...estiloCampo, width: 'auto' }} aria-label="Com ou sem nota">
            <option value="todos">Com e sem nota</option>
            <option value="com">Só com nota</option>
            <option value="sem">Só sem nota</option>
          </select>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pedido, nota, cliente, cidade, vendedor..." style={{ ...estiloCampo, flex: 1, minWidth: '200px' }} />
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-tertiary)' }}>
              <tr style={{ color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 8px', width: '36px' }}>
                  <input type="checkbox" aria-label="Marcar todos" checked={todosMarcados} onChange={(e) => setMarcados(e.target.checked ? new Set(livres.map((p) => p.pedidoId)) : new Set())} />
                </th>
                <th style={{ padding: '10px 8px' }}>Venda</th>
                <th style={{ padding: '10px 8px' }}>Pedido</th>
                <th style={{ padding: '10px 8px' }}>N/F</th>
                <th style={{ padding: '10px 8px' }}>Cliente</th>
                <th style={{ padding: '10px 8px' }}>Cidade</th>
                <th style={{ padding: '10px 8px' }}>Vendedor</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {buscando || lista === null ? (
                <tr><td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Buscando pedidos faturados...</td></tr>
              ) : visiveis.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum pedido faturado nesse período{busca || comNota !== 'todos' ? ' com esses filtros' : ''}.</td></tr>
              ) : visiveis.map((p) => (
                <tr key={p.pedidoId} onClick={() => !p.emOutraRota && alternar(p.pedidoId)} style={{ borderTop: '1px solid var(--border-color)', cursor: p.emOutraRota ? 'not-allowed' : 'pointer', opacity: p.emOutraRota ? 0.45 : 1 }}>
                  <td style={{ padding: '8px' }}>
                    <input type="checkbox" disabled={Boolean(p.emOutraRota)} checked={marcados.has(p.pedidoId)} onChange={() => alternar(p.pedidoId)} onClick={(e) => e.stopPropagation()} aria-label={`Marcar pedido ${p.numeroPedido}`} />
                  </td>
                  <td style={{ padding: '8px' }}>{dataBr(p.dataVenda)}</td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{p.numeroPedido}</td>
                  <td style={{ padding: '8px' }}>{p.notaNumero || 'S/N'}</td>
                  <td style={{ padding: '8px' }}>
                    {p.clienteNome}
                    {p.emOutraRota && <div style={{ fontSize: '12px', color: '#f59e0b' }}>{p.emOutraRota}</div>}
                  </td>
                  <td style={{ padding: '8px' }}>{p.cidade || '—'}</td>
                  <td style={{ padding: '8px' }}>{p.vendedorNome || '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{moeda(p.valorTotalCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {marcados.size} marcado(s) · {moeda((lista || []).filter((p) => marcados.has(p.pedidoId)).reduce((t, p) => t + p.valorTotalCentavos, 0))}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
            <button
              type="button"
              className="btn-primary"
              disabled={marcados.size === 0}
              onClick={() => onAdicionar((lista || []).filter((p) => marcados.has(p.pedidoId)).map(({ emOutraRota: _ignorado, ...entrega }) => entrega))}
            >
              Adicionar {marcados.size > 0 ? marcados.size : ''} à rota
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// REGISTRAR ENTREGA
// ---------------------------------------------------------------------------

const RegistrarEntregaModal: React.FC<{
  entrega: EntregaRomaneio;
  motivos: string[];
  onFechar: () => void;
  onSalvar: (registro: RegistroDeEntrega) => Promise<void>;
}> = ({ entrega, motivos, onFechar, onSalvar }) => {
  const [status, setStatus] = useState<StatusEntrega>(entrega.status === 'pendente' ? 'entregue' : entrega.status);
  const [recebedorNome, setRecebedorNome] = useState(entrega.recebedorNome);
  const [recebedorDocumento, setRecebedorDocumento] = useState(entrega.recebedorDocumento);
  const [motivo, setMotivo] = useState(entrega.motivo || '');
  const [recebido, setRecebido] = useState(textoDosCentavos(entrega.recebidoCentavos));
  const [recebidoForma, setRecebidoForma] = useState(entrega.recebidoForma || 'Dinheiro');
  const [observacao, setObservacao] = useState(entrega.observacao);
  const [justificativa, setJustificativa] = useState(entrega.justificativaValor);
  const [salvando, setSalvando] = useState(false);
  const recebidoCentavos = status === 'pendente' ? 0 : centavosDoTexto(recebido);
  const diferenca = status === 'pendente' ? 0 : diferencaDoRecebido({ recebidoCentavos, valorTotalCentavos: entrega.valorTotalCentavos });

  const salvar = async () => {
    setSalvando(true);
    try {
      await onSalvar({ status, recebedorNome, recebedorDocumento, motivo, recebidoCentavos, recebidoForma, observacao, justificativaValor: justificativa });
    } finally {
      setSalvando(false);
    }
  };

  const opcao = (valor: StatusEntrega, rotulo: string, icone: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setStatus(valor)}
      className={status === valor ? 'btn-primary' : 'btn-secondary'}
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px' }}
    >
      {icone} {rotulo}
    </button>
  );

  return (
    <div style={estiloFundoModal} onClick={onFechar}>
      <div style={estiloModal(560)} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Registrar entrega">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <h3 style={{ margin: 0, fontSize: '17px' }}>Pedido #{entrega.numeroPedido}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
          {entrega.clienteNome} · {entrega.cidade || 'sem cidade'} · {moeda(entrega.valorTotalCentavos)} ({entrega.formaPagamento || 'sem forma'})
        </p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {opcao('entregue', 'Entregue', <CheckCircle size={16} />)}
          {opcao('nao_entregue', 'Não entregue', <XCircle size={16} />)}
          {entrega.status !== 'pendente' && opcao('pendente', 'Voltar a pendente', <ArrowLeft size={16} />)}
        </div>

        {status === 'entregue' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
              <span style={estiloRotulo}>Quem recebeu *</span>
              <input value={recebedorNome} onChange={(e) => setRecebedorNome(e.target.value.toUpperCase())} autoFocus style={{ ...estiloCampo, textTransform: 'uppercase' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
              <span style={estiloRotulo}>Documento (RG/CPF) de quem recebeu</span>
              <input value={recebedorDocumento} onChange={(e) => setRecebedorDocumento(e.target.value)} placeholder="Opcional" style={estiloCampo} />
            </label>
          </div>
        )}

        {status === 'nao_entregue' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
            <span style={estiloRotulo}>Motivo *</span>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} style={estiloCampo}>
              <option value="">Escolha o motivo...</option>
              {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
              {motivo && !motivos.includes(motivo) && <option value={motivo}>{motivo}</option>}
            </select>
          </label>
        )}

        {status !== 'pendente' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={estiloRotulo}>Motorista recebeu (R$)</span>
              <input inputMode="decimal" value={recebido} onChange={(e) => setRecebido(e.target.value)} style={estiloCampo} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={estiloRotulo}>Como</span>
              <select value={recebidoForma} onChange={(e) => setRecebidoForma(e.target.value)} style={estiloCampo}>
                {FORMAS_RECEBIDAS_NA_ENTREGA.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            {diferenca !== 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '10px 12px', borderRadius: '8px', border: '1px solid #f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.08)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b' }}>Valor diferente do pedido: {textoDaDiferenca(diferenca)}</span>
                <span style={estiloRotulo}>Por quê? (pagamento parcial, abatimento de outra nota...) *</span>
                <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2} style={{ ...estiloCampo, height: 'auto', padding: '8px 10px', resize: 'vertical' }} />
              </div>
            )}
            <span style={{ gridColumn: '1 / -1', fontSize: '12px', color: 'var(--text-muted)' }}>
              Só registro para o acerto. A baixa do título continua em Contas a Receber.
            </span>
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
          <span style={estiloRotulo}>Observação</span>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" style={estiloCampo} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
          <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {salvando && <Loader2 size={16} className="spin-icon" />} Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CONFIGURACAO (motivos de nao entrega e linhas do acerto)
// ---------------------------------------------------------------------------

const ConfiguracaoRomaneioModal: React.FC<{
  tenantId: string;
  motivos: string[];
  tipos: TipoAcerto[];
  onFechar: () => void;
  onSalvo: (motivos: string[], tipos: TipoAcerto[]) => void;
}> = ({ tenantId, motivos: motivosIniciais, tipos: tiposIniciais, onFechar, onSalvo }) => {
  const [motivos, setMotivos] = useState<string[]>(motivosIniciais);
  const [tipos, setTipos] = useState<TipoAcerto[]>(tiposIniciais);
  const [novoMotivo, setNovoMotivo] = useState('');
  const [novoTipo, setNovoTipo] = useState('');
  const [novaNatureza, setNovaNatureza] = useState<NaturezaAcerto>('despesa');
  const [salvando, setSalvando] = useState(false);

  const adicionarMotivo = () => {
    const nome = normalizarNomeCadastro(novoMotivo);
    if (nome.length < 3) { showError('Motivo', 'Escreva o motivo (mínimo 3 letras).'); return; }
    if (motivos.includes(nome)) { showError('Motivo', `Já existe o motivo "${nome}".`); return; }
    setMotivos([...motivos, nome]);
    setNovoMotivo('');
  };
  const adicionarTipo = () => {
    const nome = normalizarNomeCadastro(novoTipo);
    if (nome.length < 2) { showError('Item do acerto', 'Escreva o nome do item (mínimo 2 letras).'); return; }
    if (tipos.some((t) => t.nome === nome)) { showError('Item do acerto', `Já existe o item "${nome}".`); return; }
    setTipos([...tipos, { nome, natureza: novaNatureza }]);
    setNovoTipo('');
  };

  const salvar = async () => {
    if (motivos.length === 0) { showError('Motivos', 'Deixe pelo menos um motivo de não entrega.'); return; }
    if (tipos.length === 0) { showError('Acerto', 'Deixe pelo menos um item no acerto.'); return; }
    setSalvando(true);
    try {
      await updateDoc(doc(db, 'configuracoes', tenantId), { motivosNaoEntrega: motivos, tiposAcertoRomaneio: tipos });
      showSuccess('Configuração do romaneio salva.');
      onSalvo(motivos, tipos);
    } catch (erro) {
      console.error('Erro ao salvar a configuração do romaneio:', erro);
      showError('Não foi possível salvar', mensagemDoErro(erro, 'Confira sua conexão e se você pode alterar as Configurações.'));
    } finally {
      setSalvando(false);
    }
  };

  const linhaLista: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', fontSize: '13.5px' };

  return (
    <div style={estiloFundoModal} onClick={onFechar}>
      <div style={estiloModal(640)} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Configurar romaneio">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '17px' }}>Configurar romaneio</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <h4 style={{ margin: '0 0 8px', fontSize: '14px' }}>Motivos de não entrega</h4>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input value={novoMotivo} maxLength={40} onChange={(e) => setNovoMotivo(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarMotivo(); } }} placeholder="Novo motivo" style={{ ...estiloCampo, flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={adicionarMotivo}><Plus size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '24px' }}>
          {motivos.map((m) => (
            <div key={m} style={linhaLista}>
              <span>{m}</span>
              <button type="button" onClick={() => setMotivos(motivos.filter((x) => x !== m))} title="Remover" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex' }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>

        <h4 style={{ margin: '0 0 4px', fontSize: '14px' }}>Itens do acerto</h4>
        <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: 'var(--text-muted)' }}>
          O tipo decide a conta do saldo: adiantamento soma (a loja deu), despesa subtrai (o motorista pagou), informação não entra na conta.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <input value={novoTipo} maxLength={40} onChange={(e) => setNovoTipo(e.target.value.toUpperCase())} placeholder="Novo item" style={{ ...estiloCampo, flex: 1, minWidth: '160px' }} />
          <select value={novaNatureza} onChange={(e) => setNovaNatureza(e.target.value as NaturezaAcerto)} style={{ ...estiloCampo, width: 'auto' }}>
            {(Object.keys(ROTULO_NATUREZA_ACERTO) as NaturezaAcerto[]).map((n) => <option key={n} value={n}>{ROTULO_NATUREZA_ACERTO[n]}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={adicionarTipo}><Plus size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
          {tipos.map((t) => (
            <div key={t.nome} style={linhaLista}>
              <span>{t.nome} <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>· {ROTULO_NATUREZA_ACERTO[t.natureza]}</span></span>
              <button type="button" onClick={() => setTipos(tipos.filter((x) => x.nome !== t.nome))} title="Remover" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex' }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
          <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {salvando && <Loader2 size={16} className="spin-icon" />} Salvar configuração
          </button>
        </div>
      </div>
    </div>
  );
};

export default RomaneioForm;

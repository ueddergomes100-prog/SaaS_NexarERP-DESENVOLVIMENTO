import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { MessageCircle } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { transactionDueDateInput, transactionNetCents } from '../../utils/financeDomain';
import { chaveDoGrupo, type ContaParaAgrupar, type GrupoDeContas } from '../../utils/contasAgrupadasDomain';
import { PARAMETROS_VENDA_PADRAO, parseParametrosVenda, type ParametrosVenda } from '../../utils/parametrosVendaDomain';
import {
  acrescimoDoTitulo,
  campoDoPercentual,
  lerPercentuaisDaTela,
  parametrosComPercentuaisDaTela,
  temPercentuais,
  textoDosPercentuais,
  type PercentuaisDeAtraso,
} from '../../utils/atrasoReceberDomain';
import { contasDaCobranca, contaVencida, linkDoWhatsapp, mensagemDeCobranca, type TipoDeCobranca } from '../../utils/cobrancaWhatsappDomain';
import { carregarDadosDaCobranca, type DadosDaCobranca } from '../../services/cobrancaWhatsappService';
import { PERMISSAO_FINANCEIRO } from '../../utils/permissoesNovasDomain';
import { PERMISSAO_APP_COBRAR_WHATSAPP } from '../../utils/permissoesAppDomain';
import { hasTenantFullAccess } from '../../utils/roles';
import { podeTelaDoApp } from './vendedorPermissoes';
import { showError } from '../../utils/alerts';
import ContasAgrupadas from './ContasAgrupadas';
import type { VendedorContasReceberNavState } from './vendedorNavState';

/**
 * So consulta -- ver o que esta pendente/vencido e o valor, sem marcar como
 * recebido. Le direto a colecao `transacoes` (mesma que o desktop usa em
 * ContasReceber.tsx), filtrando por `tipo: 'entrada'`. Sem escrita nenhuma
 * no Firestore, de proposito: mexer com saldo de banco/quitar conta fica
 * pro desktop por enquanto.
 *
 * Agrupada por cliente (15/10/2026): uma linha por nome, com quantas notas
 * e o total; ao tocar, as notas abrem embaixo (ContasAgrupadas.tsx).
 *
 * 28/11/2026 (pedido do dono):
 *  - juros e multa dos atrasados pelas % da filial (Parametros de venda), como
 *    no Contas a Receber do computador; quem pode alterar juros e multa troca
 *    as % so' nesta consulta, sem gravar;
 *  - cobrar pelo WhatsApp: as vencidas, todas ou uma nota, com pedido, data da
 *    compra e valores (cobrancaWhatsappDomain.ts);
 *  - chegando da venda (debitos do cliente), a lista abre so' naquele cliente.
 * Cartao fica fora, como no saldo em aberto: quem paga e' a operadora.
 */

const FORMAS_FORA_DA_COBRANCA = ['Cartão de Crédito', 'Cartão de Débito'];

interface Conta extends ContaParaAgrupar {
  clienteId: string;
  valorCentavos: number;
  pedidoId: string;
  /** Dia em que o titulo nasceu: data da compra quando o pedido nao diz. */
  criadoEm: string;
}

type EstadoDosDados = { estado: 'carregando' } | { estado: 'pronto'; dados: DadosDaCobranca };

const dataDoTimestamp = (valor: unknown): string => (
  valor && typeof (valor as { toDate?: unknown }).toDate === 'function'
    ? getDateInputInTimeZone((valor as { toDate: () => Date }).toDate())
    : ''
);

const botaoPilula = (cor: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '40px', padding: '0 14px', borderRadius: '999px',
  border: 'none', backgroundColor: cor, color: '#ffffff', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
});

const linkTexto: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--brand-400)', fontWeight: 700, fontSize: '13px', fontFamily: 'inherit', textDecoration: 'underline',
};

const campoPct: React.CSSProperties = {
  width: '100%', padding: '11px 12px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '16px',
  backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', boxSizing: 'border-box',
};

const VERDE_WHATSAPP = '#1f9d55';

const VendedorContasReceber: React.FC = () => {
  const { tenantId, userPermissions, userRole, isOwner, selectedTenant } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const filtro = (location.state as VendedorContasReceberNavState | null)?.cliente || null;
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [parametrosDaFilial, setParametrosDaFilial] = useState<ParametrosVenda>(PARAMETROS_VENDA_PADRAO);
  const [empresaNome, setEmpresaNome] = useState('');
  const [percentuaisDaTela, setPercentuaisDaTela] = useState<PercentuaisDeAtraso | null>(null);
  const [editandoPct, setEditandoPct] = useState<{ juros: string; multa: string; erro: string } | null>(null);
  const [dadosPorCliente, setDadosPorCliente] = useState<Record<string, EstadoDosDados>>({});

  const podeVer = userPermissions.includes('financeiro.receber');
  const acessoTotal = hasTenantFullAccess(userRole, isOwner);
  // Mudar as % muda o que o cliente paga: so' quem pode alterar juros e multa na baixa (igual ao computador).
  const podeAlterarPct = acessoTotal || userPermissions.includes(PERMISSAO_FINANCEIRO.baixaJurosMulta);
  const podeCobrar = podeTelaDoApp(PERMISSAO_APP_COBRAR_WHATSAPP, userRole, isOwner, userPermissions);

  useEffect(() => {
    if (!tenantId || !podeVer) return;
    let cancelado = false;
    setCarregando(true);

    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        if (cancelado) return;
        const config = snap.exists() ? snap.data() : {};
        setParametrosDaFilial(parseParametrosVenda(config.parametrosVenda));
        setEmpresaNome(String(config.nomeFantasia || config.nomeOficina || config.razaoSocial || '').trim());
      })
      .catch(() => { /* sem sinal: fica sem juros (padrao) */ });

    getDocs(query(
      collection(db, 'transacoes'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'entrada'),
      // So' o que esta em aberto: o banco devolve os pendentes em vez do
      // historico inteiro (antes um titulo pago aparecia como pendente,
      // porque o filtro procurava o status 'Recebida', que nao existe).
      where('status', '==', 'Pendente'),
    )).then((snap) => {
      if (cancelado) return;
      const lista: Conta[] = snap.docs
        .filter((docSnap) => !FORMAS_FORA_DA_COBRANCA.includes(String(docSnap.data().formaPagamento || '')))
        .map((docSnap) => {
          const data = docSnap.data();
          const valorCentavos = transactionNetCents(data);
          return {
            id: docSnap.id,
            descricao: data.descricao || '',
            vencimento: transactionDueDateInput(data),
            valor: valorCentavos / 100,
            valorCentavos,
            nome: data.clienteNome || '',
            clienteId: String(data.clienteId || ''),
            pedidoId: String(data.pedidoId || ''),
            criadoEm: dataDoTimestamp(data.createdAt),
          };
        })
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      setContas(lista);
      setCarregando(false);
    }).catch(() => setCarregando(false));

    return () => { cancelado = true; };
  }, [tenantId, podeVer]);

  const hoje = getDateInputInTimeZone();
  const parametros = useMemo(() => parametrosComPercentuaisDaTela(parametrosDaFilial, percentuaisDaTela), [parametrosDaFilial, percentuaisDaTela]);
  const acrescimoCentavos = useCallback((conta: Conta): number => (
    acrescimoDoTitulo(parametros, { status: 'Pendente', valorCentavos: conta.valorCentavos, dataVencimento: conta.vencimento }, hoje)?.totalCentavos ?? 0
  ), [parametros, hoje]);

  // Vindo da venda: so' as notas daquele cliente, ja' abertas.
  const contasNaTela = useMemo(() => (
    filtro ? contas.filter((c) => (filtro.id && c.clienteId ? c.clienteId === filtro.id : chaveDoGrupo(c.nome) === chaveDoGrupo(filtro.nome))) : contas
  ), [contas, filtro]);
  const haVencidas = contasNaTela.some((c) => contaVencida(c, hoje));

  const carregarDados = useCallback((grupo: GrupoDeContas<Conta>) => {
    if (!podeCobrar || dadosPorCliente[grupo.chave]) return;
    const clienteId = grupo.contas.find((c) => c.clienteId)?.clienteId || '';
    setDadosPorCliente((atual) => ({ ...atual, [grupo.chave]: { estado: 'carregando' } }));
    carregarDadosDaCobranca(clienteId, grupo.contas.map((c) => c.pedidoId))
      .then((dados) => setDadosPorCliente((atual) => ({ ...atual, [grupo.chave]: { estado: 'pronto', dados } })))
      .catch(() => setDadosPorCliente((atual) => ({ ...atual, [grupo.chave]: { estado: 'pronto', dados: { whatsapp: null, datasDasCompras: {} } } })));
  }, [podeCobrar, dadosPorCliente]);

  // Chegando da venda o grupo ja' abre: carrega o celular sem esperar o toque.
  const [carregouDoFiltro, setCarregouDoFiltro] = useState(false);
  useEffect(() => {
    if (!filtro || carregouDoFiltro || carregando || contasNaTela.length === 0) return;
    setCarregouDoFiltro(true);
    const chave = chaveDoGrupo(contasNaTela[0].nome || contasNaTela[0].descricao);
    carregarDados({ chave, nome: contasNaTela[0].nome, contas: contasNaTela, quantidade: contasNaTela.length, total: 0, vencimentoMaisAntigo: '', vencidas: 0 });
  }, [filtro, carregouDoFiltro, carregando, contasNaTela, carregarDados]);

  const cobrar = (grupo: GrupoDeContas<Conta>, tipo: TipoDeCobranca, so?: Conta) => {
    const estado = dadosPorCliente[grupo.chave];
    const dados = estado && estado.estado === 'pronto' ? estado.dados : { whatsapp: null, datasDasCompras: {} };
    const escolhidas = contasDaCobranca(so ? [so] : grupo.contas, tipo, hoje).map((c) => ({
      descricao: c.descricao,
      dataCompra: dados.datasDasCompras[c.pedidoId] || c.criadoEm,
      vencimento: c.vencimento,
      valorCentavos: c.valorCentavos,
      acrescimoCentavos: acrescimoCentavos(c),
    }));
    const texto = mensagemDeCobranca({ clienteNome: grupo.nome, empresaNome: empresaNome || selectedTenant?.nomeOficina || '', contas: escolhidas, hoje });
    if (!texto) {
      showError('Nada para cobrar', tipo === 'vencidas' ? 'Este cliente não tem conta vencida. Use "Todas" para lembrar das que vão vencer.' : 'Este cliente não tem conta em aberto.');
      return;
    }
    window.open(linkDoWhatsapp(dados.whatsapp, texto), '_blank', 'noopener');
  };

  const acoesDoGrupo = (grupo: GrupoDeContas<Conta>) => {
    const estado = dadosPorCliente[grupo.chave];
    const carregandoDados = !estado || estado.estado === 'carregando';
    const semCelular = estado && estado.estado === 'pronto' && !estado.dados.whatsapp;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)' }}>Cobrar no WhatsApp</span>
          {grupo.vencidas > 0 && (
            <button type="button" disabled={carregandoDados} onClick={() => cobrar(grupo, 'vencidas')} style={{ ...botaoPilula('#dc2626'), opacity: carregandoDados ? 0.6 : 1 }}>
              <MessageCircle size={16} aria-hidden="true" /> Vencidas ({grupo.vencidas})
            </button>
          )}
          <button type="button" disabled={carregandoDados} onClick={() => cobrar(grupo, 'todas')} style={{ ...botaoPilula(VERDE_WHATSAPP), opacity: carregandoDados ? 0.6 : 1 }}>
            <MessageCircle size={16} aria-hidden="true" /> Todas ({grupo.quantidade})
          </button>
        </div>
        {semCelular && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            O cadastro não tem celular com DDD: o WhatsApp vai pedir para escolher o contato. Corrija o telefone no cadastro do cliente.
          </div>
        )}
      </div>
    );
  };

  const acaoDaConta = (conta: Conta, grupo: GrupoDeContas<Conta>) => {
    const estado = dadosPorCliente[grupo.chave];
    const carregandoDados = !estado || estado.estado === 'carregando';
    return (
      <button
        type="button"
        disabled={carregandoDados}
        onClick={() => cobrar(grupo, 'uma', conta)}
        aria-label={`Cobrar ${conta.descricao || 'esta conta'} no WhatsApp`}
        title="Cobrar só esta no WhatsApp"
        style={{ width: '44px', height: '44px', flex: 'none', borderRadius: '999px', border: 'none', backgroundColor: 'rgba(31,157,85,0.14)', color: VERDE_WHATSAPP, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: carregandoDados ? 0.5 : 1 }}
      >
        <MessageCircle size={18} aria-hidden="true" />
      </button>
    );
  };

  const aplicarPct = () => {
    if (!editandoPct) return;
    const lido = lerPercentuaisDaTela(editandoPct.juros, editandoPct.multa);
    if ('erro' in lido) {
      setEditandoPct({ ...editandoPct, erro: lido.erro });
      return;
    }
    setPercentuaisDaTela(lido.percentuais);
    setEditandoPct(null);
  };

  if (!podeVer) {
    return <Navigate to="/vendedor" replace />;
  }

  const emUso = parametros.juros;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Contas a Receber" />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtro && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>Só de <strong>{filtro.nome}</strong></span>
            <button type="button" style={linkTexto} onClick={() => navigate('/vendedor/contas-receber', { replace: true })}>Ver todos</button>
          </div>
        )}

        {/* Juros e multa dos atrasados (28/11/2026): % da filial, mudaveis so' nesta consulta. */}
        {!carregando && (haVencidas || percentuaisDaTela) && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span>
              {temPercentuais(emUso)
                ? <>Atrasadas com {textoDosPercentuais(emUso)}{percentuaisDaTela ? <strong style={{ color: '#f59e0b' }}> (alterado só nesta tela, não fica salvo)</strong> : ' (padrão da filial)'}.</>
                : (percentuaisDaTela
                  ? 'Juros e multa zerados só nesta tela.'
                  : 'Sem juros e multa: a filial não tem as % em Configurações › Parâmetros de venda.')}
            </span>
            {(podeAlterarPct || percentuaisDaTela) && !editandoPct && (
              <span style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {podeAlterarPct && (
                  <button type="button" style={linkTexto} onClick={() => setEditandoPct({ juros: campoDoPercentual(emUso.aoMesPercentual), multa: campoDoPercentual(emUso.multaPercentual), erro: '' })}>
                    Alterar só nesta tela
                  </button>
                )}
                {percentuaisDaTela && (
                  <button type="button" style={{ ...linkTexto, color: 'var(--text-muted)' }} onClick={() => setPercentuaisDaTela(null)}>Voltar ao padrão da filial</button>
                )}
              </span>
            )}
          </div>
        )}

        {editandoPct && (
          <div style={{ borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Juros e multa só nesta tela</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Juros ao mês (%)
                <input inputMode="decimal" value={editandoPct.juros} onChange={(e) => setEditandoPct({ ...editandoPct, juros: e.target.value, erro: '' })} style={campoPct} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Multa (%)
                <input inputMode="decimal" value={editandoPct.multa} onChange={(e) => setEditandoPct({ ...editandoPct, multa: e.target.value, erro: '' })} style={campoPct} />
              </label>
            </div>
            {editandoPct.erro && <div role="alert" style={{ fontSize: '13px', color: '#ef4444', fontWeight: 600 }}>{editandoPct.erro}</div>}
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Vale só para esta consulta e para as cobranças daqui. O padrão continua o das Configurações da filial.</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setEditandoPct(null)} style={{ ...botaoPilula('transparent'), color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>Cancelar</button>
              <button type="button" onClick={aplicarPct} style={botaoPilula('var(--brand-600)')}>Aplicar</button>
            </div>
          </div>
        )}

        <ContasAgrupadas
          // Remonta ao trocar de "so' um cliente" para todos e ao terminar de carregar: o grupo do cliente abre ja' com as notas.
          key={`${filtro ? `cliente:${filtro.id || filtro.nome}` : 'todos'}:${carregando ? 'carregando' : 'pronto'}`}
          contas={contasNaTela}
          hoje={hoje}
          carregando={carregando}
          rotuloTotal="Total a receber"
          rotuloNome="cliente"
          acrescimoCentavos={acrescimoCentavos}
          acoesDoGrupo={podeCobrar ? acoesDoGrupo : undefined}
          acaoDaConta={podeCobrar ? acaoDaConta : undefined}
          aoAbrirGrupo={podeCobrar ? carregarDados : undefined}
          abertosIniciais={filtro && contasNaTela.length > 0 ? [chaveDoGrupo(contasNaTela[0].nome || contasNaTela[0].descricao)] : undefined}
          textoVazio={filtro ? 'Este cliente não tem conta em aberto.' : undefined}
        />
      </div>
    </div>
  );
};

export default VendedorContasReceber;

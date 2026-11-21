import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Filter, AlertCircle, Package, Edit, Power, Trash2, Upload, Factory, ScanBarcode, CaseUpper, Eye, EyeOff, Building2, Columns3, ChevronDown, ChevronRight, ArrowDown, ArrowUp, ArrowUpDown, Boxes } from 'lucide-react';
import { chaveDoProdutoPeloId, itemDaFilial } from '../../utils/cadastroGrupoDomain';
import { agruparVariacoes, somaDasVariacoes } from '../../utils/gradeProdutosDomain';
import { collection, query, onSnapshot, doc, where, updateDoc, setDoc, serverTimestamp, orderBy, startAfter, limit, getDocs, type QueryDocumentSnapshot, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { acompanharCatalogoEstoque, catalogoEstoqueJaCarregado, obterCatalogoEstoque } from '../../services/catalogoEstoqueService';
import { buscarProdutosNoBanco, contarResumoDoEstoque, TAMANHO_PAGINA_ESTOQUE } from '../../services/estoqueBuscaService';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { avisarSeEmEdicao, useTravasAtivas } from '../../hooks/useTravaDeEdicao';
import { MarcaEmEdicao } from '../../components/common/TravaDeEdicaoAviso';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { isPlatformAdminRole } from '../../utils/roles';
import { DICA_BUSCA_MULTIPLA, normalizeSearchText, splitSearchTerms } from '../../utils/textSearch';
import { LINHAS_POR_VEZ, useTermoAdiado } from '../../hooks/useTermoAdiado';
import { DEFAULT_MOSTRAR_RESUMO_ESTOQUE, parseMostrarResumoEstoque } from '../../utils/estoqueResumoDomain';
import { COLUNAS_OPCIONAIS_ESTOQUE, compararPelaOrdem, parseColunasOcultasEstoque, type ColunaOpcionalEstoque } from '../../utils/estoqueColunasDomain';
import { avisoInativacaoComSaldo, avisoInativacaoSemSaldo, precisaZerarParaInativar } from '../../utils/estoqueInativacaoDomain';
import {
  embalagensDaLista, equivalenciaDaEmbalagem, precosDoProdutoDaLista, resumoDasEmbalagens, saldoNaEmbalagem,
  temEmbalagemAtiva, unidadeBaseDaLista, unidadesDeVendaDaLista, type UnidadeDeVendaDaLista,
} from '../../utils/estoqueUnidadesDeVendaDomain';
import './Estoque.css';
import { CadastroError, alterarSituacaoCadastro } from '../../services/cadastroService';
import { confirmarEExcluirCadastro } from '../../utils/excluirCadastroUi';
import EstadoVazio from '../../components/common/EstadoVazio';
import { createAuditLog } from '../../services/logService';
import OrigensDaReservaModal from '../../components/common/OrigensDaReservaModal';
import { resumoDeReserva } from '../../utils/estoqueReservaDomain';
import { ordenarPorSaldo, proximaOrdemSaldo, ROTULO_FILTRO_SALDO, ROTULO_ORDEM_SALDO, saldoPassaNoFiltro, type FiltroSaldo, type OrdemSaldo } from '../../utils/estoqueListaDomain';

interface PecaData {
  id: string;
  /** Filiais: onde o cadastro nasceu. */
  filialOrigem?: string;
  nome: string;
  codigo: string;
  categoria: string;
  quantidade: number;
  /** Preso em pre-venda, condicional, OS ou troca em aberto (estoqueReservaDomain.ts). */
  quantidadeReservada?: number;
  precoVenda: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  ativo?: boolean;
  /** Grade de produtos (gradeProdutosDomain.ts): principal (temGrade) e variacao (ehVariacao). */
  temGrade?: boolean;
  ehVariacao?: boolean;
  produtoPaiChave?: string;
  grupoChave?: string;
  variacaoRotulo?: string;
  codigoBarras?: string;
  referencia?: string;
  /** Valores e embalagens na lista (21/11/2026): estoqueUnidadesDeVendaDomain.ts. */
  precoCusto?: number;
  precoAVista?: number;
  precos?: { venda?: unknown; aVista?: unknown; custo?: unknown } | null;
  embalagens?: unknown;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Visao da lista (21/11/2026): "Estoque" (saldo) ou "Tabela de precos" (cada unidade de venda numa linha). */
type VisaoDaLista = 'estoque' | 'precos';
const chaveDaVisao = (uid: string | undefined) => `hennder_estoque_visao_${uid ?? ''}`;
/** Escolha de cada usuario neste computador; sem armazenamento, abre na de Estoque. */
const lerVisaoGuardada = (uid: string | undefined): VisaoDaLista => {
  try { return window.localStorage.getItem(chaveDaVisao(uid)) === 'precos' ? 'precos' : 'estoque'; } catch { return 'estoque'; }
};

/** Uma pagina da lista (modo padrao): os itens e onde a proxima comeca. */
interface PaginaDoEstoque {
  itens: PecaData[];
  ultimoDoc: QueryDocumentSnapshot<DocumentData> | null;
  cheia: boolean;
}

/** Cabecalho clicavel que ordena a lista (seta mostra o sentido). */
const BotaoOrdem: React.FC<{ ativo: boolean; desc: boolean; onClick: () => void; titulo: string; children: React.ReactNode }> = ({ ativo, desc, onClick, titulo, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={titulo}
    style={{ background: 'none', border: 'none', padding: 0, color: ativo ? '#c084fc' : 'inherit', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', textTransform: 'inherit', letterSpacing: 'inherit' }}
  >
    {children}
    {ativo ? (desc ? <ArrowDown size={14} /> : <ArrowUp size={14} />) : <ArrowUpDown size={14} style={{ opacity: 0.6 }} />}
  </button>
);

const EstoqueList: React.FC = () => {
  const { openTab } = useTabs();
  // Trava de edicao (fase 2, 16/10/2026): em edicao por outra pessoa = cinza e nao abre.
  const travasProdutos = useTravasAtivas('produto');
  const abrirProduto = (id: string) => {
    if (avisarSeEmEdicao(travasProdutos, 'produto', id)) return;
    void openTab(`/estoque/editar/${id}`);
  };
  const [pecasList, setPecasList] = useState<PecaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  /** "Ativos" (padrao) esconde produto inativado da lista e da busca;
   * "Inativos" mostra so os inativados; "Todos" mostra os dois. Produto
   * inativado continua existindo (historico e estoque intactos), so nao
   * aparece aqui por padrao pra nao confundir com o que da pra vender de
   * verdade. */
  const [filtroStatus, setFiltroStatus] = useState<'ativos' | 'inativos' | 'todos'>('ativos');
  // Reserva visivel (maquinas pesadas, fase 2): filtro 'so com reserva' e a janela de onde vem.
  const [soComReserva, setSoComReserva] = useState(false);
  /** Grade de produtos: so' os principais com variacoes (pedido do dono, 20/10). */
  const [soComGrade, setSoComGrade] = useState(false);
  // Ordem e filtro pelo saldo (26/10/2026): botao na coluna "Qtd." e filtro de zerados/negativos.
  const [ordemSaldo, setOrdemSaldo] = useState<OrdemSaldo>('padrao');
  // Clique no cabecalho "Codigo / SKU" ou "Nome do Produto" (17/11/2026): ordena
  // por ele; clicar de novo inverte. Padrao: nome A-Z (a paginacao no banco).
  const [ordemLista, setOrdemLista] = useState<{ campo: 'nome' | 'codigo'; desc: boolean }>({ campo: 'nome', desc: false });
  const ordenarPor = (campo: 'nome' | 'codigo') => {
    setOrdemSaldo('padrao');
    setOrdemLista((atual) => (atual.campo === campo ? { campo, desc: !atual.desc } : { campo, desc: false }));
  };
  /** Colunas que a empresa escondeu (Configuracoes da filial: colunasOcultasEstoque). */
  const [colunasOcultas, setColunasOcultas] = useState<string[]>([]);
  const ver = (coluna: ColunaOpcionalEstoque) => !colunasOcultas.includes(coluna);
  const [filtroSaldo, setFiltroSaldo] = useState<FiltroSaldo>('todos');
  const [reservaAberta, setReservaAberta] = useState<PecaData | null>(null);
  /** Linha destacada por um clique simples. Editar exige duplo clique (ou
   * Enter), pra um clique de leitura nao abrir uma aba sem querer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Principais de grade que a pessoa abriu/fechou no chevron (vale por cima do
   * padrao: fechado sem busca, aberto quando a busca bateu numa variacao). */
  const [expandidos, setExpandidos] = useState<Map<string, boolean>>(new Map());
  /** Configuracoes -> Estoque: mostrar os cartoes de resumo no topo. */
  const [mostrarResumo, setMostrarResumo] = useState(DEFAULT_MOSTRAR_RESUMO_ESTOQUE);

  const { currentUser, tenantId, userRole, userPermissions, isOwner, grupo, podeTrocarFilial, usaGradeDeProdutos, venderPorEmbalagem } = useAuth();
  // Redesenho da lista (21/11/2026, pedido do dono: ver embalagens e valores sem
  // abrir item por item). Embalagem so' aparece com Configuracoes > "Vender por
  // embalagem" ligado -- a mesma condicao da aba Embalagens do cadastro.
  const [visao, setVisao] = useState<VisaoDaLista>(() => lerVisaoGuardada(currentUser?.uid));
  const escolherVisao = (nova: VisaoDaLista) => {
    setVisao(nova);
    try { window.localStorage.setItem(chaveDaVisao(currentUser?.uid), nova); } catch { /* sem armazenamento: vale enquanto a tela estiver aberta */ }
  };
  /** So' os produtos vendidos tambem em embalagem (rolo, tubo, saco...). */
  const [soComEmbalagem, setSoComEmbalagem] = useState(false);
  /** Embalagens abertas embaixo do produto: a escolha da linha vale por cima do "Abrir embalagens". */
  const [embalagensAbertas, setEmbalagensAbertas] = useState<Map<string, boolean>>(new Map());
  const [todasEmbalagensAbertas, setTodasEmbalagensAbertas] = useState(false);
  const alternarTodasEmbalagens = () => {
    setTodasEmbalagensAbertas((atual) => !atual);
    setEmbalagensAbertas(new Map());
  };
  // Filiais (2026-10-06): a lista ja' vem nos itens desta filial (cadastrados
  // nela ou com estoque nela); quem usa outras filiais ve o catalogo do grupo.
  const [escopoFilial, setEscopoFilial] = useState<'filial' | 'grupo'>('filial');
  // So quem tem "Estoque: Abrir Cadastro de Produto" abre/cria/exclui um
  // produto -- ver a lista (nome, categoria, qtd, preco de venda) e' a
  // permissao base (cadastros.estoque). Sem isto, um funcionario so-leitura
  // dava duplo clique e via custo/margem/fornecedor do produto inteiro.
  const canEditProduto = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('cadastros.estoque_alterar'));
  // Mesmo criterio das regras do Firestore para gravar configuracoes
  // (canEditTenantConfig): dono/admin ou a permissao de Configuracoes.
  const podeAlterarConfiguracoes = isOwner || isPlatformAdminRole(userRole) || userRole === 'Master' || userRole === 'Admin'
    || Boolean(userPermissions?.includes('administrativo.config'));

  /** Atalho para a mesma opcao de Configuracoes Gerais (mostrarResumoEstoque). */
  const alternarResumo = async () => {
    if (!tenantId) return;
    try {
      await setDoc(doc(db, 'configuracoes', tenantId), { tenantId, mostrarResumoEstoque: !mostrarResumo }, { merge: true });
    } catch (error) {
      console.error('Erro ao alterar os cartões de resumo do estoque:', error);
      showError(
        'Não foi possível alterar',
        'Esta opção vale para todos os usuários da filial e só pode ser mudada pelo dono ou por um administrador. Peça a eles ou use Configurações → Configurações da filial.',
      );
    }
  };

  // Ao vivo: o dono liga/desliga em Configuracoes e a tela acompanha sem
  // ninguem precisar relogar.
  useEffect(() => {
    if (!tenantId) return;
    const unsubscribe = onSnapshot(doc(db, 'configuracoes', tenantId), (snap) => {
      setMostrarResumo(parseMostrarResumoEstoque(snap.exists() ? snap.data().mostrarResumoEstoque : undefined));
      setColunasOcultas(parseColunasOcultasEstoque(snap.exists() ? snap.data().colunasOcultasEstoque : undefined));
    }, (error) => {
      // Falha de leitura MANTEM o que ja estava: piscar os cartoes por causa
      // de uma queda de rede seria pior do que continuar mostrando.
      console.error('Erro ao carregar a configuracao de resumo do estoque:', error);
    });

    return () => unsubscribe();
  }, [tenantId]);

  // ---------------------------------------------------------------------------
  // CARREGAMENTO SEM LER O ESTOQUE INTEIRO (17/11/2026, fase 4 da otimizacao
  // de leituras; pedido do dono: "a tela de estoque esta carregando o estoque
  // inteiro, nao pode"). Tres modos:
  //  - padrao (sem busca, filtros no padrao): paginas de 50 pela ordem do nome
  //    (indice tenantId+nome), ao vivo, com "Ver mais";
  //  - busca: no banco, pelo comeco do nome e pelo codigo, codigo de barras e
  //    referencia exatos; "palavra no meio do nome" usa o catalogo compartilhado;
  //  - filtros (inativos, saldo, reserva, grade, ordem por saldo, todas as
  //    filiais) e busca completa: catalogo compartilhado (catalogoEstoqueService),
  //    lido uma vez por pagina aberta e o mesmo das telas de venda.
  // ---------------------------------------------------------------------------
  const [buscaCompleta, setBuscaCompleta] = useState(false);
  // Busca sem travar (17/11/2026): o filtro roda quando a pessoa para de digitar.
  const termoAdiado = useTermoAdiado(searchTerm);
  const termoBusca = termoAdiado.trim();
  const filtrosNoPadrao = filtroStatus === 'ativos' && filtroSaldo === 'todos' && !soComReserva && !soComGrade && !(venderPorEmbalagem && soComEmbalagem)
    && ordemLista.campo === 'nome' && !ordemLista.desc
    && ordemSaldo === 'padrao' && !(grupo && escopoFilial === 'grupo');
  const modoCompleto = !filtrosNoPadrao || (termoBusca !== '' && (buscaCompleta || catalogoEstoqueJaCarregado(tenantId)));
  const modoBuscaNoBanco = !modoCompleto && termoBusca !== '';
  // Busca nova volta para a busca no banco.
  useEffect(() => { if (termoBusca === '') setBuscaCompleta(false); }, [termoBusca]);

  // Modo completo: catalogo compartilhado, ao vivo.
  const [catalogo, setCatalogo] = useState<PecaData[] | null>(null);
  useEffect(() => {
    if (!currentUser || !tenantId || !modoCompleto) return;
    setLoading(true);
    return acompanharCatalogoEstoque(tenantId, (snap) => {
      setCatalogo(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PecaData)));
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar estoque:', error);
      setLoading(false);
    });
  }, [currentUser, tenantId, modoCompleto]);

  // Modo padrao: paginas de 50, cada uma com a propria escuta.
  const [paginas, setPaginas] = useState<PaginaDoEstoque[]>([]);
  const escutasDasPaginas = useRef<Unsubscribe[]>([]);
  const abrirPagina = useCallback((indice: number, depoisDe: QueryDocumentSnapshot<DocumentData> | null) => {
    if (!tenantId) return;
    const restricoes = [where('tenantId', '==', tenantId), orderBy('nome'), ...(depoisDe ? [startAfter(depoisDe)] : []), limit(TAMANHO_PAGINA_ESTOQUE)];
    escutasDasPaginas.current[indice]?.();
    escutasDasPaginas.current[indice] = onSnapshot(query(collection(db, 'estoque'), ...restricoes), (snap) => {
      const pagina: PaginaDoEstoque = {
        itens: snap.docs.map((d) => ({ id: d.id, ...d.data() } as PecaData)),
        ultimoDoc: snap.docs[snap.docs.length - 1] ?? null,
        cheia: snap.size >= TAMANHO_PAGINA_ESTOQUE,
      };
      setPaginas((atual) => { const novo = [...atual]; novo[indice] = pagina; return novo; });
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar estoque:', error);
      setLoading(false);
    });
  }, [tenantId]);
  const modoPaginado = !modoCompleto && !modoBuscaNoBanco;
  useEffect(() => {
    if (!currentUser || !tenantId || !modoPaginado) return;
    setLoading(true);
    setPaginas([]);
    abrirPagina(0, null);
    return () => {
      escutasDasPaginas.current.forEach((parar) => parar?.());
      escutasDasPaginas.current = [];
    };
  }, [currentUser, tenantId, modoPaginado, abrirPagina]);
  const ultimaPagina = paginas[paginas.length - 1];
  const temMaisPaginas = modoPaginado && Boolean(ultimaPagina?.cheia && ultimaPagina.ultimoDoc);
  const verMais = () => {
    if (!ultimaPagina?.ultimoDoc) return;
    abrirPagina(paginas.length, ultimaPagina.ultimoDoc);
  };
  const itensDasPaginas = paginas.flatMap((p) => p?.itens ?? []);

  // Grade: as variacoes dos principais da pagina (o saldo do principal e' a soma delas).
  const chavesDosPrincipaisDaPagina = itensDasPaginas
    .filter((p) => p.temGrade === true)
    .map((p) => p.grupoChave || chaveDoProdutoPeloId(p.id, tenantId))
    .sort()
    .join('|');
  const [variacoesDaPagina, setVariacoesDaPagina] = useState<PecaData[]>([]);
  useEffect(() => {
    if (!tenantId || !modoPaginado || !chavesDosPrincipaisDaPagina) { setVariacoesDaPagina([]); return; }
    let cancelado = false;
    const chaves = chavesDosPrincipaisDaPagina.split('|');
    const lotes: string[][] = [];
    for (let i = 0; i < chaves.length; i += 10) lotes.push(chaves.slice(i, i + 10));
    Promise.all(lotes.map((lote) => getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId), where('produtoPaiChave', 'in', lote)))))
      .then((snaps) => { if (!cancelado) setVariacoesDaPagina(snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() } as PecaData)))); })
      .catch((error) => console.error('Erro ao buscar as variações da grade:', error));
    return () => { cancelado = true; };
  }, [tenantId, modoPaginado, chavesDosPrincipaisDaPagina]);

  // Busca no banco: comeco do nome + codigo, codigo de barras e referencia exatos.
  const [resultadosBusca, setResultadosBusca] = useState<PecaData[]>([]);
  useEffect(() => {
    if (!tenantId || !modoBuscaNoBanco) return;
    let cancelado = false;
    setLoading(true);
    const espera = window.setTimeout(() => {
      buscarProdutosNoBanco(tenantId, termoBusca)
        .then((achados) => { if (!cancelado) { setResultadosBusca(achados as PecaData[]); setLoading(false); } })
        .catch((error) => {
          console.error('Erro na busca de produtos:', error);
          if (!cancelado) { setResultadosBusca([]); setLoading(false); }
        });
    }, 100);
    return () => { cancelado = true; window.clearTimeout(espera); };
  }, [tenantId, modoBuscaNoBanco, termoBusca]);

  useEffect(() => {
    const lista = modoCompleto
      ? (catalogo ?? [])
      : modoBuscaNoBanco
        ? resultadosBusca
        : [...itensDasPaginas, ...variacoesDaPagina];
    const porId = new Map<string, PecaData>();
    lista.forEach((p) => porId.set(p.id, p));
    const pecas = [...porId.values()];
    // Mesma ordem nos tres modos: pelo nome (a paginacao no banco e' pelo nome).
    pecas.sort((a, b) => compararPelaOrdem(a, b, ordemLista.campo, ordemLista.desc));
    setPecasList(pecas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoCompleto, modoBuscaNoBanco, catalogo, resultadosBusca, paginas, variacoesDaPagina, ordemLista]);

  // Cartoes de resumo sem ler o estoque: contagem no servidor.
  const [contagens, setContagens] = useState<{ total: number | null; baixo: number | null; esgotados: number | null }>({ total: null, baixo: null, esgotados: null });
  useEffect(() => {
    if (!tenantId || !mostrarResumo || modoCompleto) return;
    let cancelado = false;
    contarResumoDoEstoque(tenantId).then((c) => { if (!cancelado) setContagens(c); });
    return () => { cancelado = true; };
  }, [tenantId, mostrarResumo, modoCompleto]);

  const handleToggleAtivo = async (peca: PecaData) => {
    if (!currentUser) return;
    if (avisarSeEmEdicao(travasProdutos, 'produto', peca.id)) return;
    const novoStatus = peca.ativo === false;
    // Inativar com saldo zera o estoque na mesma operacao -- ver
    // estoqueInativacaoDomain.ts pro porque da regra.
    const vaiZerar = !novoStatus && precisaZerarParaInativar(peca.quantidade);

    const aviso = novoStatus
      ? {
        title: `Ativar "${peca.nome}"?`,
        text: 'O produto volta a aparecer nas buscas de venda, OS e orçamento.',
        confirmButtonText: 'Sim, ativar',
      }
      : vaiZerar
        ? avisoInativacaoComSaldo(peca.nome, peca.quantidade, peca.unidadeMedidaSigla)
        : avisoInativacaoSemSaldo(peca.nome);
    // Principal de grade: o saldo e' das variacoes, e elas vao junto (gradeProdutosDomain.ts).
    if (novoStatus && peca.temGrade) {
      aviso.text = 'As variações deste produto voltam junto com ele e reaparecem nas buscas de venda, OS e orçamento.';
    }
    if (!novoStatus && peca.temGrade) {
      aviso.text = `${vaiZerar
        ? `As variações deste produto somam ${peca.quantidade} ${peca.unidadeMedidaSigla || 'UN'} em estoque. O sistema vai zerar o saldo de cada variação (registrado no Relatório de Ajustes) e inativar todas junto com o produto principal.`
        : 'As variações deste produto são inativadas junto com ele.'} Variação presa em pré-venda, condicional, OS ou troca impede a inativação.`;
    }

    const confirm = await NexusSwal.fire({
      ...aviso,
      icon: vaiZerar ? 'warning' : 'question',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      // O servidor confere as pendencias (reserva em pre-venda, receita de
      // produto ativo, producao aberta) e, se passar, zera o saldo e inativa
      // numa transacao so', com o registro no Relatorio de Ajustes. Ver
      // server/services/cadastroIntegridade.js.
      const resultado = await alterarSituacaoCadastro('estoque', peca.id, novoStatus);
      showSuccess(novoStatus
        ? 'Produto ativado!'
        : resultado.saldoZerado
          ? `Produto inativado e estoque zerado (era ${resultado.saldoZerado}).`
          : 'Produto inativado!');
    } catch (error) {
      console.error('Erro ao atualizar status do produto:', error);
      const titulo = novoStatus ? 'Não foi possível ativar' : 'Não foi possível inativar';
      const texto = (error as Error).message || 'Tente novamente mais tarde.';
      // Bloqueio por reserva: a mensagem do servidor ja' cita as pre-vendas/OS,
      // e o segundo botao abre a janela "Reservas de ..." com o atalho pra
      // cada documento -- sem ter que procurar pre-venda por pre-venda.
      const bloqueadoPorReserva = !novoStatus && error instanceof CadastroError && error.status === 409 && resumoDeReserva(peca).reservada > 0;
      if (!bloqueadoPorReserva) { showError(titulo, texto); return; }
      const resposta = await NexusSwal.fire({
        icon: 'error',
        title: titulo,
        text: texto,
        confirmButtonText: 'Ver onde está reservado',
        showCancelButton: true,
        cancelButtonText: 'Entendi',
      });
      if (resposta.isConfirmed) setReservaAberta(peca);
    }
  };

  const handleFixNames = async () => {
    if (!currentUser) return;
    const isConfirmed = await NexusSwal.fire({
      title: 'Padronizar Nomes?',
      text: 'Isto converterá o nome de TODOS os produtos do estoque para MAIÚSCULAS.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, padronizar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      // Historico de alteracoes (09/11/2026): UM registro para a padronizacao inteira
      // (nao um por produto), com quantos mudaram e uma amostra do antes -> depois.
      let count = 0;
      const amostra: Array<{ campo: string; valorAnterior: string; valorNovo: string }> = [];
      const registrar = (concluida: boolean) => {
        if (count === 0) return;
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'estoque',
          acao: 'edicao',
          descricao: concluida
            ? `Padronizou os nomes dos produtos em MAIÚSCULAS: ${count} produto(s) alterado(s).${count > amostra.length ? ` Abaixo, os ${amostra.length} primeiros.` : ''}`
            : `Padronização dos nomes em MAIÚSCULAS interrompida por erro: ${count} produto(s) chegaram a ser alterados.`,
          documentoTipo: 'produto',
          alteracoes: amostra,
          status: concluida ? 'sucesso' : 'erro',
        });
      };
      try {
        // A lista mostra so' uma parte: a padronizacao pega o catalogo inteiro.
        const todos = (await obterCatalogoEstoque(tenantId || '')).docs.map((d) => ({ id: d.id, ...d.data() } as PecaData));
        for (const p of todos) {
          const upName = p.nome.toUpperCase().trim();
          if (p.nome !== upName) {
            await updateDoc(doc(db, 'estoque', p.id), {
              nome: upName,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nome padronizado para maiúsculas'),
            });
            count++;
            if (amostra.length < 50) amostra.push({ campo: `Nome${p.codigo ? ` (cód. ${p.codigo})` : ''}`, valorAnterior: p.nome, valorNovo: upName });
          }
        }
        registrar(true);
        showSuccess(`Pronto! ${count} produtos foram atualizados.`);
      } catch(err) {
        registrar(false);
        showError('Erro', 'Ocorreu um erro na migração.');
      } finally {
        setLoading(false);
      }
    }
  };

  // Grade de produtos (19/10/2026): as variacoes ficam embaixo do principal e o
  // saldo dele e' a soma das variacoes ativas (ele mesmo nao tem saldo). Ver
  // gradeProdutosDomain.ts.
  const chaveDaPeca = (peca: PecaData) => peca.grupoChave || chaveDoProdutoPeloId(peca.id, tenantId);
  const { principais, variacoesPorPai } = agruparVariacoes(pecasList, chaveDaPeca);
  const variacoesDe = (peca: PecaData): PecaData[] => (peca.temGrade ? variacoesPorPai.get(chaveDaPeca(peca)) ?? [] : []);
  const comSaldoDasVariacoes = (peca: PecaData): PecaData => (peca.temGrade ? { ...peca, ...somaDasVariacoes(variacoesDe(peca)) } : peca);

  const passaNosFiltros = (peca: PecaData) => {
    const ativo = peca.ativo !== false;
    const passaNoStatus = filtroStatus === 'todos' || (filtroStatus === 'ativos' ? ativo : !ativo);
    const passaNaFilial = !grupo || escopoFilial === 'grupo' || itemDaFilial(peca, tenantId);
    const passaNaReserva = !soComReserva || resumoDeReserva(comSaldoDasVariacoes(peca)).temReserva;
    const passaNoSaldo = saldoPassaNoFiltro(comSaldoDasVariacoes(peca).quantidade, filtroSaldo);
    return passaNoStatus && passaNaFilial && passaNaReserva && passaNoSaldo;
  };
  // Mesma busca das telas de venda: acento nao conta e "+" exige todas as
  // palavras ("Racao+Quatree+20KG"). Ver matchesAllSearchTerms. A variacao
  // tambem bate pela combinacao (P / AZUL) e pelo codigo de barras dela.
  // O texto de busca de cada produto e' montado uma vez por mudanca da lista,
  // nao a cada tecla (com o catalogo inteiro sao milhares de produtos).
  const textoDeBusca = useMemo(() => {
    const mapa = new Map<string, string>();
    pecasList.forEach((peca) => mapa.set(peca.id, [peca.nome, peca.codigo, peca.categoria, peca.codigoBarras ?? '', peca.referencia ?? '', ...(peca.ehVariacao ? [peca.variacaoRotulo ?? ''] : [])]
      .map((campo) => normalizeSearchText(campo)).join('\u0001')));
    return mapa;
  }, [pecasList]);
  const termosDaBusca = useMemo(() => splitSearchTerms(termoAdiado).map((t) => normalizeSearchText(t)).filter(Boolean), [termoAdiado]);
  const passaNaBusca = (peca: PecaData) => {
    if (termosDaBusca.length === 0) return true;
    const texto = textoDeBusca.get(peca.id) ?? '';
    return termosDaBusca.every((termo) => texto.includes(termo));
  };
  const buscando = termosDaBusca.length > 0;
  /** O principal aparece se ele ou alguma variacao passa; buscando, as variacoes
   * que bateram ja' vem abertas -- e o chevron abre/fecha em qualquer caso. */
  const linhasFiltradas = principais.flatMap((peca) => {
    if (soComGrade && peca.temGrade !== true) return [];
    const todas = variacoesDe(peca);
    if (venderPorEmbalagem && soComEmbalagem && !temEmbalagemAtiva(peca) && !todas.some((v) => temEmbalagemAtiva(v))) return [];
    const variacoesQueBatem = todas.filter((v) => passaNosFiltros(v) && passaNaBusca(v));
    if (!(passaNosFiltros(peca) && passaNaBusca(peca)) && variacoesQueBatem.length === 0) return [];
    const aberto = expandidos.get(peca.id) ?? (buscando && variacoesQueBatem.length > 0);
    const variacoesQuePassam = buscando ? variacoesQueBatem : todas.filter(passaNosFiltros);
    const variacoes = aberto ? variacoesQuePassam : [];
    return [{ peca, variacoes, variacoesQuePassam, aberto, totalDeVariacoes: todas.length }];
  });
  // Botao da coluna "Qtd.": maior/menor estoque primeiro; as variacoes seguem embaixo do principal.
  const totalDeColunas = 2 + COLUNAS_OPCIONAIS_ESTOQUE.filter((c) => ver(c.chave)).length;
  /** Tabela de precos: Codigo, Produto, Unidade, Venda, A vista, Codigo de barras, Acoes. */
  const totalDeColunasDosPrecos = 7;
  /** Mais opcoes > Colunas da lista: vale para todos os usuarios da filial. */
  const escolherColunas = async () => {
    if (!tenantId) return;
    const resposta = await NexusSwal.fire({
      title: 'Colunas da lista de produtos',
      html: `<div style="text-align:left;display:flex;flex-direction:column;gap:8px">${COLUNAS_OPCIONAIS_ESTOQUE.map((c) => (
        `<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" data-coluna="${c.chave}" ${colunasOcultas.includes(c.chave) ? '' : 'checked'}/> ${c.rotulo}</label>`
      )).join('')}<small style="opacity:.7">Nome do produto e Ações aparecem sempre. Vale para todos os usuários desta filial.</small></div>`,
      showCancelButton: true,
      confirmButtonText: 'Salvar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => COLUNAS_OPCIONAIS_ESTOQUE
        .filter((c) => !(document.querySelector(`input[data-coluna="${c.chave}"]`) as HTMLInputElement | null)?.checked)
        .map((c) => c.chave),
    });
    if (!resposta.isConfirmed) return;
    try {
      await setDoc(doc(db, 'configuracoes', tenantId), { tenantId, colunasOcultasEstoque: resposta.value as string[] }, { merge: true });
      showSuccess('Colunas salvas.');
    } catch (error) {
      console.error('Erro ao salvar as colunas do estoque:', error);
      showError('Não foi possível salvar as colunas', 'Esta opção vale para todos os usuários da filial e só pode ser mudada pelo dono ou por um administrador.');
    }
  };
  const linhasVisiveis = ordenarPorSaldo(linhasFiltradas, ordemSaldo, ({ peca }) => comSaldoDasVariacoes(peca).quantidade);
  // Com o catalogo inteiro, desenha 100 linhas por vez: desenhar milhares de
  // linhas de uma vez era o que travava a busca.
  const [limiteNaTela, setLimiteNaTela] = useState(LINHAS_POR_VEZ);
  useEffect(() => { setLimiteNaTela(LINHAS_POR_VEZ); }, [termoAdiado, filtroStatus, filtroSaldo, soComReserva, soComGrade, soComEmbalagem, ordemSaldo, ordemLista, escopoFilial]);
  const linhasNaTela = modoCompleto ? linhasVisiveis.slice(0, limiteNaTela) : linhasVisiveis;
  const restamNaTela = linhasVisiveis.length - linhasNaTela.length;

  const alternarExpandido = (id: string, abertoAgora: boolean) => {
    setExpandidos((atual) => new Map(atual).set(id, !abertoAgora));
  };

  // Cartoes de resumo seguem o filtro de filial (07/10): numa filial nova, os
  // 700 itens do grupo sem estoque aqui apareciam como 'esgotados'. O principal
  // de grade fica de fora: quem tem saldo sao as variacoes.
  // Sem o catalogo carregado (lista paginada), os numeros vem da contagem no servidor.
  const semPrincipaisDeGrade = pecasList.filter((peca) => peca.temGrade !== true);
  const pecasDoResumo = grupo && escopoFilial === 'filial' ? semPrincipaisDeGrade.filter((peca) => itemDaFilial(peca, tenantId)) : semPrincipaisDeGrade;
  const formatarContagem = (n: number | null) => (n === null ? '—' : n);
  const resumoTotal = modoCompleto ? pecasDoResumo.length : formatarContagem(contagens.total);
  const resumoBaixo = modoCompleto ? pecasDoResumo.filter(p => p.quantidade > 0 && p.quantidade < 5).length : formatarContagem(contagens.baixo);
  const resumoEsgotados = modoCompleto ? pecasDoResumo.filter(p => p.quantidade <= 0).length : formatarContagem(contagens.esgotados);

  const getStatusBadge = (quantidade: number) => {
    if (quantidade <= 0) {
      return (
        <span className="status-badge" style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>
          <span className="status-dot" style={{ backgroundColor: '#ef4444' }}></span>
          Esgotado
        </span>
      );
    } else if (quantidade < 5) {
      return (
        <span className="status-badge" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}>
          <span className="status-dot" style={{ backgroundColor: '#f59e0b' }}></span>
          Baixo
        </span>
      );
    } else {
      return (
        <span className="status-badge" style={{ backgroundColor: '#10b98120', color: '#10b981' }}>
          <span className="status-dot" style={{ backgroundColor: '#10b981' }}></span>
          Em Estoque
        </span>
      );
    }
  };

  /** Valor da embalagem que nao foi digitado nela: veio do produto x quantidade da embalagem. */
  const marcaCalculado = (calculado: boolean, oQue: string) => (calculado ? (
    <span className="estoque-calc" title={`${oQue} calculado: valor do produto × quantidade da embalagem. Para usar um valor próprio, informe na aba Embalagens do produto.`}>calc.</span>
  ) : null);
  const reaisOuTraco = (valor: number, dica: string) => (valor > 0 ? MOEDA.format(valor) : <span className="estoque-mudo" title={dica}>—</span>);
  const formatarQuantidade = (valor: number, casas: number) => valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

  /**
   * Uma linha da tabela: produto comum, principal de grade (saldo = soma das
   * variacoes, chevron para abri-las) ou variacao (indentada, abre o principal).
   * Produto com embalagem (21/11/2026): o selo "2 embalagens: TB, RL" abre, logo
   * embaixo, uma linha por embalagem com saldo, venda e a vista nas mesmas
   * colunas -- sem precisar abrir o cadastro. Custo e margem nao aparecem na
   * lista (decisao do dono, 21/11/2026): so' dentro do cadastro.
   */
  const linhaDoProduto = (pecaCrua: PecaData, opcoes: { principal?: PecaData; aberto?: boolean; totalDeVariacoes?: number }) => {
    const { principal, aberto = false, totalDeVariacoes = 0 } = opcoes;
    const peca = comSaldoDasVariacoes(pecaCrua);
    const ehPrincipalDeGrade = pecaCrua.temGrade === true;
    const idParaAbrir = principal ? principal.id : peca.id;
    const precos = precosDoProdutoDaLista(peca);
    const reserva = resumoDeReserva(peca);
    const casas = peca.unidadeMedidaCasasDecimais ?? 0;
    const siglaDaBase = peca.unidadeMedidaSigla || 'UN';
    const embalagens = venderPorEmbalagem ? embalagensDaLista(peca) : [];
    const embalagensAbertasAgora = embalagens.length > 0 && (embalagensAbertas.get(peca.id) ?? todasEmbalagensAbertas);
    const classeDaLinha = [
      canEditProduto ? 'row-selectable' : '',
      canEditProduto && selectedId === peca.id ? 'is-selected' : '',
      embalagensAbertasAgora ? 'estoque-linha-aberta' : '',
    ].filter(Boolean).join(' ');

    const linhaPrincipal = (
    <tr
      key={peca.id}
      // Sem permissao de abrir o cadastro a linha nao abre nada --
      // seria um duplo clique que so devolve erro.
      className={classeDaLinha || undefined}
      onClick={canEditProduto ? () => setSelectedId(peca.id) : undefined}
      onDoubleClick={canEditProduto ? () => abrirProduto(idParaAbrir) : undefined}
      // Enter abre o produto selecionado -- o duplo clique sozinho
      // deixaria a linha inacessivel por teclado.
      onKeyDown={canEditProduto ? (event) => {
        if (event.key === 'Enter') abrirProduto(idParaAbrir);
      } : undefined}
      tabIndex={canEditProduto ? 0 : undefined}
      title={canEditProduto ? (principal ? 'Duplo clique abre o produto principal (a variação se edita no quadro da grade)' : 'Clique para selecionar, duplo clique para editar') : undefined}
      style={travasProdutos.has(peca.id) ? { opacity: 0.55 } : undefined}
    >
      {ver('codigo') && <td className="font-medium" style={{ color: 'var(--text-muted)', paddingLeft: principal ? '28px' : undefined }}>{peca.codigo}</td>}
      <td>
        {ehPrincipalDeGrade && (
          // Abre/fecha as variacoes sem selecionar nem abrir a linha.
          <button
            type="button"
            className="icon-btn"
            title={aberto ? 'Esconder variações' : 'Mostrar variações'}
            onClick={(e) => { e.stopPropagation(); alternarExpandido(peca.id, aberto); }}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{ marginRight: '6px', verticalAlign: 'middle' }}
          >
            {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        {principal ? (
          <span style={{ paddingLeft: '18px', color: 'var(--text-primary)' }}>
            ↳ {peca.variacaoRotulo || peca.nome}
            {peca.codigoBarras && <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>{peca.codigoBarras}</span>}
          </span>
        ) : peca.nome}
        {ehPrincipalDeGrade && (
          // O selo tambem abre/fecha: e' o alvo mais facil de acertar que o chevron.
          <button
            type="button"
            title={aberto ? 'Esconder variações' : 'Mostrar variações'}
            onClick={(e) => { e.stopPropagation(); alternarExpandido(peca.id, aberto); }}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1px 7px', whiteSpace: 'nowrap', background: 'transparent', cursor: 'pointer' }}
          >
            Grade · {totalDeVariacoes} variação(ões) {aberto ? '▾' : '▸'}
          </button>
        )}
        {embalagens.length > 0 && (
          // Mesmo jeito do selo da grade: abre/fecha sem selecionar nem abrir o produto.
          <button
            type="button"
            className="estoque-embalagens-selo"
            aria-expanded={embalagensAbertasAgora}
            title={embalagensAbertasAgora ? 'Esconder as embalagens' : 'Mostrar as embalagens com saldo e preços'}
            onClick={(e) => { e.stopPropagation(); setEmbalagensAbertas((atual) => new Map(atual).set(peca.id, !embalagensAbertasAgora)); }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {embalagensAbertasAgora ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {resumoDasEmbalagens(embalagens)}
          </button>
        )}
        <MarcaEmEdicao trava={travasProdutos.get(peca.id)} />
      </td>
      {ver('categoria') && <td>{peca.categoria}</td>}
      {ver('quantidade') && (
        <td className="font-medium estoque-num">
          {formatarQuantidade(Number(peca.quantidade) || 0, casas)} <span className="estoque-un">{siglaDaBase}</span>
        </td>
      )}
      {/* Reservado e disponivel sem abrir o cadastro; clicar no reservado mostra em que documento ele esta preso. */}
      {ver('reservado') && <td className="estoque-num" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {reserva.temReserva && ehPrincipalDeGrade ? (
          // A reserva esta' nas variacoes: abra o principal para ver cada uma.
          <span style={{ color: '#c084fc', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatarQuantidade(reserva.reservada, casas)}</span>
        ) : reserva.temReserva ? (
          <button
            type="button"
            onClick={() => setReservaAberta(peca)}
            title="Ver de onde vem a reserva"
            style={{ background: 'color-mix(in srgb, #a855f7 16%, transparent)', color: '#c084fc', border: 'none', borderRadius: '999px', padding: '2px 10px', fontWeight: 600, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
          >
            {formatarQuantidade(reserva.reservada, casas)}
          </button>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>}
      {ver('disponivel') && (
        <td className="font-medium estoque-num" style={{ color: reserva.temReserva ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {formatarQuantidade(reserva.disponivel, casas)}
        </td>
      )}
      {ver('preco') && <td className="estoque-num"><strong>{MOEDA.format(precos.venda)}</strong></td>}
      {ver('vista') && <td className="estoque-num">{reaisOuTraco(precos.vista, 'Sem preço à vista: vale o de venda')}</td>}
      {ver('status') && <td>{getStatusBadge(Number(peca.quantidade))}</td>}
      {ver('ativo') && <td>
        <span style={{
          backgroundColor: peca.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
          color: peca.ativo === false ? 'var(--text-muted)' : '#10b981',
          padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
        }}>
          {peca.ativo === false ? 'Inativo' : 'Ativo'}
        </span>
      </td>}
      <td>
        {canEditProduto && (
          // stopPropagation: sem isso, um duplo clique acidental
          // em cima do botao tambem abriria a tela de edicao.
          <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" title={principal ? 'Abrir o produto principal' : 'Editar'} onClick={() => abrirProduto(idParaAbrir)}>
              <Edit size={16} />
            </button>
            <button
              className="icon-btn"
              title={peca.ativo === false ? 'Ativar' : 'Inativar'}
              style={{ color: peca.ativo === false ? '#10b981' : '#ef4444' }}
              onClick={() => handleToggleAtivo(peca)}
            >
              <Power size={16} />
            </button>
            <button
              className="icon-btn"
              title="Excluir (só sem movimentação)"
              style={{ color: '#ef4444' }}
              onClick={() => { if (!avisarSeEmEdicao(travasProdutos, 'produto', peca.id)) void confirmarEExcluirCadastro('estoque', peca.id, peca.nome, principal ? 'a variação' : 'o produto'); }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </td>
    </tr>
    );

    if (!embalagensAbertasAgora) return [linhaPrincipal];
    // O saldo da embalagem e' o mesmo estoque (na unidade base) contado em embalagens.
    const linhasDasEmbalagens = embalagens.map((unidade, indice) => {
      const casasDaEmbalagem = unidade.fracionado ? unidade.casasDecimais : 0;
      return (
        <tr
          key={`${peca.id}-embalagem-${unidade.embalagemId}`}
          className={`estoque-emb-linha${indice === embalagens.length - 1 ? ' estoque-emb-linha--ultima' : ''}`}
          onDoubleClick={canEditProduto ? () => abrirProduto(idParaAbrir) : undefined}
          title={canEditProduto ? 'Duplo clique abre o produto (os valores da embalagem se mudam na aba Embalagens)' : undefined}
        >
          {ver('codigo') && <td />}
          <td>
            <div className="estoque-emb-nome">
              <span className="estoque-sigla" title={unidade.codigoBarras ? `Código de barras: ${unidade.codigoBarras}` : undefined}>{unidade.sigla}</span>
              <span>{equivalenciaDaEmbalagem(unidade, siglaDaBase)}</span>
              {unidade.descricao && <span className="estoque-mudo estoque-emb-descricao" title={unidade.descricao}>· {unidade.descricao}</span>}
            </div>
          </td>
          {ver('categoria') && <td />}
          {ver('quantidade') && (
            <td className="estoque-num estoque-mudo-2" title={unidade.fracionado ? undefined : 'Embalagens completas que o saldo dá'}>
              {formatarQuantidade(saldoNaEmbalagem(peca.quantidade, unidade), casasDaEmbalagem)} <span className="estoque-un">{unidade.sigla}</span>
            </td>
          )}
          {ver('reservado') && <td />}
          {ver('disponivel') && <td className="estoque-num estoque-mudo-2">{formatarQuantidade(saldoNaEmbalagem(reserva.disponivel, unidade), casasDaEmbalagem)}</td>}
          {ver('preco') && <td className="estoque-num"><strong>{reaisOuTraco(unidade.venda, 'Sem preço de venda')}</strong>{marcaCalculado(unidade.vendaCalculada, 'Preço de venda')}</td>}
          {ver('vista') && <td className="estoque-num">{reaisOuTraco(unidade.vista, 'Sem preço à vista: vale o de venda')}{marcaCalculado(unidade.vistaCalculada, 'Preço à vista')}</td>}
          {ver('status') && <td />}
          {ver('ativo') && <td />}
          <td />
        </tr>
      );
    });
    return [linhaPrincipal, ...linhasDasEmbalagens];
  };

  /**
   * "Tabela de precos": cada unidade de venda do produto numa linha (a unidade
   * do estoque e, com "Vender por embalagem", cada embalagem ativa).
   */
  const linhasDePreco = (pecaCrua: PecaData, principal?: PecaData) => {
    const peca = comSaldoDasVariacoes(pecaCrua);
    const unidades: UnidadeDeVendaDaLista[] = venderPorEmbalagem ? unidadesDeVendaDaLista(peca) : [unidadeBaseDaLista(peca)];
    const idParaAbrir = principal ? principal.id : peca.id;
    return unidades.map((unidade, indice) => (
      <tr
        key={`${peca.id}-preco-${unidade.embalagemId || 'base'}`}
        className={[
          'estoque-precos-linha',
          indice > 0 ? 'estoque-precos-linha--seguinte' : '',
          indice === unidades.length - 1 ? 'estoque-precos-linha--ultima' : '',
          canEditProduto ? 'row-selectable' : '',
        ].filter(Boolean).join(' ')}
        onDoubleClick={canEditProduto ? () => abrirProduto(idParaAbrir) : undefined}
        title={canEditProduto ? 'Duplo clique abre o produto' : undefined}
        style={travasProdutos.has(peca.id) ? { opacity: 0.55 } : undefined}
      >
        <td className="font-medium" style={{ color: 'var(--text-muted)' }}>{indice === 0 ? peca.codigo : ''}</td>
        <td>
          {indice === 0 && (principal
            ? <span style={{ paddingLeft: '12px' }}>↳ {peca.variacaoRotulo || peca.nome}</span>
            : <span className="estoque-precos-nome">{peca.nome}</span>)}
          {indice === 0 && <MarcaEmEdicao trava={travasProdutos.get(peca.id)} />}
        </td>
        <td>
          <div className="estoque-unidade">
            <span className={`estoque-sigla${unidade.base ? ' estoque-sigla--base' : ''}`}>{unidade.sigla}</span>
            <span className="estoque-mudo-2">{unidade.base ? 'unidade do estoque' : equivalenciaDaEmbalagem(unidade, peca.unidadeMedidaSigla || 'UN')}</span>
            {unidade.descricao && <span className="estoque-mudo">· {unidade.descricao}</span>}
          </div>
        </td>
        <td className="estoque-num"><strong>{reaisOuTraco(unidade.venda, 'Sem preço de venda')}</strong>{marcaCalculado(unidade.vendaCalculada, 'Preço de venda')}</td>
        <td className="estoque-num">{reaisOuTraco(unidade.vista, 'Sem preço à vista: vale o de venda')}{marcaCalculado(unidade.vistaCalculada, 'Preço à vista')}</td>
        <td className="estoque-mudo estoque-barras">{unidade.codigoBarras}</td>
        <td>
          {indice === 0 && canEditProduto && (
            <button
              className="icon-btn"
              title={principal ? 'Abrir o produto principal' : 'Editar'}
              onClick={(e) => { e.stopPropagation(); abrirProduto(idParaAbrir); }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Edit size={16} />
            </button>
          )}
        </td>
      </tr>
    ));
  };

  return (
    <div className="estoque-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Estoque e Produtos</h1>
          <p className="page-subtitle">Controle de inventário, produtos e insumos</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="estoque-visao" role="group" aria-label="Como ver a lista">
            <button type="button" aria-pressed={visao === 'estoque'} onClick={() => escolherVisao('estoque')} title="Saldo, reserva e preços de cada produto">
              Estoque
            </button>
            <button type="button" aria-pressed={visao === 'precos'} onClick={() => escolherVisao('precos')} title="Cada unidade de venda (metro, tubo, rolo...) numa linha, com os preços">
              Tabela de preços
            </button>
          </div>
          {/* A vista so' o "Novo Produto"; o resto e' de uso eventual (dono, 02/10). */}
          <MenuMaisOpcoes
            itens={[
              { texto: 'Importar produtos', Icone: Upload, onClick: () => openTab('/estoque/importar', 'Importar Produtos') },
              { texto: 'Importar composição', Icone: Factory, onClick: () => openTab('/estoque/importar-composicao', 'Importar Composição') },
              {
                texto: 'Importar dados fiscais', Icone: ScanBarcode,
                titulo: 'Atualiza código de barras, NCM e CEST dos produtos já cadastrados',
                onClick: () => openTab('/estoque/importar-fiscal', 'Importar Dados Fiscais'),
              },
              { texto: 'Padronizar nomes (A-Z)', Icone: CaseUpper, onClick: handleFixNames, separadorAntes: true },
              {
                texto: 'Colunas da lista', Icone: Columns3,
                titulo: 'Escolher quais colunas aparecem nesta lista (vale para todos os usuários da filial)',
                oculto: !podeAlterarConfiguracoes,
                separadorAntes: true,
                onClick: () => { void escolherColunas(); },
              },
              {
                texto: mostrarResumo ? 'Esconder cartões de resumo' : 'Mostrar cartões de resumo',
                Icone: mostrarResumo ? EyeOff : Eye,
                titulo: 'Vale para todos os usuários da empresa (Configurações da filial → "Mostrar os cartões de resumo na tela de Estoque")',
                oculto: !podeAlterarConfiguracoes,
                separadorAntes: true,
                onClick: () => { void alternarResumo(); },
              },
            ]}
          />
          {canEditProduto && (
            <button
              className="btn-primary"
              onClick={() => openTab('/estoque/nova')}
            >
              <Plus size={18} style={{ marginRight: 8 }} />
              Novo Produto
            </button>
          )}
        </div>
      </div>

      {/* Cartoes de resumo: a empresa decide se aparecem (Configuracoes ->
          Estoque). Ver DEFAULT_MOSTRAR_RESUMO_ESTOQUE. */}
      {mostrarResumo && (
      <div className="dashboard-charts" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '8px' }}>
         <div className="card stat-card" style={{ padding: '20px' }}>
          <div className="stat-header">
            <div className="stat-icon blue-bg">
              <Package size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{resumoTotal}</h3>
            <p>Itens Cadastrados</p>
          </div>
        </div>
        <div className="card stat-card" style={{ padding: '20px' }}>
          <div className="stat-header">
            <div className="stat-icon yellow-bg">
              <AlertCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{resumoBaixo}</h3>
            <p>Estoque Baixo</p>
          </div>
        </div>
        <div className="card stat-card" style={{ padding: '20px' }}>
          <div className="stat-header">
            <div className="stat-icon" style={{ backgroundColor: '#ef444415', color: '#ef4444' }}>
              <AlertCircle size={24} />
            </div>
          </div>
          <div className="stat-info">
            <h3>{resumoEsgotados}</h3>
            <p>Itens Esgotados</p>
          </div>
        </div>
      </div>
      )}

      {reservaAberta && tenantId && (
        <OrigensDaReservaModal tenantId={tenantId} produto={reservaAberta} onFechar={() => setReservaAberta(null)} />
      )}

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Buscar…"
              title={DICA_BUSCA_MULTIPLA}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <label
            className="btn-secondary filter-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <Filter size={18} />
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as 'ativos' | 'inativos' | 'todos')}
              style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
            >
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </label>
          <label
            className="btn-secondary filter-btn"
            title="Filtrar pela quantidade em estoque (coluna Qtd.)"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', ...(filtroSaldo !== 'todos' ? { borderColor: '#a855f7', color: '#c084fc' } : {}) }}
          >
            <Boxes size={18} />
            <select
              value={filtroSaldo}
              onChange={(e) => setFiltroSaldo(e.target.value as FiltroSaldo)}
              aria-label="Filtrar pelo saldo em estoque"
              style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
            >
              {(Object.keys(ROTULO_FILTRO_SALDO) as FiltroSaldo[]).map((chave) => (
                <option key={chave} value={chave}>{ROTULO_FILTRO_SALDO[chave]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary filter-btn"
            onClick={() => setSoComReserva((v) => !v)}
            aria-pressed={soComReserva}
            title="Mostrar só os produtos com estoque reservado em pré-venda, condicional, OS ou troca"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', ...(soComReserva ? { borderColor: '#a855f7', color: '#c084fc' } : {}) }}
          >
            Com reserva
          </button>
          {usaGradeDeProdutos && (
            <button
              type="button"
              className="btn-secondary filter-btn"
              onClick={() => setSoComGrade((v) => !v)}
              aria-pressed={soComGrade}
              title="Mostrar só os produtos com grade (tamanho, cor...) e suas variações"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', ...(soComGrade ? { borderColor: '#a855f7', color: '#c084fc' } : {}) }}
            >
              Com grade
            </button>
          )}
          {venderPorEmbalagem && (
            <button
              type="button"
              className="btn-secondary filter-btn"
              onClick={() => setSoComEmbalagem((v) => !v)}
              aria-pressed={soComEmbalagem}
              title="Mostrar só os produtos vendidos também em embalagem (rolo, tubo, saco...)"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', ...(soComEmbalagem ? { borderColor: '#a855f7', color: '#c084fc' } : {}) }}
            >
              Com embalagem
            </button>
          )}
          {grupo && podeTrocarFilial && (
            <label
              className="btn-secondary filter-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            >
              <Building2 size={18} />
              <select
                value={escopoFilial}
                onChange={(e) => setEscopoFilial(e.target.value as 'filial' | 'grupo')}
                aria-label="Itens de qual filial"
                style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
              >
                <option value="filial">Itens desta filial</option>
                <option value="grupo">Todas as filiais</option>
              </select>
            </label>
          )}
          {venderPorEmbalagem && visao === 'estoque' && (
            <button
              type="button"
              className="btn-secondary filter-btn"
              onClick={alternarTodasEmbalagens}
              aria-pressed={todasEmbalagensAbertas}
              title={todasEmbalagensAbertas ? 'Fechar as embalagens de todos os produtos' : 'Mostrar as embalagens de todos os produtos, com saldo e preços'}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}
            >
              <Package size={16} />
              {todasEmbalagensAbertas ? 'Fechar embalagens' : 'Abrir embalagens'}
            </button>
          )}
        </div>

        <div className="table-wrapper">
          {visao === 'precos' ? (
          <table className="data-table estoque-tabela">
            <thead>
              <tr>
                <th aria-sort={ordemLista.campo === 'codigo' && ordemSaldo === 'padrao' ? (ordemLista.desc ? 'descending' : 'ascending') : 'none'}>
                  <BotaoOrdem ativo={ordemLista.campo === 'codigo' && ordemSaldo === 'padrao'} desc={ordemLista.desc} onClick={() => ordenarPor('codigo')} titulo="Ordenar pelo código">Código</BotaoOrdem>
                </th>
                <th aria-sort={ordemLista.campo === 'nome' && ordemSaldo === 'padrao' ? (ordemLista.desc ? 'descending' : 'ascending') : 'none'}>
                  <BotaoOrdem ativo={ordemLista.campo === 'nome' && ordemSaldo === 'padrao'} desc={ordemLista.desc} onClick={() => ordenarPor('nome')} titulo="Ordenar pelo nome (A-Z)">Produto</BotaoOrdem>
                </th>
                <th>Unidade de venda</th>
                <th className="estoque-num">Venda</th>
                <th className="estoque-num">À vista</th>
                <th>Código de barras</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalDeColunasDosPrecos} style={{ textAlign: 'center', padding: '20px' }}>Carregando Estoque...</td>
                </tr>
              ) : linhasVisiveis.length === 0 ? (
                <tr>
                  <td colSpan={totalDeColunasDosPrecos} style={{ padding: '8px' }}>
                    <EstadoVazio titulo={searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : 'Nenhum produto cadastrado no estoque.'} compacto />
                  </td>
                </tr>
              ) : (
                linhasNaTela.flatMap(({ peca, variacoesQuePassam }) => [
                  ...linhasDePreco(peca),
                  ...variacoesQuePassam.flatMap((variacao) => linhasDePreco(variacao, peca)),
                ])
              )}
            </tbody>
          </table>
          ) : (
          <table className="data-table estoque-tabela">
            <thead>
              <tr>
                {ver('codigo') && (
                  <th aria-sort={ordemLista.campo === 'codigo' && ordemSaldo === 'padrao' ? (ordemLista.desc ? 'descending' : 'ascending') : 'none'}>
                    <BotaoOrdem ativo={ordemLista.campo === 'codigo' && ordemSaldo === 'padrao'} desc={ordemLista.desc} onClick={() => ordenarPor('codigo')} titulo="Ordenar pelo código">Código / SKU</BotaoOrdem>
                  </th>
                )}
                <th aria-sort={ordemLista.campo === 'nome' && ordemSaldo === 'padrao' ? (ordemLista.desc ? 'descending' : 'ascending') : 'none'}>
                  <BotaoOrdem ativo={ordemLista.campo === 'nome' && ordemSaldo === 'padrao'} desc={ordemLista.desc} onClick={() => ordenarPor('nome')} titulo="Ordenar pelo nome (A-Z)">Nome do Produto</BotaoOrdem>
                </th>
                {ver('categoria') && <th>Categoria</th>}
                {ver('quantidade') && <th className="estoque-num" aria-sort={ordemSaldo === 'maior' ? 'descending' : ordemSaldo === 'menor' ? 'ascending' : 'none'}>
                  <button
                    type="button"
                    onClick={() => setOrdemSaldo((atual) => proximaOrdemSaldo(atual))}
                    title={ROTULO_ORDEM_SALDO[ordemSaldo]}
                    aria-label={ROTULO_ORDEM_SALDO[ordemSaldo]}
                    style={{ background: 'none', border: 'none', padding: 0, color: ordemSaldo === 'padrao' ? 'inherit' : '#c084fc', font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', textTransform: 'inherit', letterSpacing: 'inherit' }}
                  >
                    Qtd.
                    {ordemSaldo === 'maior' ? <ArrowDown size={14} /> : ordemSaldo === 'menor' ? <ArrowUp size={14} /> : <ArrowUpDown size={14} style={{ opacity: 0.6 }} />}
                  </button>
                </th>}
                {ver('reservado') && <th className="estoque-num">Reservado</th>}
                {ver('disponivel') && <th className="estoque-num">Disponível</th>}
                {ver('preco') && <th className="estoque-num">Venda</th>}
                {ver('vista') && <th className="estoque-num">À vista</th>}
                {ver('status') && <th>Status</th>}
                {ver('ativo') && <th>Ativo</th>}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalDeColunas} style={{ textAlign: 'center', padding: '20px' }}>Carregando Estoque...</td>
                </tr>
              ) : linhasVisiveis.length === 0 ? (
                <tr>
                  <td colSpan={totalDeColunas} style={{ padding: '8px' }}>
                    <EstadoVazio titulo={searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : 'Nenhum produto cadastrado no estoque.'} compacto />
                  </td>
                </tr>
              ) : (
                linhasNaTela.flatMap(({ peca, variacoes, aberto, totalDeVariacoes }) => [
                  ...linhaDoProduto(peca, { aberto, totalDeVariacoes }),
                  ...variacoes.flatMap((variacao) => linhaDoProduto(variacao, { principal: peca })),
                ])
              )}
            </tbody>
          </table>
          )}
        </div>
        {modoBuscaNoBanco && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>
            <span>Mostrando o que começa com &quot;{splitSearchTerms(termoBusca)[0]}&quot; ou tem esse código, código de barras ou referência.</span>
            <button type="button" className="btn-secondary" onClick={() => setBuscaCompleta(true)}>
              Procurar em qualquer parte do nome
            </button>
          </div>
        )}
        {restamNaTela > 0 && !loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px' }}>
            <button type="button" className="btn-secondary" onClick={() => setLimiteNaTela((n) => n + LINHAS_POR_VEZ)}>
              Mostrar mais ({restamNaTela.toLocaleString('pt-BR')} restantes)
            </button>
          </div>
        )}
        {temMaisPaginas && !loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px' }}>
            <button type="button" className="btn-secondary" onClick={verMais}>
              Ver mais produtos
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EstoqueList;

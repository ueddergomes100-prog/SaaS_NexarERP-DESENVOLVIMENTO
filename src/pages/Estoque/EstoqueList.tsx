import React, { useEffect, useState } from 'react';
import { Plus, Search, Filter, AlertCircle, Package, Edit, Power, Trash2, Upload, Factory, ScanBarcode, CaseUpper, Eye, EyeOff, Building2, ChevronDown, ChevronRight } from 'lucide-react';
import { chaveDoProdutoPeloId, itemDaFilial } from '../../utils/cadastroGrupoDomain';
import { agruparVariacoes, somaDasVariacoes } from '../../utils/gradeProdutosDomain';
import { collection, query, onSnapshot, doc, where, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { avisarSeEmEdicao, useTravasAtivas } from '../../hooks/useTravaDeEdicao';
import { MarcaEmEdicao } from '../../components/common/TravaDeEdicaoAviso';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { isPlatformAdminRole } from '../../utils/roles';
import { DICA_BUSCA_MULTIPLA, matchesAllSearchTerms } from '../../utils/textSearch';
import { DEFAULT_MOSTRAR_RESUMO_ESTOQUE, parseMostrarResumoEstoque } from '../../utils/estoqueResumoDomain';
import { avisoInativacaoComSaldo, avisoInativacaoSemSaldo, precisaZerarParaInativar } from '../../utils/estoqueInativacaoDomain';
import './Estoque.css';
import { CadastroError, alterarSituacaoCadastro } from '../../services/cadastroService';
import { confirmarEExcluirCadastro } from '../../utils/excluirCadastroUi';
import EstadoVazio from '../../components/common/EstadoVazio';
import OrigensDaReservaModal from '../../components/common/OrigensDaReservaModal';
import { resumoDeReserva } from '../../utils/estoqueReservaDomain';

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
}

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
  const [reservaAberta, setReservaAberta] = useState<PecaData | null>(null);
  /** Linha destacada por um clique simples. Editar exige duplo clique (ou
   * Enter), pra um clique de leitura nao abrir uma aba sem querer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Principais de grade que a pessoa abriu/fechou no chevron (vale por cima do
   * padrao: fechado sem busca, aberto quando a busca bateu numa variacao). */
  const [expandidos, setExpandidos] = useState<Map<string, boolean>>(new Map());
  /** Configuracoes -> Estoque: mostrar os cartoes de resumo no topo. */
  const [mostrarResumo, setMostrarResumo] = useState(DEFAULT_MOSTRAR_RESUMO_ESTOQUE);

  const { currentUser, tenantId, userRole, userPermissions, isOwner, grupo, podeTrocarFilial, usaGradeDeProdutos } = useAuth();
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
    }, (error) => {
      // Falha de leitura MANTEM o que ja estava: piscar os cartoes por causa
      // de uma queda de rede seria pior do que continuar mostrando.
      console.error('Erro ao carregar a configuracao de resumo do estoque:', error);
    });

    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const pecas: PecaData[] = [];
      querySnapshot.forEach((doc) => {
        pecas.push({ id: doc.id, ...doc.data() } as PecaData);
      });
      // Por codigo (numerico, nao alfabetico) -- sequencia que o usuario
      // reconhece do sistema antigo/papel, nao a ordem do nome.
      pecas.sort((a, b) => (Number(a.codigo) || 0) - (Number(b.codigo) || 0));
      setPecasList(pecas);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar estoque:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

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
      try {
        let count = 0;
        for (const p of pecasList) {
          const upName = p.nome.toUpperCase().trim();
          if (p.nome !== upName) {
            await updateDoc(doc(db, 'estoque', p.id), {
              nome: upName,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nome padronizado para maiúsculas'),
            });
            count++;
          }
        }
        showSuccess(`Pronto! ${count} produtos foram atualizados.`);
      } catch(err) {
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
    return passaNoStatus && passaNaFilial && passaNaReserva;
  };
  // Mesma busca das telas de venda: acento nao conta e "+" exige todas as
  // palavras ("Racao+Quatree+20KG"). Ver matchesAllSearchTerms. A variacao
  // tambem bate pela combinacao (P / AZUL) e pelo codigo de barras dela.
  const passaNaBusca = (peca: PecaData) => matchesAllSearchTerms(
    [peca.nome, peca.codigo, peca.categoria, ...(peca.ehVariacao ? [peca.variacaoRotulo ?? '', peca.codigoBarras ?? ''] : [])],
    searchTerm,
  );
  const buscando = searchTerm.trim() !== '';
  /** O principal aparece se ele ou alguma variacao passa; buscando, as variacoes
   * que bateram ja' vem abertas -- e o chevron abre/fecha em qualquer caso. */
  const linhasVisiveis = principais.flatMap((peca) => {
    if (soComGrade && peca.temGrade !== true) return [];
    const todas = variacoesDe(peca);
    const variacoesQueBatem = todas.filter((v) => passaNosFiltros(v) && passaNaBusca(v));
    if (!(passaNosFiltros(peca) && passaNaBusca(peca)) && variacoesQueBatem.length === 0) return [];
    const aberto = expandidos.get(peca.id) ?? (buscando && variacoesQueBatem.length > 0);
    const variacoes = !aberto ? [] : buscando ? variacoesQueBatem : todas.filter(passaNosFiltros);
    return [{ peca, variacoes, aberto, totalDeVariacoes: todas.length }];
  });

  const alternarExpandido = (id: string, abertoAgora: boolean) => {
    setExpandidos((atual) => new Map(atual).set(id, !abertoAgora));
  };

  // Cartoes de resumo seguem o filtro de filial (07/10): numa filial nova, os
  // 700 itens do grupo sem estoque aqui apareciam como 'esgotados'. O principal
  // de grade fica de fora: quem tem saldo sao as variacoes.
  const semPrincipaisDeGrade = pecasList.filter((peca) => peca.temGrade !== true);
  const pecasDoResumo = grupo && escopoFilial === 'filial' ? semPrincipaisDeGrade.filter((peca) => itemDaFilial(peca, tenantId)) : semPrincipaisDeGrade;

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

  /**
   * Uma linha da tabela: produto comum, principal de grade (saldo = soma das
   * variacoes, chevron para abri-las) ou variacao (indentada, abre o principal).
   */
  const linhaDoProduto = (pecaCrua: PecaData, opcoes: { principal?: PecaData; aberto?: boolean; totalDeVariacoes?: number }) => {
    const { principal, aberto = false, totalDeVariacoes = 0 } = opcoes;
    const peca = comSaldoDasVariacoes(pecaCrua);
    const ehPrincipalDeGrade = pecaCrua.temGrade === true;
    const idParaAbrir = principal ? principal.id : peca.id;
    return (
    <tr
      key={peca.id}
      // Sem permissao de abrir o cadastro a linha nao abre nada --
      // seria um duplo clique que so devolve erro.
      className={canEditProduto ? (selectedId === peca.id ? 'row-selectable is-selected' : 'row-selectable') : undefined}
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
      <td className="font-medium" style={{ color: 'var(--text-muted)', paddingLeft: principal ? '28px' : undefined }}>{peca.codigo}</td>
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
        <MarcaEmEdicao trava={travasProdutos.get(peca.id)} />
      </td>
      <td>{peca.categoria}</td>
      <td className="font-medium">
        {Number(peca.quantidade).toFixed(peca.unidadeMedidaCasasDecimais ?? 0)} {peca.unidadeMedidaSigla || 'UN'}
      </td>
      {(() => {
        // Reservado e disponivel sem abrir o cadastro; clicar no
        // reservado mostra em que documento ele esta preso.
        const reserva = resumoDeReserva(peca);
        const casas = peca.unidadeMedidaCasasDecimais ?? 0;
        return (
          <>
            <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              {reserva.temReserva && ehPrincipalDeGrade ? (
                // A reserva esta' nas variacoes: abra o principal para ver cada uma.
                <span style={{ color: '#c084fc', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{reserva.reservada.toFixed(casas)}</span>
              ) : reserva.temReserva ? (
                <button
                  type="button"
                  onClick={() => setReservaAberta(peca)}
                  title="Ver de onde vem a reserva"
                  style={{ background: 'color-mix(in srgb, #a855f7 16%, transparent)', color: '#c084fc', border: 'none', borderRadius: '999px', padding: '2px 10px', fontWeight: 600, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
                >
                  {reserva.reservada.toFixed(casas)}
                </button>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              )}
            </td>
            <td className="font-medium" style={{ color: reserva.temReserva ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {reserva.disponivel.toFixed(casas)}
            </td>
          </>
        );
      })()}
      <td>
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(peca.precoVenda))}
      </td>
      <td>{getStatusBadge(Number(peca.quantidade))}</td>
      <td>
        <span style={{
          backgroundColor: peca.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
          color: peca.ativo === false ? 'var(--text-muted)' : '#10b981',
          padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
        }}>
          {peca.ativo === false ? 'Inativo' : 'Ativo'}
        </span>
      </td>
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
  };

  return (
    <div className="estoque-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Estoque e Produtos</h1>
          <p className="page-subtitle">Controle de inventário, produtos e insumos</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
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
            <h3>{pecasDoResumo.length}</h3>
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
            <h3>{pecasDoResumo.filter(p => p.quantidade > 0 && p.quantidade < 5).length}</h3>
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
            <h3>{pecasDoResumo.filter(p => p.quantidade <= 0).length}</h3>
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
              placeholder="Buscar por código, nome ou categoria"
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
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código / SKU</th>
                <th>Nome do Produto</th>
                <th>Categoria</th>
                <th>Qtd.</th>
                <th>Reservado</th>
                <th>Disponível</th>
                <th>Preço (Venda)</th>
                <th>Status</th>
                <th>Ativo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '20px' }}>Carregando Estoque...</td>
                </tr>
              ) : linhasVisiveis.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '8px' }}>
                    <EstadoVazio titulo={searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : 'Nenhum produto cadastrado no estoque.'} compacto />
                  </td>
                </tr>
              ) : (
                linhasVisiveis.flatMap(({ peca, variacoes, aberto, totalDeVariacoes }) => [
                  linhaDoProduto(peca, { aberto, totalDeVariacoes }),
                  ...variacoes.map((variacao) => linhaDoProduto(variacao, { principal: peca })),
                ])
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default EstoqueList;

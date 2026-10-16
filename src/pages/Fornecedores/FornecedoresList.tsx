import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Edit, Power, Trash2, Upload, FileText } from 'lucide-react';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { avisarSeEmEdicao, useTravasAtivas } from '../../hooks/useTravaDeEdicao';
import { MarcaEmEdicao } from '../../components/common/TravaDeEdicaoAviso';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import ValidarDocumentoButton from '../../components/common/ValidarDocumentoButton';
import { formatarDocumento } from '../../utils/documentoValidacao';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import { alterarSituacaoCadastro } from '../../services/cadastroService';
import { confirmarEExcluirCadastro } from '../../utils/excluirCadastroUi';
import EstadoVazio from '../../components/common/EstadoVazio';
import { BotaoFiltros, CampoFiltro, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import FiltrosDeCadastro from '../../components/common/FiltrosDeCadastro';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { FILTRO_LOCAL_VAZIO, listarLocaisDosClientes, passaNoFiltroLocal, type FiltroLocalCliente } from '../../utils/clientSearch';
import {
  FILTRO_EXTRA_CLIENTES_VAZIO,
  diaDoCadastro,
  frasesDosFiltrosDeCadastro,
  quantosFiltrosExtras,
  situacaoNoRelatorio,
  type FiltroExtraClientes,
} from '../../utils/relatorioClientesDomain';
import { TIPOS_DE_FORNECEDOR, montarDocumentoFornecedores, passaNosFiltrosDoFornecedor } from '../../utils/relatorioFornecedoresDomain';

interface FornecedorData {
  id: string;
  codigo: string;
  nome: string;
  cnpj: string;
  telefone: string;
  email: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  // Campos que so' o relatorio usa (16/10/2026).
  tipo?: string;
  identidade?: string;
  celular?: string;
  estado?: string;
  cep?: string;
  observacoes?: string;
  ativo?: boolean;
  createdAt: any;
}

const formatCnpjOuCpf = (digits: string) => (digits ? formatarDocumento(digits) : '-');

const FornecedoresList: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const { openTab } = useTabs();
  // Trava de edicao (fase 2, 16/10/2026): em edicao por outra pessoa = cinza e nao abre.
  const travasFornecedores = useTravasAtivas('fornecedor');
  const abrirFornecedor = (id: string) => {
    if (avisarSeEmEdicao(travasFornecedores, 'fornecedor', id)) return;
    void openTab(`/fornecedores/editar/${id}`);
  };
  const [fornecedores, setFornecedores] = useState<FornecedorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Filtros e relatorio (16/10/2026): o relatorio sai com o que esta filtrado aqui.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocalCliente>(FILTRO_LOCAL_VAZIO);
  const [tipoCadastro, setTipoCadastro] = useState('');
  const [filtroExtra, setFiltroExtra] = useState<FiltroExtraClientes>(FILTRO_EXTRA_CLIENTES_VAZIO);
  const [previewAberto, setPreviewAberto] = useState(false);

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: FornecedorData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as FornecedorData);
      });
      // Por codigo (numerico, nao alfabetico) -- e' a sequencia que o
      // usuario reconhece do sistema antigo/papel, nao a ordem do nome.
      data.sort((a, b) => (Number(a.codigo) || 0) - (Number(b.codigo) || 0));
      setFornecedores(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar fornecedores:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const handleToggleAtivo = async (fornecedor: FornecedorData) => {
    if (!currentUser) return;
    if (avisarSeEmEdicao(travasFornecedores, 'fornecedor', fornecedor.id)) return;
    const novoStatus = fornecedor.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar ${fornecedor.nome}?` : `Inativar ${fornecedor.nome}?`,
      text: novoStatus
        ? `${fornecedor.nome} volta a aparecer nas buscas de compra e entrada de nota.`
        : `${fornecedor.nome} some das buscas de compra e entrada de nota, mas o histórico dele continua intacto. Pode ser reativado quando quiser.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await alterarSituacaoCadastro('fornecedores', fornecedor.id, novoStatus);
      showSuccess(novoStatus ? 'Fornecedor ativado!' : 'Fornecedor inativado!');
    } catch (error) {
      console.error("Erro ao atualizar status do fornecedor:", error);
      showError('Erro ao atualizar', (error as Error).message || 'Tente novamente mais tarde.');
    }
  };

  const locais = useMemo(() => listarLocaisDosClientes(fornecedores), [fornecedores]);

  const filteredFornecedores = fornecedores.filter((registro) => passaNaSituacao(registro.ativo !== false, situacao)).filter(fornecedor => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (fornecedor.nome && fornecedor.nome.toLowerCase().includes(term)) ||
      (fornecedor.cnpj && fornecedor.cnpj.includes(searchTerm)) ||
      (fornecedor.telefone && fornecedor.telefone.includes(searchTerm))
    );
  })
    .filter((fornecedor) => passaNoFiltroLocal(fornecedor, filtroLocal))
    .filter((fornecedor) => passaNosFiltrosDoFornecedor({ ...fornecedor, cadastradoEm: diaDoCadastro(fornecedor.createdAt) }, tipoCadastro, filtroExtra));

  const filtrosAtivos = (filtroLocal.uf || filtroLocal.cidade ? 1 : 0) + (tipoCadastro ? 1 : 0) + quantosFiltrosExtras(filtroExtra);
  const limparFiltros = () => {
    setFiltroLocal(FILTRO_LOCAL_VAZIO);
    setTipoCadastro('');
    setFiltroExtra(FILTRO_EXTRA_CLIENTES_VAZIO);
  };

  if (previewAberto) {
    const filtrosAplicados = frasesDosFiltrosDeCadastro({
      busca: searchTerm,
      situacao: situacaoNoRelatorio(situacao),
      filtroLocal,
      locais,
      filtro: filtroExtra,
      extras: tipoCadastro ? [`Tipo: ${tipoCadastro}`] : [],
    });
    return (
      <RelatorioPreview
        relatorioId="fornecedores-cadastro"
        documento={montarDocumentoFornecedores(
          filteredFornecedores.map((f) => ({ ...f, cadastradoEm: diaDoCadastro(f.createdAt) })),
          { filtrosAplicados, cadastradoDe: filtroExtra.cadastradoDe, cadastradoAte: filtroExtra.cadastradoAte },
        )}
        nomeArquivo={nomeArquivoRelatorio('Relatório de Fornecedores', filtroExtra.cadastradoDe, filtroExtra.cadastradoAte)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos fornecedores"
      />
    );
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Fornecedores</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Cadastro de fornecedores usados na entrada de notas fiscais e compras</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <MenuMaisOpcoes
            itens={[
              {
                texto: 'Relatório', Icone: FileText,
                titulo: 'Abre em PDF os fornecedores filtrados na tela (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
                desabilitado: loading,
                onClick: () => setPreviewAberto(true),
              },
              { texto: 'Importar fornecedores', Icone: Upload, onClick: () => openTab('/fornecedores/importar', 'Importar Fornecedores'), separadorAntes: true },
            ]}
          />
          <button className="btn-primary" onClick={() => openTab('/fornecedores/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo Fornecedor
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar fornecedor, CNPJ ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <FiltroSituacao valor={situacao} onChange={setSituacao} />
            <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
          </div>
        </div>

        <FiltrosDeCadastro
          aberto={filtrosAbertos}
          quantidadeAtiva={filtrosAtivos}
          onLimpar={limparFiltros}
          locais={locais}
          filtroLocal={filtroLocal}
          onFiltroLocal={setFiltroLocal}
          filtro={filtroExtra}
          onFiltro={(parcial) => setFiltroExtra((atual) => ({ ...atual, ...parcial }))}
        >
          <CampoFiltro rotulo="Tipo">
            <select value={tipoCadastro} onChange={(e) => setTipoCadastro(e.target.value)} style={estiloCampoFiltro}>
              <option value="">Todos</option>
              {TIPOS_DE_FORNECEDOR.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </CampoFiltro>
        </FiltrosDeCadastro>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome / Razão Social</th>
                <th>Telefone</th>
                <th>CNPJ / CPF</th>
                <th>E-mail</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>Carregando fornecedores...</td>
                </tr>
              ) : filteredFornecedores.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '8px' }}>
                    <EstadoVazio
                      titulo={searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : (filtrosAtivos > 0 ? 'Nenhum fornecedor com esses filtros.' : 'Nenhum fornecedor cadastrado.')}
                      compacto
                    />
                  </td>
                </tr>
              ) : (
                filteredFornecedores.map((fornecedor) => (
                  <tr key={fornecedor.id} {...linha(fornecedor.id, () => abrirFornecedor(fornecedor.id))} style={travasFornecedores.has(fornecedor.id) ? { opacity: 0.55 } : undefined}>
                    <td style={{ color: 'var(--text-muted)' }}>{fornecedor.codigo || '-'}</td>
                    <td className="font-medium">
                      {fornecedor.nome}
                      <MarcaEmEdicao trava={travasFornecedores.get(fornecedor.id)} />
                    </td>
                    <td>{fornecedor.telefone || '-'}</td>
                    <td>{formatCnpjOuCpf(fornecedor.cnpj)}</td>
                    <td>{fornecedor.email || '-'}</td>
                    <td>
                      <span style={{
                        backgroundColor: fornecedor.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                        color: fornecedor.ativo === false ? 'var(--text-muted)' : '#10b981',
                        padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {fornecedor.ativo === false ? 'Inativo' : 'Ativo'}
                      </span>
                    </td>
                    <td {...semAbrirLinha}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <ValidarDocumentoButton documento={fornecedor.cnpj} />
                        <button className="icon-btn" title="Editar" onClick={() => abrirFornecedor(fornecedor.id)}>
                          <Edit size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title={fornecedor.ativo === false ? 'Ativar' : 'Inativar'}
                          style={{ color: fornecedor.ativo === false ? '#10b981' : '#ef4444' }}
                          onClick={() => handleToggleAtivo(fornecedor)}
                        >
                          <Power size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Excluir (só sem movimentação)"
                          style={{ color: '#ef4444' }}
                          onClick={() => { if (!avisarSeEmEdicao(travasFornecedores, 'fornecedor', fornecedor.id)) void confirmarEExcluirCadastro('fornecedores', fornecedor.id, fornecedor.nome, 'o fornecedor'); }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FornecedoresList;

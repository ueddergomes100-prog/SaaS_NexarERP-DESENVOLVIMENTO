import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Edit, Power, FileText, CaseUpper } from 'lucide-react';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { collection, query, onSnapshot, doc, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import { alterarSituacaoCadastro } from '../../services/cadastroService';
import EstadoVazio from '../../components/common/EstadoVazio';
import { BotaoFiltros, CampoFiltro, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { situacaoNoRelatorio } from '../../utils/relatorioClientesDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { categoriasDosServicos, montarDocumentoServicos, passaNaCategoria } from '../../utils/relatorioServicosDomain';

interface ServicoData {
  id: string;
  codigo: string;
  nome: string;
  categoria: string;
  preco: number;
  comissaoPercentual?: number | string | null;
  ativo?: boolean;
}

const ServicosList: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const [searchTerm, setSearchTerm] = useState('');
  const { openTab } = useTabs();
  const [servicos, setServicos] = useState<ServicoData[]>([]);
  const [loading, setLoading] = useState(true);
  // Filtro e relatorio (16/10/2026): o relatorio sai com o que esta filtrado aqui.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [categoria, setCategoria] = useState('');
  const [previewAberto, setPreviewAberto] = useState(false);
  const categorias = useMemo(() => categoriasDosServicos(servicos), [servicos]);

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: ServicoData[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as ServicoData));
      // Por codigo (numerico, nao alfabetico) -- sequencia que o usuario
      // reconhece do sistema antigo/papel, nao a ordem do nome.
      data.sort((a, b) => (Number(a.codigo) || 0) - (Number(b.codigo) || 0));
      setServicos(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  const handleToggleAtivo = async (servico: ServicoData) => {
    if (!currentUser) return;
    const novoStatus = servico.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar "${servico.nome}"?` : `Inativar "${servico.nome}"?`,
      text: novoStatus
        ? 'O serviço volta a aparecer na hora de montar uma OS.'
        : 'O serviço some da hora de montar uma OS, mas o histórico continua intacto. Pode ser reativado quando quiser.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await alterarSituacaoCadastro('servicos', servico.id, novoStatus);
      showSuccess(novoStatus ? 'Serviço ativado!' : 'Serviço inativado!');
    } catch (error) {
      showError('Erro', (error as Error).message || 'Não foi possível atualizar o status do serviço.');
    }
  };

  const handleFixNames = async () => {
    if (!currentUser) return;
    const isConfirmed = await NexusSwal.fire({
      title: 'Padronizar Nomes?',
      text: 'Isto converterá o nome de TODOS os serviços para MAIÚSCULAS.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, padronizar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      try {
        let count = 0;
        for (const s of servicos) {
          const upName = s.nome.toUpperCase().trim();
          // registro inativo nao se edita (firestore.rules)
          if (s.ativo !== false && s.nome !== upName) {
            await updateDoc(doc(db, 'servicos', s.id), {
              nome: upName,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nome padronizado para maiúsculas'),
            });
            count++;
          }
        }
        showSuccess(`Pronto! ${count} serviços foram atualizados.`);
      } catch(err) {
        showError('Erro', 'Ocorreu um erro na migração.');
      } finally {
        setLoading(false);
      }
    }
  };


  // A busca existia na tela mas nao estava ligada a nada (2026-09-19).
  const termoServico = searchTerm.trim().toLowerCase();
  const filteredServicos = servicos
    .filter((registro) => passaNaSituacao(registro.ativo !== false, situacao))
    .filter((servico) => !termoServico
      || (servico.nome || '').toLowerCase().includes(termoServico)
      || String(servico.codigo || '').toLowerCase().includes(termoServico)
      || (servico.categoria || '').toLowerCase().includes(termoServico))
    .filter((servico) => passaNaCategoria(servico, categoria));

  const filtrosAtivos = categoria ? 1 : 0;

  if (previewAberto) {
    const hoje = getDateInputInTimeZone();
    const filtrosAplicados = [
      searchTerm.trim() ? `Busca: "${searchTerm.trim()}"` : '',
      situacaoNoRelatorio(situacao) ? `Situação: ${situacaoNoRelatorio(situacao)}` : '',
      categoria ? `Categoria: ${categoria}` : '',
    ].filter(Boolean);
    return (
      <RelatorioPreview
        relatorioId="servicos-tabela"
        documento={montarDocumentoServicos(filteredServicos, { filtrosAplicados, dataHoje: hoje })}
        nomeArquivo={nomeArquivoRelatorio('Tabela de Serviços', hoje, hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos serviços"
      />
    );
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Serviços</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Catálogo de mão de obra e pacotes</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <MenuMaisOpcoes
            itens={[
              {
                texto: 'Relatório', Icone: FileText,
                titulo: 'Abre em PDF a tabela dos serviços filtrados na tela (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
                desabilitado: loading,
                onClick: () => setPreviewAberto(true),
              },
              { texto: 'Padronizar nomes (A-Z)', Icone: CaseUpper, onClick: handleFixNames, separadorAntes: true },
            ]}
          />
          <button className="btn-primary" onClick={() => openTab('/servicos/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo Serviço
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar serviço..." 
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

        <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={() => setCategoria('')}>
          <CampoFiltro rotulo="Categoria">
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={estiloCampoFiltro}>
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </CampoFiltro>
        </PainelFiltros>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome do Serviço</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Valor / Hora</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredServicos.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '8px' }}><EstadoVazio titulo={searchTerm || filtrosAtivos > 0 ? 'Nenhum serviço com essa busca ou filtro.' : 'Nenhum serviço cadastrado.'} compacto /></td></tr>
              ) : (
                filteredServicos.map((servico) => (
                  <tr key={servico.id} {...linha(servico.id, () => openTab(`/servicos/editar/${servico.id}`))}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{servico.codigo || '-'}</td>
                    <td className="font-medium">{servico.nome}</td>
                    <td>{servico.categoria || '-'}</td>
                    <td style={{ textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(servico.preco || 0)}
                    </td>
                    <td>
                      <span style={{
                        backgroundColor: servico.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                        color: servico.ativo === false ? 'var(--text-muted)' : '#10b981',
                        padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {servico.ativo === false ? 'Inativo' : 'Ativo'}
                      </span>
                    </td>
                    <td {...semAbrirLinha}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => openTab(`/servicos/editar/${servico.id}`)}>
                          <Edit size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title={servico.ativo === false ? 'Ativar' : 'Inativar'}
                          style={{ color: servico.ativo === false ? '#10b981' : '#ef4444' }}
                          onClick={() => handleToggleAtivo(servico)}
                        >
                          <Power size={16} />
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

export default ServicosList;

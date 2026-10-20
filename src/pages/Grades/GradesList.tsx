import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, LayoutGrid, Edit, Power, X, Loader2, AlertTriangle } from 'lucide-react';
import { collection, query, onSnapshot, doc, where, updateDoc, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { chaveDoProdutoPeloId } from '../../utils/cadastroGrupoDomain';
import {
  LIMITE_DA_OPCAO,
  LIMITE_DO_NOME_DA_GRADE,
  gradeEmUso,
  lerGrade,
  lerOpcoesDigitadas,
  normalizarOpcao,
  opcoesEmUso,
  type FilhoDaGrade,
  type PaiDaGrade,
} from '../../utils/gradeProdutosDomain';
import { useEscapeLayer, useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import '../OS/OS.css';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import { alterarSituacaoCadastro } from '../../services/cadastroService';
import EstadoVazio from '../../components/common/EstadoVazio';

/**
 * Cadastros Auxiliares > Grades (19/10/2026): nome + opcoes (TAMANHO: P, M, G;
 * COR: AZUL, PRETO). O produto escolhe ate' duas grades e cada combinacao vira
 * uma variacao -- ver src/utils/gradeProdutosDomain.ts. So' aparece com
 * "Loja utiliza grade de produtos" ligado nas Configuracoes Gerais.
 */
interface GradeData {
  id: string;
  nome: string;
  opcoes: string[];
  ativo?: boolean;
}

/** O que ja' esta em uso por produtos: nome da grade e opcoes de cada uma. */
interface UsoDasGrades {
  pais: PaiDaGrade[];
  filhos: FilhoDaGrade[];
}

const GradesList: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const [grades, setGrades] = useState<GradeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [opcoes, setOpcoes] = useState<string[]>([]);
  const [novaOpcao, setNovaOpcao] = useState('');
  /** Uso das grades por produtos, lido ao abrir o modal de edicao. */
  const [uso, setUso] = useState<UsoDasGrades>({ pais: [], filhos: [] });
  const [modalLoading, setModalLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const novaOpcaoRef = useRef<HTMLInputElement>(null);

  const { currentUser, tenantId, userRole, userPermissions, isOwner, usaGradeDeProdutos } = useAuth();
  const navigate = useNavigate();

  const canAccess = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('cadastros.grades'));

  useEscapeLayer(isModalOpen, () => closeModal());
  useKeyboardShortcuts([
    { key: 'F2', handler: () => searchInputRef.current?.focus() },
    { key: 'F6', handler: () => openNewModal() },
  ]);

  useEffect(() => {
    if (!currentUser || !tenantId || !canAccess) return;
    const q = query(collection(db, 'grades'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: GradeData[] = [];
      snapshot.forEach((d) => {
        const dados = d.data();
        data.push({ id: d.id, nome: String(dados.nome || ''), opcoes: Array.isArray(dados.opcoes) ? dados.opcoes.map(String) : [], ativo: dados.ativo });
      });
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setGrades(data);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar grades:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, tenantId, canAccess]);

  /** Produtos com grade e suas variacoes: decide o que nao pode mais mudar na grade. */
  const carregarUso = async (): Promise<UsoDasGrades> => {
    if (!tenantId) return { pais: [], filhos: [] };
    const [paisSnap, filhosSnap] = await Promise.all([
      getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId), where('temGrade', '==', true))),
      getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId), where('ehVariacao', '==', true))),
    ]);
    return {
      pais: paisSnap.docs.map((d) => ({
        chave: String(d.data().grupoChave || '') || chaveDoProdutoPeloId(d.id, tenantId),
        gradeNomes: Array.isArray(d.data().gradeNomes) ? d.data().gradeNomes.map(String) : [],
      })),
      filhos: filhosSnap.docs.map((d) => ({
        produtoPaiChave: String(d.data().produtoPaiChave || ''),
        variacao: Array.isArray(d.data().variacao) ? d.data().variacao.map(String) : [],
      })),
    };
  };

  const handleToggleAtivo = async (grade: GradeData) => {
    if (!currentUser) return;
    const novoStatus = grade.ativo === false;

    const confirm = await NexusSwal.fire({
      title: novoStatus ? `Ativar "${grade.nome}"?` : `Inativar "${grade.nome}"?`,
      text: novoStatus
        ? 'A grade volta a aparecer na hora de cadastrar produto.'
        : 'A grade some da hora de cadastrar produto novo. Produtos que já usam essa grade continuam como estão. Pode ser reativada quando quiser.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: novoStatus ? 'Sim, ativar' : 'Sim, inativar',
      cancelButtonText: 'Cancelar',
    });
    if (!confirm.isConfirmed) return;

    try {
      await alterarSituacaoCadastro('grades', grade.id, novoStatus);
      showSuccess(novoStatus ? 'Grade ativada!' : 'Grade inativada!');
    } catch (error) {
      showError(novoStatus ? 'Não foi possível ativar' : 'Não foi possível inativar', (error as Error).message || 'Tente novamente mais tarde.');
    }
  };

  const openNewModal = () => {
    setEditingId(null);
    setNome('');
    setOpcoes([]);
    setNovaOpcao('');
    setUso({ pais: [], filhos: [] });
    setIsModalOpen(true);
  };

  const openEditModal = async (grade: GradeData) => {
    // Cadastro inativo nao se altera (firestore.rules): reative antes.
    if (grade.ativo === false) {
      showError('Grade inativa', `A grade "${grade.nome}" está inativa e não pode ser alterada. Para alterar, reative-a na lista de Grades.`);
      return;
    }
    setEditingId(grade.id);
    setNome(grade.nome);
    setOpcoes(grade.opcoes);
    setNovaOpcao('');
    setIsModalOpen(true);
    try {
      setUso(await carregarUso());
    } catch (error) {
      // Sem conseguir ler os produtos, a tela nao sabe o que esta em uso:
      // fecha pra nao deixar tirar uma opcao que alguma variacao usa.
      console.error('Erro ao conferir o uso da grade:', error);
      setIsModalOpen(false);
      showError('Não foi possível abrir a grade', 'Não deu para conferir quais produtos usam esta grade. Confira sua conexão e tente de novo.');
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
  };

  const nomeEmUso = editingId !== null && gradeEmUso(nome, uso.pais);
  const usadas = editingId !== null ? opcoesEmUso(nome, uso.pais, uso.filhos) : new Set<string>();

  const adicionarOpcao = () => {
    const novas = lerOpcoesDigitadas(novaOpcao).filter((o) => !opcoes.some((atual) => normalizarOpcao(atual) === normalizarOpcao(o)));
    if (novas.length === 0) {
      if (novaOpcao.trim()) showError('Opção repetida', 'Essa opção já está na grade.');
      return;
    }
    setOpcoes((atual) => [...atual, ...novas]);
    setNovaOpcao('');
    novaOpcaoRef.current?.focus();
  };

  const removerOpcao = (opcao: string) => {
    if (usadas.has(normalizarOpcao(opcao))) {
      showError('Opção em uso', `A opção "${opcao}" já está em variações de produto e não pode sair da grade. Inative as variações que a usam antes.`);
      return;
    }
    setOpcoes((atual) => atual.filter((o) => o !== opcao));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const leitura = lerGrade(nome, opcoes);
    if (!leitura.ok) {
      showError('Confira a grade', leitura.erro);
      return;
    }
    const { valor } = leitura;
    const repetida = grades.some((g) => g.id !== editingId && normalizarOpcao(g.nome) === normalizarOpcao(valor.nome));
    if (repetida) {
      showError('Nome repetido', `Já existe uma grade chamada ${valor.nome}. Use outro nome ou edite a que já existe.`);
      return;
    }

    setModalLoading(true);
    try {
      if (editingId) {
        const original = grades.find((g) => g.id === editingId);
        if (original && nomeEmUso && normalizarOpcao(original.nome) !== normalizarOpcao(valor.nome)) {
          showError('Nome em uso', `A grade "${original.nome}" já está em produtos cadastrados e não pode mudar de nome.`);
          return;
        }
        await updateDoc(doc(db, 'grades', editingId), {
          nome: valor.nome,
          opcoes: valor.opcoes,
          tenantId,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Grade atualizada!');
      } else {
        await addDoc(collection(db, 'grades'), {
          nome: valor.nome,
          opcoes: valor.opcoes,
          tenantId,
          ativo: true,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Grade cadastrada!');
      }
      closeModal();
    } catch (err) {
      console.error(err);
      showError('Erro ao salvar', 'Não foi possível salvar a grade. Confira sua conexão e tente de novo.');
    } finally {
      setModalLoading(false);
    }
  };

  const filteredGrades = grades
    .filter((registro) => passaNaSituacao(registro.ativo !== false, situacao))
    .filter((g) => normalizarOpcao(g.nome).includes(normalizarOpcao(searchTerm))
      || g.opcoes.some((o) => normalizarOpcao(o).includes(normalizarOpcao(searchTerm))));

  if (!canAccess) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '20px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '20px' }}>
          <AlertTriangle size={48} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>Acesso Negado</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 24px' }}>
          Você não possui permissão para gerenciar as grades de produto. Solicite ao administrador da empresa para liberar "Cadastros: Grades de produto".
        </p>
        <button className="btn-primary" onClick={() => navigate('/dashboard')}>
          Ir para o Dashboard
        </button>
      </div>
    );
  }

  if (!usaGradeDeProdutos) {
    return (
      <div className="page-container">
        <EstadoVazio
          titulo="A grade de produtos está desligada."
          texto='Para usar tamanho, cor e outras variações, ligue "Loja utiliza grade de produtos" em Configurações › Configurações Gerais.'
        />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Grades</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Tamanho, cor e outras variações dos produtos</p>
        </div>
        <button className="btn-primary" onClick={openNewModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Nova Grade
        </button>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar grade..."
              ref={searchInputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <FiltroSituacao valor={situacao} onChange={setSituacao} />
          <div className="shortcuts-hint">
            <span><kbd>F2</kbd> Buscar</span>
            <span><kbd>F6</kbd> Nova</span>
            <span><kbd>Esc</kbd> Fechar</span>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Grade</th>
                <th>Opções</th>
                <th style={{ width: '12%' }}>Status</th>
                <th style={{ width: '12%' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredGrades.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '8px' }}>
                    <EstadoVazio titulo={grades.length === 0 ? 'Nenhuma grade cadastrada. Comece por TAMANHO (P, M, G) ou COR.' : 'Nenhuma grade encontrada.'} compacto />
                  </td>
                </tr>
              ) : (
                filteredGrades.map((grade) => (
                  <tr key={grade.id} {...linha(grade.id, () => { void openEditModal(grade); })}>
                    <td className="font-medium" style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>{grade.nome}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {grade.opcoes.map((opcao) => (
                          <span key={opcao} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '2px 9px', backgroundColor: 'var(--bg-tertiary)' }}>
                            {opcao}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        backgroundColor: grade.ativo === false ? 'rgba(255,255,255,0.05)' : '#10b98120',
                        color: grade.ativo === false ? 'var(--text-muted)' : '#10b981',
                        padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {grade.ativo === false ? 'Inativa' : 'Ativa'}
                      </span>
                    </td>
                    <td {...semAbrirLinha}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => { void openEditModal(grade); }}>
                          <Edit size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title={grade.ativo === false ? 'Ativar' : 'Inativar'}
                          style={{ color: grade.ativo === false ? '#10b981' : '#ef4444' }}
                          onClick={() => handleToggleAtivo(grade)}
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

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '520px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)', padding: '24px', position: 'relative', boxShadow: 'var(--shadow-card)', animation: 'pageFadeIn 0.2s ease-out',
          }}>
            <button onClick={closeModal} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LayoutGrid size={20} color="#8b5cf6" />
              {editingId ? 'Editar Grade' : 'Nova Grade'}
            </h3>

            <form onSubmit={handleSave}>
              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome da grade *</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value.toUpperCase())}
                  required
                  maxLength={LIMITE_DO_NOME_DA_GRADE}
                  readOnly={nomeEmUso}
                  title={nomeEmUso ? 'Grade já usada em produtos: o nome não muda' : undefined}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)', opacity: nomeEmUso ? 0.7 : 1 }}
                />
                {nomeEmUso && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                    Esta grade já está em produtos cadastrados: o nome não muda, mas você pode acrescentar opções.
                  </span>
                )}
              </div>

              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Opções *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '34px', padding: '6px 0' }}>
                  {opcoes.length === 0 && (
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhuma opção ainda. Acrescente abaixo (uma por vez ou várias separadas por vírgula).</span>
                  )}
                  {opcoes.map((opcao) => {
                    const emUso = usadas.has(normalizarOpcao(opcao));
                    return (
                      <span
                        key={opcao}
                        title={emUso ? 'Opção já usada em variações de produto' : undefined}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '4px 6px 4px 11px', backgroundColor: 'var(--bg-tertiary)' }}
                      >
                        {opcao}
                        <button
                          type="button"
                          onClick={() => removerOpcao(opcao)}
                          title={emUso ? 'Em uso: não pode sair da grade' : 'Tirar da grade'}
                          style={{ background: 'none', border: 'none', cursor: emUso ? 'not-allowed' : 'pointer', color: emUso ? 'var(--text-muted)' : '#ef4444', display: 'inline-flex', padding: 0 }}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    ref={novaOpcaoRef}
                    type="text"
                    value={novaOpcao}
                    maxLength={LIMITE_DA_OPCAO * 4}
                    onChange={(e) => setNovaOpcao(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        adicionarOpcao();
                      }
                    }}
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  />
                  <button type="button" className="btn-secondary" onClick={adicionarOpcao} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={16} /> Acrescentar
                  </button>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                  A ordem das opções é a ordem do quadro de variações no produto.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={modalLoading}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={modalLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {modalLoading && <Loader2 size={16} className="spin-icon" />}
                  {modalLoading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GradesList;

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  collection, query, where, getDocs, writeBatch, doc, serverTimestamp,
} from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, Tags, Upload } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
} from '../../utils/importacaoEstoqueDomain';
import {
  inferirMapeamentoColunasCategoria,
  montarCategoriaImportada,
  processarLinhasCategorias,
  TIPOS_CATEGORIA,
  type CategoriaImportada,
  type MapeamentoColunasCategoria,
  type TipoCategoria,
} from '../../utils/importacaoCategoriasDomain';

/**
 * Importacao em massa de categorias (grupos, no vocabulario do sistema
 * antigo) a partir do cadastro de um cliente novo (CSV/XLSX). Mesmo padrao
 * de 3 passos das outras importacoes (clientes/produtos): mapeamento
 * confirmado pelo usuario, linha duplicada fica destacada pra revisao,
 * nada e gravado sem confirmar a tela final.
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

const ImportarCategorias: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasCategoria>({ nome: 0, tipo: null });

  const [categorias, setCategorias] = useState<CategoriaImportada[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [nomesExistentes, setNomesExistentes] = useState<Set<string>>(new Set());

  const [salvando, setSalvando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<{ criados: number } | null>(null);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
      if (tenantId) {
        const existentesSnap = await getDocs(query(collection(db, 'categorias'), where('tenantId', '==', tenantId)));
        const nomes = new Set<string>();
        existentesSnap.forEach((d) => {
          const nome = String(d.data().nome || '').trim().toUpperCase();
          if (nome) nomes.add(nome);
        });
        setNomesExistentes(nomes);
      }

      const nomeLower = file.name.toLowerCase();
      let linhas: string[][];

      if (nomeLower.endsWith('.xlsx') || nomeLower.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
        const matriz = XLSX.utils.sheet_to_json<string[]>(primeiraAba, { header: 1, raw: false, defval: '' });
        linhas = matriz.map((linha) => linha.map((celula) => String(celula ?? '').trim()));
      } else {
        const buffer = await file.arrayBuffer();
        const texto = decodificarArquivoTexto(buffer);
        const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
        const delimitador = detectarDelimitador(primeiraLinha);
        linhas = parseDelimitedText(texto, delimitador);
      }

      linhas = linhas.filter((linha) => linha.some((c) => c && c.trim()));
      if (linhas.length < 2) {
        showError('Planilha vazia', 'Não encontramos nenhuma linha de dado nesta planilha.');
        return;
      }

      const [linhaCabecalho, ...resto] = linhas;
      setNomeArquivo(file.name);
      setCabecalho(linhaCabecalho);
      setLinhasDados(resto);
      setMapeamento(inferirMapeamentoColunasCategoria(linhaCabecalho));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler arquivo de importação:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const confirmarMapeamento = () => {
    const processados = processarLinhasCategorias(linhasDados, mapeamento);
    if (processados.length === 0) {
      showError(
        'Nenhuma categoria encontrada nessa coluna',
        'A coluna selecionada para "Nome" veio em branco em todas as linhas. Confira no cabeçalho da planilha se a coluna certa foi escolhida.',
      );
      return;
    }
    setCategorias(processados);
    setItensExcluidos(new Set());
    setPasso('confirmacao');
  };

  const atualizarCategoria = (linhaId: number, patch: Partial<CategoriaImportada>) => {
    setCategorias((atual) => atual.map((c) => (c.linhaId === linhaId ? { ...c, ...patch } : c)));
  };

  const linhasAtivas = useMemo(() => categorias.filter((c) => !itensExcluidos.has(c.linhaId)), [categorias, itensExcluidos]);

  const avisoDuplicado = (categoria: CategoriaImportada): string => {
    if (nomesExistentes.has(categoria.nome)) return 'Já existe uma categoria cadastrada com este nome.';
    return '';
  };

  const linhaTemProblema = (categoria: CategoriaImportada): boolean => (
    !categoria.nome.trim() || avisoDuplicado(categoria) !== ''
  );

  const totalComProblema = linhasAtivas.filter(linhaTemProblema).length;
  const categoriasProntas = totalComProblema === 0 && linhasAtivas.length > 0;

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!categoriasProntas) {
      showError('Ainda há linhas pendentes', `${totalComProblema} linha(s) precisam ser corrigidas, ou marcadas como "não importar", antes de continuar.`);
      return;
    }

    setSalvando(true);
    try {
      const timestamp = serverTimestamp();

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < linhasAtivas.length; inicio += LOTE_MAXIMO) {
        const lote = linhasAtivas.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);

        lote.forEach((categoria) => {
          const docRef = doc(collection(db, 'categorias'));
          batch.set(docRef, montarCategoriaImportada(
            { nome: categoria.nome, tipo: categoria.tipo },
            tenantId,
            currentUser.uid,
            timestamp,
          ));
        });

        await batch.commit();
      }

      setResultadoImportacao({ criados: linhasAtivas.length });
      setPasso('concluido');
      showSuccess(`${linhasAtivas.length} categoria(s) importada(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar categorias:', error);
      showError('Erro ao importar', 'Não foi possível concluir a importação. Nenhuma categoria foi gravada neste lote com erro -- tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/categorias')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Tags size={26} color="var(--accent-purple)" /> Importar Categorias
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Importação em massa a partir do cadastro de grupos/categorias de outro sistema (CSV ou XLSX)</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '440px' }}>
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é o nome da categoria (e o tipo, se a planilha tiver essa informação).
            </p>
          </div>
          <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            {carregandoArquivo ? <Loader2 size={18} className="spin-animation" /> : <FileUp size={18} />}
            {carregandoArquivo ? 'Lendo arquivo...' : 'Escolher arquivo'}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              disabled={carregandoArquivo}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleArquivoSelecionado(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {passo === 'mapeamento' && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confirme as colunas</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Arquivo: {nomeArquivo} — {linhasDados.length} linha(s) de dado encontrada(s).</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de Nome da categoria</label>
              <select
                value={mapeamento.nome}
                onChange={(e) => setMapeamento((atual) => ({ ...atual, nome: Number(e.target.value) }))}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
              >
                {cabecalho.map((h, idx) => <option key={idx} value={idx}>{h || `Coluna ${idx + 1}`}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de Tipo (opcional)</label>
              <select
                value={mapeamento.tipo === null ? '' : mapeamento.tipo}
                onChange={(e) => setMapeamento((atual) => ({ ...atual, tipo: e.target.value === '' ? null : Number(e.target.value) }))}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
              >
                <option value="">-- Nenhuma (usa "Peça" pra todas) --</option>
                {cabecalho.map((h, idx) => <option key={idx} value={idx}>{h || `Coluna ${idx + 1}`}</option>)}
              </select>
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
            Se a planilha não trouxer o tipo, toda categoria entra como "Peça / Produto" — você pode ajustar cada uma na próxima tela.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('upload')}>Voltar</button>
            <button className="btn-primary" onClick={confirmarMapeamento} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Continuar <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {passo === 'confirmacao' && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confira e corrija cada categoria</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {categorias.length} categoria(s) encontrada(s){totalComProblema > 0 ? `, ${totalComProblema} precisam de atenção (destacadas abaixo)` : ''}.
            </p>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Nome</th>
                  <th style={{ padding: '8px' }}>Tipo</th>
                  <th style={{ padding: '8px' }}>Situação</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Não importar</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((categoria) => {
                  const excluido = itensExcluidos.has(categoria.linhaId);
                  const problema = linhaTemProblema(categoria);
                  const aviso = avisoDuplicado(categoria);
                  const motivos = [categoria.motivo, aviso].filter(Boolean).join(' ');
                  return (
                    <tr key={categoria.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: (problema && !excluido) ? 'rgba(245,158,11,0.08)' : undefined, opacity: excluido ? 0.4 : 1 }}>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={categoria.nome} onChange={(e) => atualizarCategoria(categoria.linhaId, { nome: e.target.value.toUpperCase() })} style={{ ...inputStyle, width: '260px', textTransform: 'uppercase' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select value={categoria.tipo} onChange={(e) => atualizarCategoria(categoria.linhaId, { tipo: e.target.value as TipoCategoria })} style={{ ...inputStyle, width: '160px' }}>
                          {TIPOS_CATEGORIA.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {problema && !excluido ? (
                          <span style={{ color: '#f59e0b', fontWeight: 600 }} title={motivos}>REVISAR</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>OK</span>
                        )}
                        {motivos && !excluido && <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '260px' }}>{motivos}</div>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={excluido}
                          onChange={(e) => setItensExcluidos((atual) => {
                            const novo = new Set(atual);
                            if (e.target.checked) novo.add(categoria.linhaId); else novo.delete(categoria.linhaId);
                            return novo;
                          })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('mapeamento')} disabled={salvando}>Voltar</button>
            <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !categoriasProntas} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !categoriasProntas) ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : `Importar ${linhasAtivas.length} categoria(s)`}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} categoria(s) importada(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px' }}>
            As categorias já aparecem em Categorias.
          </p>
          <button className="btn-primary" onClick={() => navigate('/categorias')}>Ir para Categorias</button>
        </div>
      )}
    </div>
  );
};

export default ImportarCategorias;

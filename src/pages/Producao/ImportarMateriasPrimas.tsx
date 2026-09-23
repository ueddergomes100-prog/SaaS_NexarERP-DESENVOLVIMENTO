import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, Factory, Upload } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { getProximoCodigoMateriaPrima } from '../../utils/materiaPrimaCodigo';
import { garantirMarcasCadastradas } from '../../utils/marcaDomain';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
  inferirMapeamentoColunasMateriaPrima,
  processarLinhasMateriaPrima,
  montarMateriaPrimaImportada,
  type ItemMateriaPrimaImportado,
  type MapeamentoColunasMateriaPrima,
} from '../../utils/importacaoMateriaPrimaDomain';

/**
 * Importacao em massa de materias-primas a partir de um export do sistema
 * antigo (CSV/XLSX). Versao mais simples da de Estoque (ImportarProdutos.tsx):
 * materia-prima nao tem embalagem nem vinculo de unidade com uma colecao --
 * so upload, mapeamento de colunas e confirmacao linha a linha.
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

interface MateriaPrimaConfirmar {
  chave: string;
  nome: string;
  categoria: string;
  unidade: string;
  quantidade: string;
  custo: string;
  marca: string;
  referencia: string;
  linhaId: number;
}

const ImportarMateriasPrimas: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasMateriaPrima>({ codigo: null, descricao: 0, quantidade: 1, unidade: null, custo: null, marca: null, referencia: null });

  const [itens, setItens] = useState<ItemMateriaPrimaImportado[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [categoriaCompartilhada, setCategoriaCompartilhada] = useState('');
  const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrimaConfirmar[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<{ criados: number } | null>(null);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
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
      setMapeamento(inferirMapeamentoColunasMateriaPrima(linhaCabecalho));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler arquivo de importação:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const confirmarMapeamento = () => {
    const processados = processarLinhasMateriaPrima(linhasDados, mapeamento);
    setItens(processados);
    setItensExcluidos(new Set());

    const paraTexto = (valor: number | null): string => (valor === null ? '' : String(valor));
    setMateriasPrimas(processados.map((item) => ({
      chave: `item-${item.linhaId}`,
      nome: item.descricao,
      categoria: categoriaCompartilhada,
      unidade: item.unidade || 'UN',
      quantidade: item.quantidade !== null ? String(item.quantidade) : '',
      custo: paraTexto(item.custo),
      marca: item.marca,
      referencia: item.referencia,
      linhaId: item.linhaId,
    })));
    setPasso('confirmacao');
  };

  const atualizarMateriaPrima = (chave: string, patch: Partial<MateriaPrimaConfirmar>) => {
    setMateriasPrimas((atual) => atual.map((m) => (m.chave === chave ? { ...m, ...patch } : m)));
  };

  const materiasPrimasValidas = materiasPrimas.filter((m) => !itensExcluidos.has(m.linhaId));

  const materiasPrimasProntas = materiasPrimasValidas.every((m) => (
    m.nome.trim() && m.unidade.trim() && m.quantidade.trim() !== '' && Number.isFinite(Number(m.quantidade.replace(',', '.')))
  ));

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!materiasPrimasProntas) {
      showError('Preencha todos os campos', 'Toda matéria-prima precisa de nome, unidade e quantidade (um número válido) antes de importar.');
      return;
    }
    if (materiasPrimasValidas.length === 0) {
      showError('Nada para importar', 'Todas as linhas foram marcadas como "não importar".');
      return;
    }

    setSalvando(true);
    try {
      let proximoCodigo = Number(await getProximoCodigoMateriaPrima(tenantId));
      const timestamp = serverTimestamp();

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < materiasPrimasValidas.length; inicio += LOTE_MAXIMO) {
        const lote = materiasPrimasValidas.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);

        lote.forEach((materiaPrima) => {
          const codigo = String(proximoCodigo);
          proximoCodigo += 1;

          const docRef = doc(collection(db, 'materias_primas'));
          batch.set(docRef, montarMateriaPrimaImportada(
            {
              codigo,
              nome: materiaPrima.nome,
              categoria: materiaPrima.categoria,
              unidade: materiaPrima.unidade,
              quantidade: Number(materiaPrima.quantidade.replace(',', '.')) || 0,
              precoCusto: materiaPrima.custo.trim() ? Number(materiaPrima.custo.replace(',', '.')) : undefined,
              marca: materiaPrima.marca,
              referencia: materiaPrima.referencia,
            },
            tenantId,
            currentUser.uid,
            timestamp,
          ));
        });

        await batch.commit();
      }

      // Cadastro de Marcas ja nasce completo -- cria as que a planilha
      // trouxe e ainda nao existiam, sem o usuario ter que digitar cada
      // uma de novo depois em Cadastros Auxiliares > Marcas.
      await garantirMarcasCadastradas(materiasPrimasValidas.map((m) => m.marca), tenantId, currentUser.uid, timestamp);

      setResultadoImportacao({ criados: materiasPrimasValidas.length });
      setPasso('concluido');
      showSuccess(`${materiasPrimasValidas.length} matéria(s)-prima(s) importada(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar matérias-primas:', error);
      showError(
        'Erro ao importar',
        `A importação parou antes de terminar. ${(error as Error)?.message || ''}

`
        + 'ANTES de tentar de novo, abra a lista de Matéria-Prima e confira se alguma parte já foi gravada: '
        + 'a importação grava em lotes, e os lotes anteriores ao erro podem ter entrado. '
        + 'Repetir sem conferir duplica o que já está lá.',
      );
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/materias-primas')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Factory size={26} color="var(--accent-purple)" /> Importar Matérias-Primas
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Importação em massa a partir de uma planilha do sistema antigo (CSV ou XLSX)</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '440px' }}>
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é a descrição, a quantidade e o resto.
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
            {(['descricao', 'quantidade', 'unidade', 'marca', 'referencia', 'custo', 'codigo'] as const).map((campo) => {
              const obrigatorio = campo === 'descricao' || campo === 'quantidade';
              const rotulos: Record<typeof campo, string> = {
                descricao: 'Descrição', quantidade: 'Quantidade', unidade: 'Unidade (opcional)',
                marca: 'Marca (opcional)', referencia: 'Referência (opcional)', custo: 'Custo (opcional)',
                codigo: 'Código interno (referência, opcional)',
              };
              return (
                <div className="input-group" key={campo}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de {rotulos[campo]}</label>
                  <select
                    value={mapeamento[campo] === null ? '' : mapeamento[campo]}
                    onChange={(e) => setMapeamento((atual) => ({ ...atual, [campo]: e.target.value === '' ? null : Number(e.target.value) }))}
                    style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                  >
                    {!obrigatorio && <option value="">-- Nenhuma --</option>}
                    {cabecalho.map((h, idx) => <option key={idx} value={idx}>{h || `Coluna ${idx + 1}`}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
            O código interno da planilha é só referência: o código da matéria-prima no sistema é sempre gerado automaticamente (1, 2, 3...).
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
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confirme nome, unidade, quantidade e custo</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {materiasPrimas.length} linha(s). O código de cada uma é gerado automaticamente pelo sistema.
            </p>
          </div>
          <div className="input-group" style={{ maxWidth: '320px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria (aplicada a todas, opcional)</label>
            <input type="text" value={categoriaCompartilhada} onChange={(e) => {
              setCategoriaCompartilhada(e.target.value);
              setMateriasPrimas((atual) => atual.map((m) => ({ ...m, categoria: e.target.value })));
            }} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }} />
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Nome</th>
                  <th style={{ padding: '8px' }}>Marca</th>
                  <th style={{ padding: '8px' }}>Referência</th>
                  <th style={{ padding: '8px' }}>Unidade *</th>
                  <th style={{ padding: '8px' }}>Quantidade *</th>
                  <th style={{ padding: '8px' }}>Custo</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Não importar</th>
                </tr>
              </thead>
              <tbody>
                {materiasPrimas.map((materiaPrima) => {
                  const itemOrigem = itens.find((i) => i.linhaId === materiaPrima.linhaId);
                  const excluida = itensExcluidos.has(materiaPrima.linhaId);
                  const quantidadeInvalida = materiaPrima.quantidade.trim() === '' || !Number.isFinite(Number(materiaPrima.quantidade.replace(',', '.')));
                  return (
                    <tr key={materiaPrima.chave} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: itemOrigem?.status === 'REVISAR' && !excluida ? 'rgba(245,158,11,0.08)' : undefined, opacity: excluida ? 0.4 : 1 }}>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={materiaPrima.nome} onChange={(e) => atualizarMateriaPrima(materiaPrima.chave, { nome: aplicarCaixaAltaCadastro(e.target, e.target.value) })} style={{ width: '200px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                        {itemOrigem?.motivo && <div style={{ fontSize: '11px', color: '#f59e0b' }}>{itemOrigem.motivo}</div>}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={materiaPrima.marca} onChange={(e) => atualizarMateriaPrima(materiaPrima.chave, { marca: aplicarCaixaAltaCadastro(e.target, e.target.value) })} style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={materiaPrima.referencia} onChange={(e) => atualizarMateriaPrima(materiaPrima.chave, { referencia: aplicarCaixaAltaCadastro(e.target, e.target.value) })} style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={materiaPrima.unidade} onChange={(e) => atualizarMateriaPrima(materiaPrima.chave, { unidade: e.target.value.toUpperCase() })} style={{ width: '70px', backgroundColor: 'var(--bg-tertiary)', border: !materiaPrima.unidade.trim() ? '1px solid #ef4444' : '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={materiaPrima.quantidade} onChange={(e) => atualizarMateriaPrima(materiaPrima.chave, { quantidade: e.target.value })} style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: quantidadeInvalida ? '1px solid #ef4444' : '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: Number(materiaPrima.quantidade.replace(',', '.')) < 0 ? '#ef4444' : 'var(--text-primary)' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={materiaPrima.custo} onChange={(e) => atualizarMateriaPrima(materiaPrima.chave, { custo: e.target.value })} style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={excluida}
                          onChange={(e) => setItensExcluidos((atual) => {
                            const novo = new Set(atual);
                            if (e.target.checked) novo.add(materiaPrima.linhaId); else novo.delete(materiaPrima.linhaId);
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
            <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !materiasPrimasProntas} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !materiasPrimasProntas) ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} matéria(s)-prima(s) importada(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px' }}>
            As matérias-primas já aparecem em Matéria-Prima.
          </p>
          <button className="btn-primary" onClick={() => navigate('/materias-primas')}>Ir para Matéria-Prima</button>
        </div>
      )}
    </div>
  );
};

export default ImportarMateriasPrimas;

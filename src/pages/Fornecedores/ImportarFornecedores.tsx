import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  collection, query, where, getDocs, writeBatch, doc, serverTimestamp,
} from 'firebase/firestore';
import { getProximoCodigoFornecedor } from '../../utils/fornecedorCodigo';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, Truck, Upload } from 'lucide-react';
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
  inferirMapeamentoColunasFornecedor,
  montarFornecedorImportado,
  processarLinhasFornecedores,
  MAPEAMENTO_FORNECEDOR_VAZIO,
  type FornecedorImportado,
  type MapeamentoColunasFornecedor,
} from '../../utils/importacaoFornecedoresDomain';

/**
 * Importacao em massa de fornecedores a partir do cadastro do sistema
 * antigo de um cliente novo (CSV/XLSX). Mesmo padrao da importacao de
 * clientes (ImportarClientes.tsx): mapeamento de colunas confirmado pelo
 * usuario, linha com dado ambiguo fica destacada pra revisao, nada e
 * gravado sem o usuario confirmar a tela final.
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

interface CampoMapeamento {
  campo: keyof MapeamentoColunasFornecedor;
  rotulo: string;
  obrigatorio?: boolean;
}

const GRUPOS_MAPEAMENTO: Array<{ titulo: string; campos: CampoMapeamento[] }> = [
  {
    titulo: 'Dados básicos',
    campos: [
      { campo: 'nome', rotulo: 'Nome / Razão Social', obrigatorio: true },
      { campo: 'documento', rotulo: 'CNPJ/CPF' },
      { campo: 'identidade', rotulo: 'Inscrição Estadual / C.I.' },
      { campo: 'tipo', rotulo: 'Tipo (Fornecedor/Transportadora/Serviços/Impostos)' },
      { campo: 'ativo', rotulo: 'Ativo' },
    ],
  },
  {
    titulo: 'Contato',
    campos: [
      { campo: 'telefone', rotulo: 'Telefone Fixo' },
      { campo: 'celular', rotulo: 'Celular' },
      { campo: 'email', rotulo: 'E-mail' },
    ],
  },
  {
    titulo: 'Endereço',
    campos: [
      { campo: 'endereco', rotulo: 'Rua (com número junto ou não, tanto faz)' },
      { campo: 'numero', rotulo: 'Número (se vier em coluna própria)' },
      { campo: 'bairro', rotulo: 'Bairro' },
      { campo: 'cidade', rotulo: 'Cidade' },
      { campo: 'estado', rotulo: 'Estado (UF)' },
      { campo: 'cep', rotulo: 'CEP' },
    ],
  },
  {
    titulo: 'Outros',
    campos: [
      { campo: 'observacoes', rotulo: 'Observações' },
    ],
  },
];

/** Entre linhas com o mesmo documento (CNPJ/CPF), mantem so a PRIMEIRA
 * marcada pra importar -- as demais entram pre-marcadas como "não
 * importar" (o usuario ainda pode desmarcar se quiser mesmo assim). Nao
 * afeta as linhas sem documento (fornecedor "generico" tipo categoria de
 * despesa do sistema antigo) -- essas nunca colidem entre si. */
const linhasIdsDuplicadosParaExcluir = (processados: FornecedorImportado[]): Set<number> => {
  const vistos = new Set<string>();
  const excluidos = new Set<number>();
  processados.forEach((fornecedor) => {
    if (!fornecedor.documento) return;
    if (vistos.has(fornecedor.documento)) {
      excluidos.add(fornecedor.linhaId);
    } else {
      vistos.add(fornecedor.documento);
    }
  });
  return excluidos;
};

const ImportarFornecedores: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasFornecedor>(MAPEAMENTO_FORNECEDOR_VAZIO);

  const [fornecedores, setFornecedores] = useState<FornecedorImportado[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [documentosExistentes, setDocumentosExistentes] = useState<Set<string>>(new Set());

  const [salvando, setSalvando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<{ criados: number } | null>(null);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
      if (tenantId) {
        const existentesSnap = await getDocs(query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId)));
        const docs = new Set<string>();
        existentesSnap.forEach((d) => {
          const documento = String(d.data().cnpj || '').replace(/\D/g, '');
          if (documento) docs.add(documento);
        });
        setDocumentosExistentes(docs);
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
      setMapeamento(inferirMapeamentoColunasFornecedor(linhaCabecalho));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler arquivo de importação:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const confirmarMapeamento = () => {
    const processados = processarLinhasFornecedores(linhasDados, mapeamento);
    if (processados.length === 0) {
      showError(
        'Nenhum fornecedor encontrado nessa coluna',
        'A coluna selecionada para "Nome / Razão Social" veio em branco em todas as linhas. Confira no cabeçalho da planilha se a coluna certa foi escolhida -- às vezes o dado de verdade está uma coluna ao lado do texto do cabeçalho (célula mesclada na planilha original).',
      );
      return;
    }

    setFornecedores(processados);
    setItensExcluidos(linhasIdsDuplicadosParaExcluir(processados));
    setPasso('confirmacao');
  };

  const atualizarFornecedor = (linhaId: number, patch: Partial<FornecedorImportado>) => {
    setFornecedores((atual) => atual.map((f) => (f.linhaId === linhaId ? { ...f, ...patch } : f)));
  };

  const linhasAtivas = useMemo(() => fornecedores.filter((f) => !itensExcluidos.has(f.linhaId)), [fornecedores, itensExcluidos]);

  const contagemDocumentosNoLote = useMemo(() => {
    const contagem = new Map<string, number>();
    linhasAtivas.forEach((f) => {
      if (!f.documento) return;
      contagem.set(f.documento, (contagem.get(f.documento) || 0) + 1);
    });
    return contagem;
  }, [linhasAtivas]);

  const avisoDuplicado = (fornecedor: FornecedorImportado): string => {
    if (!fornecedor.documento) return '';
    if ((contagemDocumentosNoLote.get(fornecedor.documento) || 0) > 1) return 'CNPJ/CPF repetido em mais de uma linha desta planilha.';
    if (documentosExistentes.has(fornecedor.documento)) return 'Já existe um fornecedor cadastrado com este CNPJ/CPF.';
    const outrasOcorrencias = fornecedores.filter((f) => f.documento === fornecedor.documento).length;
    if (outrasOcorrencias > 1 && itensExcluidos.has(fornecedor.linhaId)) return 'CNPJ/CPF repetido nesta planilha -- pré-marcado para não importar (mantido só o primeiro registro).';
    return '';
  };

  const linhaTemProblema = (fornecedor: FornecedorImportado): boolean => (
    fornecedor.status === 'REVISAR'
    || !fornecedor.nome.trim()
    || (fornecedor.documento !== '' && fornecedor.documento.length !== 11 && fornecedor.documento.length !== 14)
    || avisoDuplicado(fornecedor) !== ''
  );

  const totalComProblema = linhasAtivas.filter(linhaTemProblema).length;
  const fornecedoresProntos = totalComProblema === 0 && linhasAtivas.length > 0;

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!fornecedoresProntos) {
      showError('Ainda há linhas pendentes', `${totalComProblema} linha(s) precisam ser corrigidas, ou marcadas como "não importar", antes de continuar.`);
      return;
    }

    setSalvando(true);
    try {
      let proximoCodigo = Number.parseInt(await getProximoCodigoFornecedor(tenantId), 10);
      if (!Number.isFinite(proximoCodigo)) proximoCodigo = 1;
      const timestamp = serverTimestamp();

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < linhasAtivas.length; inicio += LOTE_MAXIMO) {
        const lote = linhasAtivas.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);

        lote.forEach((fornecedor) => {
          const codigo = String(proximoCodigo);
          proximoCodigo += 1;

          const docRef = doc(collection(db, 'fornecedores'));
          batch.set(docRef, {
            ...montarFornecedorImportado(
              {
                codigo,
                nome: fornecedor.nome,
                documento: fornecedor.documento,
                identidade: fornecedor.identidade,
                telefone: fornecedor.telefone,
                celular: fornecedor.celular,
                email: fornecedor.email,
                endereco: fornecedor.endereco,
                numero: fornecedor.numero,
                bairro: fornecedor.bairro,
                cidade: fornecedor.cidade,
                estado: fornecedor.estado,
                cep: fornecedor.cep,
                tipo: fornecedor.tipo,
                ativo: fornecedor.ativo,
                observacoes: fornecedor.observacoes,
              },
              tenantId,
              currentUser.uid,
              timestamp,
            ),
            ...buildDocumentMetadata(currentUser.uid, timestamp),
          });
        });

        await batch.commit();
      }

      setResultadoImportacao({ criados: linhasAtivas.length });
      setPasso('concluido');
      showSuccess(`${linhasAtivas.length} fornecedor(es) importado(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar fornecedores:', error);
      showError('Erro ao importar', 'Não foi possível concluir a importação. Nenhum fornecedor foi gravado neste lote com erro -- tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/fornecedores')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Truck size={26} color="var(--accent-purple)" /> Importar Fornecedores
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Importação em massa a partir do cadastro de fornecedores de outro sistema (CSV ou XLSX)</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '440px' }}>
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é cada campo -- nome, documento, contato, endereço, tipo e observações.
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

          {GRUPOS_MAPEAMENTO.map((grupo) => (
            <div key={grupo.titulo} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                {grupo.titulo}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                {grupo.campos.map(({ campo, rotulo, obrigatorio }) => (
                  <div className="input-group" key={campo}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{rotulo}{obrigatorio ? ' *' : ''}</label>
                    <select
                      value={mapeamento[campo] === null ? '' : (mapeamento[campo] as number)}
                      onChange={(e) => {
                        const valor = e.target.value === '' ? null : Number(e.target.value);
                        setMapeamento((atual) => ({ ...atual, [campo]: valor }));
                      }}
                      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                    >
                      {!obrigatorio && <option value="">-- Nenhuma --</option>}
                      {cabecalho.map((h, idx) => <option key={idx} value={idx}>{h || `Coluna ${idx + 1}`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
            Se o endereço vier todo junto num campo só ("Rua, Número, Bairro - Cidade"), deixe Bairro/Cidade sem coluna que a próxima tela tenta separar tudo automaticamente. Se só a rua e o número vierem juntos ("Rua X, 51") mas bairro/cidade já tiverem coluna própria, deixe Número sem coluna que ele é separado da rua sozinho. O código do fornecedor é sempre gerado automaticamente pelo sistema (1, 2, 3...).
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
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confira e corrija cada fornecedor</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {fornecedores.length} fornecedor(es) encontrado(s){totalComProblema > 0 ? `, ${totalComProblema} precisam de atenção (destacados abaixo)` : ''}.
              {itensExcluidos.size > 0 && ` ${itensExcluidos.size} linha(s) com CNPJ/CPF repetido na planilha já vêm pré-marcadas para não importar (mantido o primeiro registro de cada) -- desmarque se quiser importar mesmo assim.`}
            </p>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Nome</th>
                  <th style={{ padding: '8px' }}>CNPJ/CPF</th>
                  <th style={{ padding: '8px' }}>Tipo</th>
                  <th style={{ padding: '8px' }}>Telefone</th>
                  <th style={{ padding: '8px' }}>Rua</th>
                  <th style={{ padding: '8px' }}>Nº</th>
                  <th style={{ padding: '8px' }}>Cidade</th>
                  <th style={{ padding: '8px' }}>Situação</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Não importar</th>
                </tr>
              </thead>
              <tbody>
                {fornecedores.map((fornecedor) => {
                  const excluido = itensExcluidos.has(fornecedor.linhaId);
                  const problema = linhaTemProblema(fornecedor);
                  const aviso = avisoDuplicado(fornecedor);
                  const motivos = [fornecedor.motivo, aviso].filter(Boolean).join(' ');
                  return (
                    <tr key={fornecedor.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: (problema && !excluido) ? 'rgba(245,158,11,0.08)' : undefined, opacity: excluido ? 0.5 : 1 }}>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={fornecedor.nome} onChange={(e) => atualizarFornecedor(fornecedor.linhaId, { nome: e.target.value })} style={{ ...inputStyle, width: '220px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={fornecedor.documento} onChange={(e) => atualizarFornecedor(fornecedor.linhaId, { documento: e.target.value.replace(/\D/g, '') })} style={{ ...inputStyle, width: '130px' }} />
                      </td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{fornecedor.tipo}</td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={fornecedor.telefone} onChange={(e) => atualizarFornecedor(fornecedor.linhaId, { telefone: e.target.value })} style={{ ...inputStyle, width: '120px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={fornecedor.endereco} onChange={(e) => atualizarFornecedor(fornecedor.linhaId, { endereco: e.target.value })} style={{ ...inputStyle, width: '180px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={fornecedor.numero} onChange={(e) => atualizarFornecedor(fornecedor.linhaId, { numero: e.target.value })} style={{ ...inputStyle, width: '60px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={fornecedor.cidade} onChange={(e) => atualizarFornecedor(fornecedor.linhaId, { cidade: e.target.value })} style={{ ...inputStyle, width: '120px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        {problema ? (
                          <span style={{ color: excluido ? 'var(--text-muted)' : '#f59e0b', fontWeight: 600 }} title={motivos}>{excluido ? 'IGNORADO' : 'REVISAR'}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>OK</span>
                        )}
                        {motivos && <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '200px' }}>{motivos}</div>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={excluido}
                          onChange={(e) => setItensExcluidos((atual) => {
                            const novo = new Set(atual);
                            if (e.target.checked) novo.add(fornecedor.linhaId); else novo.delete(fornecedor.linhaId);
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
            <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !fornecedoresProntos} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !fornecedoresProntos) ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : `Importar ${linhasAtivas.length} fornecedor(es)`}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} fornecedor(es) importado(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px' }}>
            Os fornecedores já aparecem em Fornecedores.
          </p>
          <button className="btn-primary" onClick={() => navigate('/fornecedores')}>Ir para Fornecedores</button>
        </div>
      )}
    </div>
  );
};

export default ImportarFornecedores;

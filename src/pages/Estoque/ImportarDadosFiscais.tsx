import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, Download, FileUp, Loader2, ScanBarcode } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
} from '../../utils/importacaoEstoqueDomain';
import {
  CABECALHO_MODELO_FISCAL,
  ROTULO_STATUS_FISCAL,
  inferirMapeamentoFiscal,
  lerLinhasFiscais,
  nomeCampo,
  planejarImportacaoFiscal,
  type CampoFiscal,
  type MapeamentoFiscal,
  type ProdutoFiscalAtual,
  type StatusLinhaFiscal,
} from '../../utils/importacaoFiscalDomain';

/**
 * Atualiza codigo de barras, NCM e CEST de produtos que JA existem, a partir
 * de uma planilha (CSV/XLSX) com a coluna Codigo (ou o nome do produto). Nunca
 * cria produto, nunca apaga dado e nao troca valor ja preenchido sem o usuario
 * mandar. Regras e testes: src/utils/importacaoFiscalDomain.ts.
 */

type Passo = 'upload' | 'conferencia' | 'concluido';

const LIMITE_LINHAS_NA_TELA = 300;
const TAMANHO_LOTE = 400; // o Firestore aceita ate' 500 escritas por lote

const COR_STATUS: Record<StatusLinhaFiscal, { fundo: string; cor: string }> = {
  atualizar: { fundo: 'rgba(16,185,129,.15)', cor: '#10b981' },
  sem_mudanca: { fundo: 'rgba(107,114,128,.18)', cor: '#9ca3af' },
  conflito: { fundo: 'rgba(245,158,11,.15)', cor: '#f59e0b' },
  erro: { fundo: 'rgba(239,68,68,.15)', cor: '#ef4444' },
  nao_encontrado: { fundo: 'rgba(239,68,68,.15)', cor: '#ef4444' },
  ambiguo: { fundo: 'rgba(239,68,68,.15)', cor: '#ef4444' },
};

const CAMPOS_MAPA: { campo: CampoFiscal; rotulo: string }[] = [
  { campo: 'codigo', rotulo: 'Código do produto' },
  { campo: 'produto', rotulo: 'Nome do produto' },
  { campo: 'codigoBarras', rotulo: 'Código de barras' },
  { campo: 'ncm', rotulo: 'NCM' },
  { campo: 'cest', rotulo: 'CEST' },
];

const celulaParaTexto = (valor: unknown): string => {
  if (valor === null || valor === undefined) return '';
  // Numero do Excel (codigo de barras, NCM) vira texto inteiro, sem notacao cientifica.
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor.toFixed(0) : String(valor);
  return String(valor).trim();
};

const estiloCampo: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text-primary)',
};

const ImportarDadosFiscais: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasBrutas, setLinhasBrutas] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<MapeamentoFiscal>({ codigo: null, produto: null, codigoBarras: null, ncm: null, cest: null });
  const [produtos, setProdutos] = useState<ProdutoFiscalAtual[]>([]);
  const [sobrescrever, setSobrescrever] = useState(false);
  const [filtro, setFiltro] = useState<StatusLinhaFiscal | 'todos'>('todos');
  const [atualizados, setAtualizados] = useState(0);

  const linhas = useMemo(() => lerLinhasFiscais(linhasBrutas, mapa), [linhasBrutas, mapa]);
  const plano = useMemo(
    () => planejarImportacaoFiscal({ linhas, produtos, sobrescrever }),
    [linhas, produtos, sobrescrever],
  );

  const baixarModelo = () => {
    const planilha = XLSX.utils.aoa_to_sheet([CABECALHO_MODELO_FISCAL, ['10', 'ACUCAR MASCAVO 500G', '7898945717076', '17011300', '1710300']]);
    // Codigos como TEXTO: senao o Excel corta zeros da frente e vira notacao cientifica.
    ['A2', 'C2', 'D2', 'E2'].forEach((ref) => { if (planilha[ref]) planilha[ref].t = 's'; });
    planilha['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 10 }];
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, 'Dados fiscais');
    XLSX.writeFile(livro, 'modelo-importar-dados-fiscais.xlsx');
  };

  const carregarProdutos = async (): Promise<ProdutoFiscalAtual[]> => {
    if (!tenantId) return [];
    const snap = await getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)));
    return snap.docs.map((d) => {
      const dados = d.data();
      const embalagens: any[] = Array.isArray(dados.embalagens) ? dados.embalagens : [];
      return {
        id: d.id,
        codigo: String(dados.codigo ?? ''),
        nome: String(dados.nome ?? ''),
        codigoBarras: String(dados.codigoBarras ?? '').trim(),
        ncm: String(dados.ncm || dados.fiscal?.ncm || ''),
        cest: String(dados.cest || dados.fiscal?.cest || ''),
        embalagensBarras: embalagens.map((e) => String(e?.codigoBarras ?? '').trim()).filter(Boolean),
      };
    });
  };

  const lerArquivo = async (arquivo: File) => {
    setCarregando(true);
    try {
      const nome = arquivo.name.toLowerCase();
      let matriz: string[][] = [];
      if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
        const livro = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
        const aba = livro.Sheets[livro.SheetNames[0]];
        // raw: true mantem o numero como numero (o texto formatado viraria 7.9E+12).
        const bruto = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: true, defval: '' });
        matriz = bruto.map((linha) => linha.map(celulaParaTexto));
      } else if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
        const texto = decodificarArquivoTexto(await arquivo.arrayBuffer());
        matriz = parseDelimitedText(texto, detectarDelimitador(texto.split(/\r?\n/)[0] || ''));
      } else {
        showError('Arquivo não reconhecido', 'Envie uma planilha do Excel (.xlsx) ou um arquivo CSV.');
        return;
      }
      const [cab, ...dados] = matriz.filter((l) => l.some((c) => String(c).trim() !== ''));
      if (!cab || dados.length === 0) {
        showError('Planilha vazia', 'Não encontrei linhas de dados. A primeira linha deve ser o cabeçalho (Código, Produto, Código de barras, NCM, CEST).');
        return;
      }
      const mapaInferido = inferirMapeamentoFiscal(cab);
      if (mapaInferido.codigo === null && mapaInferido.produto === null) {
        showError('Faltou a coluna do produto', 'Não achei nenhuma coluna Código nem Produto no cabeçalho. Confira a primeira linha ou use "Baixar modelo".');
        return;
      }
      if (mapaInferido.codigoBarras === null && mapaInferido.ncm === null && mapaInferido.cest === null) {
        showError('Nada para importar', 'Não achei nenhuma coluna de Código de barras, NCM ou CEST no cabeçalho. Confira a primeira linha ou use "Baixar modelo".');
        return;
      }
      setProdutos(await carregarProdutos());
      setNomeArquivo(arquivo.name);
      setCabecalho(cab.map((c) => String(c)));
      setLinhasBrutas(dados);
      setMapa(mapaInferido);
      setFiltro('todos');
      setPasso('conferencia');
    } catch (erro) {
      console.error('Erro ao ler a planilha de dados fiscais:', erro);
      showError('Não foi possível ler o arquivo', 'Confira se ele não está aberto em outro programa e se é uma planilha válida.');
    } finally {
      setCarregando(false);
      if (inputArquivo.current) inputArquivo.current.value = '';
    }
  };

  const aplicar = async () => {
    if (!currentUser || !tenantId) return;
    const alvos = plano.resultados.filter((r) => r.status === 'atualizar' && r.produto);
    if (alvos.length === 0) return;
    setSalvando(true);
    try {
      for (let i = 0; i < alvos.length; i += TAMANHO_LOTE) {
        const lote = writeBatch(db);
        alvos.slice(i, i + TAMANHO_LOTE).forEach((r) => {
          lote.update(doc(db, 'estoque', r.produto!.id), {
            ...r.grava, // so' as chaves que mudam (nunca undefined)
            updatedAt: serverTimestamp(),
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Dados fiscais importados de planilha'),
          });
        });
        await lote.commit();
      }
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'estoque',
          acao: 'edicao',
          descricao: `Importação de dados fiscais (código de barras, NCM, CEST): ${alvos.length} produto(s) atualizado(s) pela planilha "${nomeArquivo}".${sobrescrever ? ' Valores já preenchidos foram sobrescritos.' : ''}`,
          registroRelacionadoId: alvos[0].produto!.id,
          status: 'sucesso',
          critical: false,
        });
      } catch (logError) {
        console.error('Erro ao registrar auditoria da importação fiscal:', logError);
      }
      setAtualizados(alvos.length);
      setPasso('concluido');
      showSuccess(`${alvos.length} produto(s) atualizado(s)!`);
    } catch (erro) {
      console.error('Erro ao gravar dados fiscais:', erro);
      showError('Não foi possível gravar', 'A importação foi interrompida. Nada foi perdido: confira o cadastro e tente de novo (os produtos já gravados não mudam de novo).');
    } finally {
      setSalvando(false);
    }
  };

  const filtradas = plano.resultados.filter((r) => filtro === 'todos' || r.status === filtro);
  const resumo = plano.resumo;
  const fichas: { chave: StatusLinhaFiscal | 'todos'; rotulo: string; valor: number }[] = [
    { chave: 'todos', rotulo: 'Linhas', valor: resumo.total },
    { chave: 'atualizar', rotulo: 'Vão atualizar', valor: resumo.atualizar },
    { chave: 'sem_mudanca', rotulo: 'Já estão iguais', valor: resumo.semMudanca },
    { chave: 'conflito', rotulo: 'Conflitos', valor: resumo.conflito },
    { chave: 'erro', rotulo: 'Com problema', valor: resumo.erro },
    { chave: 'nao_encontrado', rotulo: 'Não encontrados', valor: resumo.naoEncontrado },
    { chave: 'ambiguo', rotulo: 'Mais de um produto', valor: resumo.ambiguo },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <ScanBarcode size={28} color="var(--accent-purple)" /> Importar dados fiscais
          </h1>
          <p style={{ color: 'var(--text-muted)', maxWidth: '760px' }}>
            Atualiza <strong>código de barras, NCM e CEST</strong> de produtos que já estão cadastrados, a partir de uma planilha. Não cria produto, não apaga dado e não troca o que já está preenchido sem você mandar.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => navigate('/estoque')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ArrowLeft size={18} /> Voltar aos produtos
        </button>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '28px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>1. Envie a planilha</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              A primeira linha é o cabeçalho. Colunas: <strong>Código</strong> (o código do produto aqui no sistema) ou <strong>Produto</strong> (o nome), e as que quiser atualizar: <strong>Código de barras</strong>, <strong>NCM</strong>, <strong>CEST</strong>. Aceita Excel (.xlsx) e CSV.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <input
              ref={inputArquivo}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              style={{ display: 'none' }}
              onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) void lerArquivo(arquivo); }}
            />
            <button className="btn-primary" disabled={carregando} onClick={() => inputArquivo.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {carregando ? <Loader2 size={18} className="spin-icon" /> : <FileUp size={18} />} {carregando ? 'Lendo a planilha...' : 'Escolher arquivo'}
            </button>
            <button className="btn-secondary" onClick={baixarModelo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Download size={18} /> Baixar modelo
            </button>
          </div>
          <ul style={{ color: 'var(--text-muted)', fontSize: '13px', paddingLeft: '18px', lineHeight: 1.7 }}>
            <li>Você confere tudo na próxima tela antes de gravar. Nada é alterado agora.</li>
            <li>Código de barras que não fecha o dígito verificador, NCM sem 8 dígitos e CEST sem 7 dígitos são ignorados e explicados.</li>
            <li>O mesmo código de barras em dois produtos é recusado, para o leitor do caixa não errar de produto.</li>
          </ul>
        </div>
      )}

      {passo === 'conferencia' && (
        <>
          <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '18px', marginBottom: '2px' }}>2. Confira antes de gravar</h2>
                <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Arquivo: {nomeArquivo} · {produtos.length} produtos cadastrados na empresa</span>
              </div>
              <button className="btn-secondary" onClick={() => { setPasso('upload'); setLinhasBrutas([]); }}>Trocar arquivo</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
              {CAMPOS_MAPA.map(({ campo, rotulo }) => (
                <label key={campo} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {rotulo}
                  <select
                    value={mapa[campo] === null ? '' : String(mapa[campo])}
                    onChange={(e) => setMapa((atual) => ({ ...atual, [campo]: e.target.value === '' ? null : Number(e.target.value) }))}
                    style={estiloCampo}
                  >
                    <option value="">— não usar —</option>
                    {cabecalho.map((titulo, indice) => <option key={indice} value={indice}>{titulo || `Coluna ${indice + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer', fontSize: '14px' }}>
              <input type="checkbox" checked={sobrescrever} onChange={(e) => setSobrescrever(e.target.checked)} style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--accent-purple)' }} />
              <span>
                <strong>Sobrescrever valores já preenchidos</strong>
                <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '12px' }}>Desligado (recomendado): só preenche o que está vazio e mostra como “conflito” o que já tem valor diferente.</span>
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {fichas.map((ficha) => (
              <button
                key={ficha.chave}
                type="button"
                onClick={() => setFiltro(ficha.chave)}
                style={{
                  padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${filtro === ficha.chave ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                  backgroundColor: filtro === ficha.chave ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                  color: filtro === ficha.chave ? '#fff' : 'var(--text-primary)',
                }}
              >
                {ficha.rotulo} ({ficha.valor})
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: '0', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px', position: 'sticky', top: 0, backgroundColor: 'var(--bg-secondary)' }}>
                    <th style={{ padding: '10px' }}>Linha</th>
                    <th style={{ padding: '10px' }}>Produto</th>
                    <th style={{ padding: '10px' }}>Situação</th>
                    <th style={{ padding: '10px' }}>O que muda</th>
                    <th style={{ padding: '10px' }}>Avisos</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma linha nesta situação.</td></tr>
                  ) : filtradas.slice(0, LIMITE_LINHAS_NA_TELA).map((r) => (
                    <tr key={r.linha.linha} style={{ borderBottom: '1px solid var(--border-color)', verticalAlign: 'top' }}>
                      <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{r.linha.linha}</td>
                      <td style={{ padding: '10px', minWidth: '220px' }}>
                        <strong>{r.produto ? r.produto.nome : (r.linha.produto || '—')}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Código {r.produto ? r.produto.codigo : (r.linha.codigo || '—')}</div>
                      </td>
                      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                        <span style={{ backgroundColor: COR_STATUS[r.status].fundo, color: COR_STATUS[r.status].cor, padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                          {ROTULO_STATUS_FISCAL[r.status]}
                        </span>
                      </td>
                      <td style={{ padding: '10px', minWidth: '260px' }}>
                        {r.mudancas.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : r.mudancas.map((m) => (
                          <div key={m.campo} style={{ fontSize: '12px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>{nomeCampo(m.campo)}: </span>
                            {m.antes ? <s style={{ color: 'var(--text-muted)' }}>{m.antes}</s> : <em style={{ color: 'var(--text-muted)' }}>vazio</em>}
                            {' → '}<strong style={{ color: m.tipo === 'trocar' ? '#f59e0b' : '#10b981' }}>{m.depois}</strong>
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: '10px', minWidth: '300px', fontSize: '12px', color: r.status === 'atualizar' ? '#f59e0b' : 'var(--text-secondary)' }}>
                        {r.problemas.map((p, i) => <div key={i}>{p}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtradas.length > LIMITE_LINHAS_NA_TELA && (
              <div style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                Mostrando as primeiras {LIMITE_LINHAS_NA_TELA} de {filtradas.length} linhas. Use os filtros acima para ver o resto. A gravação vale para todas as {resumo.atualizar} que vão atualizar.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {resumo.atualizar === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma linha vai atualizar. Confira os avisos acima.</span>}
            <button className="btn-primary" disabled={salvando || resumo.atualizar === 0} onClick={() => void aplicar()} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: resumo.atualizar === 0 ? 0.5 : 1 }}>
              {salvando ? <Loader2 size={18} className="spin-icon" /> : <CheckCircle2 size={18} />}
              {salvando ? 'Gravando...' : `Atualizar ${resumo.atualizar} produto${resumo.atualizar === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}

      {passo === 'concluido' && (
        <div className="card" style={{ padding: '32px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
          <CheckCircle2 size={48} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{atualizados} produto{atualizados === 1 ? '' : 's'} atualizado{atualizados === 1 ? '' : 's'}</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '520px' }}>Código de barras, NCM e CEST já valem no cadastro. Se ficaram linhas com conflito ou problema, corrija a planilha e envie de novo: o que já foi gravado não muda outra vez.</p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => { setPasso('upload'); setLinhasBrutas([]); }}>Importar outra planilha</button>
            <button className="btn-primary" onClick={() => navigate('/estoque')}>Ver produtos</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportarDadosFiscais;

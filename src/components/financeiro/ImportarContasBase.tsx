import React, { useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  collection, query, where, getDocs, getDoc, writeBatch, doc, serverTimestamp,
} from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
} from '../../utils/importacaoEstoqueDomain';
import {
  chaveGrupoVinculo,
  formatarDocumentoParte,
  inferirMapeamentoColunasConta,
  montarContaImportada,
  normalizarDocumentoParte,
  processarLinhasContas,
  resolverVinculoParte,
  sementeIdImportacao,
  type ContaImportada,
  type MapeamentoColunasConta,
  type ParteCadastrada,
  type StatusPagamentoConta,
} from '../../utils/importacaoContasDomain';

/**
 * Wizard de importacao em massa de titulos pendentes de Contas a Receber
 * (clientes) ou Contas a Pagar (fornecedores) -- as duas telas usam
 * EXATAMENTE o mesmo fluxo e o mesmo formato de gravacao em `transacoes`
 * (ver importacaoContasDomain.ts), so muda o rotulo, a colecao de vinculo
 * (clientes/fornecedores) e tipo/entrada-saida. Ver
 * src/pages/Financeiro/ImportarContasReceber.tsx e ImportarContasPagar.tsx.
 *
 * Revisto em 2026-09-17 (migracao Sol Natus): o vinculo com o cadastro e'
 * por CPF/CNPJ (resolverVinculoParte), titulo sem cadastro fica FORA da
 * importacao, e titulo com chave ganha id fixo -- importar de novo nao
 * duplica.
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';
type FiltroLinhas = 'atencao' | 'importar' | 'fora' | 'todos';

interface ImportarContasBaseProps {
  tipo: 'entrada' | 'saida';
  titulo: string;
  subtitulo: string;
  rotaVoltar: string;
  colecaoParte: 'clientes' | 'fornecedores';
  rotuloParte: string;
  Icone: ComponentType<{ size?: number; color?: string }>;
}

interface ResultadoImportacao {
  criados: number;
  jaExistiam: number;
  semCadastro: number;
  semCadastroValor: number;
  semVinculoTexto: number;
}

const CAMPOS_MAPEAMENTO = ['descricao', 'valor', 'vencimento', 'categoria', 'parte', 'documentoParte', 'status', 'dataPagamento', 'chave'] as const;

const formatarMoeda = (valor: number): string => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatarData = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Id do documento em `transacoes` pra um titulo com chave. SHA-256 da
 * semente (tenant + tipo + chave) -- ver sementeIdImportacao. */
const idDoTitulo = async (semente: string): Promise<string> => {
  const bytes = new TextEncoder().encode(semente);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `imp_${hex.slice(0, 40)}`;
};

const ImportarContasBase: React.FC<ImportarContasBaseProps> = ({
  tipo, titulo, subtitulo, rotaVoltar, colecaoParte, rotuloParte, Icone,
}) => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const rotuloParteMin = rotuloParte.toLowerCase();
  const nomeTelaDestino = tipo === 'entrada' ? 'Contas a Receber' : 'Contas a Pagar';

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasConta>({
    descricao: 0, valor: 1, vencimento: 2, categoria: null, parte: null, documentoParte: null, status: null, dataPagamento: null, chave: null,
  });

  const [contas, setContas] = useState<ContaImportada[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [partesDisponiveis, setPartesDisponiveis] = useState<ParteCadastrada[]>([]);
  /** Escolha do usuario pra cada grupo ambiguo (ver chaveGrupoVinculo). */
  const [escolhasGrupo, setEscolhasGrupo] = useState<Record<string, string>>({});
  /** linhaId -> id fixo do documento (so' titulos com chave). */
  const [idsPorLinha, setIdsPorLinha] = useState<Map<number, string>>(new Map());
  const [jaImportados, setJaImportados] = useState<Set<number>>(new Set());
  const [verificando, setVerificando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroLinhas>('todos');

  const [salvando, setSalvando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<ResultadoImportacao | null>(null);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
      if (tenantId) {
        const partesSnap = await getDocs(query(collection(db, colecaoParte), where('tenantId', '==', tenantId)));
        setPartesDisponiveis(partesSnap.docs.map((d) => {
          const dados = d.data();
          // Cliente guarda em `documento`; fornecedor, em `cnpj`.
          const documentoBruto = colecaoParte === 'clientes' ? dados.documento : (dados.cnpj ?? dados.documento);
          return {
            id: d.id,
            nome: String(dados.nome || ''),
            documento: normalizarDocumentoParte(String(documentoBruto || '')),
            codigo: String(dados.codigo || ''),
            cidade: String(dados.cidade || ''),
            ativo: dados.ativo !== false,
          };
        }));
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
      setMapeamento(inferirMapeamentoColunasConta(linhaCabecalho));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler arquivo de importação:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const confirmarMapeamento = async () => {
    if (!tenantId) return;
    const processados = processarLinhasContas(linhasDados, mapeamento).map((conta) => {
      const vinculo = resolverVinculoParte(conta.documentoParte, conta.parteNomeBruto, partesDisponiveis);
      return {
        ...conta,
        parteId: vinculo.id,
        parteNome: vinculo.nome || conta.parteNome,
        vinculo: vinculo.situacao,
        candidatos: vinculo.candidatos,
        avisoVinculo: vinculo.aviso,
      };
    });
    if (processados.length === 0) {
      showError(
        'Nenhum título encontrado nessa coluna',
        'As colunas selecionadas para "Descrição" e "Valor" vieram em branco em todas as linhas. Confira no cabeçalho da planilha se as colunas certas foram escolhidas.',
      );
      return;
    }

    // Chave repetida na planilha faria dois titulos diferentes disputarem o
    // mesmo id -- o segundo sobrescreveria o primeiro sem ninguem ver.
    const contagemChaves = new Map<string, number>();
    processados.forEach((c) => { if (c.chave) contagemChaves.set(c.chave, (contagemChaves.get(c.chave) || 0) + 1); });
    const chavesRepetidas = Array.from(contagemChaves.entries()).filter(([, n]) => n > 1).map(([k]) => k);
    if (chavesRepetidas.length > 0) {
      showError(
        'Chave de importação repetida',
        `A coluna de chave precisa identificar cada título uma única vez, e ${chavesRepetidas.length} chave(s) aparecem em mais de uma linha (ex.: "${chavesRepetidas[0]}"). Corrija a planilha, ou escolha "-- Nenhuma --" na coluna de chave.`,
      );
      return;
    }

    setVerificando(true);
    try {
      // Titulo com chave: id fixo, e o que ja' existe fica de fora.
      const ids = new Map<number, string>();
      await Promise.all(processados.filter((c) => c.chave).map(async (c) => {
        ids.set(c.linhaId, await idDoTitulo(sementeIdImportacao(tenantId, tipo, c.chave)));
      }));
      const existentes = new Set<number>();
      const pendentes = Array.from(ids.entries());
      const LOTE_LEITURA = 50;
      for (let i = 0; i < pendentes.length; i += LOTE_LEITURA) {
        const fatia = pendentes.slice(i, i + LOTE_LEITURA);
        const snaps = await Promise.all(fatia.map(([, id]) => getDoc(doc(db, 'transacoes', id))));
        snaps.forEach((snap, k) => { if (snap.exists()) existentes.add(fatia[k][0]); });
      }

      setIdsPorLinha(ids);
      setJaImportados(existentes);
      setContas(processados);
      setEscolhasGrupo({});
      setItensExcluidos(new Set());
      setFiltro(processados.some((c) => c.vinculo === 'ambiguo' || c.status === 'REVISAR') ? 'atencao' : 'todos');
      setPasso('confirmacao');
    } catch (error) {
      console.error('Erro ao conferir títulos já importados:', error);
      showError('Não foi possível conferir a planilha', 'Falhou a consulta dos títulos que já foram importados antes. Verifique a conexão e clique em Continuar de novo -- nada foi gravado.');
    } finally {
      setVerificando(false);
    }
  };

  const atualizarConta = (linhaId: number, patch: Partial<ContaImportada>) => {
    setContas((atual) => atual.map((c) => (c.linhaId === linhaId ? { ...c, ...patch } : c)));
  };

  /** Cadastro que efetivamente recebe o titulo (ou null). */
  const parteEfetiva = (conta: ContaImportada): { id: string | null; nome: string } => {
    if (conta.vinculo === 'vinculado') return { id: conta.parteId, nome: conta.parteNome };
    if (conta.vinculo === 'ambiguo') {
      const escolhido = conta.candidatos.find((p) => p.id === escolhasGrupo[chaveGrupoVinculo(conta)]);
      return escolhido ? { id: escolhido.id, nome: escolhido.nome } : { id: null, nome: conta.parteNome };
    }
    return { id: null, nome: conta.parteNome };
  };

  /** Fora da importacao por regra, sem o usuario poder incluir. */
  const foraPorRegra = (conta: ContaImportada): boolean => (
    jaImportados.has(conta.linhaId) || conta.vinculo === 'sem_cadastro'
  );

  const linhaTemProblema = (conta: ContaImportada): boolean => (
    conta.status === 'REVISAR'
    || !conta.descricao.trim()
    || conta.valor === null
    || conta.valor <= 0
    || !conta.vencimento
    || (conta.vinculo === 'ambiguo' && !parteEfetiva(conta).id)
  );

  const linhasAtivas = useMemo(
    () => contas.filter((c) => !itensExcluidos.has(c.linhaId) && !foraPorRegra(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contas, itensExcluidos, jaImportados],
  );

  const somar = (lista: ContaImportada[]) => lista.reduce((s, c) => s + (c.valor || 0), 0);

  const totalComProblema = linhasAtivas.filter(linhaTemProblema).length;
  const semCadastro = contas.filter((c) => c.vinculo === 'sem_cadastro' && !jaImportados.has(c.linhaId));
  const jaImportadosLista = contas.filter((c) => jaImportados.has(c.linhaId));
  const semVinculoTexto = linhasAtivas.filter((c) => c.vinculo === 'sem_parte' && c.parteNomeBruto).length;
  const contasProntas = totalComProblema === 0 && linhasAtivas.length > 0;
  const planilhaTemChave = mapeamento.chave !== null;

  // Grupos que pedem escolha, e grupos sem cadastro (uma linha por parte).
  const gruposAmbiguos = useMemo(() => {
    const mapa = new Map<string, { exemplo: ContaImportada; qtd: number; valor: number }>();
    contas.forEach((c) => {
      if (c.vinculo !== 'ambiguo' || jaImportados.has(c.linhaId)) return;
      const k = chaveGrupoVinculo(c);
      const g = mapa.get(k) || { exemplo: c, qtd: 0, valor: 0 };
      g.qtd += 1;
      g.valor += c.valor || 0;
      mapa.set(k, g);
    });
    return Array.from(mapa.entries());
  }, [contas, jaImportados]);

  const gruposSemCadastro = useMemo(() => {
    const mapa = new Map<string, { exemplo: ContaImportada; qtd: number; valor: number }>();
    semCadastro.forEach((c) => {
      const k = chaveGrupoVinculo(c);
      const g = mapa.get(k) || { exemplo: c, qtd: 0, valor: 0 };
      g.qtd += 1;
      g.valor += c.valor || 0;
      mapa.set(k, g);
    });
    return Array.from(mapa.values()).sort((a, b) => a.exemplo.parteNome.localeCompare(b.exemplo.parteNome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contas, jaImportados]);

  const linhasFiltradas = contas.filter((c) => {
    const fora = foraPorRegra(c) || itensExcluidos.has(c.linhaId);
    if (filtro === 'atencao') return !fora && linhaTemProblema(c);
    if (filtro === 'importar') return !fora;
    if (filtro === 'fora') return fora;
    return true;
  });

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!contasProntas) {
      showError('Ainda há títulos pendentes', `${totalComProblema} título(s) precisam ser corrigidos, ter o ${rotuloParteMin} escolhido, ou ser marcados como "não importar" antes de continuar.`);
      return;
    }

    setSalvando(true);
    let gravados = 0;
    try {
      const timestamp = serverTimestamp();

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < linhasAtivas.length; inicio += LOTE_MAXIMO) {
        const lote = linhasAtivas.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);

        lote.forEach((conta) => {
          const idFixo = idsPorLinha.get(conta.linhaId);
          const docRef = idFixo ? doc(db, 'transacoes', idFixo) : doc(collection(db, 'transacoes'));
          const parte = parteEfetiva(conta);
          batch.set(docRef, montarContaImportada(
            {
              descricao: conta.descricao,
              categoria: conta.categoria,
              valor: conta.valor as number,
              vencimento: conta.vencimento,
              statusPagamento: conta.statusPagamento,
              dataPagamento: conta.dataPagamento,
              parteId: parte.id,
              parteNome: parte.nome,
              chave: conta.chave,
            },
            tipo,
            tenantId,
            currentUser.uid,
            timestamp,
          ));
        });

        await batch.commit();
        gravados += lote.length;
      }

      setResultadoImportacao({
        criados: gravados,
        jaExistiam: jaImportadosLista.length,
        semCadastro: semCadastro.length,
        semCadastroValor: somar(semCadastro),
        semVinculoTexto,
      });
      setPasso('concluido');
      showSuccess(`${gravados} título(s) importado(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar contas:', error);
      // A gravacao e' em lotes: os anteriores ao erro JA' estao no sistema.
      // Mandar "tentar de novo" sem dizer isso duplicava os titulos.
      const jaGravados = gravados > 0
        ? `${gravados} de ${linhasAtivas.length} título(s) já foram gravados antes do erro. `
        : 'Nenhum título foi gravado. ';
      showError(
        'Erro ao importar',
        planilhaTemChave
          ? `${jaGravados}Pode importar a mesma planilha de novo: os títulos que já entraram são reconhecidos pela chave e não duplicam.`
          : `${jaGravados}${gravados > 0 ? `Antes de tentar de novo, confira em ${nomeTelaDestino}: esta planilha não tem coluna de chave, e importar de novo duplica os títulos que já entraram.` : 'Verifique a conexão e tente de novo.'}`,
      );
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' };
  const cardStyle = { padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column' as const, gap: '16px' };
  const thStyle = { padding: '8px' };

  const rotulosCampo: Record<typeof CAMPOS_MAPEAMENTO[number], string> = {
    descricao: 'Descrição', valor: 'Valor', vencimento: 'Vencimento',
    categoria: 'Categoria (opcional)', parte: `${rotuloParte} (opcional)`,
    documentoParte: `CPF/CNPJ do ${rotuloParteMin} (recomendado)`,
    status: 'Situação -- Pago/Pendente (opcional)', dataPagamento: 'Data de pagamento (opcional)',
    chave: 'Chave do título (recomendado)',
  };

  const rotuloVinculo = (conta: ContaImportada): React.ReactNode => {
    if (jaImportados.has(conta.linhaId)) return <span style={{ color: 'var(--text-muted)' }}>Já importado</span>;
    if (conta.vinculo === 'vinculado') return <span style={{ color: '#10b981' }}>Vinculado</span>;
    if (conta.vinculo === 'ambiguo') {
      return parteEfetiva(conta).id
        ? <span style={{ color: '#10b981' }}>Vinculado (escolhido)</span>
        : <span style={{ color: '#f59e0b', fontWeight: 600 }}>Escolher {rotuloParteMin}</span>;
    }
    if (conta.vinculo === 'sem_cadastro') return <span style={{ color: '#ef4444', fontWeight: 600 }}>Sem cadastro</span>;
    return <span style={{ color: 'var(--text-muted)' }}>{conta.parteNomeBruto ? 'Só texto' : '-'}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate(rotaVoltar)}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icone size={26} color="var(--accent-purple)" /> {titulo}
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>{subtitulo}</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '460px' }}>
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é a descrição, o valor, o vencimento, a categoria, o {rotuloParteMin} e o CPF/CNPJ.
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
        <div className="card" style={{ ...cardStyle, gap: '20px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confirme as colunas</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Arquivo: {nomeArquivo} — {linhasDados.length} linha(s) de dado encontrada(s).</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {CAMPOS_MAPEAMENTO.map((campo) => {
              const obrigatorio = campo === 'descricao' || campo === 'valor' || campo === 'vencimento';
              return (
                <div className="input-group" key={campo}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de {rotulosCampo[campo]}</label>
                  <select
                    value={mapeamento[campo] === null ? '' : mapeamento[campo]!}
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
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p style={{ margin: 0 }}>
              <strong>Com a coluna de CPF/CNPJ</strong>, cada título é ligado ao {rotuloParteMin} com o mesmo documento — o nome não é usado.
              Título cujo documento não tem cadastro fica <strong>fora da importação</strong> e é listado na próxima tela.
              Sem essa coluna, o título só é ligado quando o nome bate com <strong>um único</strong> {rotuloParteMin} cadastrado.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Com a coluna de chave</strong>, importar a mesma planilha de novo não duplica nada: o que já entrou é reconhecido e pulado.
              Sem coluna de situação, todo título entra como <strong>Pendente</strong>. Vencimento aceita dd/mm/aaaa.
            </p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('upload')} disabled={verificando}>Voltar</button>
            <button className="btn-primary" onClick={confirmarMapeamento} disabled={verificando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {verificando ? <Loader2 size={16} className="spin-animation" /> : null}
              {verificando ? 'Conferindo títulos...' : 'Continuar'} {!verificando && <ArrowRight size={16} />}
            </button>
          </div>
        </div>
      )}

      {passo === 'confirmacao' && (
        <>
          <div className="card" style={cardStyle}>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Resumo da conferência</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
              {[
                { rotulo: 'Serão importados', qtd: linhasAtivas.length, valor: somar(linhasAtivas), cor: '#10b981' },
                { rotulo: `Sem ${rotuloParteMin} cadastrado`, qtd: semCadastro.length, valor: somar(semCadastro), cor: '#ef4444' },
                { rotulo: 'Já importados antes', qtd: jaImportadosLista.length, valor: somar(jaImportadosLista), cor: 'var(--text-muted)' },
                { rotulo: 'Pedem atenção', qtd: totalComProblema, valor: somar(linhasAtivas.filter(linhaTemProblema)), cor: '#f59e0b' },
              ].map((c) => (
                <div key={c.rotulo} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c.rotulo}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: c.cor }}>{c.qtd}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formatarMoeda(c.valor)}</div>
                </div>
              ))}
            </div>
            {!planilhaTemChave && (
              <p style={{ margin: 0, fontSize: '12px', color: '#f59e0b' }}>
                Esta planilha não tem coluna de chave: importar de novo duplica os títulos. Confira tudo antes de importar.
              </p>
            )}
          </div>

          {gruposAmbiguos.length > 0 && (
            <div className="card" style={{ ...cardStyle, border: '1px solid rgba(245,158,11,0.4)' }}>
              <div>
                <h2 style={{ fontSize: '16px', margin: '0 0 4px 0', color: '#f59e0b' }}>Escolha o {rotuloParteMin}</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                  Mais de um cadastro serve para estes títulos. A escolha vale para todos os títulos do grupo.
                  Se forem cadastros repetidos, depois vale inativar a cópia para isto não se repetir.
                </p>
              </div>
              {gruposAmbiguos.map(([grupo, g]) => (
                <div key={grupo} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                  <div style={{ flex: '1 1 260px' }}>
                    <div style={{ fontWeight: 600 }}>{g.exemplo.parteNome || '-'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {g.exemplo.documentoParte ? `CPF/CNPJ ${formatarDocumentoParte(g.exemplo.documentoParte)} · ` : 'Sem CPF/CNPJ na planilha · '}
                      {g.qtd} título(s) · {formatarMoeda(g.valor)}
                    </div>
                  </div>
                  <select
                    value={escolhasGrupo[grupo] || ''}
                    onChange={(e) => setEscolhasGrupo((atual) => ({ ...atual, [grupo]: e.target.value }))}
                    style={{ ...inputStyle, padding: '8px 10px', flex: '0 1 460px', minWidth: 0, maxWidth: '100%', border: escolhasGrupo[grupo] ? inputStyle.border : '1px solid #f59e0b' }}
                  >
                    <option value="">Escolha o cadastro...</option>
                    {g.exemplo.candidatos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {[p.codigo ? `Cód. ${p.codigo}` : '', p.nome, p.documento ? formatarDocumentoParte(p.documento) : 'sem CPF/CNPJ', p.cidade].filter(Boolean).join(' — ')}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {gruposSemCadastro.length > 0 && (
            <div className="card" style={{ ...cardStyle, border: '1px solid rgba(239,68,68,0.4)' }}>
              <div>
                <h2 style={{ fontSize: '16px', margin: '0 0 4px 0', color: '#ef4444' }}>
                  Fora da importação: {semCadastro.length} título(s) sem {rotuloParteMin} cadastrado ({formatarMoeda(somar(semCadastro))})
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                  Cadastre {rotuloParte === 'Cliente' ? 'os clientes' : 'os fornecedores'} abaixo e importe a mesma planilha de novo
                  {planilhaTemChave ? ' — o que já entrou não duplica.' : '.'}
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                      <th style={thStyle}>{rotuloParte} na planilha</th>
                      <th style={thStyle}>CPF/CNPJ</th>
                      <th style={thStyle}>Títulos</th>
                      <th style={thStyle}>Valor</th>
                      <th style={thStyle}>O que fazer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gruposSemCadastro.map((g) => (
                      <tr key={chaveGrupoVinculo(g.exemplo)} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={thStyle}>{g.exemplo.parteNome || '-'}</td>
                        <td style={{ ...thStyle, whiteSpace: 'nowrap' }}>{g.exemplo.documentoParte ? formatarDocumentoParte(g.exemplo.documentoParte) : '-'}</td>
                        <td style={thStyle}>{g.qtd}</td>
                        <td style={{ ...thStyle, whiteSpace: 'nowrap' }}>{formatarMoeda(g.valor)}</td>
                        <td style={{ ...thStyle, color: 'var(--text-muted)', fontSize: '12px' }}>{g.exemplo.avisoVinculo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card" style={cardStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Títulos</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                  {contas.length} título(s) na planilha. Só os que pedem atenção são editáveis.
                  {semVinculoTexto > 0 && ` ${semVinculoTexto} não trazem ${rotuloParteMin} identificável e entram só com o nome em texto.`}
                </p>
              </div>
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroLinhas)} style={{ ...inputStyle, padding: '8px 10px' }}>
                <option value="atencao">Pedem atenção ({totalComProblema})</option>
                <option value="importar">Serão importados ({linhasAtivas.length})</option>
                <option value="fora">Fora da importação ({contas.length - linhasAtivas.length})</option>
                <option value="todos">Todos ({contas.length})</option>
              </select>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                    <th style={thStyle}>Descrição</th>
                    <th style={thStyle}>{rotuloParte}</th>
                    <th style={thStyle}>Vínculo</th>
                    <th style={thStyle}>Categoria</th>
                    <th style={thStyle}>Valor (R$)</th>
                    <th style={thStyle}>Vencimento</th>
                    <th style={thStyle}>Situação</th>
                    <th style={thStyle}>Conferência</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Não importar</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.map((conta) => {
                    const bloqueado = foraPorRegra(conta);
                    const excluido = bloqueado || itensExcluidos.has(conta.linhaId);
                    const problema = !excluido && linhaTemProblema(conta);
                    // So a linha com problema de dado vira formulario: 2.600
                    // titulos com 8 campos cada travavam a aba.
                    const editavel = problema && conta.status === 'REVISAR';
                    const parte = parteEfetiva(conta);
                    return (
                      <tr key={conta.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: problema ? 'rgba(245,158,11,0.08)' : undefined, opacity: excluido ? 0.45 : 1 }}>
                        <td style={thStyle}>
                          {editavel
                            ? <input type="text" value={conta.descricao} onChange={(e) => atualizarConta(conta.linhaId, { descricao: e.target.value })} style={{ ...inputStyle, width: '220px' }} />
                            : conta.descricao}
                        </td>
                        <td style={thStyle}>
                          <div>{parte.nome || '-'}</div>
                          {conta.documentoParte && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatarDocumentoParte(conta.documentoParte)}</div>}
                        </td>
                        <td style={{ ...thStyle, whiteSpace: 'nowrap' }}>{rotuloVinculo(conta)}</td>
                        <td style={thStyle}>{conta.categoria || '-'}</td>
                        <td style={{ ...thStyle, whiteSpace: 'nowrap' }}>
                          {editavel
                            ? <input type="text" placeholder="0,00" value={conta.valorBruto} onChange={(e) => atualizarConta(conta.linhaId, { valorBruto: e.target.value, valor: Number(e.target.value.replace(',', '.')) || null })} style={{ ...inputStyle, width: '100px', border: (conta.valor === null || conta.valor <= 0) ? '1px solid #ef4444' : inputStyle.border }} />
                            : (conta.valor !== null ? formatarMoeda(conta.valor) : conta.valorBruto)}
                        </td>
                        <td style={{ ...thStyle, whiteSpace: 'nowrap' }}>
                          {editavel
                            ? <input type="date" value={conta.vencimento} onChange={(e) => atualizarConta(conta.linhaId, { vencimento: e.target.value })} style={{ ...inputStyle, width: '140px', border: !conta.vencimento ? '1px solid #ef4444' : inputStyle.border }} />
                            : formatarData(conta.vencimento)}
                        </td>
                        <td style={thStyle}>
                          {editavel
                            ? (
                              <select value={conta.statusPagamento} onChange={(e) => atualizarConta(conta.linhaId, { statusPagamento: e.target.value as StatusPagamentoConta })} style={{ ...inputStyle, width: '110px' }}>
                                <option value="Pendente">Pendente</option>
                                <option value="Paga">Paga</option>
                              </select>
                            )
                            : conta.statusPagamento}
                        </td>
                        <td style={thStyle}>
                          {problema ? (
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>REVISAR</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>{excluido ? '-' : 'OK'}</span>
                          )}
                          {problema && (conta.motivo || conta.avisoVinculo) && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '240px' }}>{conta.motivo || conta.avisoVinculo}</div>
                          )}
                        </td>
                        <td style={{ ...thStyle, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={excluido}
                            disabled={bloqueado}
                            title={bloqueado ? (jaImportados.has(conta.linhaId) ? 'Este título já foi importado.' : `Cadastre o ${rotuloParteMin} para importar este título.`) : undefined}
                            onChange={(e) => setItensExcluidos((atual) => {
                              const novo = new Set(atual);
                              if (e.target.checked) novo.add(conta.linhaId); else novo.delete(conta.linhaId);
                              return novo;
                            })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {linhasFiltradas.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum título neste filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setPasso('mapeamento')} disabled={salvando}>Voltar</button>
              <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !contasProntas} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !contasProntas) ? 0.6 : 1 }}>
                {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
                {salvando ? 'Importando...' : `Importar ${linhasAtivas.length} título(s) — ${formatarMoeda(somar(linhasAtivas))}`}
              </button>
            </div>
          </div>
        </>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} título(s) importado(s)!</h2>
          <div style={{ color: 'var(--text-muted)', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p style={{ margin: 0 }}>Os títulos já aparecem em {nomeTelaDestino}.</p>
            {resultadoImportacao.jaExistiam > 0 && <p style={{ margin: 0 }}>{resultadoImportacao.jaExistiam} já tinham sido importados antes e foram pulados.</p>}
            {resultadoImportacao.semCadastro > 0 && (
              <p style={{ margin: 0, color: '#ef4444' }}>
                {resultadoImportacao.semCadastro} título(s) ({formatarMoeda(resultadoImportacao.semCadastroValor)}) ficaram de fora por falta de cadastro do {rotuloParteMin}. Cadastre e importe a mesma planilha de novo.
              </p>
            )}
            {resultadoImportacao.semVinculoTexto > 0 && <p style={{ margin: 0 }}>{resultadoImportacao.semVinculoTexto} entraram só com o nome em texto, sem vínculo com o cadastro.</p>}
          </div>
          <button className="btn-primary" onClick={() => navigate(rotaVoltar)}>Ir para {nomeTelaDestino}</button>
        </div>
      )}
    </div>
  );
};

export default ImportarContasBase;

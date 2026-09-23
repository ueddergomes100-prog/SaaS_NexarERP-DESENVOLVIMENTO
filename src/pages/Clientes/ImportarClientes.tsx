import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  collection, query, where, getDocs, writeBatch, doc, serverTimestamp,
} from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, Upload, Users } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { getProximoCodigoCliente } from '../../utils/clienteCodigo';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
} from '../../utils/importacaoEstoqueDomain';
import {
  ehConsumidorFinal,
  inferirMapeamentoColunasCliente,
  montarClienteImportado,
  processarLinhasClientes,
  removerPrefixoCodigoAntigo,
  MAPEAMENTO_CLIENTE_VAZIO,
  type ClienteImportado,
  type MapeamentoColunasCliente,
} from '../../utils/importacaoClientesDomain';

/**
 * Importacao em massa de clientes a partir do cadastro do sistema antigo
 * de um cliente novo (CSV/XLSX). Mesmo padrao da importacao de produtos
 * (ImportarProdutos.tsx): mapeamento de colunas confirmado pelo usuario,
 * linha com dado ambiguo fica destacada pra revisao, nada e' gravado sem
 * o usuario confirmar a tela final.
 *
 * Cobre dois formatos reais de planilha: Shopping Rural (2026-08-29, so 4
 * colunas, endereco empacotado num campo so) e Sol Natus (2026-09-14, 33
 * colunas ja separadas, incluindo endereco de cobranca/entrega). Ver o
 * cabecalho de src/utils/importacaoClientesDomain.ts pros detalhes.
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

interface CampoMapeamento {
  campo: keyof MapeamentoColunasCliente;
  rotulo: string;
  obrigatorio?: boolean;
}

const GRUPOS_MAPEAMENTO: Array<{ titulo: string; campos: CampoMapeamento[] }> = [
  {
    titulo: 'Dados básicos',
    campos: [
      { campo: 'nome', rotulo: 'Nome / Razão Social', obrigatorio: true },
      { campo: 'fantasia', rotulo: 'Nome Fantasia' },
      { campo: 'documento', rotulo: 'CPF/CNPJ' },
      { campo: 'identidade', rotulo: 'Inscrição Estadual / RG' },
    ],
  },
  {
    titulo: 'Contato',
    campos: [
      { campo: 'telefoneDdd', rotulo: 'DDD do Telefone Fixo' },
      { campo: 'telefone', rotulo: 'Telefone Fixo' },
      { campo: 'celularDdd', rotulo: 'DDD do Celular' },
      { campo: 'celular', rotulo: 'Celular' },
      { campo: 'email', rotulo: 'E-mail' },
      { campo: 'emailNfe', rotulo: 'E-mail para Nota Fiscal' },
    ],
  },
  {
    titulo: 'Endereço Principal',
    campos: [
      { campo: 'endereco', rotulo: 'Rua (ou endereço completo, se vier tudo junto)' },
      { campo: 'numero', rotulo: 'Número' },
      { campo: 'bairro', rotulo: 'Bairro' },
      { campo: 'cidade', rotulo: 'Cidade' },
      { campo: 'estado', rotulo: 'Estado (UF)' },
      { campo: 'cep', rotulo: 'CEP' },
      { campo: 'referencia', rotulo: 'Ponto de Referência' },
    ],
  },
  {
    titulo: 'Endereço de Cobrança (opcional -- só se vier na planilha)',
    campos: [
      { campo: 'enderecoCobranca', rotulo: 'Rua' },
      { campo: 'numeroCobranca', rotulo: 'Número' },
      { campo: 'bairroCobranca', rotulo: 'Bairro' },
      { campo: 'cidadeCobranca', rotulo: 'Cidade' },
      { campo: 'estadoCobranca', rotulo: 'UF' },
      { campo: 'cepCobranca', rotulo: 'CEP' },
    ],
  },
  {
    titulo: 'Endereço de Entrega (opcional -- só se vier na planilha)',
    campos: [
      { campo: 'enderecoEntrega', rotulo: 'Rua' },
      { campo: 'numeroEntrega', rotulo: 'Número' },
      { campo: 'bairroEntrega', rotulo: 'Bairro' },
      { campo: 'cidadeEntrega', rotulo: 'Cidade' },
      { campo: 'estadoEntrega', rotulo: 'UF' },
      { campo: 'cepEntrega', rotulo: 'CEP' },
      { campo: 'referenciaEntrega', rotulo: 'Ponto de Referência' },
    ],
  },
  {
    titulo: 'Outros',
    campos: [
      { campo: 'dtUltimaCompra', rotulo: 'Data da Última Compra (só histórico, não editável depois)' },
    ],
  },
];

/** Consulta o codigo IBGE de cada CEP unico (ViaCEP, publico), com
 * concorrencia limitada -- 813 clientes reais chegam a ter so ~350 CEPs
 * distintos, e consultar um de cada vez levaria minutos. CEP que falha
 * (invalido, fora do ar) fica sem IBGE e NAO trava a importacao -- o
 * cliente entra do mesmo jeito, so sem o codigo que a NF-e exige (da pra
 * completar depois, editando o cadastro). */
const resolverCodigosIbgePorCep = async (
  ceps: string[],
  aoProgredir: (atual: number, total: number) => void,
): Promise<Map<string, string>> => {
  const unicos = Array.from(new Set(ceps.filter((cep) => cep.length === 8)));
  const resultado = new Map<string, string>();
  if (unicos.length === 0) return resultado;

  let indice = 0;
  let concluidos = 0;
  const CONCORRENCIA = 8;

  const worker = async () => {
    while (indice < unicos.length) {
      const meu = indice;
      indice += 1;
      const cep = unicos[meu];
      try {
        const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const dados = await resposta.json();
        if (!dados.erro && dados.ibge) resultado.set(cep, String(dados.ibge));
      } catch (error) {
        console.error(`Erro ao resolver código IBGE do CEP ${cep}:`, error);
      } finally {
        concluidos += 1;
        aoProgredir(concluidos, unicos.length);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, unicos.length) }, worker));
  return resultado;
};

/** Entre linhas com o mesmo documento (CPF/CNPJ), mantem so a PRIMEIRA
 * marcada pra importar -- as demais entram pre-marcadas como "não
 * importar" (o usuario ainda pode desmarcar se quiser mesmo assim). */
const linhasIdsDuplicadosParaExcluir = (processados: ClienteImportado[]): Set<number> => {
  const vistos = new Set<string>();
  const excluidos = new Set<number>();
  processados.forEach((cliente) => {
    if (!cliente.documento) return;
    if (vistos.has(cliente.documento)) {
      excluidos.add(cliente.linhaId);
    } else {
      vistos.add(cliente.documento);
    }
  });
  return excluidos;
};

const ImportarClientes: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasCliente>(MAPEAMENTO_CLIENTE_VAZIO);

  const [clientes, setClientes] = useState<ClienteImportado[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [ignoradosConsumidorFinal, setIgnoradosConsumidorFinal] = useState(0);
  const [documentosExistentes, setDocumentosExistentes] = useState<Set<string>>(new Set());

  const [salvando, setSalvando] = useState(false);
  const [progressoIbge, setProgressoIbge] = useState<{ atual: number; total: number } | null>(null);
  const [resultadoImportacao, setResultadoImportacao] = useState<{ criados: number } | null>(null);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
      if (tenantId) {
        const existentesSnap = await getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId)));
        const docs = new Set<string>();
        existentesSnap.forEach((d) => {
          const documento = String(d.data().documento || '').replace(/\D/g, '');
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
      setMapeamento(inferirMapeamentoColunasCliente(linhaCabecalho, resto));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler arquivo de importação:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const confirmarMapeamento = () => {
    const processados = processarLinhasClientes(linhasDados, mapeamento);

    const totalConsumidorFinal = linhasDados.filter((linha) => {
      const nomeBruto = (linha[mapeamento.nome] || '').trim();
      if (!nomeBruto) return false;
      return ehConsumidorFinal(removerPrefixoCodigoAntigo(nomeBruto).nomeLimpo);
    }).length;

    if (processados.length === 0 && totalConsumidorFinal === 0) {
      showError(
        'Nenhum cliente encontrado nessa coluna',
        'A coluna selecionada para "Nome / Razão Social" veio em branco em todas as linhas. Confira no cabeçalho da planilha se a coluna certa foi escolhida -- às vezes o dado de verdade está uma coluna ao lado do texto do cabeçalho (célula mesclada na planilha original).',
      );
      return;
    }

    setClientes(processados);
    setIgnoradosConsumidorFinal(totalConsumidorFinal);
    setItensExcluidos(linhasIdsDuplicadosParaExcluir(processados));
    setPasso('confirmacao');
  };

  const atualizarCliente = (linhaId: number, patch: Partial<ClienteImportado>) => {
    setClientes((atual) => atual.map((c) => (c.linhaId === linhaId ? { ...c, ...patch } : c)));
  };

  const linhasAtivas = useMemo(() => clientes.filter((c) => !itensExcluidos.has(c.linhaId)), [clientes, itensExcluidos]);

  const contagemDocumentosNoLote = useMemo(() => {
    const contagem = new Map<string, number>();
    linhasAtivas.forEach((c) => {
      if (!c.documento) return;
      contagem.set(c.documento, (contagem.get(c.documento) || 0) + 1);
    });
    return contagem;
  }, [linhasAtivas]);

  const avisoDuplicado = (cliente: ClienteImportado): string => {
    if (!cliente.documento) return '';
    if ((contagemDocumentosNoLote.get(cliente.documento) || 0) > 1) return 'CPF/CNPJ repetido em mais de uma linha desta planilha.';
    if (documentosExistentes.has(cliente.documento)) return 'Já existe um cliente cadastrado com este CPF/CNPJ.';
    // Documento repetido mas ja excluido (nao entra em linhasAtivas) --
    // ainda vale avisar o motivo de ter sido pre-marcado.
    const outrasOcorrencias = clientes.filter((c) => c.documento === cliente.documento).length;
    if (outrasOcorrencias > 1 && itensExcluidos.has(cliente.linhaId)) return 'CPF/CNPJ repetido nesta planilha -- pré-marcado para não importar (mantido só o primeiro registro).';
    return '';
  };

  const linhaTemProblema = (cliente: ClienteImportado): boolean => (
    cliente.status === 'REVISAR'
    || !cliente.nome.trim()
    || (cliente.documento !== '' && cliente.documento.length !== 11 && cliente.documento.length !== 14)
    || avisoDuplicado(cliente) !== ''
  );

  const totalComProblema = linhasAtivas.filter(linhaTemProblema).length;
  const clientesProntos = totalComProblema === 0 && linhasAtivas.length > 0;

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!clientesProntos) {
      showError('Ainda há linhas pendentes', `${totalComProblema} linha(s) precisam ser corrigidas, ou marcadas como "não importar", antes de continuar.`);
      return;
    }

    setSalvando(true);
    setProgressoIbge({ atual: 0, total: 0 });
    try {
      const mapaIbgePorCep = await resolverCodigosIbgePorCep(
        linhasAtivas.map((c) => c.cep),
        (atual, total) => setProgressoIbge({ atual, total }),
      );
      setProgressoIbge(null);

      let proximoCodigo = Number.parseInt(await getProximoCodigoCliente(tenantId), 10);
      if (!Number.isFinite(proximoCodigo)) proximoCodigo = 1;
      const timestamp = serverTimestamp();

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < linhasAtivas.length; inicio += LOTE_MAXIMO) {
        const lote = linhasAtivas.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);

        lote.forEach((cliente) => {
          const codigo = String(proximoCodigo);
          proximoCodigo += 1;

          const docRef = doc(collection(db, 'clientes'));
          batch.set(docRef, {
            ...montarClienteImportado(
              {
                codigo,
                nome: cliente.nome,
                fantasia: cliente.fantasia,
                identidade: cliente.identidade,
                telefone: cliente.telefone,
                celular: cliente.celular,
                email: cliente.email,
                emailNfe: cliente.emailNfe,
                documento: cliente.documento,
                endereco: cliente.endereco,
                numero: cliente.numero,
                bairro: cliente.bairro,
                cidade: cliente.cidade,
                estado: cliente.estado,
                cep: cliente.cep,
                codigoIbge: mapaIbgePorCep.get(cliente.cep) || '',
                referencia: cliente.referencia,
                enderecoCobranca: cliente.enderecoCobranca,
                numeroCobranca: cliente.numeroCobranca,
                bairroCobranca: cliente.bairroCobranca,
                cidadeCobranca: cliente.cidadeCobranca,
                estadoCobranca: cliente.estadoCobranca,
                cepCobranca: cliente.cepCobranca,
                enderecoEntrega: cliente.enderecoEntrega,
                numeroEntrega: cliente.numeroEntrega,
                bairroEntrega: cliente.bairroEntrega,
                cidadeEntrega: cliente.cidadeEntrega,
                estadoEntrega: cliente.estadoEntrega,
                cepEntrega: cliente.cepEntrega,
                referenciaEntrega: cliente.referenciaEntrega,
                dtUltimaCompra: cliente.dtUltimaCompra,
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
      showSuccess(`${linhasAtivas.length} cliente(s) importado(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar clientes:', error);
      showError('Erro ao importar', 'Não foi possível concluir a importação. Nenhum cliente foi gravado neste lote com erro -- tente novamente.');
    } finally {
      setSalvando(false);
      setProgressoIbge(null);
    }
  };

  const inputStyle = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/clientes')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={26} color="var(--accent-purple)" /> Importar Clientes
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Importação em massa a partir do cadastro de clientes de outro sistema (CSV ou XLSX)</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '440px' }}>
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é cada campo -- nome, documento, contato e os três endereços possíveis (principal, cobrança e entrega).
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
            Se o endereço principal vier todo junto num campo só ("Rua, Número, Bairro - Cidade"), deixe Número/Bairro/Cidade sem coluna que a próxima tela tenta separar automaticamente -- confira o resultado linha por linha antes de importar. O código do cliente é sempre gerado automaticamente pelo sistema (1, 2, 3...). O código IBGE (necessário pra NF-e) é resolvido a partir do CEP na hora de importar, não precisa vir na planilha.
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
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confira e corrija cada cliente</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {clientes.length} cliente(s) encontrado(s){totalComProblema > 0 ? `, ${totalComProblema} precisam de atenção (destacados abaixo)` : ''}.
              {ignoradosConsumidorFinal > 0 && ` ${ignoradosConsumidorFinal} linha(s) chamada(s) "Consumidor Final" foram ignoradas — esse cliente já existe por padrão no sistema.`}
              {itensExcluidos.size > 0 && ` ${itensExcluidos.size} linha(s) com CPF/CNPJ repetido na planilha já vêm pré-marcadas para não importar (mantido o primeiro registro de cada) -- desmarque se quiser importar mesmo assim.`}
            </p>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Nome</th>
                  <th style={{ padding: '8px' }}>CPF/CNPJ</th>
                  <th style={{ padding: '8px' }}>Telefone</th>
                  <th style={{ padding: '8px' }}>Rua</th>
                  <th style={{ padding: '8px' }}>Nº</th>
                  <th style={{ padding: '8px' }}>Bairro</th>
                  <th style={{ padding: '8px' }}>Cidade</th>
                  <th style={{ padding: '8px' }}>Situação</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Não importar</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((cliente) => {
                  const excluido = itensExcluidos.has(cliente.linhaId);
                  const problema = linhaTemProblema(cliente);
                  const aviso = avisoDuplicado(cliente);
                  const motivos = [cliente.motivo, aviso].filter(Boolean).join(' ');
                  return (
                    <tr key={cliente.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: (problema && !excluido) ? 'rgba(245,158,11,0.08)' : undefined, opacity: excluido ? 0.5 : 1 }}>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={cliente.nome} onChange={(e) => atualizarCliente(cliente.linhaId, { nome: aplicarCaixaAltaCadastro(e.target, e.target.value) })} style={{ ...inputStyle, width: '220px' }} title={cliente.prefixoCodigoRemovido ? `Código "${cliente.prefixoCodigoRemovido}" do sistema antigo removido do nome` : undefined} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={cliente.documento} onChange={(e) => atualizarCliente(cliente.linhaId, { documento: e.target.value.replace(/\D/g, '') })} style={{ ...inputStyle, width: '130px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={cliente.telefone} onChange={(e) => atualizarCliente(cliente.linhaId, { telefone: e.target.value })} style={{ ...inputStyle, width: '120px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={cliente.endereco} onChange={(e) => atualizarCliente(cliente.linhaId, { endereco: e.target.value })} style={{ ...inputStyle, width: '180px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={cliente.numero} onChange={(e) => atualizarCliente(cliente.linhaId, { numero: e.target.value })} style={{ ...inputStyle, width: '60px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={cliente.bairro} onChange={(e) => atualizarCliente(cliente.linhaId, { bairro: e.target.value })} style={{ ...inputStyle, width: '120px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={cliente.cidade} onChange={(e) => atualizarCliente(cliente.linhaId, { cidade: e.target.value })} style={{ ...inputStyle, width: '120px' }} />
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
                            if (e.target.checked) novo.add(cliente.linhaId); else novo.delete(cliente.linhaId);
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
          {progressoIbge && (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Loader2 size={14} className="spin-animation" /> Resolvendo código IBGE pelo CEP... {progressoIbge.atual}/{progressoIbge.total || '?'}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('mapeamento')} disabled={salvando}>Voltar</button>
            <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !clientesProntos} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !clientesProntos) ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : `Importar ${linhasAtivas.length} cliente(s)`}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} cliente(s) importado(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px' }}>
            Os clientes já aparecem em Clientes.
          </p>
          <button className="btn-primary" onClick={() => navigate('/clientes')}>Ir para Clientes</button>
        </div>
      )}
    </div>
  );
};

export default ImportarClientes;

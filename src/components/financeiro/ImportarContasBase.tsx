import React, { useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  collection, query, where, getDocs, writeBatch, doc, serverTimestamp,
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
  inferirMapeamentoColunasConta,
  montarContaImportada,
  processarLinhasContas,
  resolverParteImportada,
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
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

interface ImportarContasBaseProps {
  tipo: 'entrada' | 'saida';
  titulo: string;
  subtitulo: string;
  rotaVoltar: string;
  colecaoParte: 'clientes' | 'fornecedores';
  rotuloParte: string;
  Icone: ComponentType<{ size?: number; color?: string }>;
}

const ImportarContasBase: React.FC<ImportarContasBaseProps> = ({
  tipo, titulo, subtitulo, rotaVoltar, colecaoParte, rotuloParte, Icone,
}) => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasConta>({
    descricao: 0, valor: 1, vencimento: 2, categoria: null, parte: null, status: null, dataPagamento: null,
  });

  const [contas, setContas] = useState<ContaImportada[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [partesDisponiveis, setPartesDisponiveis] = useState<ParteCadastrada[]>([]);

  const [salvando, setSalvando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<{ criados: number; semVinculo: number } | null>(null);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
      if (tenantId) {
        const partesSnap = await getDocs(query(collection(db, colecaoParte), where('tenantId', '==', tenantId)));
        setPartesDisponiveis(partesSnap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || '') })));
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

  const confirmarMapeamento = () => {
    const processados = processarLinhasContas(linhasDados, mapeamento).map((conta) => {
      const vinculo = resolverParteImportada(conta.parteNomeBruto, partesDisponiveis);
      return { ...conta, parteId: vinculo.id, parteNome: vinculo.nome };
    });
    if (processados.length === 0) {
      showError(
        'Nenhum título encontrado nessa coluna',
        'As colunas selecionadas para "Descrição" e "Valor" vieram em branco em todas as linhas. Confira no cabeçalho da planilha se as colunas certas foram escolhidas.',
      );
      return;
    }
    setContas(processados);
    setItensExcluidos(new Set());
    setPasso('confirmacao');
  };

  const atualizarConta = (linhaId: number, patch: Partial<ContaImportada>) => {
    setContas((atual) => atual.map((c) => (c.linhaId === linhaId ? { ...c, ...patch } : c)));
  };

  const linhasAtivas = useMemo(() => contas.filter((c) => !itensExcluidos.has(c.linhaId)), [contas, itensExcluidos]);

  const linhaTemProblema = (conta: ContaImportada): boolean => (
    conta.status === 'REVISAR'
    || !conta.descricao.trim()
    || conta.valor === null
    || conta.valor <= 0
    || !conta.vencimento
  );

  const totalComProblema = linhasAtivas.filter(linhaTemProblema).length;
  const totalSemVinculo = linhasAtivas.filter((c) => c.parteNomeBruto && !c.parteId).length;
  const contasProntas = totalComProblema === 0 && linhasAtivas.length > 0;

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!contasProntas) {
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

        lote.forEach((conta) => {
          const docRef = doc(collection(db, 'transacoes'));
          batch.set(docRef, montarContaImportada(
            {
              descricao: conta.descricao,
              categoria: conta.categoria,
              valor: conta.valor as number,
              vencimento: conta.vencimento,
              statusPagamento: conta.statusPagamento,
              dataPagamento: conta.dataPagamento,
              parteId: conta.parteId,
              parteNome: conta.parteNome,
            },
            tipo,
            tenantId,
            currentUser.uid,
            timestamp,
          ));
        });

        await batch.commit();
      }

      setResultadoImportacao({ criados: linhasAtivas.length, semVinculo: totalSemVinculo });
      setPasso('concluido');
      showSuccess(`${linhasAtivas.length} título(s) importado(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar contas:', error);
      showError('Erro ao importar', 'Não foi possível concluir a importação. Nenhum título foi gravado neste lote com erro -- tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' };

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
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é a descrição, o valor, o vencimento, a categoria e o {rotuloParte.toLowerCase()}.
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
            {(['descricao', 'valor', 'vencimento', 'categoria', 'parte', 'status', 'dataPagamento'] as const).map((campo) => {
              const obrigatorio = campo === 'descricao' || campo === 'valor' || campo === 'vencimento';
              const rotulos: Record<typeof campo, string> = {
                descricao: 'Descrição', valor: 'Valor', vencimento: 'Vencimento',
                categoria: 'Categoria (opcional)', parte: `${rotuloParte} (opcional)`,
                status: 'Situação -- Pago/Pendente (opcional)', dataPagamento: 'Data de pagamento (opcional)',
              };
              return (
                <div className="input-group" key={campo}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de {rotulos[campo]}</label>
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
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
            Sem coluna de situação, todo título entra como <strong>Pendente</strong> (é pra isso que serve importar saldo de um sistema antigo). Vencimento aceita dd/mm/aaaa. O {rotuloParte.toLowerCase()} só vincula ao cadastro quando o nome bate exatamente com um já importado -- confira antes se {rotuloParte === 'Cliente' ? 'os clientes' : 'os fornecedores'} já foram importados.
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
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confira e corrija cada título</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {contas.length} título(s) encontrado(s){totalComProblema > 0 ? `, ${totalComProblema} precisam de atenção (destacados abaixo)` : ''}.
              {totalSemVinculo > 0 && ` ${totalSemVinculo} não bateram com nenhum ${rotuloParte.toLowerCase()} já cadastrado -- entram só com o nome em texto, sem vínculo com o cadastro.`}
            </p>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Descrição</th>
                  <th style={{ padding: '8px' }}>{rotuloParte}</th>
                  <th style={{ padding: '8px' }}>Categoria</th>
                  <th style={{ padding: '8px' }}>Valor (R$)</th>
                  <th style={{ padding: '8px' }}>Vencimento</th>
                  <th style={{ padding: '8px' }}>Situação</th>
                  <th style={{ padding: '8px' }}>Conferência</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Não importar</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((conta) => {
                  const excluido = itensExcluidos.has(conta.linhaId);
                  const problema = linhaTemProblema(conta);
                  return (
                    <tr key={conta.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: (problema && !excluido) ? 'rgba(245,158,11,0.08)' : undefined, opacity: excluido ? 0.4 : 1 }}>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={conta.descricao} onChange={(e) => atualizarConta(conta.linhaId, { descricao: e.target.value })} style={{ ...inputStyle, width: '220px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={conta.parteNome} onChange={(e) => atualizarConta(conta.linhaId, { parteNome: e.target.value.toUpperCase(), parteId: null })} style={{ ...inputStyle, width: '160px' }} title={conta.parteId ? 'Vinculado ao cadastro' : 'Sem vínculo com o cadastro -- só texto'} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="-" value={conta.categoria} onChange={(e) => atualizarConta(conta.linhaId, { categoria: e.target.value })} style={{ ...inputStyle, width: '140px' }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="text" placeholder="0,00" value={conta.valorBruto} onChange={(e) => atualizarConta(conta.linhaId, { valorBruto: e.target.value, valor: Number(e.target.value.replace(',', '.')) || null })} style={{ ...inputStyle, width: '100px', border: (conta.valor === null || conta.valor <= 0) ? '1px solid #ef4444' : inputStyle.border }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input type="date" value={conta.vencimento} onChange={(e) => atualizarConta(conta.linhaId, { vencimento: e.target.value })} style={{ ...inputStyle, width: '140px', border: !conta.vencimento ? '1px solid #ef4444' : inputStyle.border }} />
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select value={conta.statusPagamento} onChange={(e) => atualizarConta(conta.linhaId, { statusPagamento: e.target.value as StatusPagamentoConta })} style={{ ...inputStyle, width: '110px' }}>
                          <option value="Pendente">Pendente</option>
                          <option value="Paga">Paga</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {problema && !excluido ? (
                          <span style={{ color: '#f59e0b', fontWeight: 600 }} title={conta.motivo}>REVISAR</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>OK</span>
                        )}
                        {conta.motivo && !excluido && <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '200px' }}>{conta.motivo}</div>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={excluido}
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
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('mapeamento')} disabled={salvando}>Voltar</button>
            <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !contasProntas} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !contasProntas) ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : `Importar ${linhasAtivas.length} título(s)`}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} título(s) importado(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px' }}>
            Os títulos já aparecem em {tipo === 'entrada' ? 'Contas a Receber' : 'Contas a Pagar'}.
            {resultadoImportacao.semVinculo > 0 && ` ${resultadoImportacao.semVinculo} entraram sem vínculo com o cadastro de ${colecaoParte} (nome não bateu com nenhum registro) -- aparecem agrupados pelo nome em texto mesmo assim.`}
          </p>
          <button className="btn-primary" onClick={() => navigate(rotaVoltar)}>Ir para {tipo === 'entrada' ? 'Contas a Receber' : 'Contas a Pagar'}</button>
        </div>
      )}
    </div>
  );
};

export default ImportarContasBase;

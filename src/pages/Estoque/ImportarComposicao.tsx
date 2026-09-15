import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, Factory, Upload, AlertTriangle } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { ROTULO_POR_ORIGEM } from '../../utils/producaoDomain';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  parseDelimitedText,
  inferirMapeamentoColunasComposicao,
  processarLinhasComposicao,
  reavaliarLinha,
  agruparComposicoes,
  composicaoEhCircular,
  construirIndiceCatalogo,
  montarComposicaoImportada,
  type ItemCatalogo,
  type LinhaComposicaoImportada,
  type MapeamentoColunasComposicao,
} from '../../utils/importacaoComposicaoDomain';

/**
 * Importacao em massa de composicao (receita de producao) a partir de uma
 * planilha do sistema antigo.
 *
 * Diferente dos outros importadores, este NAO cria cadastro: cada linha diz
 * "produto X leva N do componente Y", e o trabalho e' casar X e Y pelo nome
 * com o que ja' esta' cadastrado. O produto final so' pode ser um item do
 * Estoque (e' ele que a Ordem de Producao produz); o componente pode vir de
 * Estoque ou de Materia-Prima (ver src/utils/producaoDomain.ts).
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 14px',
  color: 'var(--text-primary)',
};

const celulaSelect: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  padding: '6px 8px',
  color: 'var(--text-primary)',
  maxWidth: '260px',
};

const ImportarComposicao: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunasComposicao>({ produto: 0, componente: 1, quantidade: 2, unidade: null });

  const [produtosCatalogo, setProdutosCatalogo] = useState<ItemCatalogo[]>([]);
  const [componentesCatalogo, setComponentesCatalogo] = useState<ItemCatalogo[]>([]);
  const [linhas, setLinhas] = useState<LinhaComposicaoImportada[]>([]);
  const [somenteRevisar, setSomenteRevisar] = useState(false);
  const [substituirExistentes, setSubstituirExistentes] = useState(true);
  const [composicoesExistentes, setComposicoesExistentes] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ produtos: number; itens: number; ignoradas: number } | null>(null);

  const catalogoPorId = useMemo(() => {
    const m = new Map<string, ItemCatalogo>();
    for (const item of [...produtosCatalogo, ...componentesCatalogo]) m.set(item.id, item);
    return m;
  }, [produtosCatalogo, componentesCatalogo]);

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    try {
      const nomeLower = file.name.toLowerCase();
      let matriz: string[][];

      if (nomeLower.endsWith('.xlsx') || nomeLower.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
        const bruto = XLSX.utils.sheet_to_json<string[]>(primeiraAba, { header: 1, raw: false, defval: '' });
        matriz = bruto.map((linha) => linha.map((celula) => String(celula ?? '').trim()));
      } else {
        const buffer = await file.arrayBuffer();
        const texto = decodificarArquivoTexto(buffer);
        const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
        matriz = parseDelimitedText(texto, detectarDelimitador(primeiraLinha));
      }

      matriz = matriz.filter((linha) => linha.some((c) => c && c.trim()));
      if (matriz.length < 2) {
        showError('Planilha vazia', 'Não encontramos nenhuma linha de dado nesta planilha.');
        return;
      }

      const [linhaCabecalho, ...resto] = matriz;
      setNomeArquivo(file.name);
      setCabecalho(linhaCabecalho);
      setLinhasDados(resto);
      setMapeamento(inferirMapeamentoColunasComposicao(linhaCabecalho));
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
    if (mapeamento.produto === mapeamento.componente) {
      showError('Colunas iguais', 'A coluna do produto e a coluna do componente precisam ser diferentes.');
      return;
    }
    setCarregandoArquivo(true);
    try {
      // Produto final so' pode ser item do Estoque -- e' ele que a Ordem de
      // Producao produz. Inativo fica de fora: receita nova nao deve cair em
      // cadastro que o usuario ja tirou de circulacao.
      const [snapEstoque, snapMp, snapComposicoes] = await Promise.all([
        getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'materias_primas'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'produtos_composicao'), where('tenantId', '==', tenantId))),
      ]);

      const produtos: ItemCatalogo[] = [];
      snapEstoque.forEach((d) => {
        const data = d.data();
        if (data.ativo === false) return;
        produtos.push({
          id: d.id,
          nome: (data.nome || '').trim(),
          codigo: data.codigo || '',
          origem: 'estoque',
          unidade: data.unidadeMedidaSigla || data.unidade || 'UN',
        });
      });

      const materiasPrimas: ItemCatalogo[] = [];
      snapMp.forEach((d) => {
        const data = d.data();
        if (data.ativo === false) return;
        materiasPrimas.push({
          id: d.id,
          nome: (data.nome || '').trim(),
          codigo: data.codigo || '',
          origem: 'materia_prima',
          unidade: data.unidade || 'UN',
        });
      });

      const jaTemComposicao = new Set<string>();
      snapComposicoes.forEach((d) => {
        const itens = d.data().itens;
        if (Array.isArray(itens) && itens.length > 0) jaTemComposicao.add(d.id);
      });

      setProdutosCatalogo(produtos);
      setComponentesCatalogo(materiasPrimas);
      setComposicoesExistentes(jaTemComposicao);

      // Componente pode vir das duas colecoes -- o indice guarda TODOS os
      // cadastros de cada nome. Quando o mesmo nome existe nas duas,
      // resolverNome fica com a materia-prima (producao consome dela) e a
      // conferencia mostra a escolha pro usuario poder trocar.
      const indiceProdutos = construirIndiceCatalogo(produtos);
      const indiceComponentes = construirIndiceCatalogo([...materiasPrimas, ...produtos]);

      setLinhas(processarLinhasComposicao(linhasDados, mapeamento, indiceProdutos, indiceComponentes));
      setPasso('confirmacao');
    } catch (error) {
      console.error('Erro ao carregar catálogo para importação de composição:', error);
      showError('Erro ao carregar cadastros', 'Não foi possível ler os produtos e matérias-primas para comparar com a planilha. Tente novamente.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const escolher = (linhaId: number, campo: 'produtoEscolhidoId' | 'componenteEscolhidoId', valor: string) => {
    setLinhas((atual) => atual.map((l) => (
      l.linhaId === linhaId ? reavaliarLinha({ ...l, [campo]: valor || null }, catalogoPorId) : l
    )));
  };

  const grupos = useMemo(() => agruparComposicoes(linhas, catalogoPorId), [linhas, catalogoPorId]);
  const circulares = useMemo(() => grupos.filter(composicaoEhCircular), [grupos]);
  const linhasOk = linhas.filter((l) => l.status === 'OK').length;
  const linhasRevisar = linhas.length - linhasOk;
  const totalItens = grupos.reduce((soma, g) => soma + g.itens.length, 0);
  const duplicadas = grupos.reduce((soma, g) => soma + g.duplicadasIgnoradas, 0);
  const vaiSubstituir = grupos.filter((g) => composicoesExistentes.has(g.produtoId)).length;

  const linhasVisiveis = somenteRevisar ? linhas.filter((l) => l.status === 'REVISAR') : linhas;

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (grupos.length === 0) {
      showError('Nada para importar', 'Nenhuma linha está pronta para gravar. Resolve as pendências da coluna "Situação" e tente de novo.');
      return;
    }
    if (circulares.length > 0) {
      showError(
        'Receita circular',
        `${circulares.map((g) => `"${g.produtoNome}"`).join(', ')} aparece dentro da própria receita. Um produto não pode ser componente de si mesmo — corrija a planilha ou remova essa linha antes de importar.`,
      );
      return;
    }
    if (!substituirExistentes && vaiSubstituir > 0) {
      showError(
        'Produtos já têm composição',
        `${vaiSubstituir} produto(s) já têm composição cadastrada. Marque "Substituir a composição atual" para seguir, ou tire esses produtos da planilha.`,
      );
      return;
    }

    setSalvando(true);
    try {
      const timestamp = serverTimestamp();
      const paraGravar = substituirExistentes ? grupos : grupos.filter((g) => !composicoesExistentes.has(g.produtoId));

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < paraGravar.length; inicio += LOTE_MAXIMO) {
        const lote = paraGravar.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);
        lote.forEach((grupo) => {
          // Id do documento e' o id do produto (produtos_composicao/{produtoId}),
          // igual a aba Composicao do cadastro grava -- as duas telas escrevem
          // no mesmo lugar de proposito.
          batch.set(doc(db, 'produtos_composicao', grupo.produtoId), montarComposicaoImportada(grupo, tenantId, currentUser.uid, timestamp));
        });
        await batch.commit();
      }

      setResultado({
        produtos: paraGravar.length,
        itens: paraGravar.reduce((soma, g) => soma + g.itens.length, 0),
        ignoradas: linhasRevisar,
      });
      setPasso('concluido');
      showSuccess(`Composição importada para ${paraGravar.length} produto(s)!`);
    } catch (error) {
      console.error('Erro ao importar composições:', error);
      showError('Erro ao importar', 'Não foi possível concluir a importação. Confira sua conexão e tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const opcoesProduto = (linha: LinhaComposicaoImportada): ItemCatalogo[] => (
    linha.produto.candidatos.length > 0 ? linha.produto.candidatos : produtosCatalogo
  );
  const opcoesComponente = (linha: LinhaComposicaoImportada): ItemCatalogo[] => (
    linha.componente.candidatos.length > 0 ? linha.componente.candidatos : [...componentesCatalogo, ...produtosCatalogo]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/estoque')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Factory size={26} color="var(--accent-purple)" /> Importar Composição
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Monta a receita de produção de vários produtos de uma vez, a partir de uma planilha
          </p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '520px' }}>
              Aceita .csv e .xlsx. Uma linha por item da receita, com o produto final, o componente e a quantidade
              consumida para produzir <strong>1 unidade</strong> do produto.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '10px' }}>
              Esta tela não cadastra produto nem matéria-prima: ela liga cadastros que já existem, comparando pelo nome.
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
            {(['produto', 'componente', 'quantidade', 'unidade'] as const).map((campo) => {
              const obrigatorio = campo !== 'unidade';
              const rotulos: Record<typeof campo, string> = {
                produto: 'Produto final',
                componente: 'Componente',
                quantidade: 'Quantidade por unidade',
                unidade: 'Unidade (opcional, só conferência)',
              };
              return (
                <div className="input-group" key={campo}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de {rotulos[campo]}</label>
                  <select
                    value={mapeamento[campo] === null ? '' : mapeamento[campo]}
                    onChange={(e) => setMapeamento((atual) => ({ ...atual, [campo]: e.target.value === '' ? null : Number(e.target.value) }))}
                    style={inputStyle}
                  >
                    {!obrigatorio && <option value="">-- Nenhuma --</option>}
                    {cabecalho.map((h, idx) => <option key={idx} value={idx}>{h || `Coluna ${idx + 1}`}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
            A unidade usada na receita é sempre a do cadastro do componente, não a da planilha — a coluna de unidade serve
            só para você conferir se bate.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('upload')} disabled={carregandoArquivo}>Voltar</button>
            <button className="btn-primary" onClick={confirmarMapeamento} disabled={carregandoArquivo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {carregandoArquivo ? <Loader2 size={16} className="spin-animation" /> : <ArrowRight size={16} />}
              {carregandoArquivo ? 'Comparando com os cadastros...' : 'Continuar'}
            </button>
          </div>
        </div>
      )}

      {passo === 'confirmacao' && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confira antes de gravar</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {linhasOk} linha(s) prontas, formando a receita de <strong>{grupos.length}</strong> produto(s) ({totalItens} item(ns) no total).
              {linhasRevisar > 0 && <> {linhasRevisar} linha(s) precisam de atenção e <strong>não serão gravadas</strong> do jeito que estão.</>}
            </p>
          </div>

          {duplicadas > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', fontSize: '13px' }}>
              {duplicadas} linha(s) repetem um componente que já está na receita do mesmo produto. A receita guarda um item por
              componente, então só a primeira de cada uma vale.
            </div>
          )}

          {circulares.length > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', fontSize: '13px', display: 'flex', gap: '10px' }}>
              <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
              <div>
                <strong>Receita circular:</strong> {circulares.map((g) => g.produtoNome).join(', ')} aparece dentro da própria receita.
                Um produto não pode ser componente de si mesmo — corrija a planilha antes de importar.
              </div>
            </div>
          )}

          {vaiSubstituir > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', fontSize: '13px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={substituirExistentes} onChange={(e) => setSubstituirExistentes(e.target.checked)} style={{ marginTop: '3px' }} />
                <span>
                  <strong>{vaiSubstituir} produto(s) já têm composição cadastrada.</strong> Marcado, a receita da planilha
                  substitui a atual por inteiro. Desmarcado, esses produtos são pulados e a composição que já existe fica como está.
                </span>
              </label>
            </div>
          )}

          {linhasRevisar > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={somenteRevisar} onChange={(e) => setSomenteRevisar(e.target.checked)} />
              Mostrar só as {linhasRevisar} linha(s) que precisam de atenção
            </label>
          )}

          <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Produto final (da planilha)</th>
                  <th style={{ padding: '8px' }}>Produto no sistema</th>
                  <th style={{ padding: '8px' }}>Componente (da planilha)</th>
                  <th style={{ padding: '8px' }}>Componente no sistema</th>
                  <th style={{ padding: '8px' }}>Qtd.</th>
                  <th style={{ padding: '8px' }}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis.map((linha) => {
                  const produtoResolvido = linha.produtoEscolhidoId ? catalogoPorId.get(linha.produtoEscolhidoId) : null;
                  const componenteEscolhido = linha.componenteEscolhidoId ? catalogoPorId.get(linha.componenteEscolhidoId) : null;
                  const unidadeDivergente = !!componenteEscolhido && !!linha.unidadeArquivo
                    && componenteEscolhido.unidade.toUpperCase() !== linha.unidadeArquivo;
                  return (
                    <tr key={linha.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: linha.status === 'REVISAR' ? 'rgba(245,158,11,0.08)' : undefined }}>
                      <td style={{ padding: '8px', maxWidth: '210px' }}>{linha.produtoBruto}</td>
                      <td style={{ padding: '8px' }}>
                        {/* Select so' onde precisa escolher. A lista tem mais de mil
                            cadastros e a planilha traz centenas de linhas -- renderizar
                            o select cheio em toda linha trava a aba. */}
                        {produtoResolvido && linha.produto.status === 'encontrado'
                          ? <span>{produtoResolvido.codigo ? `${produtoResolvido.codigo} — ` : ''}{produtoResolvido.nome}</span>
                          : (
                            <select value={linha.produtoEscolhidoId || ''} onChange={(e) => escolher(linha.linhaId, 'produtoEscolhidoId', e.target.value)} style={celulaSelect}>
                              <option value="">-- escolher --</option>
                              {opcoesProduto(linha).map((o) => (
                                <option key={o.id} value={o.id}>{o.codigo ? `${o.codigo} — ` : ''}{o.nome}</option>
                              ))}
                            </select>
                          )}
                      </td>
                      <td style={{ padding: '8px', maxWidth: '210px' }}>{linha.componenteBruto}</td>
                      <td style={{ padding: '8px' }}>
                        {componenteEscolhido && linha.componente.status === 'encontrado'
                          ? <span>{componenteEscolhido.nome}</span>
                          : (
                            <select value={linha.componenteEscolhidoId || ''} onChange={(e) => escolher(linha.linhaId, 'componenteEscolhidoId', e.target.value)} style={celulaSelect}>
                              <option value="">-- escolher --</option>
                              {opcoesComponente(linha).map((o) => (
                                <option key={o.id} value={o.id}>{ROTULO_POR_ORIGEM[o.origem]}: {o.nome}</option>
                              ))}
                            </select>
                          )}
                        {componenteEscolhido && (
                          <div style={{ fontSize: '11px', color: unidadeDivergente ? '#f59e0b' : 'var(--text-muted)' }}>
                            {ROTULO_POR_ORIGEM[componenteEscolhido.origem]} · {componenteEscolhido.unidade}
                            {linha.componente.status === 'resolvido_por_origem' && ' · escolhido automaticamente'}
                            {unidadeDivergente && ` (planilha diz ${linha.unidadeArquivo})`}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{linha.quantidadeBruta || '-'}</td>
                      <td style={{ padding: '8px', maxWidth: '260px' }}>
                        {linha.status === 'OK'
                          ? <span style={{ color: '#10b981' }}>OK</span>
                          : <span style={{ color: '#f59e0b' }}>{linha.motivo}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('mapeamento')} disabled={salvando}>Voltar</button>
            <button
              className="btn-primary"
              onClick={executarImportacao}
              disabled={salvando || grupos.length === 0 || circulares.length > 0}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || grupos.length === 0 || circulares.length > 0) ? 0.6 : 1 }}
            >
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : `Importar ${grupos.length} composição(ões)`}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultado && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>Composição importada para {resultado.produtos} produto(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '520px' }}>
            {resultado.itens} item(ns) de receita gravados. A composição de cada produto aparece em
            Estoque → editar produto → aba "Composição (Produção)".
            {resultado.ignoradas > 0 && ` ${resultado.ignoradas} linha(s) ficaram de fora por pendência e podem ser importadas depois.`}
          </p>
          <button className="btn-primary" onClick={() => navigate('/estoque')}>Ir para Produtos</button>
        </div>
      )}
    </div>
  );
};

export default ImportarComposicao;

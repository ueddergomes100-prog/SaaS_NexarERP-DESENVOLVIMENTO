import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  collection, doc, getCountFromServer, getDoc, getDocs, query, where,
  writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2, PackageSearch, Upload } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { DEFAULT_VENDER_POR_EMBALAGEM } from '../../utils/embalagemDomain';
import {
  decodificarArquivoTexto,
  detectarDelimitador,
  detectarGruposEmbalagem,
  inferirMapeamentoColunas,
  montarProdutoImportado,
  parseDelimitedText,
  processarLinhas,
  type GrupoCandidatoEmbalagem,
  type ItemImportado,
  type MapeamentoColunas,
  type UnidadeMedidaRef,
} from '../../utils/importacaoEstoqueDomain';

/**
 * Importacao em massa de produtos, a partir da contagem fisica de estoque
 * de um cliente novo (CSV/XLSX). Ver o plano da feature (2026-08-28) pras
 * decisoes de arquitetura -- resumo: nunca resolve sozinho uma quantidade
 * ambigua, nunca inventa fator de conversao de embalagem, e o usuario
 * confirma unidade/preco/quantidade produto por produto antes de gravar.
 */

type Passo = 'upload' | 'mapeamento' | 'quantidades' | 'embalagens' | 'confirmacao' | 'concluido';

interface UnidadeMedidaDB {
  id: string;
  sigla: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

interface DecisaoGrupo {
  mesclar: boolean;
  fatorConversao: string;
  /** linhaId do item que vira a unidade BASE do produto mesclado. */
  baseLinhaId: number;
}

interface ProdutoConfirmar {
  chave: string;
  nome: string;
  categoria: string;
  unidadeId: string;
  quantidade: string;
  precoVenda: string;
  /** Vindos das colunas opcionais da planilha (custo/preço à vista/preço a
   * prazo), quando mapeadas -- string vazia = a planilha não trouxe. */
  custo: string;
  precoAVista: string;
  precoAPrazo: string;
  origemLinhaIds: number[];
  embalagem?: { unidadeId: string; fatorConversao: number };
}

const CONTAINER_WORD = /\b(SACO|SC|ROLO|MC)\b/i;

const ImportarProdutos: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

  const [passo, setPasso] = useState<Passo>('upload');
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhasDados, setLinhasDados] = useState<string[][]>([]);
  const [mapeamento, setMapeamento] = useState<MapeamentoColunas>({ codigo: 0, descricao: 1, quantidade: 2, observacao: null, custo: null, precoAVista: null, precoAPrazo: null });

  const [itens, setItens] = useState<ItemImportado[]>([]);
  const [itensExcluidos, setItensExcluidos] = useState<Set<number>>(new Set());
  const [ajustesQuantidade, setAjustesQuantidade] = useState<Record<number, string>>({});

  const [grupos, setGrupos] = useState<GrupoCandidatoEmbalagem[]>([]);
  const [decisoesGrupo, setDecisoesGrupo] = useState<Record<string, DecisaoGrupo>>({});

  const [unidadesDisponiveis, setUnidadesDisponiveis] = useState<UnidadeMedidaDB[]>([]);
  const [venderPorEmbalagemAtivo, setVenderPorEmbalagemAtivo] = useState(true);
  const [dadosCarregados, setDadosCarregados] = useState(false);

  const [categoriaCompartilhada, setCategoriaCompartilhada] = useState('');
  const [produtos, setProdutos] = useState<ProdutoConfirmar[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState<{ criados: number; ligouEmbalagem: boolean } | null>(null);

  const carregarConfigTenant = async () => {
    if (!tenantId || dadosCarregados) return;
    try {
      const [unidadesSnap, configSnap] = await Promise.all([
        getDocs(query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId))),
        getDoc(doc(db, 'configuracoes', tenantId)),
      ]);
      setUnidadesDisponiveis(unidadesSnap.docs.map((d) => ({
        id: d.id,
        sigla: String(d.data().sigla || '').toUpperCase(),
        casasDecimais: Number(d.data().casasDecimais || 0),
        permiteFracionado: d.data().permiteFracionado === true,
      })));
      const config = configSnap.exists() ? configSnap.data() : {};
      setVenderPorEmbalagemAtivo(config.venderPorEmbalagem ?? DEFAULT_VENDER_POR_EMBALAGEM);
      setDadosCarregados(true);
    } catch (error) {
      console.error('Erro ao carregar configuração da empresa:', error);
      showError('Erro ao carregar dados', 'Não foi possível carregar as unidades de medida cadastradas. Tente recarregar a página.');
    }
  };

  const acharUnidadePorSigla = (sigla: string): UnidadeMedidaDB | undefined => (
    unidadesDisponiveis.find((u) => u.sigla === sigla.toUpperCase())
  );

  const handleArquivoSelecionado = async (file: File) => {
    setCarregandoArquivo(true);
    await carregarConfigTenant();
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
      setMapeamento(inferirMapeamentoColunas(linhaCabecalho));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler arquivo de importação:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setCarregandoArquivo(false);
    }
  };

  const confirmarMapeamento = () => {
    const processados = processarLinhas(linhasDados, mapeamento);
    setItens(processados);
    setItensExcluidos(new Set());
    setAjustesQuantidade({});
    setPasso('quantidades');
  };

  const itensRevisarPendentes = itens.filter((item) => (
    item.status === 'REVISAR'
    && !itensExcluidos.has(item.linhaId)
    && !ajustesQuantidade[item.linhaId]
  ));

  const confirmarQuantidades = () => {
    if (itensRevisarPendentes.length > 0) {
      showError('Ainda há itens para revisar', `${itensRevisarPendentes.length} linha(s) precisam de um valor confirmado ou de serem marcadas como "não importar" antes de continuar.`);
      return;
    }
    const itensValidos = itens.filter((item) => !itensExcluidos.has(item.linhaId));
    setGrupos(detectarGruposEmbalagem(itensValidos));
    setPasso('embalagens');
  };

  const chaveGrupo = (grupo: GrupoCandidatoEmbalagem) => grupo.descricaoBase;

  const decisaoPadrao = (grupo: GrupoCandidatoEmbalagem): DecisaoGrupo => {
    const itemBase = grupo.itens.find((i) => !CONTAINER_WORD.test(i.descricao)) || grupo.itens[0];
    return {
      mesclar: grupo.fatorConversaoSugerido !== null,
      fatorConversao: grupo.fatorConversaoSugerido !== null ? String(grupo.fatorConversaoSugerido) : '',
      baseLinhaId: itemBase.linhaId,
    };
  };

  const getDecisao = (grupo: GrupoCandidatoEmbalagem): DecisaoGrupo => (
    decisoesGrupo[chaveGrupo(grupo)] || decisaoPadrao(grupo)
  );

  const atualizarDecisao = (grupo: GrupoCandidatoEmbalagem, patch: Partial<DecisaoGrupo>) => {
    setDecisoesGrupo((atual) => ({ ...atual, [chaveGrupo(grupo)]: { ...getDecisao(grupo), ...patch } }));
  };

  const quantidadeFinalDoItem = (item: ItemImportado): number => {
    const ajuste = ajustesQuantidade[item.linhaId];
    if (ajuste !== undefined && ajuste.trim() !== '') {
      const n = Number(ajuste.replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
    return item.quantidadeCalculada ?? 0;
  };

  const paraTexto = (valor: number | null): string => (valor === null ? '' : String(valor));

  /** Campo em branco = "sem essa informação" (undefined, chave omitida no
   * documento) -- nunca gravamos 0 pra custo/preço a vista/preço a prazo
   * quando a planilha nao trouxer nem o usuario digitar. */
  const paraNumeroOpcional = (texto: string): number | undefined => {
    const limpo = texto.trim();
    if (!limpo) return undefined;
    const numero = Number(limpo.replace(',', '.'));
    return Number.isFinite(numero) ? numero : undefined;
  };

  const montarListaDeProdutos = () => {
    const itensValidos = itens.filter((item) => !itensExcluidos.has(item.linhaId));
    const idsEmGrupo = new Set(grupos.flatMap((g) => g.itens.map((i) => i.linhaId)));

    const resultado: ProdutoConfirmar[] = [];

    grupos.forEach((grupo) => {
      const decisao = getDecisao(grupo);
      if (!decisao.mesclar) {
        grupo.itens.forEach((item) => resultado.push(produtoAvulso(item)));
        return;
      }
      const itemBase = grupo.itens.find((i) => i.linhaId === decisao.baseLinhaId) || grupo.itens[0];
      const itensEmbalagem = grupo.itens.filter((i) => i.linhaId !== itemBase.linhaId);
      const fator = Number(decisao.fatorConversao.replace(',', '.')) || 0;

      const quantidadeBase = quantidadeFinalDoItem(itemBase)
        + itensEmbalagem.reduce((soma, i) => soma + quantidadeFinalDoItem(i) * fator, 0);

      const unidadeBaseSugerida = acharUnidadePorSigla(itemBase.unidadeSugerida || 'KG')?.sigla || 'KG';
      const unidadeEmbalagemSugerida = itensEmbalagem[0]
        ? (CONTAINER_WORD.exec(itensEmbalagem[0].descricao)?.[1]?.toUpperCase() === 'SACO' ? 'SC' : (acharUnidadePorSigla(itensEmbalagem[0].unidadeSugerida || 'SC')?.sigla || 'SC'))
        : '';

      // Preco (custo/a vista/a prazo) vem do item BASE (o granel) -- nao
      // faz sentido somar/mesclar preco entre os itens do grupo, so
      // quantidade.
      resultado.push({
        chave: `grupo-${chaveGrupo(grupo)}`,
        nome: grupo.descricaoBase,
        categoria: categoriaCompartilhada,
        unidadeId: acharUnidadePorSigla(unidadeBaseSugerida)?.id || '',
        quantidade: String(quantidadeBase),
        precoVenda: paraTexto(itemBase.precoAVista),
        custo: paraTexto(itemBase.custo),
        precoAVista: paraTexto(itemBase.precoAVista),
        precoAPrazo: paraTexto(itemBase.precoAPrazo),
        origemLinhaIds: grupo.itens.map((i) => i.linhaId),
        embalagem: fator > 0 ? { unidadeId: acharUnidadePorSigla(unidadeEmbalagemSugerida)?.id || '', fatorConversao: fator } : undefined,
      });
    });

    function produtoAvulso(item: ItemImportado): ProdutoConfirmar {
      return {
        chave: `item-${item.linhaId}`,
        nome: item.descricao,
        categoria: categoriaCompartilhada,
        unidadeId: acharUnidadePorSigla(item.unidadeSugerida || 'UN')?.id || '',
        quantidade: String(quantidadeFinalDoItem(item)),
        precoVenda: paraTexto(item.precoAVista),
        custo: paraTexto(item.custo),
        precoAVista: paraTexto(item.precoAVista),
        precoAPrazo: paraTexto(item.precoAPrazo),
        origemLinhaIds: [item.linhaId],
      };
    }

    itensValidos
      .filter((item) => !idsEmGrupo.has(item.linhaId))
      .forEach((item) => resultado.push(produtoAvulso(item)));

    return resultado;
  };

  const confirmarEmbalagens = () => {
    const pendenteSemFator = grupos.some((g) => {
      const d = getDecisao(g);
      return d.mesclar && (!d.fatorConversao || Number(d.fatorConversao.replace(',', '.')) <= 0);
    });
    if (pendenteSemFator) {
      showError('Fator de conversão pendente', 'Informe o fator de conversão (quantas unidades base cabem em cada embalagem) para os grupos marcados como "mesclar".');
      return;
    }
    setProdutos(montarListaDeProdutos());
    setPasso('confirmacao');
  };

  const atualizarProduto = (chave: string, patch: Partial<ProdutoConfirmar>) => {
    setProdutos((atual) => atual.map((p) => (p.chave === chave ? { ...p, ...patch } : p)));
  };

  const produtosProntos = produtos.every((p) => (
    p.nome.trim() && p.unidadeId && Number(p.precoVenda.replace(',', '.')) > 0
  ));

  const executarImportacao = async () => {
    if (!tenantId || !currentUser) return;
    if (!produtosProntos) {
      showError('Preencha todos os campos', 'Todo produto precisa de nome, unidade de medida e preço de venda maior que zero antes de importar.');
      return;
    }

    setSalvando(true);
    try {
      const contagemSnap = await getCountFromServer(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)));
      let proximoCodigo = contagemSnap.data().count + 1;
      const timestamp = serverTimestamp();
      const precisaLigarEmbalagem = !venderPorEmbalagemAtivo && produtos.some((p) => p.embalagem);

      const LOTE_MAXIMO = 400;
      for (let inicio = 0; inicio < produtos.length; inicio += LOTE_MAXIMO) {
        const lote = produtos.slice(inicio, inicio + LOTE_MAXIMO);
        const batch = writeBatch(db);

        lote.forEach((produto) => {
          const unidadeBase = unidadesDisponiveis.find((u) => u.id === produto.unidadeId);
          const unidadeBaseRef: UnidadeMedidaRef = unidadeBase
            ? { id: unidadeBase.id, sigla: unidadeBase.sigla, casasDecimais: unidadeBase.casasDecimais, fracionado: unidadeBase.permiteFracionado }
            : { id: '', sigla: 'UN', casasDecimais: 0, fracionado: false };

          const unidadeEmbalagem = produto.embalagem ? unidadesDisponiveis.find((u) => u.id === produto.embalagem!.unidadeId) : undefined;

          const codigo = String(proximoCodigo);
          proximoCodigo += 1;

          const docRef = doc(collection(db, 'estoque'));
          batch.set(docRef, montarProdutoImportado(
            {
              codigo,
              nome: produto.nome,
              categoria: produto.categoria,
              unidadeBase: unidadeBaseRef,
              quantidade: Number(produto.quantidade.replace(',', '.')) || 0,
              precoVenda: Number(produto.precoVenda.replace(',', '.')) || 0,
              precoCusto: paraNumeroOpcional(produto.custo),
              precoAVista: paraNumeroOpcional(produto.precoAVista),
              precoAPrazo: paraNumeroOpcional(produto.precoAPrazo),
              embalagem: (produto.embalagem && unidadeEmbalagem) ? {
                unidade: { id: unidadeEmbalagem.id, sigla: unidadeEmbalagem.sigla, casasDecimais: unidadeEmbalagem.casasDecimais, fracionado: unidadeEmbalagem.permiteFracionado },
                fatorConversao: produto.embalagem.fatorConversao,
                quantidadeNaEmbalagem: 0,
              } : undefined,
            },
            tenantId,
            currentUser.uid,
            timestamp,
          ));
        });

        if (inicio === 0 && precisaLigarEmbalagem) {
          batch.update(doc(db, 'configuracoes', tenantId), { venderPorEmbalagem: true });
        }

        await batch.commit();
      }

      setResultadoImportacao({ criados: produtos.length, ligouEmbalagem: precisaLigarEmbalagem });
      setPasso('concluido');
      showSuccess(`${produtos.length} produto(s) importado(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao importar produtos:', error);
      showError('Erro ao importar', 'Não foi possível concluir a importação. Nenhum produto foi gravado neste lote com erro -- tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const totalOk = itens.filter((i) => i.status === 'OK').length;
  const totalRevisar = itens.filter((i) => i.status === 'REVISAR').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/estoque')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <PackageSearch size={26} color="var(--accent-purple)" /> Importar Produtos
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Importação em massa a partir de uma planilha de contagem de estoque (CSV ou XLSX)</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '440px' }}>
              Aceita .csv e .xlsx. A próxima tela deixa você confirmar qual coluna é o código, a descrição, a quantidade e a observação.
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
            {(['codigo', 'descricao', 'quantidade', 'observacao', 'custo', 'precoAVista', 'precoAPrazo'] as const).map((campo) => {
              const obrigatorio = campo === 'codigo' || campo === 'descricao' || campo === 'quantidade';
              const rotulos: Record<typeof campo, string> = {
                codigo: 'Código', descricao: 'Descrição', quantidade: 'Quantidade',
                observacao: 'Observação (opcional)', custo: 'Custo (opcional)',
                precoAVista: 'Preço à vista (opcional)', precoAPrazo: 'Preço a prazo (opcional)',
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
            Custo, preço à vista e preço a prazo são opcionais — se o export do sistema antigo trouxer essas colunas, elas já vêm pré-preenchidas na tela de confirmação (ainda editáveis).
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('upload')}>Voltar</button>
            <button className="btn-primary" onClick={confirmarMapeamento} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Continuar <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {passo === 'quantidades' && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confira as quantidades</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {itens.length} item(ns): {totalOk} com quantidade calculada automaticamente, {totalRevisar} precisam da sua confirmação (destacados abaixo).
            </p>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '480px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Descrição</th>
                  <th style={{ padding: '8px' }}>Bruto</th>
                  <th style={{ padding: '8px' }}>Quantidade</th>
                  <th style={{ padding: '8px' }}>Situação</th>
                  <th style={{ padding: '8px', textAlign: 'center' }}>Não importar</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => {
                  const revisarPendente = item.status === 'REVISAR' && !itensExcluidos.has(item.linhaId) && !ajustesQuantidade[item.linhaId];
                  return (
                    <tr key={item.linhaId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: item.status === 'REVISAR' ? 'rgba(245,158,11,0.08)' : undefined, opacity: itensExcluidos.has(item.linhaId) ? 0.4 : 1 }}>
                      <td style={{ padding: '8px' }}>{item.descricao}</td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{item.quantidadeBruta}</td>
                      <td style={{ padding: '8px' }}>
                        {item.status === 'REVISAR' && !itensExcluidos.has(item.linhaId) ? (
                          <input
                            type="text"
                            placeholder="Digite o valor"
                            value={ajustesQuantidade[item.linhaId] ?? ''}
                            onChange={(e) => setAjustesQuantidade((atual) => ({ ...atual, [item.linhaId]: e.target.value }))}
                            style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text-primary)' }}
                          />
                        ) : (
                          <span>{item.quantidadeCalculada ?? '-'}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {revisarPendente ? (
                          <span style={{ color: '#f59e0b', fontWeight: 600 }} title={item.motivo}>REVISAR</span>
                        ) : item.status === 'REVISAR' ? (
                          <span style={{ color: '#10b981' }}>Confirmado</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>OK</span>
                        )}
                        {item.motivo && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.motivo}</div>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={itensExcluidos.has(item.linhaId)}
                          onChange={(e) => setItensExcluidos((atual) => {
                            const novo = new Set(atual);
                            if (e.target.checked) novo.add(item.linhaId); else novo.delete(item.linhaId);
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
            <button className="btn-secondary" onClick={() => setPasso('mapeamento')}>Voltar</button>
            <button className="btn-primary" onClick={confirmarQuantidades} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Continuar <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {passo === 'embalagens' && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Produtos em duas unidades</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {grupos.length === 0
                ? 'Nenhum par de produto em unidades diferentes foi encontrado nesta planilha.'
                : `Encontramos ${grupos.length} grupo(s) que parecem ser o mesmo produto vendido em unidades diferentes. Confirme se deve virar um produto só (com embalagem) ou continuar separado.`}
            </p>
          </div>
          {grupos.map((grupo) => {
            const decisao = getDecisao(grupo);
            return (
              <div key={chaveGrupo(grupo)} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <strong>{grupo.descricaoBase}</strong>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {grupo.itens.map((i) => <li key={i.linhaId}>{i.descricao} — {quantidadeFinalDoItem(i)} {i.unidadeSugerida}</li>)}
                </ul>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <input type="checkbox" checked={decisao.mesclar} onChange={(e) => atualizarDecisao(grupo, { mesclar: e.target.checked })} />
                  Mesclar num produto só, com embalagem
                </label>
                {decisao.mesclar && (
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      Unidade base:
                      <select value={decisao.baseLinhaId} onChange={(e) => atualizarDecisao(grupo, { baseLinhaId: Number(e.target.value) })} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 10px', color: 'var(--text-primary)' }}>
                        {grupo.itens.map((i) => <option key={i.linhaId} value={i.linhaId}>{i.descricao}</option>)}
                      </select>
                    </label>
                    <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      Fator de conversão (unidades base por embalagem):
                      <input
                        type="text"
                        placeholder={grupo.fatorConversaoSugerido === null ? 'digite o fator' : ''}
                        value={decisao.fatorConversao}
                        onChange={(e) => atualizarDecisao(grupo, { fatorConversao: e.target.value })}
                        style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 10px', color: 'var(--text-primary)' }}
                      />
                    </label>
                    {grupo.fatorConversaoSugerido === null && (
                      <span style={{ fontSize: '12px', color: '#f59e0b' }}>Não conseguimos deduzir o fator pela descrição — confirme com quem contou.</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('quantidades')}>Voltar</button>
            <button className="btn-primary" onClick={confirmarEmbalagens} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Continuar <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {passo === 'confirmacao' && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confirme unidade, preço e quantidade</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{produtos.length} produto(s) prontos para gravar. O código de cada um é gerado automaticamente pelo sistema.</p>
          </div>
          <div className="input-group" style={{ maxWidth: '320px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria (aplicada a todos, opcional)</label>
            <input type="text" value={categoriaCompartilhada} onChange={(e) => {
              setCategoriaCompartilhada(e.target.value);
              setProdutos((atual) => atual.map((p) => ({ ...p, categoria: e.target.value })));
            }} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }} />
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '11px' }}>
                  <th style={{ padding: '8px' }}>Nome</th>
                  <th style={{ padding: '8px' }}>Unidade</th>
                  <th style={{ padding: '8px' }}>Quantidade</th>
                  <th style={{ padding: '8px' }}>Custo</th>
                  <th style={{ padding: '8px' }}>Preço à vista</th>
                  <th style={{ padding: '8px' }}>Preço a prazo</th>
                  <th style={{ padding: '8px' }}>Preço de venda *</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((produto) => (
                  <tr key={produto.chave} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={produto.nome} onChange={(e) => atualizarProduto(produto.chave, { nome: e.target.value })} style={{ width: '220px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <select value={produto.unidadeId} onChange={(e) => atualizarProduto(produto.chave, { unidadeId: e.target.value })} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }}>
                        <option value="">-- selecione --</option>
                        {unidadesDisponiveis.map((u) => <option key={u.id} value={u.id}>{u.sigla}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={produto.quantidade} onChange={(e) => atualizarProduto(produto.chave, { quantidade: e.target.value })} style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" placeholder="-" value={produto.custo} onChange={(e) => atualizarProduto(produto.chave, { custo: e.target.value })} style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" placeholder="-" value={produto.precoAVista} onChange={(e) => atualizarProduto(produto.chave, { precoAVista: e.target.value })} style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" placeholder="-" value={produto.precoAPrazo} onChange={(e) => atualizarProduto(produto.chave, { precoAPrazo: e.target.value })} style={{ width: '90px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" placeholder="0,00" value={produto.precoVenda} onChange={(e) => atualizarProduto(produto.chave, { precoVenda: e.target.value })} style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: !produto.precoVenda ? '1px solid #ef4444' : '1px solid var(--border-color)', borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('embalagens')} disabled={salvando}>Voltar</button>
            <button className="btn-primary" onClick={executarImportacao} disabled={salvando || !produtosProntos} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: (salvando || !produtosProntos) ? 0.6 : 1 }}>
              {salvando ? <Loader2 size={16} className="spin-animation" /> : <CheckCircle2 size={16} />}
              {salvando ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && resultadoImportacao && (
        <div className="card" style={{ padding: '40px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CheckCircle2 size={44} color="#10b981" />
          <h2 style={{ fontSize: '20px' }}>{resultadoImportacao.criados} produto(s) importado(s)!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px' }}>
            Os produtos já aparecem em Estoque. Nenhum deles tem NCM preenchido (não dava pra saber pela contagem) — complete o cadastro fiscal de cada um antes de emitir nota.
            {resultadoImportacao.ligouEmbalagem && ' Também ligamos "Vender por embalagem" nas Configurações da empresa, necessário pros produtos com embalagem funcionarem na venda.'}
          </p>
          <button className="btn-primary" onClick={() => navigate('/estoque')}>Ir para o Estoque</button>
        </div>
      )}
    </div>
  );
};

export default ImportarProdutos;

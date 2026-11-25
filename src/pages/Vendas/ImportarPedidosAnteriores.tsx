import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Timestamp, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, FileUp, Loader2, ShoppingCart, Upload } from 'lucide-react';
import { db } from '../../services/firebase';
import { createAuditLog } from '../../services/logService';
import { criarVendedorNoServidor } from '../../services/usuarioAcessoService';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { decodificarArquivoTexto, detectarDelimitador, parseDelimitedText } from '../../utils/importacaoEstoqueDomain';
import { normalizarDocumentoParte, resolverVinculoParte, type ParteCadastrada } from '../../utils/importacaoContasDomain';
import { applyStockFieldDeltas, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import { computeReservationDelta } from '../../utils/estoqueReservaDomain';
import { toStockAdjustmentItems } from '../../utils/embalagemDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { hasTenantFullAccess } from '../../utils/roles';
import {
  CAMPOS_OBRIGATORIOS_PEDIDOS,
  SITUACAO_FATURADO,
  SITUACAO_PRE_VENDA,
  chaveDoVendedor,
  inferirMapeamentoPedidos,
  itensDoPedidoImportado,
  lerPedidosImportados,
  montarPedidoImportado,
  planoDeRenumeracao,
  resumirImportacao,
  sementeIdPedidoImportado,
  sugerirVendedor,
  trocarNumeroNoTexto,
  vendedoresDoArquivo,
  type PedidoImportadoLido,
  type ProdutoParaImportar,
  type Renumeracao,
  type VendedorDoArquivo,
} from '../../utils/importacaoPedidosAnterioresDomain';

/**
 * Importar pedidos do sistema anterior (23/11/2026, migracao Embala Minas).
 * Regras em importacaoPedidosAnterioresDomain.ts. Ordem do que grava:
 *   1. vendedores antigos que nao existem: criados INATIVOS na aba Vendedores;
 *   2. vendas faturadas: Pedido de Venda finalizado, so' registro (sem estoque,
 *      caixa, contas nem comissao);
 *   3. pre-vendas em aberto: pre-venda com reserva de estoque;
 *   4. vendas ja' feitas no Hennder: renumeradas depois do ultimo numero antigo,
 *      e a numeracao segue dali.
 * Tudo com id fixo: importar o mesmo arquivo de novo nao duplica.
 */

type Passo = 'upload' | 'confirmacao' | 'gravando' | 'concluido';

interface PedidoConferido extends PedidoImportadoLido {
  clienteId: string | null;
  clienteNome: string;
  idFixo: string;
  /** '' = entra. */
  fora: string;
}

interface UsuarioDaEmpresa {
  id: string;
  nome: string;
  vendedorSemLogin: boolean;
  ativo: boolean;
}

const CRIAR_INATIVO = '__criar__';
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const idDoPedido = async (semente: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semente));
  return `ant_${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
};
const normalizarChave = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
/** Criado no dia e hora da venda no sistema antigo (horario de Brasilia), nao no dia da importacao:
 *  as listas ordenadas por criacao nao mostram 15 mil vendas antigas como "de hoje". */
const criadoNaDataDaVenda = (p: PedidoImportadoLido) => {
  const hora = /^\d{2}:\d{2}$/.test(p.hora) ? p.hora : '12:00';
  const quando = new Date(`${p.data}T${hora}:00-03:00`);
  return Number.isNaN(quando.getTime()) ? serverTimestamp() : Timestamp.fromDate(quando);
};

const ImportarPedidosAnteriores: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, userRole, isOwner, conferenciaMercadoriaAtiva } = useAuth();
  const podeImportar = hasTenantFullAccess(userRole, Boolean(isOwner));
  const [passo, setPasso] = useState<Passo>('upload');
  const [ocupado, setOcupado] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [pedidos, setPedidos] = useState<PedidoConferido[]>([]);
  const [produtos, setProdutos] = useState<Map<string, ProdutoParaImportar>>(new Map());
  const [usuarios, setUsuarios] = useState<UsuarioDaEmpresa[]>([]);
  const [vendedores, setVendedores] = useState<VendedorDoArquivo[]>([]);
  const [escolhaVendedor, setEscolhaVendedor] = useState<Record<string, string>>({});
  const [progresso, setProgresso] = useState('');
  const [resultado, setResultado] = useState<{ faturados: number; preVendas: number; vendedoresCriados: number; renumerados: Renumeracao[]; proximo: string } | null>(null);

  const aImportar = useMemo(() => pedidos.filter((p) => !p.fora && !p.problema), [pedidos]);
  const deFora = useMemo(() => pedidos.filter((p) => p.fora || p.problema), [pedidos]);
  const resumo = useMemo(() => resumirImportacao(pedidos), [pedidos]);

  const produtoDoItem = (mapa: Map<string, ProdutoParaImportar>) => (item: { codigoProduto: string }) => (
    item.codigoProduto ? mapa.get(normalizarChave(item.codigoProduto)) || null : null
  );

  const lerArquivo = async (file: File) => {
    if (!tenantId) return;
    setOcupado(true);
    try {
      const [snapClientes, snapEstoque, snapUsuarios] = await Promise.all([
        getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId))),
      ]);
      const clientes: ParteCadastrada[] = snapClientes.docs.map((d) => {
        const c = d.data();
        return {
          id: d.id, nome: String(c.nome || ''), documento: normalizarDocumentoParte(String(c.documento || '')),
          codigo: String(c.codigo || ''), cidade: String(c.cidade || ''), ativo: c.ativo !== false,
        };
      });
      // Produto pela Referencia (o codigo do sistema antigo); sem ela, pelo codigo.
      const mapaProdutos = new Map<string, ProdutoParaImportar>();
      const porCodigo = new Map<string, ProdutoParaImportar>();
      snapEstoque.docs.forEach((d) => {
        const p = d.data();
        const produto: ProdutoParaImportar = {
          id: d.id,
          nome: String(p.nome || ''),
          ...(p.unidadeMedidaSigla ? { unidadeMedidaSigla: String(p.unidadeMedidaSigla) } : {}),
          unidadeMedidaFracionado: p.unidadeMedidaFracionado === true,
          unidadeMedidaCasasDecimais: Number.isInteger(p.unidadeMedidaCasasDecimais) ? p.unidadeMedidaCasasDecimais : 0,
        };
        const ref = normalizarChave(p.referencia);
        if (ref && !mapaProdutos.has(ref)) mapaProdutos.set(ref, produto);
        const cod = normalizarChave(p.codigo);
        if (cod && !porCodigo.has(cod)) porCodigo.set(cod, produto);
      });
      porCodigo.forEach((p, cod) => { if (!mapaProdutos.has(cod)) mapaProdutos.set(cod, p); });
      const lista: UsuarioDaEmpresa[] = snapUsuarios.docs.map((d) => {
        const u = d.data();
        return {
          id: d.id,
          nome: String(u.nome || u.nomeResponsavel || u.email || ''),
          vendedorSemLogin: u.tipoRegistro === 'vendedor',
          ativo: String(u.status || 'Ativo') !== 'Inativo',
        };
      }).filter((u) => u.nome);

      let matriz: string[][];
      const buffer = await file.arrayBuffer();
      if (/\.xlsx?$/i.test(file.name)) {
        const wb = XLSX.read(buffer, { type: 'array' });
        matriz = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
          .map((l) => l.map((c) => String(c ?? '').trim()));
      } else {
        const texto = decodificarArquivoTexto(buffer);
        matriz = parseDelimitedText(texto, detectarDelimitador(texto.split(/\r?\n/, 1)[0] || ''));
      }
      matriz = matriz.filter((l) => l.some((c) => c && c.trim()));
      if (matriz.length < 2) {
        showError('Planilha vazia', 'Não encontramos nenhuma linha de dado nesta planilha.');
        return;
      }
      const mapa = inferirMapeamentoPedidos(matriz[0]);
      const faltando = CAMPOS_OBRIGATORIOS_PEDIDOS.filter((c) => mapa[c] === null);
      if (faltando.length > 0) {
        showError('Planilha em outro formato', `Faltam as colunas: ${faltando.join(', ')}. Use o arquivo gerado na migração (9-pedidos-de-venda.csv).`);
        return;
      }
      const lidos = lerPedidosImportados(matriz.slice(1), mapa);
      const achaProduto = produtoDoItem(mapaProdutos);
      const conferidos: PedidoConferido[] = await Promise.all(lidos.map(async (p) => {
        let clienteId: string | null = null;
        let clienteNome = '';
        let fora = '';
        if (p.documentoCliente || p.nomeCliente) {
          const vinculo = resolverVinculoParte(p.documentoCliente, p.nomeCliente, clientes);
          if (vinculo.situacao === 'vinculado' && vinculo.id) {
            clienteId = vinculo.id;
            clienteNome = vinculo.nome || p.nomeCliente;
          } else {
            fora = `Cliente ${p.nomeCliente || p.documentoCliente}: ${vinculo.aviso || 'não encontrado no cadastro.'}`;
          }
        }
        if (!fora && p.situacao === SITUACAO_PRE_VENDA) {
          const { semProduto } = itensDoPedidoImportado(p, achaProduto);
          if (semProduto.length > 0) fora = `Pré-venda com produto que não está no cadastro (${semProduto.join(', ')}): sem ele não dá para reservar o estoque.`;
        }
        return { ...p, clienteId, clienteNome, fora, idFixo: await idDoPedido(sementeIdPedidoImportado(tenantId, p.numero)) };
      }));
      // O que ja' entrou numa importacao anterior fica de fora (id fixo).
      const comId = conferidos.filter((p) => !p.fora && !p.problema);
      for (let i = 0; i < comId.length; i += 100) {
        const fatia = comId.slice(i, i + 100);
        const snaps = await Promise.all(fatia.map((p) => getDoc(doc(db, 'pedidos_venda', p.idFixo))));
        snaps.forEach((s, k) => { if (s.exists()) fatia[k].fora = 'Já importado antes.'; });
        setProgresso(`Conferindo o que já foi importado: ${Math.min(i + 100, comId.length)} de ${comId.length}`);
      }
      const doArquivo = vendedoresDoArquivo(conferidos.filter((p) => !p.fora && !p.problema));
      setEscolhaVendedor(Object.fromEntries(doArquivo.map((v) => [v.codigo || v.nome, sugerirVendedor(v.nome, lista) || CRIAR_INATIVO])));
      setVendedores(doArquivo);
      setUsuarios(lista);
      setProdutos(mapaProdutos);
      setPedidos(conferidos);
      setNomeArquivo(file.name);
      setPasso('confirmacao');
    } catch (error) {
      console.error('Erro ao ler a planilha de pedidos:', error);
      showError('Não foi possível ler a planilha', 'Confira se é o CSV gerado na migração e a sua conexão, e tente de novo. Nada foi gravado.');
    } finally {
      setOcupado(false);
      setProgresso('');
    }
  };

  const importar = async () => {
    if (!tenantId || !currentUser || aImportar.length === 0) return;
    setOcupado(true);
    setPasso('gravando');
    const feitos = { faturados: 0, preVendas: 0, vendedoresCriados: 0 };
    let renumerados: Renumeracao[];
    let proximo: string;
    try {
      // 1. Vendedores: os que vao ser criados entram INATIVOS, sem login.
      const vendedorPorChave = new Map<string, { id: string; nome: string }>();
      for (const v of vendedores) {
        const chave = v.codigo || v.nome;
        const escolha = escolhaVendedor[chave] || CRIAR_INATIVO;
        if (escolha !== CRIAR_INATIVO) {
          const u = usuarios.find((x) => x.id === escolha);
          vendedorPorChave.set(chave, { id: escolha, nome: u?.nome || v.nome });
          continue;
        }
        setProgresso(`Criando o vendedor ${v.nome}...`);
        // Bloco B de seguranca (25/11/2026): o cadastro nasce no servidor (id gerado la').
        const novo = await criarVendedorNoServidor({
          nome: v.nome,
          codigoVendedor: '',
          status: 'Inativo',
          sistemaAnterior: { codigoVendedor: String(v.codigo || '') },
        });
        vendedorPorChave.set(chave, { id: novo.usuarioId, nome: v.nome });
        feitos.vendedoresCriados += 1;
      }
      const vendedorDo = (p: PedidoImportadoLido) => vendedorPorChave.get(chaveDoVendedor(p)) || { id: currentUser.uid, nome: currentUser.displayName || 'Sistema anterior' };
      const achaProduto = produtoDoItem(produtos);
      const contexto = (p: PedidoConferido) => {
        const vendedor = vendedorDo(p);
        return {
          tenantId, usuarioId: currentUser.uid, arquivoOrigem: nomeArquivo, clienteId: p.clienteId, clienteNome: p.clienteNome,
          vendedorId: vendedor.id, vendedorNome: vendedor.nome, produtoDoItem: achaProduto, conferenciaAtiva: conferenciaMercadoriaAtiva,
        };
      };

      // 2. Faturados: so' o documento do pedido, em lotes.
      const faturados = aImportar.filter((p) => p.situacao === SITUACAO_FATURADO);
      for (let i = 0; i < faturados.length; i += 300) {
        const lote = faturados.slice(i, i + 300);
        const batch = writeBatch(db);
        lote.forEach((p) => {
          batch.set(doc(db, 'pedidos_venda', p.idFixo), {
            ...montarPedidoImportado(p, contexto(p)),
            createdAt: criadoNaDataDaVenda(p),
            importadoEm: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        });
        await batch.commit();
        feitos.faturados += lote.length;
        setProgresso(`Vendas faturadas: ${feitos.faturados} de ${faturados.length}`);
      }

      // 3. Pre-vendas: uma transacao por pre-venda, com a reserva do estoque.
      const preVendas = aImportar.filter((p) => p.situacao === SITUACAO_PRE_VENDA);
      for (const p of preVendas) {
        const docPedido = montarPedidoImportado(p, contexto(p));
        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'pedidos_venda', p.idFixo);
          const existente = await tx.get(ref);
          if (existente.exists()) return;
          const deltas = computeReservationDelta([], toStockAdjustmentItems(docPedido.itens));
          // Pre-venda real do sistema antigo: reserva mesmo sem saldo suficiente (nao trava a importacao).
          if (deltas.length > 0) await applyStockFieldDeltas(tx, db, deltas, true);
          tx.set(ref, {
            ...docPedido,
            createdAt: criadoNaDataDaVenda(p),
            importadoEm: serverTimestamp(),
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
        });
        feitos.preVendas += 1;
        setProgresso(`Pré-vendas: ${feitos.preVendas} de ${preVendas.length}`);
      }

      // 4. Vendas ja' feitas no Hennder: depois do ultimo numero antigo.
      setProgresso('Conferindo as vendas já feitas no Hennder...');
      const snapTodos = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId)));
      const importados = snapTodos.docs.filter((d) => d.data().importadoSistemaAnterior === true);
      const doHennder = snapTodos.docs.filter((d) => d.data().importadoSistemaAnterior !== true);
      const ultimoImportado = importados.reduce((m, d) => Math.max(m, Number(String(d.data().numeroPedido || '').replace(/\D/g, '')) || 0), 0);
      renumerados = planoDeRenumeracao(doHennder.map((d) => {
        const dados = d.data();
        const criado = dados.createdAt && typeof dados.createdAt.toMillis === 'function' ? dados.createdAt.toMillis() : 0;
        return { id: d.id, numeroPedido: String(dados.numeroPedido || ''), criadoEmMs: criado };
      }), ultimoImportado);
      for (const r of renumerados) {
        setProgresso(`Renumerando a venda #${r.de} para #${r.para}...`);
        const relacionados = await Promise.all(['transacoes', 'creditos_cliente', 'notas_fiscais'].map((colecao) => (
          getDocs(query(collection(db, colecao), where('tenantId', '==', tenantId), where('pedidoId', '==', r.id)))
        )));
        const batch = writeBatch(db);
        batch.update(doc(db, 'pedidos_venda', r.id), {
          numeroPedido: r.para,
          numeroAntesDaMigracao: r.de,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Número trocado de #${r.de} para #${r.para} na importação dos pedidos do sistema anterior`),
        });
        relacionados.forEach((snap) => snap.docs.forEach((d) => {
          const dados = d.data();
          const mudancas: Record<string, unknown> = {};
          ['descricao', 'observacao'].forEach((campo) => {
            if (typeof dados[campo] === 'string') {
              const novo = trocarNumeroNoTexto(dados[campo], r.de, r.para);
              if (novo !== dados[campo]) mudancas[campo] = novo;
            }
          });
          ['numeroPedido', 'pedidoNumero'].forEach((campo) => {
            if (typeof dados[campo] === 'string' && dados[campo] === r.de) mudancas[campo] = r.para;
          });
          if (Object.keys(mudancas).length > 0) batch.update(d.ref, mudancas);
        }));
        await batch.commit();
      }
      // As vendas do Hennder ficaram em ultimoImportado+1 ... ultimoImportado+N (renumeradas agora ou numa importacao anterior).
      const maiorGravado = ultimoImportado + doHennder.length;
      await runTransaction(db, async (tx) => { writeTenantSequenceValue(tx, db, tenantId, 'pedidos_venda', maiorGravado); });
      proximo = String(maiorGravado + 1);

      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || currentUser.uid,
        modulo: 'vendas',
        acao: 'importacao',
        descricao: `Pedidos do sistema anterior importados da planilha "${nomeArquivo}": ${feitos.faturados} venda(s) faturada(s) (só registro: sem estoque, caixa, contas nem comissão), ${feitos.preVendas} pré-venda(s) com reserva de estoque, ${feitos.vendedoresCriados} vendedor(es) criado(s) inativo(s). `
          + (renumerados.length > 0 ? `Vendas do Hennder renumeradas: ${renumerados.map((r) => `#${r.de} → #${r.para}`).join(', ')}. ` : '')
          + `Próximo pedido: #${proximo}.`,
        documentoTipo: 'pedido',
        documentoNumero: `Planilha ${nomeArquivo}`,
        status: 'sucesso',
      });
      setResultado({ ...feitos, renumerados, proximo });
      setPasso('concluido');
      showSuccess(`${feitos.faturados + feitos.preVendas} pedido(s) do sistema anterior importado(s).`);
    } catch (error) {
      console.error('Erro ao importar pedidos do sistema anterior:', error);
      createAuditLog({
        tenantId,
        usuarioId: currentUser.uid,
        usuarioEmail: currentUser.email || currentUser.uid,
        modulo: 'vendas',
        acao: 'importacao',
        descricao: `Importação de pedidos do sistema anterior ("${nomeArquivo}") interrompida por erro: ${feitos.faturados} faturado(s), ${feitos.preVendas} pré-venda(s) e ${feitos.vendedoresCriados} vendedor(es) entraram antes do erro.`,
        documentoTipo: 'pedido',
        documentoNumero: `Planilha ${nomeArquivo}`,
        status: 'erro',
      });
      showError('A importação parou no meio', `${feitos.faturados} venda(s) faturada(s) e ${feitos.preVendas} pré-venda(s) já foram gravadas. Importe o mesmo arquivo de novo: o que já entrou é reconhecido e não duplica.`);
      setPasso('confirmacao');
    } finally {
      setOcupado(false);
      setProgresso('');
    }
  };

  const card = { padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column' as const, gap: '16px' };
  const select = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)', minWidth: '240px' };
  const opcoesDeUsuario = usuarios.filter((u) => u.ativo || u.vendedorSemLogin).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  if (!podeImportar) {
    return (
      <div className="card" style={{ ...card, margin: '24px 0' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>Importar pedidos do sistema anterior</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>Só o dono ou um administrador da empresa importa pedidos. Peça a um deles para entrar.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/clientes')} aria-label="Voltar">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShoppingCart size={26} color="var(--accent-purple)" /> Importar pedidos do sistema anterior
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Vendas faturadas entram como Pedido de Venda só para registro; pré-vendas em aberto entram para o caixa faturar.</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ ...card, padding: '40px', alignItems: 'center', textAlign: 'center' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione o arquivo de pedidos</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '600px' }}>
              O arquivo gerado na migração (uma linha por item). Importe antes os clientes e os produtos. As vendas faturadas não mexem em estoque, caixa, contas nem comissão; as pré-vendas reservam o estoque.
            </p>
          </div>
          <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            {ocupado ? <Loader2 size={18} className="spin-animation" /> : <FileUp size={18} />}
            {ocupado ? (progresso || 'Lendo arquivo...') : 'Escolher arquivo'}
            <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} disabled={ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = ''; }} />
          </label>
        </div>
      )}

      {(passo === 'confirmacao' || passo === 'gravando') && (
        <>
          <div className="card" style={card}>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Conferência — {nomeArquivo}</h2>
            <p style={{ margin: 0 }}>
              <strong>{resumo.faturados}</strong> venda(s) faturada(s), total {moeda(resumo.faturadosValor)}, e <strong>{resumo.preVendas}</strong> pré-venda(s) em aberto, total {moeda(resumo.preVendasValor)}, vão entrar.
              {deFora.length > 0 && <> <strong>{deFora.length}</strong> ficam de fora (lista abaixo).</>}
            </p>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
              Depois de importar, as vendas já feitas no Hennder passam a ter número depois do último pedido antigo, e a numeração continua dali. Peça para a loja não lançar vendas enquanto a importação roda.
            </p>
          </div>

          {vendedores.length > 0 && (
            <div className="card" style={card}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Vendedores</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>Ligue cada vendedor antigo a um usuário do Hennder, ou deixe "Criar inativo": ele é criado na aba Vendedores, sem login, só para as vendas antigas ficarem no nome certo.</p>
              <div style={{ overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead><tr style={{ textAlign: 'left' }}><th style={{ padding: '8px' }}>Cód. antigo</th><th style={{ padding: '8px' }}>Vendedor no sistema antigo</th><th style={{ padding: '8px' }}>Pedidos</th><th style={{ padding: '8px' }}>No Hennder</th></tr></thead>
                  <tbody>
                    {vendedores.map((v) => {
                      const chave = v.codigo || v.nome;
                      return (
                        <tr key={chave} style={{ borderTop: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px' }}>{v.codigo}</td>
                          <td style={{ padding: '8px' }}>{v.nome}</td>
                          <td style={{ padding: '8px' }}>{v.pedidos}</td>
                          <td style={{ padding: '8px' }}>
                            <select style={select} value={escolhaVendedor[chave] || CRIAR_INATIVO} disabled={ocupado} aria-label={`Vendedor do Hennder para ${v.nome}`}
                              onChange={(e) => setEscolhaVendedor((atual) => ({ ...atual, [chave]: e.target.value }))}>
                              <option value={CRIAR_INATIVO}>Criar inativo: {v.nome}</option>
                              {opcoesDeUsuario.map((u) => <option key={u.id} value={u.id}>{u.nome}{u.vendedorSemLogin ? ' (vendedor sem login)' : ''}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {deFora.length > 0 && (
            <div className="card" style={card}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Ficam de fora ({deFora.length})</h2>
              <div style={{ maxHeight: '320px', overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead><tr style={{ textAlign: 'left' }}><th style={{ padding: '8px' }}>Pedido</th><th style={{ padding: '8px' }}>Data</th><th style={{ padding: '8px' }}>Cliente</th><th style={{ padding: '8px' }}>Total</th><th style={{ padding: '8px' }}>Motivo</th></tr></thead>
                  <tbody>
                    {deFora.slice(0, 500).map((p) => (
                      <tr key={p.numero} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px' }}>{p.numero.replace(/^0+/, '')}</td>
                        <td style={{ padding: '8px' }}>{dataBr(p.data)}</td>
                        <td style={{ padding: '8px' }}>{p.nomeCliente || 'CONSUMIDOR FINAL'}</td>
                        <td style={{ padding: '8px' }}>{moeda(p.totalPedido)}</td>
                        <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{p.problema || p.fora}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <button className="btn-secondary" onClick={() => setPasso('upload')} disabled={ocupado}><ArrowLeft size={16} /> Voltar</button>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{progresso}</span>
            <button className="btn-primary" onClick={() => void importar()} disabled={ocupado || aImportar.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {ocupado ? <Loader2 size={16} className="spin-animation" /> : <Upload size={16} />} Importar {aImportar.length} pedido(s)
            </button>
          </div>
        </>
      )}

      {passo === 'concluido' && resultado && (
        <div className="card" style={{ ...card, alignItems: 'center', textAlign: 'center' }}>
          <CheckCircle2 size={40} color="#10b981" />
          <h2 style={{ fontSize: '18px', margin: 0 }}>Importação concluída</h2>
          <p style={{ margin: 0 }}>
            {resultado.faturados} venda(s) faturada(s) e {resultado.preVendas} pré-venda(s) importada(s); {resultado.vendedoresCriados} vendedor(es) criado(s) inativo(s).
          </p>
          {resultado.renumerados.length > 0 && (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              Vendas do Hennder renumeradas: {resultado.renumerados.map((r) => `#${r.de} → #${r.para}`).join(', ')}.
            </p>
          )}
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>A próxima venda será a #{resultado.proximo}.</p>
          <button className="btn-primary" onClick={() => navigate('/pedidos-venda')}>Ver Pedidos de Venda</button>
        </div>
      )}
    </div>
  );
};

export default ImportarPedidosAnteriores;

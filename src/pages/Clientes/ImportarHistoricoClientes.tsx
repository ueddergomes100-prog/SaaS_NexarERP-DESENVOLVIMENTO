import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, History, Loader2, Upload } from 'lucide-react';
import { db } from '../../services/firebase';
import { createAuditLog } from '../../services/logService';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { decodificarArquivoTexto, detectarDelimitador, parseDelimitedText } from '../../utils/importacaoEstoqueDomain';
import { normalizarDocumentoParte, resolverVinculoParte, type ParteCadastrada } from '../../utils/importacaoContasDomain';
import {
  CAMPOS_OBRIGATORIOS_HISTORICO,
  COLECAO_HISTORICO_ANTERIOR,
  inferirMapeamentoHistorico,
  lerPedidosHistorico,
  montarPedidoHistorico,
  sementeIdHistorico,
  type CampoColunaHistorico,
  type MapeamentoColunasHistorico,
  type PedidoHistoricoLido,
} from '../../utils/historicoSistemaAnteriorDomain';

/**
 * Importa o historico de compras do sistema anterior (22/11/2026, migracao
 * Embala Minas): uma linha por item, agrupada por cliente + pedido. Grava em
 * `historico_sistema_anterior` so' para consulta (ficha do cliente e app
 * Vendas). Regras em historicoSistemaAnteriorDomain.ts.
 */

type Passo = 'upload' | 'mapeamento' | 'confirmacao' | 'concluido';

interface PedidoConferido extends PedidoHistoricoLido {
  clienteId: string | null;
  clienteNome: string;
  /** '' = entra; senao o motivo de ficar de fora. */
  fora: string;
  idFixo: string;
}

const ROTULOS: Record<CampoColunaHistorico, string> = {
  documento: 'CPF/CNPJ do cliente (recomendado)', cliente: 'Nome do cliente', pedido: 'Número do pedido', data: 'Data do pedido',
  totalPedido: 'Total do pedido (opcional)', codigoProduto: 'Código do produto (opcional)', produto: 'Produto', quantidade: 'Quantidade',
  unidade: 'Unidade (opcional)', valorUnitario: 'Valor unitário', valorTotal: 'Valor total do item (opcional)',
};
const CAMPOS = Object.keys(ROTULOS) as CampoColunaHistorico[];

const idDoPedido = async (semente: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semente));
  return `hist_${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
};
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

const ImportarHistoricoClientes: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();
  const [passo, setPasso] = useState<Passo>('upload');
  const [ocupado, setOcupado] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<MapeamentoColunasHistorico | null>(null);
  const [clientes, setClientes] = useState<ParteCadastrada[]>([]);
  const [pedidos, setPedidos] = useState<PedidoConferido[]>([]);
  const [gravados, setGravados] = useState(0);

  const aImportar = useMemo(() => pedidos.filter((p) => !p.fora), [pedidos]);
  const deFora = useMemo(() => pedidos.filter((p) => p.fora), [pedidos]);
  const clientesNoArquivo = useMemo(() => new Set(aImportar.map((p) => p.clienteId)).size, [aImportar]);

  const lerArquivo = async (file: File) => {
    if (!tenantId) return;
    setOcupado(true);
    try {
      const snap = await getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId)));
      setClientes(snap.docs.map((d) => {
        const c = d.data();
        return {
          id: d.id, nome: String(c.nome || ''), documento: normalizarDocumentoParte(String(c.documento || '')),
          codigo: String(c.codigo || ''), cidade: String(c.cidade || ''), ativo: c.ativo !== false,
        };
      }));
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
      setNomeArquivo(file.name);
      setCabecalho(matriz[0]);
      setLinhas(matriz.slice(1));
      setMapa(inferirMapeamentoHistorico(matriz[0]));
      setPasso('mapeamento');
    } catch (error) {
      console.error('Erro ao ler planilha de historico:', error);
      showError('Erro ao ler arquivo', 'Não foi possível ler esta planilha. Confira se é um CSV ou XLSX válido.');
    } finally {
      setOcupado(false);
    }
  };

  const conferir = async () => {
    if (!tenantId || !mapa) return;
    const faltando = CAMPOS_OBRIGATORIOS_HISTORICO.filter((c) => mapa[c] === null);
    if (faltando.length > 0) {
      showError('Faltam colunas', `Escolha a coluna de: ${faltando.map((c) => ROTULOS[c]).join(', ')}.`);
      return;
    }
    if (mapa.documento === null && mapa.cliente === null) {
      showError('Falta o cliente', 'Escolha a coluna do CPF/CNPJ ou a do nome do cliente: é por ela que o pedido acha o cadastro.');
      return;
    }
    setOcupado(true);
    try {
      const lidos = lerPedidosHistorico(linhas, mapa);
      const conferidos: PedidoConferido[] = await Promise.all(lidos.map(async (p) => {
        const vinculo = resolverVinculoParte(p.documentoCliente, p.nomeCliente, clientes);
        let fora = p.problema;
        if (!fora && vinculo.situacao !== 'vinculado') {
          fora = vinculo.situacao === 'ambiguo'
            ? `${vinculo.aviso.replace(' Escolha qual recebe o título.', '').replace(' Escolha qual recebe os títulos.', '')} Complete o CPF/CNPJ no cadastro certo e importe de novo.`
            : vinculo.aviso || 'Pedido sem cliente.';
        }
        const idFixo = vinculo.id ? await idDoPedido(sementeIdHistorico(tenantId, vinculo.id, p.pedido)) : '';
        return { ...p, clienteId: vinculo.id, clienteNome: vinculo.nome || p.nomeCliente, fora, idFixo };
      }));
      // O que ja' entrou numa importacao anterior fica de fora (id fixo).
      const comId = conferidos.filter((p) => !p.fora);
      for (let i = 0; i < comId.length; i += 50) {
        const fatia = comId.slice(i, i + 50);
        const snaps = await Promise.all(fatia.map((p) => getDoc(doc(db, COLECAO_HISTORICO_ANTERIOR, p.idFixo))));
        snaps.forEach((s, k) => { if (s.exists()) fatia[k].fora = 'Já importado antes.'; });
      }
      if (conferidos.length === 0) {
        showError('Nenhum pedido encontrado', 'As colunas de pedido e produto vieram em branco em todas as linhas. Confira as colunas escolhidas.');
        return;
      }
      setPedidos(conferidos);
      setPasso('confirmacao');
    } catch (error) {
      console.error('Erro ao conferir historico:', error);
      showError('Não foi possível conferir a planilha', 'Falhou a consulta do que já foi importado. Verifique a conexão e clique em Continuar de novo — nada foi gravado.');
    } finally {
      setOcupado(false);
    }
  };

  const importar = async () => {
    if (!tenantId || !currentUser || aImportar.length === 0) return;
    setOcupado(true);
    let feitos = 0;
    const registrar = (completa: boolean) => createAuditLog({
      tenantId,
      usuarioId: currentUser.uid,
      usuarioEmail: currentUser.email || currentUser.uid,
      modulo: 'clientes',
      acao: 'importacao',
      descricao: completa
        ? `${feitos} pedido(s) do sistema anterior importado(s) para consulta, de ${clientesNoArquivo} cliente(s), da planilha "${nomeArquivo}".`
        : `Importação do histórico "${nomeArquivo}" interrompida por erro: ${feitos} de ${aImportar.length} pedido(s) entraram antes do erro.`,
      documentoTipo: 'historico_sistema_anterior',
      documentoNumero: `Planilha ${nomeArquivo || 'sem nome'}`,
      status: completa ? 'sucesso' : 'erro',
    });
    try {
      const agora = serverTimestamp();
      for (let i = 0; i < aImportar.length; i += 400) {
        const lote = aImportar.slice(i, i + 400);
        const batch = writeBatch(db);
        lote.forEach((p) => {
          batch.set(doc(db, COLECAO_HISTORICO_ANTERIOR, p.idFixo), montarPedidoHistorico(
            p, { id: p.clienteId as string, nome: p.clienteNome }, tenantId,
            { importadoEm: agora, importadoPor: currentUser.uid, arquivoOrigem: nomeArquivo },
          ));
        });
        await batch.commit();
        feitos += lote.length;
      }
      registrar(true);
      setGravados(feitos);
      setPasso('concluido');
      showSuccess(`${feitos} pedido(s) do sistema anterior importado(s).`);
    } catch (error) {
      console.error('Erro ao importar historico:', error);
      if (feitos > 0) registrar(false);
      showError('Erro ao importar', `${feitos > 0 ? `${feitos} de ${aImportar.length} pedido(s) já foram gravados antes do erro. ` : 'Nenhum pedido foi gravado. '}Pode importar a mesma planilha de novo: o que já entrou é reconhecido e não duplica.`);
    } finally {
      setOcupado(false);
    }
  };

  const card = { padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column' as const, gap: '16px' };
  const select = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: 'var(--text-primary)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/clientes')}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <History size={26} color="var(--accent-purple)" /> Importar histórico do sistema anterior
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Últimos pedidos de cada cliente, só para consulta na ficha do cliente e no app Vendas.</p>
        </div>
      </div>

      {passo === 'upload' && (
        <div className="card" style={{ ...card, padding: '40px', alignItems: 'center', textAlign: 'center' }}>
          <Upload size={40} color="var(--accent-purple)" />
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '6px' }}>Selecione a planilha</h2>
            <p style={{ color: 'var(--text-muted)', maxWidth: '520px' }}>
              Uma linha por item: CPF/CNPJ ou nome do cliente, número e data do pedido, produto, quantidade e valores. Importe os clientes antes. Estes pedidos não mexem em estoque, caixa nem financeiro.
            </p>
          </div>
          <label className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            {ocupado ? <Loader2 size={18} className="spin-animation" /> : <FileUp size={18} />}
            {ocupado ? 'Lendo arquivo...' : 'Escolher arquivo'}
            <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} disabled={ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = ''; }} />
          </label>
        </div>
      )}

      {passo === 'mapeamento' && mapa && (
        <div className="card" style={card}>
          <div>
            <h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Confirme as colunas</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Arquivo: {nomeArquivo} — {linhas.length} linha(s) de item.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            {CAMPOS.map((campo) => (
              <div className="input-group" key={campo}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coluna de {ROTULOS[campo]}</label>
                <select style={select} value={mapa[campo] ?? ''} onChange={(e) => setMapa({ ...mapa, [campo]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">-- Nenhuma --</option>
                  {cabecalho.map((c, i) => <option key={i} value={i}>{c || `Coluna ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn-secondary" onClick={() => setPasso('upload')}><ArrowLeft size={16} /> Voltar</button>
            <button className="btn-primary" onClick={() => void conferir()} disabled={ocupado} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {ocupado ? <Loader2 size={16} className="spin-animation" /> : null} Continuar <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {passo === 'confirmacao' && (
        <div className="card" style={card}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Conferência</h2>
          <p style={{ margin: 0 }}>
            <strong>{aImportar.length}</strong> pedido(s) de <strong>{clientesNoArquivo}</strong> cliente(s) vão entrar
            ({aImportar.reduce((t, p) => t + p.itens.length, 0)} item(ns), total {moeda(aImportar.reduce((t, p) => t + p.total, 0))}).
            {deFora.length > 0 && <> <strong>{deFora.length}</strong> ficam de fora (lista abaixo).</>}
          </p>
          {deFora.length > 0 && (
            <div style={{ maxHeight: '320px', overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead><tr style={{ textAlign: 'left' }}><th style={{ padding: '8px' }}>Cliente</th><th style={{ padding: '8px' }}>Pedido</th><th style={{ padding: '8px' }}>Data</th><th style={{ padding: '8px' }}>Motivo</th></tr></thead>
                <tbody>
                  {deFora.map((p) => (
                    <tr key={p.chave} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px' }}>{p.clienteNome || p.nomeCliente}</td>
                      <td style={{ padding: '8px' }}>{p.pedido}</td>
                      <td style={{ padding: '8px' }}>{dataBr(p.data)}</td>
                      <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{p.fora}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn-secondary" onClick={() => setPasso('mapeamento')} disabled={ocupado}><ArrowLeft size={16} /> Voltar</button>
            <button className="btn-primary" onClick={() => void importar()} disabled={ocupado || aImportar.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {ocupado ? <Loader2 size={16} className="spin-animation" /> : <Upload size={16} />} Importar {aImportar.length} pedido(s)
            </button>
          </div>
        </div>
      )}

      {passo === 'concluido' && (
        <div className="card" style={{ ...card, alignItems: 'center', textAlign: 'center' }}>
          <CheckCircle2 size={40} color="#10b981" />
          <h2 style={{ fontSize: '18px', margin: 0 }}>{gravados} pedido(s) importado(s)</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Eles aparecem em "Compras no sistema anterior", na ficha de cada cliente e na consulta de cliente do app Vendas.</p>
          <button className="btn-primary" onClick={() => navigate('/clientes')}>Voltar para Clientes</button>
        </div>
      )}
    </div>
  );
};

export default ImportarHistoricoClientes;

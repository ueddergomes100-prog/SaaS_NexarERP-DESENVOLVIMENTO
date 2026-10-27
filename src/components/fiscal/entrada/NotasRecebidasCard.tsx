import React, { useCallback, useEffect, useState } from 'react';
import { CloudDownload, Download, Loader2, RefreshCw } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import { notaRecebidaService, NotaRecebidaError, type NotaRecebidaDaLista, type TipoNotaRecebida } from '../../../services/notaRecebidaService';
import { showError, showSuccess, showWarning } from '../../../utils/alerts';
import { addDaysToDateInput, getDateInputInTimeZone } from '../../../utils/dateTime';
import { campoInputStyle, campoLabelStyle, cartaoStyle, dataBr, moeda, tituloDoCartaoStyle } from './estilos';

/*
 * NOTAS EMITIDAS CONTRA O CNPJ (27/10/2026). Pedido do dono: "o sistema
 * sozinho ja busca, o usuario so' clica em importar e o sistema ja baixa o XML
 * e importa". A Spedy busca de tempos em tempos as NF-e (SEFAZ) e as NFS-e
 * (Ambiente Nacional) emitidas contra o CNPJ; aqui a lista aparece e o
 * "Importar" baixa o XML e entrega para a mesma conferencia do arquivo.
 * Regras do servidor: server/services/notaRecebida.js.
 */

interface Props {
  tipo: TipoNotaRecebida;
  tenantId: string;
  /** XML baixado: a tela abre a mesma conferencia do arquivo. */
  onXml: (xml: string, nomeArquivo: string) => void;
}

const DIAS_PADRAO = 30;
const LOTE_IN = 10;

const ROTULO_SITUACAO: Record<NotaRecebidaDaLista['situacao'], { texto: string; cor: string; dica: string }> = {
  pronta: { texto: 'Pronta', cor: '#22c55e', dica: 'O XML completo já está disponível.' },
  ciencia: { texto: 'Pronta (com ciência)', cor: '#38bdf8', dica: 'Ao importar, o sistema registra a Ciência da Operação na SEFAZ (manifestação que pode ser trocada depois) e baixa o XML completo.' },
  indisponivel: { texto: 'XML ainda não liberado', cor: '#fbbf24', dica: 'O Ambiente Nacional ainda não liberou o XML completo desta NFS-e.' },
  cancelada: { texto: 'Cancelada', cor: '#ef4444', dica: 'Nota cancelada pelo emitente: não se dá entrada.' },
};

/** Chaves que ja' estao no Historico de Entradas (nao excluidas). */
const chavesJaLancadas = async (tenantId: string, chaves: string[]): Promise<Set<string>> => {
  const lancadas = new Set<string>();
  const unicas = [...new Set(chaves.filter(Boolean))];
  for (let i = 0; i < unicas.length; i += LOTE_IN) {
    const lote = unicas.slice(i, i + LOTE_IN);
    const snap = await getDocs(query(collection(db, 'notas_fiscais_entrada'), where('tenantId', '==', tenantId), where('chaveAcesso', 'in', lote)));
    snap.forEach((d) => { if (d.data().status !== 'excluida') lancadas.add(String(d.data().chaveAcesso)); });
  }
  return lancadas;
};

const NotasRecebidasCard: React.FC<Props> = ({ tipo, tenantId, onXml }) => {
  const hoje = getDateInputInTimeZone();
  const [de, setDe] = useState(addDaysToDateInput(hoje, -DIAS_PADRAO) || hoje);
  const [ate, setAte] = useState(hoje);
  const [notas, setNotas] = useState<NotaRecebidaDaLista[]>([]);
  const [proximaPagina, setProximaPagina] = useState<string | null>(null);
  const [lancadas, setLancadas] = useState<Set<string>>(new Set());
  const [mostrarLancadas, setMostrarLancadas] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [importandoId, setImportandoId] = useState('');
  const [sincronizando, setSincronizando] = useState(false);
  const nomeDoTipo = tipo === 'nfe' ? 'NF-e' : 'NFS-e';

  const carregar = useCallback(async (cursor = '') => {
    if (!tenantId) return;
    setCarregando(true);
    setErro('');
    try {
      const resposta = await notaRecebidaService.listarRecebidas(tipo, de, ate, cursor);
      const novas = resposta.notas;
      const jaLancadas = await chavesJaLancadas(tenantId, novas.map((n) => n.chave)).catch(() => new Set<string>());
      setNotas((anteriores) => (cursor ? [...anteriores, ...novas] : novas));
      setLancadas((anteriores) => (cursor ? new Set([...anteriores, ...jaLancadas]) : jaLancadas));
      setProximaPagina(resposta.proximaPagina);
    } catch (e) {
      setErro(e instanceof NotaRecebidaError ? e.message : 'Não foi possível buscar as notas recebidas agora. Tente novamente em instantes.');
      if (!cursor) setNotas([]);
    } finally {
      setCarregando(false);
    }
  }, [tenantId, tipo, de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await notaRecebidaService.sincronizarRecebidas(tipo);
      showSuccess(r.aviso);
    } catch (e) {
      showWarning('Buscar notas novas', e instanceof NotaRecebidaError ? e.message : 'Não foi possível pedir a busca agora.');
    } finally {
      setSincronizando(false);
    }
  };

  const importar = async (nota: NotaRecebidaDaLista) => {
    setImportandoId(nota.id);
    try {
      const r = await notaRecebidaService.importarRecebida(tipo, nota.id);
      if (r.situacao === 'pronta' && r.xml) {
        onXml(r.xml, `${tipo === 'nfe' ? 'NFe' : 'NFSe'}-${nota.chave || nota.numero}.xml`);
        return;
      }
      showWarning('Quase lá', r.aviso || 'O XML completo ainda não chegou. Clique em Importar de novo em instantes.');
    } catch (e) {
      showError(`Não foi possível importar a ${nomeDoTipo}`, e instanceof NotaRecebidaError ? e.message : 'Tente novamente em instantes.');
    } finally {
      setImportandoId('');
    }
  };

  const visiveis = notas.filter((n) => mostrarLancadas || !lancadas.has(n.chave));
  const ocultas = notas.length - visiveis.length;

  return (
    <div className="card" style={{ ...cartaoStyle, marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CloudDownload size={18} color="var(--accent-purple)" />
          <h3 style={tituloDoCartaoStyle}>{nomeDoTipo} emitidas contra o seu CNPJ</h3>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void sincronizar()} disabled={sincronizando} title="O sistema já busca sozinho de tempos em tempos. Use para antecipar uma nota que acabou de ser emitida." style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
          {sincronizando ? <Loader2 size={15} className="spin-icon" /> : <RefreshCw size={15} />} Buscar novas agora
        </button>
      </div>
      <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
        O sistema busca sozinho as notas emitidas contra a empresa {tipo === 'nfe' ? 'na SEFAZ (últimos 90 dias)' : 'no Ambiente Nacional da NFS-e'}. Clique em <strong>Importar</strong>: o XML é baixado e abre a conferência.
      </p>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div className="input-group" style={{ minWidth: '150px' }}>
          <label style={campoLabelStyle}>Emitidas de</label>
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={campoInputStyle} />
        </div>
        <div className="input-group" style={{ minWidth: '150px' }}>
          <label style={campoLabelStyle}>até</label>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={campoInputStyle} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', paddingBottom: '8px' }}>
          <input type="checkbox" checked={mostrarLancadas} onChange={(e) => setMostrarLancadas(e.target.checked)} /> Mostrar as já lançadas
        </label>
      </div>

      {erro ? (
        <p style={{ fontSize: '13px', color: '#f87171', margin: 0 }}>{erro}</p>
      ) : carregando && notas.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}><Loader2 size={15} className="spin-icon" /> Buscando as notas...</div>
      ) : visiveis.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          {notas.length > 0 ? `Todas as ${nomeDoTipo} do período já foram lançadas.` : `Nenhuma ${nomeDoTipo} emitida contra o CNPJ neste período.`}
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Emissão</th>
                <th>Nº</th>
                <th>{tipo === 'nfe' ? 'Fornecedor' : 'Prestador'}</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((n) => {
                const jaLancada = lancadas.has(n.chave);
                const rotulo = ROTULO_SITUACAO[n.situacao];
                const podeImportar = !jaLancada && (n.situacao === 'pronta' || n.situacao === 'ciencia');
                return (
                  <tr key={n.id}>
                    <td>{dataBr(n.emitidaEm)}</td>
                    <td className="font-medium">{n.numero || '—'}</td>
                    <td>
                      {n.emitenteNome || '—'}
                      {n.descricao && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{n.descricao.slice(0, 90)}</div>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{moeda(n.valorTotal)}</td>
                    <td>
                      <span title={jaLancada ? 'Esta nota já está no Histórico de Entradas.' : rotulo.dica} style={{ fontSize: '12px', fontWeight: 600, color: jaLancada ? 'var(--text-muted)' : rotulo.cor }}>
                        {jaLancada ? 'Já lançada' : rotulo.texto}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {podeImportar && (
                        <button type="button" className="btn-primary" onClick={() => void importar(n)} disabled={Boolean(importandoId)} title={rotulo.dica} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}>
                          {importandoId === n.id ? <Loader2 size={14} className="spin-icon" /> : <Download size={14} />} Importar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
        <span>{ocultas > 0 ? `${ocultas} já lançada(s) escondida(s).` : ''}</span>
        {proximaPagina && !erro && (
          <button type="button" className="btn-secondary" onClick={() => void carregar(proximaPagina)} disabled={carregando} style={{ fontSize: '12.5px' }}>
            {carregando ? 'Carregando...' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  );
};

export default NotasRecebidasCard;

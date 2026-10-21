import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, Lock, Plus, RefreshCw, Users, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  ROTULO_ESCOPO,
  ROTULO_REGRA_NEGATIVO,
  type RegraNegativo,
  type TipoEscopoBalanco,
} from '../../utils/balancoDomain';
import {
  abrirBalanco,
  cancelarBalanco,
  conferenciaDoBalanco,
  fecharBalanco,
  gruposParaBalanco,
  listarBalancos,
  trocarContador,
  type BalancoResumo,
  type Conferencia,
  type LinhaConferencia,
} from '../../services/balancoService';

/**
 * BALANCO -- tela do gestor (21/10/2026). Abre (o que contar, quem conta,
 * travar ou nao as vendas), acompanha cada pessoa, confere as diferencas e
 * fecha escolhendo o que fazer com o estoque negativo. Quem conta usa
 * "Contar balanco" (a mesma tela do app). Regra em balancoDomain.ts; tudo
 * grava pelo servidor (server/services/balanco.js).
 */

const estilos = {
  card: { padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' } as React.CSSProperties,
  campo: { padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px', width: '100%', boxSizing: 'border-box' } as React.CSSProperties,
  rotulo: { fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' } as React.CSSProperties,
};

const n = (v: number | null | undefined, sigla = '') => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${sigla ? ` ${sigla}` : ''}`);
const dataHora = (ms: number) => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const ROTULO_STATUS: Record<string, { texto: string; cor: string }> = {
  contando: { texto: 'Contando', cor: '#f59e0b' },
  fechando: { texto: 'Fechando', cor: '#f59e0b' },
  fechado: { texto: 'Fechado', cor: '#10b981' },
  cancelado: { texto: 'Cancelado', cor: '#ef4444' },
};

// ---------------------------------------------------------------------------
// Novo balanco
// ---------------------------------------------------------------------------

const NovoBalanco: React.FC<{ onFechar: () => void; onAberto: () => void }> = ({ onFechar, onAberto }) => {
  const { tenantId } = useAuth();
  const { items: usuarios } = useTenantCollection<{ id: string; nome?: string; nomeResponsavel?: string; email?: string; status?: string }>('usuarios', tenantId);
  // Grupos que os produtos tem de verdade (o cadastro de Categorias pode nao ter todos), com quantos itens.
  const [grupos, setGrupos] = useState<Array<{ nome: string; itens: number }>>([]);
  useEffect(() => {
    let cancelado = false;
    gruposParaBalanco().then((g) => { if (!cancelado) setGrupos(g); }).catch((e) => { if (!cancelado) setErro((e as Error).message); });
    return () => { cancelado = true; };
  }, []);
  const ativos = useMemo(() => usuarios
    .filter((u) => u.status !== 'Inativo')
    .map((u) => ({ uid: u.id, nome: String(u.nome || u.nomeResponsavel || u.email || 'Usuário') }))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [usuarios]);

  const hoje = getDateInputInTimeZone().split('-').reverse().join('/');
  const [nome, setNome] = useState(`BALANÇO ${hoje}`);
  const [tipo, setTipo] = useState<TipoEscopoBalanco>('todos');
  const [categorias, setCategorias] = useState<string[]>([]);
  const [contadores, setContadores] = useState<string[]>([]);
  const [trava, setTrava] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const alternar = (lista: string[], valor: string) => (lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]);

  const abrir = async () => {
    setErro(null);
    setAbrindo(true);
    try {
      const r = await abrirBalanco({ nome, escopo: { tipo, categorias }, contadores, travaVendas: trava });
      const nomeDe = (uid: string) => ativos.find((a) => a.uid === uid)?.nome || uid;
      await NexusSwal.fire({
        icon: 'success',
        title: 'Balanço aberto',
        html: `<p style="text-align:left;margin:0 0 8px"><strong>${r.totalItens}</strong> itens divididos assim:</p><ul style="text-align:left;margin:0;padding-left:18px">`
          + r.blocos.map((b) => `<li><strong>${escaparHtml(nomeDe(b.contadorUid))}</strong>: ${b.itens} ${b.itens === 1 ? 'item' : 'itens'} (${escaparHtml(b.grupos.map((g) => g.nome).join(', '))})</li>`).join('')
          + '</ul><p style="text-align:left;margin:10px 0 0">Cada pessoa abre "Balanço" no app (ou "Contar balanço" no computador) e conta só a sua lista.</p>',
        confirmButtonText: 'OK',
      });
      onAberto();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAbrindo(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1250, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="novo-balanco-titulo" className="card"
        style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '720px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
          <h2 id="novo-balanco-titulo" style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Novo balanço</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
        </div>
        <div style={{ padding: '18px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label htmlFor="bal-nome" style={estilos.rotulo}>Nome</label>
            <input id="bal-nome" value={nome} onChange={(e) => setNome(e.target.value.toUpperCase())} style={estilos.campo} />
          </div>

          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={estilos.rotulo}>O que contar</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
              {(Object.keys(ROTULO_ESCOPO) as TipoEscopoBalanco[]).map((t) => (
                <label key={t} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${tipo === t ? 'var(--accent-purple)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '14px' }}>
                  <input type="radio" name="bal-tipo" checked={tipo === t} onChange={() => setTipo(t)} /> {ROTULO_ESCOPO[t]}
                </label>
              ))}
            </div>
          </fieldset>

          {tipo === 'grupos' && (
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={estilos.rotulo}>Grupos ({categorias.length} escolhido{categorias.length === 1 ? '' : 's'})</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {grupos.map((g) => (
                  <label key={g.nome} style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 10px', borderRadius: '999px', border: '1px solid var(--border-color)', fontSize: '13px', cursor: 'pointer', backgroundColor: categorias.includes(g.nome) ? 'rgba(124,58,237,.12)' : 'transparent' }}>
                    <input type="checkbox" checked={categorias.includes(g.nome)} onChange={() => setCategorias((c) => alternar(c, g.nome))} /> {g.nome} <span style={{ color: 'var(--text-muted)' }}>({g.itens})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={estilos.rotulo}>Quem vai contar ({contadores.length})</legend>
            <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>O sistema divide os itens em partes iguais, mantendo o mesmo grupo com a mesma pessoa. Ninguém conta o item do outro.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {ativos.map((u) => (
                <label key={u.uid} style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 10px', borderRadius: '999px', border: '1px solid var(--border-color)', fontSize: '13px', cursor: 'pointer', backgroundColor: contadores.includes(u.uid) ? 'rgba(124,58,237,.12)' : 'transparent' }}>
                  <input type="checkbox" checked={contadores.includes(u.uid)} onChange={() => setContadores((c) => alternar(c, u.uid))} /> {u.nome}
                </label>
              ))}
            </div>
          </fieldset>

          <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px', borderRadius: '10px', border: `1px solid ${trava ? '#f59e0b' : 'var(--border-color)'}`, cursor: 'pointer' }}>
            <input type="checkbox" checked={trava} onChange={(e) => setTrava(e.target.checked)} style={{ marginTop: '3px' }} />
            <span style={{ fontSize: '14px', lineHeight: 1.5 }}>
              <strong>Travar as vendas até fechar o balanço</strong><br />
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                Ninguém finaliza venda, PDV ou OS enquanto o balanço estiver aberto (pré-venda continua liberada, porque só reserva).
                Sem travar, a loja segue vendendo e o ajuste é feito pela diferença do momento em que cada item foi contado.
              </span>
            </span>
          </label>

          {erro && <div role="alert" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #ef4444', fontSize: '13px' }}>{erro}</div>}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-secondary" onClick={onFechar} disabled={abrindo}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={() => void abrir()} disabled={abrindo || contadores.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {abrindo ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <ClipboardList size={16} />}
            {abrindo ? 'Abrindo...' : 'Abrir balanço'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Conferencia e fechamento
// ---------------------------------------------------------------------------

type FiltroConferencia = 'todos' | 'diferenca' | 'naoContados' | 'negativos';

const ConferenciaDoBalanco: React.FC<{ balancoId: string; onVoltar: () => void; onMudou: () => void }> = ({ balancoId, onVoltar, onMudou }) => {
  const [dados, setDados] = useState<Conferencia | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [regra, setRegra] = useState<RegraNegativo>('contado');
  const [filtro, setFiltro] = useState<FiltroConferencia>('todos');
  const [busca, setBusca] = useState('');
  const [fechando, setFechando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await conferenciaDoBalanco(balancoId));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [balancoId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const depois = useCallback((l: LinhaConferencia) => (regra === 'descontar' ? l.depoisDescontar : l.depoisContado), [regra]);
  const linhas = useMemo(() => {
    if (!dados) return [];
    const termo = busca.trim().toUpperCase();
    return dados.linhas.filter((l) => {
      if (filtro === 'diferenca' && Math.abs(depois(l) - l.saldoAgora) < 1e-9) return false;
      if (filtro === 'naoContados' && !l.naoContado) return false;
      if (filtro === 'negativos' && !(l.saldoNaContagem !== null && l.saldoNaContagem < 0 && !l.naoContado)) return false;
      return !termo || l.nome.toUpperCase().includes(termo) || l.codigo.toUpperCase().includes(termo);
    });
  }, [dados, filtro, busca, depois]);

  if (!dados) {
    return <div style={estilos.card}>{erro ? <p role="alert">{erro}</p> : <p style={{ color: 'var(--text-muted)' }}>Carregando a conferência...</p>}</div>;
  }
  const aberto = dados.balanco.status === 'contando' || dados.balanco.status === 'fechando';
  const nomeDe = (uid: string) => dados.progresso.find((p) => p.uid === uid)?.nome || '';
  const naoContados = dados.linhas.filter((l) => l.naoContado).length;
  const negativos = dados.linhas.filter((l) => l.saldoNaContagem !== null && l.saldoNaContagem < 0 && !l.naoContado).length;
  const comDiferenca = dados.linhas.filter((l) => Math.abs(depois(l) - l.saldoAgora) > 1e-9).length;

  const fechar = async () => {
    const r = await NexusSwal.fire({
      icon: 'warning',
      title: `Fechar o balanço "${dados.balanco.nome}"?`,
      html: '<ul style="text-align:left;margin:0;padding-left:18px">'
        + `<li><strong>${comDiferenca}</strong> item(ns) vão mudar de estoque.</li>`
        + (naoContados > 0 ? `<li><strong>${naoContados}</strong> item(ns) não contados vão ficar com estoque <strong>zero</strong>.</li>` : '')
        + (negativos > 0 ? `<li>Estoque negativo: <strong>${ROTULO_REGRA_NEGATIVO[regra]}</strong> (${negativos} item(ns)).</li>` : '')
        + '<li>A reserva de pré-venda/OS não muda.</li></ul><p style="text-align:left;margin:10px 0 0">Não dá para desfazer.</p>',
      showCancelButton: true,
      confirmButtonText: 'Fechar e ajustar o estoque',
      cancelButtonText: 'Voltar',
    });
    if (!r.isConfirmed) return;
    setFechando(true);
    try {
      const f = await fecharBalanco(balancoId, regra);
      showSuccess(`Balanço fechado: ${f.resumo.sobras || 0} com sobra, ${f.resumo.faltas || 0} com falta, ${f.resumo.naoContados || 0} zerados. Movimentos no Relatório de Ajustes.`);
      onMudou();
      await carregar();
    } catch (e) {
      showError('Não foi possível fechar', (e as Error).message);
    } finally {
      setFechando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...estilos.card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>{dados.balanco.nome}</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              {ROTULO_ESCOPO[dados.balanco.escopo.tipo]}{dados.balanco.escopo.categorias.length ? `: ${dados.balanco.escopo.categorias.join(', ')}` : ''}
              {dados.balanco.travaVendas ? ' · vendas travadas' : ''} · {ROTULO_STATUS[dados.balanco.status]?.texto}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={onVoltar}>Voltar</button>
            <button type="button" className="btn-secondary" onClick={() => void carregar()} disabled={carregando} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RefreshCw size={15} /> Atualizar
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          {dados.progresso.map((p) => (
            <div key={p.uid} style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <strong style={{ fontSize: '14px' }}>{p.nome}</strong>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.contados} de {p.total} contados{p.concluido ? ' · concluiu' : ''}</div>
              <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-tertiary)', marginTop: '6px', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${p.total ? (p.contados / p.total) * 100 : 0}%`, background: 'var(--accent-purple)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {aberto && (
        <div style={{ ...estilos.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <strong style={{ fontSize: '14px' }}>Estoque negativo ({negativos} item{negativos === 1 ? '' : 's'})</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' }}>
            {(['contado', 'descontar'] as RegraNegativo[]).map((r) => (
              <label key={r} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${regra === r ? 'var(--accent-purple)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '13px', lineHeight: 1.45 }}>
                <input type="radio" name="regra-negativo" checked={regra === r} onChange={() => setRegra(r)} style={{ marginTop: '3px' }} />
                <span><strong>{ROTULO_REGRA_NEGATIVO[r]}</strong><br />
                  <span style={{ color: 'var(--text-muted)' }}>{r === 'contado'
                    ? 'Sistema −10, contou 100 → fica 100. Use quando o que foi vendido já saiu da loja.'
                    : 'Sistema −10, contou 100 → fica 90. Use quando o vendido ainda estava na prateleira e entrou na contagem.'}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {comDiferenca} com diferença · {naoContados} não contado(s) (vão zerar)
            </span>
            <button type="button" className="btn-primary" onClick={() => void fechar()} disabled={fechando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {fechando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Lock size={16} />}
              {fechando ? 'Fechando...' : 'Fechar balanço'}
            </button>
          </div>
        </div>
      )}

      <div style={{ ...estilos.card, padding: 0 }}>
        <div style={{ padding: '14px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {([['todos', `Todos (${dados.linhas.length})`], ['diferenca', `Com diferença (${comDiferenca})`], ['naoContados', `Não contados (${naoContados})`], ['negativos', `Negativos (${negativos})`]] as Array<[FiltroConferencia, string]>).map(([f, t]) => (
            <button key={f} type="button" className={filtro === f ? 'btn-primary' : 'btn-secondary'} onClick={() => setFiltro(f)} style={{ padding: '6px 12px', fontSize: '13px' }}>{t}</button>
          ))}
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" aria-label="Buscar item" style={{ ...estilos.campo, maxWidth: '260px' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr><th>Grupo</th><th>Item</th><th>Contou</th><th style={{ textAlign: 'right' }}>Sistema na contagem</th><th style={{ textAlign: 'right' }}>Contado</th><th style={{ textAlign: 'right' }}>Sistema agora</th><th style={{ textAlign: 'right' }}>Vai ficar</th><th style={{ textAlign: 'right' }}>Diferença</th></tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>Nenhum item aqui.</td></tr>
              ) : linhas.map((l) => {
                const fica = depois(l);
                const dif = fica - l.saldoAgora;
                return (
                  <tr key={l.chave}>
                    <td>{l.grupo}</td>
                    <td><strong>{l.nome}</strong><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{l.codigo}{l.controlaLote ? ` · ${l.lotes.map((x) => `lote ${x.lote}: ${n(x.depois)}`).join(', ')}` : ''}</div></td>
                    <td>{l.naoContado ? <span style={{ color: '#b45309' }}>Não contado ({nomeDe(l.contadorUid)})</span> : (l.contadoPorNome || nomeDe(l.contadorUid))}</td>
                    <td style={{ textAlign: 'right' }}>{n(l.saldoNaContagem)}</td>
                    <td style={{ textAlign: 'right' }}>{n(l.contado, l.unidade.sigla)}</td>
                    <td style={{ textAlign: 'right' }}>{n(l.saldoAgora)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{l.aplicado ? '✓ ' : ''}{n(fica)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: dif > 0 ? '#059669' : dif < 0 ? '#dc2626' : 'var(--text-muted)' }}>{dif > 0 ? '+' : ''}{n(dif)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

const Balanco: React.FC = () => {
  const { openTab } = useTabs();
  const { tenantId } = useAuth();
  const { items: usuarios } = useTenantCollection<{ id: string; nome?: string; nomeResponsavel?: string; email?: string; status?: string }>('usuarios', tenantId);
  const [lista, setLista] = useState<BalancoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await listarBalancos());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const emAndamento = (lista || []).find((b) => b.status === 'contando' || b.status === 'fechando') || null;

  const trocar = async (b: BalancoResumo) => {
    const opcoesDe = Object.fromEntries(b.contadores.map((c) => [c.uid, c.nome]));
    const ativos = usuarios.filter((u) => u.status !== 'Inativo');
    const opcoesPara = Object.fromEntries(ativos.map((u) => [u.id, String(u.nome || u.nomeResponsavel || u.email || 'Usuário')]));
    const de = await NexusSwal.fire({ title: 'Passar os itens de quem?', input: 'select', inputOptions: opcoesDe, showCancelButton: true, confirmButtonText: 'Próximo', cancelButtonText: 'Cancelar' });
    if (!de.isConfirmed || !de.value) return;
    const para = await NexusSwal.fire({ title: 'Para quem?', text: 'A lista inteira (com o que já foi contado) passa para a pessoa escolhida.', input: 'select', inputOptions: opcoesPara, showCancelButton: true, confirmButtonText: 'Passar', cancelButtonText: 'Cancelar' });
    if (!para.isConfirmed || !para.value) return;
    try {
      const r = await trocarContador(b.id, { de: String(de.value), para: String(para.value) });
      showSuccess(`${r.movidos} item(ns) passaram para ${opcoesPara[String(para.value)] || 'a pessoa escolhida'}.`);
      await carregar();
    } catch (e) {
      showError('Não foi possível trocar', (e as Error).message);
    }
  };

  const cancelar = async (b: BalancoResumo) => {
    const r = await NexusSwal.fire({
      icon: 'warning', title: `Cancelar o balanço "${b.nome}"?`, text: 'O estoque não muda e a contagem feita é descartada. Escreva o motivo:',
      input: 'text', showCancelButton: true, confirmButtonText: 'Cancelar balanço', cancelButtonText: 'Voltar',
      preConfirm: (v) => { if (!v || String(v).trim().length < 5) { NexusSwal.showValidationMessage('Escreva o motivo (mínimo 5 letras).'); return false; } return v; },
    });
    if (!r.isConfirmed) return;
    try {
      await cancelarBalanco(b.id, String(r.value));
      showSuccess('Balanço cancelado.');
      await carregar();
    } catch (e) {
      showError('Não foi possível cancelar', (e as Error).message);
    }
  };

  if (abertoId) {
    return <ConferenciaDoBalanco balancoId={abertoId} onVoltar={() => { setAbertoId(null); void carregar(); }} onMudou={() => void carregar()} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ClipboardList size={28} color="var(--accent-purple)" /> Balanço
          </h1>
          <p style={{ color: 'var(--text-muted)', maxWidth: '760px' }}>
            Contagem do estoque dividida entre a equipe. Cada pessoa conta só a sua lista, sem ver o saldo do sistema; você confere e fecha.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={() => openTab('/estoque/balanco/contar', 'Contar balanço')}>Contar</button>
          <button type="button" className="btn-primary" onClick={() => setNovo(true)} disabled={Boolean(emAndamento)} title={emAndamento ? 'Feche ou cancele o balanço aberto antes de abrir outro' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo balanço
          </button>
        </div>
      </div>

      {erro && <div role="alert" style={{ ...estilos.card, borderColor: '#ef4444' }}>{erro}</div>}

      {emAndamento && (
        <div style={{ ...estilos.card, display: 'flex', flexDirection: 'column', gap: '12px', borderColor: 'var(--accent-purple)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <strong style={{ fontSize: '16px' }}>{emAndamento.nome}</strong>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {ROTULO_ESCOPO[emAndamento.escopo.tipo]} · {emAndamento.totalItens} itens · aberto {dataHora(emAndamento.criadoEmMs)} por {emAndamento.abertoPorNome}
                {emAndamento.travaVendas ? ' · vendas travadas' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {emAndamento.status === 'contando' && (
                <>
                  <button type="button" className="btn-secondary" onClick={() => void trocar(emAndamento)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={15} /> Trocar quem conta</button>
                  <button type="button" className="btn-secondary" onClick={() => void cancelar(emAndamento)} style={{ color: '#ef4444' }}>Cancelar</button>
                </>
              )}
              <button type="button" className="btn-primary" onClick={() => setAbertoId(emAndamento.id)}>Conferir e fechar</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {emAndamento.contadores.map((c) => (
              <span key={c.uid} style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '12px', border: '1px solid var(--border-color)' }}>{c.nome}{c.concluido ? ' ✓' : ''}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ ...estilos.card, padding: 0, overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', fontSize: '13px' }}>
          <thead><tr><th>Balanço</th><th>Aberto</th><th>O que contou</th><th>Quem contou</th><th>Situação</th><th>Resultado</th><th>Ações</th></tr></thead>
          <tbody>
            {lista === null ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Carregando...</td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhum balanço ainda. Toque em "Novo balanço".</td></tr>
            ) : lista.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.nome}</strong></td>
                <td>{dataHora(b.criadoEmMs)}</td>
                <td>{ROTULO_ESCOPO[b.escopo.tipo]} ({b.totalItens})</td>
                <td>{b.contadores.map((c) => c.nome).join(', ')}</td>
                <td><span style={{ fontWeight: 700, color: ROTULO_STATUS[b.status]?.cor }}>{ROTULO_STATUS[b.status]?.texto || b.status}</span></td>
                <td>{b.resumo && b.status === 'fechado' ? `${b.resumo.sobras || 0} sobras · ${b.resumo.faltas || 0} faltas · ${b.resumo.naoContados || 0} zerados` : '—'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => setAbertoId(b.id)} style={{ padding: '4px 10px', fontSize: '12px' }}>Ver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {novo && <NovoBalanco onFechar={() => setNovo(false)} onAberto={() => { setNovo(false); void carregar(); }} />}
    </div>
  );
};

export default Balanco;

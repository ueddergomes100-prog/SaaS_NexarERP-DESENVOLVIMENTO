import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { BookOpen, Plus, RefreshCw, Search } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useCfopsDesativados } from '../../hooks/useCfopsDesativados';
import { escaparHtml, showError, showSuccess, showWarning, NexusSwal } from '../../utils/alerts';
import {
  CFOPS,
  ROTULO_AMBITO,
  ROTULO_NATUREZA,
  ROTULO_TIPO,
  formatarCodigoCfop,
  resumoDaFuncao,
  type AmbitoCfop,
  type TipoCfop,
} from '../../utils/cfopDomain';
import { formatarCest, formatarNcm, LIMITE_DA_DESCRICAO } from '../../utils/tabelaFiscalDomain';
import {
  buscarCest,
  buscarNcm,
  cadastrarCest,
  cadastrarNcm,
  definirCfopAtivo,
  registrarUsoFiscal,
  type LinhaCest,
  type LinhaNcm,
} from '../../services/tabelasFiscaisService';

/**
 * FISCAL › TABELAS FISCAIS (pedido do dono, 20/10/2026).
 *  - CFOP: a tabela do sistema (cfopDomain.ts) com a funcao de cada CFOP; a
 *    empresa so' ativa/desativa (dono/administrador).
 *  - NCM e CEST: base unica de todas as empresas, que cresce com os produtos e
 *    as notas de entrada; cadastro a mao com descricao.
 * Permissao propria "Fiscal: Tabelas Fiscais".
 */

export const PERMISSAO_TABELAS_FISCAIS = 'fiscal.tabelas';

type Aba = 'cfop' | 'ncm' | 'cest';

const estilos = {
  card: { padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' } as React.CSSProperties,
  rotulo: { fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' } as React.CSSProperties,
  campo: { padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', font: 'inherit' } as React.CSSProperties,
  th: { padding: '10px 12px', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' } as React.CSSProperties,
  td: { padding: '10px 12px', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top', fontSize: '14px' } as React.CSSProperties,
};

const Chip: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode }> = ({ ativo, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={ativo}
    style={{
      padding: '7px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${ativo ? 'var(--accent-purple)' : 'var(--border-color)'}`,
      backgroundColor: ativo ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
      color: ativo ? '#fff' : 'var(--text-primary)',
    }}
  >
    {children}
  </button>
);

const CampoBusca: React.FC<{ id: string; valor: string; onChange: (v: string) => void; dica: string }> = ({ id, valor, onChange, dica }) => (
  <div style={{ position: 'relative', flex: '1 1 280px' }}>
    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
    <input
      id={id}
      type="text"
      placeholder="Buscar…"
      title={dica}
      aria-label={dica}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...estilos.campo, width: '100%', paddingLeft: '38px', boxSizing: 'border-box' }}
    />
  </div>
);

/** Pede codigo e descricao (e NCM, no CEST) numa janela. */
const pedirCadastro = async (tipo: 'ncm' | 'cest', inicial: { codigo?: string; descricao?: string; ncm?: string } = {}) => {
  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;text-align:left">
      <label style="font-size:13px;font-weight:600">${tipo === 'ncm' ? 'NCM (8 números)' : 'CEST (7 números)'}
        <input id="tf-codigo" class="swal2-input" style="margin:6px 0 0;width:100%" inputmode="numeric" value="${escaparHtml(inicial.codigo)}" ${inicial.codigo ? 'readonly' : ''}>
      </label>
      ${tipo === 'cest' ? `<label style="font-size:13px;font-weight:600">NCM ligado (opcional)
        <input id="tf-ncm" class="swal2-input" style="margin:6px 0 0;width:100%" inputmode="numeric" value="${escaparHtml(inicial.ncm)}">
      </label>` : ''}
      <label style="font-size:13px;font-weight:600">Descrição
        <textarea id="tf-descricao" class="swal2-textarea" style="margin:6px 0 0;width:100%" maxlength="${LIMITE_DA_DESCRICAO}">${escaparHtml(inicial.descricao)}</textarea>
      </label>
    </div>`;
  const r = await NexusSwal.fire({
    title: inicial.codigo ? `Descrever ${tipo.toUpperCase()}` : `Novo ${tipo.toUpperCase()}`,
    html,
    showCancelButton: true,
    confirmButtonText: 'Salvar',
    cancelButtonText: 'Voltar',
    focusConfirm: false,
    preConfirm: () => ({
      codigo: (document.getElementById('tf-codigo') as HTMLInputElement | null)?.value ?? '',
      descricao: (document.getElementById('tf-descricao') as HTMLTextAreaElement | null)?.value ?? '',
      ncm: (document.getElementById('tf-ncm') as HTMLInputElement | null)?.value ?? '',
    }),
  });
  return r.isConfirmed ? r.value as { codigo: string; descricao: string; ncm: string } : null;
};

// ---------------------------------------------------------------------------

const AbaCfop: React.FC<{ podeAtivar: boolean }> = ({ podeAtivar }) => {
  const { desativados } = useCfopsDesativados();
  const [tipo, setTipo] = useState<TipoCfop | ''>('');
  const [ambito, setAmbito] = useState<AmbitoCfop | ''>('');
  const [busca, setBusca] = useState('');
  const [soAtivos, setSoAtivos] = useState(false);
  const [salvando, setSalvando] = useState('');

  const linhas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const digitos = b.replace(/\D/g, '');
    return CFOPS.filter((c) => (
      (!tipo || c.tipo === tipo)
      && (!ambito || c.ambito === ambito)
      && (!soAtivos || !desativados.includes(c.codigo))
      && (!b || (digitos && /^[\d.\s]+$/.test(b) ? c.codigo.startsWith(digitos) : `${c.descricao} ${ROTULO_NATUREZA[c.natureza]}`.toLowerCase().includes(b)))
    ));
  }, [tipo, ambito, busca, soAtivos, desativados]);

  const alternar = async (codigo: string, ativo: boolean) => {
    setSalvando(codigo);
    try {
      const r = await definirCfopAtivo(codigo, ativo);
      showSuccess(`CFOP ${formatarCodigoCfop(codigo)} ${ativo ? 'ativado' : 'desativado'}${r.filiais > 1 ? ` em ${r.filiais} filiais` : ''}.`);
    } catch (erro) {
      showError('Não foi possível alterar o CFOP', erro instanceof Error ? erro.message : undefined);
    } finally {
      setSalvando('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...estilos.card, display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
          A tabela de CFOP é a mesma para todas as empresas e cada CFOP já tem a sua função (estoque, financeiro e faturamento).
          {' '}Aqui a empresa só escolhe quais usa: o CFOP desativado não aparece nas listas de escolha.
          {!podeAtivar && ' Só o dono ou um administrador ativa e desativa.'}
        </p>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...estilos.rotulo, marginRight: '4px' }}>Tipo</span>
          <Chip ativo={tipo === ''} onClick={() => setTipo('')}>Todos</Chip>
          {(['entrada', 'saida'] as TipoCfop[]).map((t) => <Chip key={t} ativo={tipo === t} onClick={() => setTipo(t)}>{ROTULO_TIPO[t]}</Chip>)}
          <span style={{ ...estilos.rotulo, margin: '0 4px 0 12px' }}>Operação</span>
          <Chip ativo={ambito === ''} onClick={() => setAmbito('')}>Todas</Chip>
          {(['estadual', 'interestadual', 'exterior'] as AmbitoCfop[]).map((a) => <Chip key={a} ativo={ambito === a} onClick={() => setAmbito(a)}>{ROTULO_AMBITO[a]}</Chip>)}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <CampoBusca id="tf-busca-cfop" valor={busca} onChange={setBusca} dica="Buscar por código (ex.: 5102) ou descrição" />
          <label htmlFor="tf-so-ativos" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
            <input id="tf-so-ativos" type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} /> Só os ativos
          </label>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{linhas.length} CFOP{linhas.length === 1 ? '' : 's'} · {desativados.length} desativado{desativados.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div style={{ ...estilos.card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={estilos.th}>CFOP</th>
              <th style={estilos.th}>Descrição</th>
              <th style={estilos.th}>Função no sistema</th>
              <th style={{ ...estilos.th, textAlign: 'center' }}>Ativo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((c) => {
              const ativo = !desativados.includes(c.codigo);
              return (
                <tr key={c.codigo} style={{ opacity: ativo ? 1 : 0.55 }}>
                  <td style={{ ...estilos.td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {formatarCodigoCfop(c.codigo)}
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>{ROTULO_TIPO[c.tipo]} · {ROTULO_AMBITO[c.ambito]}</div>
                  </td>
                  <td style={estilos.td}>
                    {c.descricao}
                    <div style={{ fontSize: '12px', color: 'var(--accent-purple)', fontWeight: 600, marginTop: '2px' }}>
                      {ROTULO_NATUREZA[c.natureza]}{c.st ? ' · Substituição tributária' : ''}
                    </div>
                  </td>
                  <td style={{ ...estilos.td, fontSize: '13px', color: 'var(--text-secondary)', minWidth: '220px' }}>{resumoDaFuncao(c)}</td>
                  <td style={{ ...estilos.td, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={ativo}
                      disabled={!podeAtivar || salvando === c.codigo}
                      onChange={(e) => { void alternar(c.codigo, e.target.checked); }}
                      aria-label={`CFOP ${formatarCodigoCfop(c.codigo)} ativo`}
                      title={podeAtivar ? (ativo ? 'Desmarque para não aparecer nas listas' : 'Marque para usar') : 'Só o dono ou um administrador altera'}
                      style={{ width: '18px', height: '18px', cursor: podeAtivar ? 'pointer' : 'not-allowed' }}
                    />
                  </td>
                </tr>
              );
            })}
            {linhas.length === 0 && (
              <tr><td colSpan={4} style={{ ...estilos.td, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum CFOP com estes filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const useBuscaComAtraso = <T,>(buscar: (b: string) => Promise<{ linhas: T[]; total: number }>, busca: string, recarregar: number) => {
  const [linhas, setLinhas] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    const espera = window.setTimeout(() => {
      setCarregando(true);
      buscar(busca)
        .then((r) => { if (vivo) { setLinhas(r.linhas); setTotal(r.total); setErro(''); } })
        .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível buscar.'); })
        .finally(() => { if (vivo) setCarregando(false); });
    }, 300);
    return () => { vivo = false; window.clearTimeout(espera); };
  }, [buscar, busca, recarregar]);
  return { linhas, total, carregando, erro };
};

const AbaNcmCest: React.FC<{ tipo: 'ncm' | 'cest'; podeAlimentar: boolean }> = ({ tipo, podeAlimentar }) => {
  const { tenantId } = useAuth();
  const [busca, setBusca] = useState('');
  const [ncmDoCest, setNcmDoCest] = useState('');
  const [recarregar, setRecarregar] = useState(0);
  const [alimentando, setAlimentando] = useState(false);
  const buscarFn = useCallback(
    (b: string) => (tipo === 'ncm' ? buscarNcm(b) : buscarCest(b, ncmDoCest)) as Promise<{ linhas: Array<LinhaNcm | LinhaCest>; total: number }>,
    [tipo, ncmDoCest],
  );
  const { linhas, total, carregando, erro } = useBuscaComAtraso(buscarFn, busca, recarregar);
  const formatar = tipo === 'ncm' ? formatarNcm : formatarCest;
  const rotulo = tipo.toUpperCase();

  const cadastrar = async (inicial: { codigo?: string; descricao?: string } = {}) => {
    const dados = await pedirCadastro(tipo, inicial);
    if (!dados) return;
    try {
      const r = tipo === 'ncm'
        ? await cadastrarNcm(dados.codigo, dados.descricao)
        : await cadastrarCest(dados.codigo, dados.descricao, dados.ncm);
      showSuccess(r.novo ? `${rotulo} cadastrado.` : `Descrição do ${rotulo} salva.`);
      setRecarregar((n) => n + 1);
    } catch (e) {
      showError(`Não foi possível salvar o ${rotulo}`, e instanceof Error ? e.message : undefined);
    }
  };

  const alimentarComProdutos = async () => {
    if (!tenantId) return;
    setAlimentando(true);
    try {
      const snap = await getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)));
      const itens = snap.docs.map((d) => ({ ncm: d.data().ncm, cest: d.data().cest })).filter((i) => i.ncm || i.cest);
      if (itens.length === 0) {
        showWarning('Nenhum produto com NCM ou CEST', 'Cadastre o NCM na aba Fiscal do produto, em Estoque.');
        return;
      }
      for (let i = 0; i < itens.length; i += 300) registrarUsoFiscal(itens.slice(i, i + 300));
      showSuccess(`Códigos de ${itens.length} produto(s) enviados para a base.`);
      window.setTimeout(() => setRecarregar((n) => n + 1), 1500);
    } catch {
      showError('Não foi possível ler os produtos', 'Confira a internet e tente de novo.');
    } finally {
      setAlimentando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...estilos.card, display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
          Base única de {rotulo} do sistema. Todo {rotulo} usado num produto ou numa nota de entrada entra sozinho aqui (só o código).
          {' '}Quem tem esta tela também cadastra com a descrição. Depois de descrito, só o suporte da Hennder altera.
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <CampoBusca id={`tf-busca-${tipo}`} valor={busca} onChange={setBusca} dica={`Buscar ${rotulo} pelo código ou pela descrição`} />
          {tipo === 'cest' && (
            <label htmlFor="tf-ncm-do-cest" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              Do NCM
              <input id="tf-ncm-do-cest" type="text" inputMode="numeric" value={ncmDoCest} onChange={(e) => setNcmDoCest(e.target.value)} style={{ ...estilos.campo, width: '130px' }} title="Mostra só os CEST que já apareceram com este NCM" />
            </label>
          )}
          <button type="button" className="btn-primary" onClick={() => { void cadastrar(); }} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={18} /> Novo {rotulo}
          </button>
          {podeAlimentar && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { void alimentarComProdutos(); }}
              disabled={alimentando}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Envia para a base os NCM e CEST dos produtos já cadastrados nesta empresa (só os códigos)"
            >
              <RefreshCw size={16} /> {alimentando ? 'Enviando…' : 'Trazer dos produtos'}
            </button>
          )}
        </div>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {carregando ? 'Buscando…' : `${total} ${rotulo}${total === 1 ? '' : 's'}${total > linhas.length ? ` (mostrando ${linhas.length}; refine a busca)` : ''}`}
        </span>
        {erro && <span style={{ color: 'var(--status-red)', fontSize: '13px' }}>{erro}</span>}
      </div>

      <div style={{ ...estilos.card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={estilos.th}>{rotulo}</th>
              <th style={estilos.th}>Descrição</th>
              {tipo === 'cest' && <th style={estilos.th}>NCMs</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.codigo}>
                <td style={{ ...estilos.td, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatar(l.codigo)}</td>
                <td style={estilos.td}>
                  {l.descricao || (
                    <button type="button" className="btn-secondary" onClick={() => { void cadastrar({ codigo: l.codigo }); }} style={{ fontSize: '13px', padding: '4px 10px' }}>
                      Sem descrição · Descrever
                    </button>
                  )}
                </td>
                {tipo === 'cest' && (
                  <td style={{ ...estilos.td, fontSize: '13px' }}>{(l as LinhaCest).ncms.map(formatarNcm).join(', ') || '—'}</td>
                )}
              </tr>
            ))}
            {!carregando && linhas.length === 0 && (
              <tr><td colSpan={tipo === 'cest' ? 3 : 2} style={{ ...estilos.td, textAlign: 'center', color: 'var(--text-muted)' }}>
                {busca || ncmDoCest ? `Nenhum ${rotulo} com esta busca.` : `A base de ${rotulo} ainda está vazia. Ela enche sozinha com os produtos e as notas de entrada.`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const TabelasFiscais: React.FC = () => {
  const { isPlatformAdmin, ehGestorDasFiliais, grupo, userPermissions } = useAuth();
  const [aba, setAba] = useState<Aba>('cfop');
  // Mesma regra do servidor (Configuracoes Gerais): com filiais, dono/administrador do grupo;
  // sem filiais, dono/administrador ou quem tem "Admin: Configuracoes".
  const podeAtivar = isPlatformAdmin || ehGestorDasFiliais || (!grupo && userPermissions.includes('administrativo.config'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={28} color="var(--accent-purple)" /> Tabelas Fiscais
        </h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: '760px' }}>
          CFOP com a função de cada operação, e a base de NCM e CEST usada nos produtos e nas notas.
        </p>
      </div>
      <div role="tablist" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([['cfop', 'CFOP'], ['ncm', 'NCM'], ['cest', 'CEST']] as Array<[Aba, string]>).map(([id, rotulo]) => (
          <Chip key={id} ativo={aba === id} onClick={() => setAba(id)}>{rotulo}</Chip>
        ))}
      </div>
      {aba === 'cfop' && <AbaCfop podeAtivar={podeAtivar} />}
      {aba === 'ncm' && <AbaNcmCest key="ncm" tipo="ncm" podeAlimentar={podeAtivar} />}
      {aba === 'cest' && <AbaNcmCest key="cest" tipo="cest" podeAlimentar={podeAtivar} />}
    </div>
  );
};

export default TabelasFiscais;

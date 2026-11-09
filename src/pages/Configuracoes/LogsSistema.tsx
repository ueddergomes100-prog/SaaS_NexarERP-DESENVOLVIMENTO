import React, { useEffect, useMemo, useState } from 'react';
import { FileText, History, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { createAuditLog } from '../../services/logService';
import { lerHistoricoDoPeriodo, LIMITE_REGISTROS_PERIODO } from '../../services/historicoService';
import { isPlatformAdminRole } from '../../utils/roles';
import { addDaysToDateInput, dateInputToUtcEnd, dateInputToUtcStart, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import {
  corDaAcao,
  dataHoraBrasil,
  filtrarRegistros,
  nomeDeQuemFez,
  opcoesDosFiltros,
  rotuloDaAcao,
  rotuloDaOrigem,
  telaDoRegistro,
  valorParaHistorico,
  type RegistroLido,
} from '../../utils/historicoAlteracoesDomain';
import { montarDocumentoHistorico } from '../../utils/relatorioHistoricoDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';

/*
 * HISTORICO DE ALTERACOES (tela geral, 09/11/2026; antes "Logs do Sistema").
 *
 * Quem criou, alterou, cancelou, excluiu, reabriu ou estornou, em todas as
 * telas e aplicativos. Le' o periodo do banco (do mais novo ao mais antigo) e
 * filtra na tela por usuario, tela, documento e acao. Relatorio em PDF (com
 * colunas por caixa de marcar e Excel separado) em "Mais opções".
 *
 * Os registros nao se alteram nem se apagam (firestore.rules). So' dono,
 * administrador e quem tem a permissao "Histórico de alterações" veem.
 */

const estiloCampo: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  backgroundColor: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: '13px',
};

const estiloRotulo: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' };

const mostrarValor = (valor: unknown): string => {
  const v = valorParaHistorico(valor);
  if (v === null || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

const LogsSistema: React.FC = () => {
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const hoje = getDateInputInTimeZone();

  const permitido = userRole === null
    ? null
    : Boolean(isOwner || isPlatformAdminRole(userRole) || userRole === 'Master' || userRole === 'Admin' || userPermissions?.includes('administrativo.logs'));

  const [inicio, setInicio] = useState(addDaysToDateInput(hoje, -6));
  const [fim, setFim] = useState(hoje);
  const [usuario, setUsuario] = useState('');
  const [tela, setTela] = useState('');
  const [documento, setDocumento] = useState('');
  const [acao, setAcao] = useState('');

  const [registros, setRegistros] = useState<RegistroLido[]>([]);
  const [cortado, setCortado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [recarregar, setRecarregar] = useState(0);
  const [selecionado, setSelecionado] = useState<RegistroLido | null>(null);
  const [relatorio, setRelatorio] = useState(false);

  // Tentativa de abrir sem permissao tambem fica registrada.
  useEffect(() => {
    if (permitido !== false || !currentUser || !tenantId) return;
    createAuditLog({
      tenantId,
      usuarioId: currentUser.uid,
      usuarioEmail: currentUser.email || currentUser.uid,
      modulo: 'logs',
      acao: 'acesso_negado',
      descricao: 'Tentou abrir o Histórico de alterações sem permissão.',
      status: 'negado',
      critical: true,
    });
  }, [permitido, currentUser, tenantId]);

  const periodoInvalido = !inicio || !fim || inicio > fim;

  useEffect(() => {
    if (!permitido || !tenantId || periodoInvalido) return undefined;
    let cancelado = false;
    setCarregando(true);
    setErro('');
    lerHistoricoDoPeriodo(tenantId, dateInputToUtcStart(inicio) as Date, dateInputToUtcEnd(fim) as Date)
      .then((r) => {
        if (cancelado) return;
        setRegistros(r.registros);
        setCortado(r.cortado);
      })
      .catch((err) => {
        console.error('Erro ao ler o histórico de alterações:', err);
        if (!cancelado) setErro('Não foi possível carregar o histórico. Confira a internet e tente de novo em instantes.');
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [permitido, tenantId, inicio, fim, periodoInvalido, recarregar]);

  const opcoes = useMemo(() => opcoesDosFiltros(registros), [registros]);
  const filtrados = useMemo(
    () => filtrarRegistros(registros, { usuario, tela, documento, acao }),
    [registros, usuario, tela, documento, acao],
  );

  const frasesDosFiltros = (): string[] => [
    usuario ? `Usuário: ${usuario}` : '',
    tela ? `Tela: ${tela}` : '',
    documento ? `Documento: ${documento}` : '',
    acao ? `Ação: ${rotuloDaAcao(acao)}` : '',
  ].filter(Boolean);

  if (permitido === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-primary)', textAlign: 'center', padding: '20px' }}>
        <ShieldAlert size={56} color="#ef4444" style={{ marginBottom: '16px' }} />
        <h2 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px' }}>Sem acesso ao Histórico de alterações</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '440px' }}>
          Peça ao dono ou ao administrador da empresa para liberar a permissão "Histórico de alterações" no seu usuário (Administração › Usuários).
        </p>
      </div>
    );
  }

  if (relatorio) {
    return (
      <RelatorioPreview
        relatorioId="historico-alteracoes"
        documento={montarDocumentoHistorico(filtrados, {
          periodo: `Período: ${formatDateInputPtBr(inicio)} a ${formatDateInputPtBr(fim)}`,
          filtros: frasesDosFiltros(),
        })}
        nomeArquivo={nomeArquivoRelatorio('Histórico de alterações', inicio, fim)}
        onFechar={() => setRelatorio(false)}
        rotuloFechar="Voltar ao histórico"
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', color: 'var(--text-primary)' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={26} color="var(--accent-purple)" />
            Histórico de alterações
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
            Quem criou, alterou, cancelou, excluiu, reabriu ou estornou, em cada tela do sistema e dos aplicativos. Nada aqui pode ser alterado ou apagado.
          </p>
        </div>
        <MenuMaisOpcoes itens={[
          { texto: 'Relatório em PDF', Icone: FileText, titulo: 'Os registros filtrados, em PDF, para imprimir ou salvar (Excel em botão separado)', onClick: () => setRelatorio(true), desabilitado: carregando || filtrados.length === 0 },
          { texto: 'Atualizar', Icone: RefreshCw, titulo: 'Lê o período de novo', onClick: () => setRecarregar((n) => n + 1) },
        ]} />
      </div>

      <div className="card" style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px', alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>De</span>
          <input type="date" value={inicio} max={fim || undefined} onChange={(e) => setInicio(e.target.value)} style={estiloCampo} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Até</span>
          <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} style={estiloCampo} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Usuário</span>
          <input type="search" value={usuario} placeholder="Buscar…" onChange={(e) => setUsuario(e.target.value)} style={estiloCampo} title="Nome ou e-mail de quem fez" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Documento</span>
          <input type="search" value={documento} placeholder="Buscar…" onChange={(e) => setDocumento(e.target.value)} style={estiloCampo} title="Número ou nome: Rota 02, 0375, nome do cliente..." />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Tela</span>
          <select value={tela} onChange={(e) => setTela(e.target.value)} style={estiloCampo}>
            <option value="">Todas as telas</option>
            {opcoes.telas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={estiloRotulo}>Ação</span>
          <select value={acao} onChange={(e) => setAcao(e.target.value)} style={estiloCampo}>
            <option value="">Todas as ações</option>
            {opcoes.acoes.map((a) => <option key={a.valor} value={a.valor}>{a.rotulo}</option>)}
          </select>
        </label>
      </div>

      {periodoInvalido && (
        <div style={{ color: '#f59e0b', fontSize: '13px' }}>Escolha um período válido: a data "De" precisa ser igual ou anterior à data "Até".</div>
      )}
      {cortado && (
        <div style={{ color: '#f59e0b', fontSize: '13px' }}>
          O período tem mais de {LIMITE_REGISTROS_PERIODO} registros: aparecem só os {LIMITE_REGISTROS_PERIODO} mais recentes. Escolha um período menor para ver todos.
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {carregando ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '48px', color: 'var(--text-muted)' }}>
            <Loader2 size={20} className="spin-icon" /> Carregando o histórico...
          </div>
        ) : erro ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>{erro}</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Nenhum registro encontrado com esses filtros. Aumente o período ou limpe os filtros.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Quem fez</th>
                  <th>Ação</th>
                  <th>Documento</th>
                  <th>O que aconteceu</th>
                  <th>Tela</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r) => (
                  <tr key={r.id} onClick={() => setSelecionado(r)} style={{ cursor: 'pointer' }} title="Ver detalhes">
                    <td style={{ whiteSpace: 'nowrap' }}>{dataHoraBrasil(r.dataHora)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{nomeDeQuemFez(r)}</div>
                      {(r.usuarioPapel || r.vendedorNome) && (
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {[r.usuarioPapel, r.vendedorNome ? `vendedor: ${r.vendedorNome}` : ''].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, color: 'white', backgroundColor: corDaAcao(r.acao), whiteSpace: 'nowrap' }}>
                        {rotuloDaAcao(r.acao)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.documentoNumero || ''}</td>
                    <td style={{ maxWidth: '420px' }}>
                      <div>{r.descricao}</div>
                      {r.motivo && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Motivo: {r.motivo}</div>}
                    </td>
                    <td>
                      <div>{telaDoRegistro(r)}</div>
                      {r.origem && r.origem !== 'sistema' && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{rotuloDaOrigem(r.origem)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!carregando && filtrados.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {filtrados.length} de {registros.length} registro(s) do período.
        </div>
      )}

      {selecionado && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}
          onClick={() => setSelecionado(null)}
        >
          <div
            role="dialog"
            aria-label="Detalhes do registro"
            style={{ width: '100%', maxWidth: '720px', maxHeight: '88vh', overflowY: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, color: 'white', backgroundColor: corDaAcao(selecionado.acao) }}>{rotuloDaAcao(selecionado.acao)}</span>
                {selecionado.documentoNumero || telaDoRegistro(selecionado)}
              </h3>
              <button type="button" onClick={() => setSelecionado(null)} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '13px', marginBottom: '14px' }}>
              <div><div style={estiloRotulo}>Data e hora</div>{dataHoraBrasil(selecionado.dataHora)}</div>
              <div><div style={estiloRotulo}>Quem fez</div>{nomeDeQuemFez(selecionado)}{selecionado.usuarioPapel ? ` (${selecionado.usuarioPapel})` : ''}</div>
              <div><div style={estiloRotulo}>Login</div>{selecionado.usuario || selecionado.usuarioId}</div>
              <div><div style={estiloRotulo}>Tela</div>{telaDoRegistro(selecionado)}</div>
              <div><div style={estiloRotulo}>Origem</div>{rotuloDaOrigem(selecionado.origem) || '—'}</div>
              <div><div style={estiloRotulo}>Filial</div>{selecionado.filialNome || '—'}</div>
              {selecionado.vendedorNome && <div><div style={estiloRotulo}>Vendedor</div>{selecionado.vendedorNome}</div>}
            </div>
            <div style={{ marginBottom: '12px' }}>
              <div style={estiloRotulo}>O que aconteceu</div>
              <div style={{ fontSize: '14px' }}>{selecionado.descricao}</div>
              {selecionado.motivo && <div style={{ fontSize: '13px', marginTop: '4px' }}><strong>Motivo:</strong> {selecionado.motivo}</div>}
            </div>
            {selecionado.alteracoes && selecionado.alteracoes.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={estiloRotulo}>O que mudou</div>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden', marginTop: '4px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '6px 10px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                    <span>Campo</span><span>Antes</span><span>Depois</span>
                  </div>
                  {selecionado.alteracoes.map((m, i) => (
                    <div key={`${m.campo}-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '7px 10px', fontSize: '12px', borderTop: '1px solid var(--border-color)', wordBreak: 'break-word' }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{m.campo}</span>
                      <span style={{ color: '#ef4444' }}>{mostrarValor(m.valorAnterior)}</span>
                      <span style={{ color: '#10b981' }}>{mostrarValor(m.valorNovo)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {selecionado.snapshotExcluido && (
              <div>
                <div style={estiloRotulo}>Como o documento estava antes</div>
                <pre style={{ margin: '4px 0 0', padding: '10px', backgroundColor: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '11px', maxHeight: '240px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(selecionado.snapshotExcluido, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LogsSistema;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  AlertTriangle, Ban, CheckCircle, Clock, FileText, Loader2, Receipt, RefreshCw, Search, Send, Settings, X,
} from 'lucide-react';
import { db } from '../../services/firebase';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import { lerGrupo, lerPercentualFilial, mensalidadeComFiliais, type GrupoEmpresarial } from '../../utils/filialDomain';
import {
  ANTECEDENCIA_DE_GERACAO_DIAS,
  PRAZOS_PADRAO,
  competenciaSeguinte,
  competenciaDaData,
  formatarData,
  formatarLinhaDigitavel,
  formatarMoeda,
  hojeEmBrasilia,
  lerContato,
  lerMensalidade,
  lerPlanoCobranca,
  lerPrazos,
  lerResumoDaCobranca,
  rotuloCompetencia,
  rotuloDaEtapa,
  situacaoDaCobranca,
  temBoleto,
  validarBoletoDigitado,
  validarPrazos,
  type ContatoDaCobranca,
  type EtapaDaCobranca,
  type MensalidadeLida,
  type PlanoCobranca,
  type PrazosCobranca,
  type ResumoDaCobranca,
} from '../../utils/mensalidadeDomain';
import {
  anexarBoleto,
  cancelarMensalidade,
  desfazerPagamento,
  enviarCobranca,
  gerarMensalidade,
  liberarEmpresaAte,
  marcarMensalidadePaga,
  salvarConfigGeralDaCobranca,
  salvarPlanoDaEmpresa,
  subirPdfDoBoleto,
} from '../../services/mensalidadesService';

/**
 * MENSALIDADES DAS EMPRESAS CLIENTES (Painel da Plataforma, 24/11/2026).
 * Regras em src/utils/mensalidadeDomain.ts; toda gravacao pelo servidor
 * (/api/mensalidades). Aqui so' se le e se chama o servidor.
 */

interface EventoDaMensalidade { em: string; tipo: string; por: string; detalhe?: string }
interface MensalidadeDaTela extends MensalidadeLida { eventos: EventoDaMensalidade[] }

interface EmpresaDaTela {
  id: string;
  nome: string;
  email: string;
  valorTotal: number;
  plano: PlanoCobranca;
  resumo: ResumoDaCobranca | null;
  mensalidades: MensalidadeDaTela[];
}

const ORDEM_DA_ETAPA: Record<EtapaDaCobranca, number> = {
  bloqueada: 0, aviso_forte: 1, liberada: 2, atrasada: 3, vence_hoje: 4, lembrete: 5, em_dia: 6,
};

const COR_DA_ETAPA: Record<EtapaDaCobranca, string> = {
  bloqueada: '#ef4444', aviso_forte: '#f97316', liberada: '#f59e0b', atrasada: '#f59e0b', vence_hoje: '#eab308', lembrete: '#3b82f6', em_dia: '#10b981',
};

const ROTULO_SITUACAO: Record<MensalidadeLida['situacao'], string> = { aberta: 'Em aberto', paga: 'Paga', cancelada: 'Cancelada' };

const ROTULO_EVENTO: Record<string, string> = {
  criada: 'Criada', boleto: 'Boleto anexado', paga: 'Pagamento registrado', pagamento_desfeito: 'Pagamento desfeito',
  cancelada: 'Cancelada', cobranca_enviada: 'Cobrança enviada',
};

const msg = (erro: unknown) => (erro instanceof Error ? erro.message : 'Tente de novo em instantes.');

const lerEventos = (v: unknown): EventoDaMensalidade[] => (Array.isArray(v) ? v : [])
  .filter((e): e is EventoDaMensalidade => Boolean(e && typeof e === 'object' && typeof (e as EventoDaMensalidade).em === 'string'))
  .sort((a, b) => b.em.localeCompare(a.em));

const carregarTudo = async (): Promise<{ empresas: EmpresaDaTela[]; prazos: PrazosCobranca; contato: ContatoDaCobranca }> => {
  const [usuarios, grupos, mensalidades, config] = await Promise.all([
    getDocs(collection(db, 'usuarios')),
    getDocs(collection(db, 'grupos')).catch(() => null),
    getDocs(collection(db, 'mensalidades')),
    getDoc(doc(db, 'plataforma', 'cobranca')),
  ]);
  const porMatriz = new Map<string, GrupoEmpresarial>();
  grupos?.forEach((g) => { const grupo = lerGrupo(g.id, g.data()); porMatriz.set(grupo.matrizTenantId, grupo); });
  const porEmpresa = new Map<string, MensalidadeDaTela[]>();
  mensalidades.forEach((m) => {
    const lida = { ...lerMensalidade(m.id, m.data()), eventos: lerEventos(m.data().eventos) };
    porEmpresa.set(lida.tenantId, [...(porEmpresa.get(lida.tenantId) || []), lida]);
  });
  const empresas: EmpresaDaTela[] = [];
  usuarios.forEach((u) => {
    const d = u.data();
    if (d.role === 'NexarAdmin' || d.role === 'SuperAdmin') return;
    // So' o dono (uid = empresa): a cobranca e' da empresa, nao de cada login.
    if (u.id !== d.tenantId) return;
    const base = Number(d.valorMensalidade) > 0 ? Number(d.valorMensalidade) : 149.9;
    empresas.push({
      id: u.id,
      nome: String(d.nomeOficina || 'Sem nome'),
      email: String(d.email || ''),
      valorTotal: mensalidadeComFiliais(base, porMatriz.get(u.id) ?? null, lerPercentualFilial(d.percentualFilial)).total,
      plano: lerPlanoCobranca(d.planoCobranca),
      resumo: lerResumoDaCobranca(d.cobrancaEmpresa),
      mensalidades: (porEmpresa.get(u.id) || []).sort((a, b) => b.competencia.localeCompare(a.competencia)),
    });
  });
  const dadosConfig = config.exists() ? config.data() : {};
  return { empresas, prazos: lerPrazos(dadosConfig.prazos), contato: lerContato(dadosConfig.contato) };
};

const estiloSelo = (cor: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: cor,
});

// ---------------------------------------------------------------- tela

const SuperAdminMensalidades: React.FC = () => {
  const [carregando, setCarregando] = useState(true);
  const [empresas, setEmpresas] = useState<EmpresaDaTela[]>([]);
  const [prazosPadrao, setPrazosPadrao] = useState<PrazosCobranca>(PRAZOS_PADRAO);
  const [contato, setContato] = useState<ContatoDaCobranca>({});
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const hoje = hojeEmBrasilia();

  const recarregar = useCallback(async () => {
    try {
      const r = await carregarTudo();
      setEmpresas(r.empresas);
      setPrazosPadrao(r.prazos);
      setContato(r.contato);
    } catch (erro) {
      console.error('Mensalidades: falha ao carregar', erro);
      showError('Não foi possível carregar as mensalidades', 'Recarregue a página (F5). Se continuar, confira a conexão.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void recarregar(); }, [recarregar]);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return empresas
      .filter((e) => !termo || e.nome.toLowerCase().includes(termo) || e.email.toLowerCase().includes(termo))
      .map((e) => ({ ...e, situacao: situacaoDaCobranca(e.resumo, hoje) }))
      .sort((a, b) => ORDEM_DA_ETAPA[a.situacao.etapa] - ORDEM_DA_ETAPA[b.situacao.etapa] || a.nome.localeCompare(b.nome));
  }, [empresas, busca, hoje]);

  const totais = useMemo(() => {
    const comSituacao = empresas.map((e) => situacaoDaCobranca(e.resumo, hoje).etapa);
    return {
      emAberto: empresas.reduce((s, e) => s + (e.resumo?.valorEmAberto || 0), 0),
      atrasadas: comSituacao.filter((x) => x === 'atrasada' || x === 'aviso_forte' || x === 'liberada').length,
      bloqueadas: comSituacao.filter((x) => x === 'bloqueada').length,
      ligadas: empresas.filter((e) => e.plano.ativa).length,
    };
  }, [empresas, hoje]);

  const empresaAberta = empresas.find((e) => e.id === aberta) || null;

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
        <Loader2 size={18} className="spin" /> Carregando mensalidades…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1280px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Receipt size={24} color="var(--accent-purple)" /> Mensalidades
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            Prazos padrão: lembrete {prazosPadrao.diasLembreteAntes} dia(s) antes, aviso forte com {prazosPadrao.diasAvisoForte} e bloqueio no {prazosPadrao.diasBloqueio}º dia de atraso.
          </p>
        </div>
        <MenuMaisOpcoes
          itens={[
            { texto: 'Prazos padrão e contato', Icone: Settings, onClick: () => setConfigAberta(true) },
            { texto: 'Atualizar a lista', Icone: RefreshCw, onClick: () => { setCarregando(true); void recarregar(); } },
          ]}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {[
          { rotulo: 'Em aberto', valor: formatarMoeda(totais.emAberto), cor: 'var(--text-primary)' },
          { rotulo: 'Atrasadas', valor: String(totais.atrasadas), cor: '#f59e0b' },
          { rotulo: 'Bloqueadas', valor: String(totais.bloqueadas), cor: '#ef4444' },
          { rotulo: 'Com cobrança ligada', valor: `${totais.ligadas} de ${empresas.length}`, cor: 'var(--text-primary)' },
        ].map((c) => (
          <div key={c.rotulo} className="card" style={{ padding: '18px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>{c.rotulo}</p>
            <p style={{ margin: '6px 0 0', fontSize: '26px', fontWeight: 800, color: c.cor }}>{c.valor}</p>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ position: 'relative', maxWidth: '360px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar empresa"
            style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 8px' }}>Empresa</th>
                <th style={{ padding: '10px 8px' }}>Cobrança</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Mensalidade</th>
                <th style={{ padding: '10px 8px' }}>Situação</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Em aberto</th>
                <th style={{ padding: '10px 8px' }} aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ fontWeight: 600 }}>{e.nome}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{e.email}</div>
                  </td>
                  <td style={{ padding: '12px 8px', color: e.plano.ativa ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {e.plano.ativa && e.plano.diaVencimento ? `Todo dia ${e.plano.diaVencimento}` : 'Desligada'}
                    {e.plano.prazos ? <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Prazos próprios</div> : null}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>{formatarMoeda(e.valorTotal)}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={estiloSelo(COR_DA_ETAPA[e.situacao.etapa])}>
                      {e.situacao.etapa === 'bloqueada' ? <Ban size={15} /> : e.situacao.etapa === 'em_dia' ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                      {rotuloDaEtapa(e.situacao)}
                    </span>
                    {e.resumo && !e.resumo.boleto ? <div style={{ fontSize: '12px', color: '#f59e0b' }}>Sem boleto anexado</div> : null}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>{e.resumo ? formatarMoeda(e.resumo.valorEmAberto) : '—'}</td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <button type="button" className="btn-secondary" onClick={() => setAberta(e.id)} style={{ fontSize: '13px', padding: '6px 14px' }}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
              {!linhas.length && (
                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma empresa encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {empresaAberta && (
        <CobrancaDaEmpresa
          empresa={empresaAberta}
          prazosPadrao={prazosPadrao}
          hoje={hoje}
          onFechar={() => setAberta(null)}
          onMudou={recarregar}
        />
      )}
      {configAberta && (
        <ConfigGeral
          prazos={prazosPadrao}
          contato={contato}
          onFechar={() => setConfigAberta(false)}
          onSalvo={() => { setConfigAberta(false); void recarregar(); }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------- janelas

const Janela: React.FC<{ titulo: string; onFechar: () => void; largura?: number; children: React.ReactNode }> = ({ titulo, onFechar, largura = 900, children }) => (
  <div role="dialog" aria-modal="true" aria-label={titulo} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
    <div className="card" style={{ padding: 0, backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: `${largura}px`, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{titulo}</h2>
        <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={24} />
        </button>
      </div>
      <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {children}
      </div>
    </div>
  </div>
);

const Campo: React.FC<{ rotulo: string; children: React.ReactNode; largura?: string }> = ({ rotulo, children, largura }) => (
  <label className="input-group" style={{ margin: 0, ...(largura ? { width: largura } : {}) }}>
    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>{rotulo}</span>
    {children}
  </label>
);

const CamposDosPrazos: React.FC<{ valor: PrazosCobranca; onChange: (p: PrazosCobranca) => void }> = ({ valor, onChange }) => (
  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
    <Campo rotulo="Lembrete (dias antes)" largura="170px">
      <input type="number" min={0} max={15} value={valor.diasLembreteAntes} onChange={(e) => onChange({ ...valor, diasLembreteAntes: Number(e.target.value) })} />
    </Campo>
    <Campo rotulo="Aviso forte (dias de atraso)" largura="200px">
      <input type="number" min={1} max={60} value={valor.diasAvisoForte} onChange={(e) => onChange({ ...valor, diasAvisoForte: Number(e.target.value) })} />
    </Campo>
    <Campo rotulo="Bloqueio (dia de atraso)" largura="190px">
      <input type="number" min={1} max={90} value={valor.diasBloqueio} onChange={(e) => onChange({ ...valor, diasBloqueio: Number(e.target.value) })} />
    </Campo>
  </div>
);

const ConfigGeral: React.FC<{ prazos: PrazosCobranca; contato: ContatoDaCobranca; onFechar: () => void; onSalvo: () => void }> = ({ prazos, contato, onFechar, onSalvo }) => {
  const [rascunho, setRascunho] = useState<PrazosCobranca>(prazos);
  const [nome, setNome] = useState(contato.nome || '');
  const [whatsapp, setWhatsapp] = useState(contato.whatsapp || '');
  const [email, setEmail] = useState(contato.email || '');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const erro = validarPrazos(rascunho);
    if (erro) { showError('Prazos inválidos', erro); return; }
    setSalvando(true);
    try {
      await salvarConfigGeralDaCobranca(rascunho, { nome, whatsapp, email });
      showSuccess('Prazos e contato salvos. As empresas já foram recalculadas.');
      onSalvo();
    } catch (e) {
      showError('Não foi possível salvar', msg(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Janela titulo="Prazos padrão e contato" onFechar={onFechar} largura={680}>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Valem para toda empresa sem prazos próprios. O contato aparece no aviso e na tela de bloqueio do cliente.
      </p>
      <CamposDosPrazos valor={rascunho} onChange={setRascunho} />
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <Campo rotulo="Nome do contato" largura="200px"><input value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
        <Campo rotulo="WhatsApp do suporte (com DDD)" largura="220px"><input value={whatsapp} inputMode="tel" onChange={(e) => setWhatsapp(e.target.value)} /></Campo>
        <Campo rotulo="E-mail do suporte" largura="220px"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" className="btn-secondary" onClick={onFechar}>Cancelar</button>
        <button type="button" className="btn-primary" onClick={() => { void salvar(); }} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </Janela>
  );
};

const CobrancaDaEmpresa: React.FC<{
  empresa: EmpresaDaTela;
  prazosPadrao: PrazosCobranca;
  hoje: string;
  onFechar: () => void;
  onMudou: () => Promise<void>;
}> = ({ empresa, prazosPadrao, hoje, onFechar, onMudou }) => {
  const [ativa, setAtiva] = useState(empresa.plano.ativa);
  const [dia, setDia] = useState(empresa.plano.diaVencimento ? String(empresa.plano.diaVencimento) : '');
  const [proprios, setProprios] = useState(Boolean(empresa.plano.prazos));
  const [prazos, setPrazos] = useState<PrazosCobranca>(empresa.plano.prazos || prazosPadrao);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [boletoDe, setBoletoDe] = useState<MensalidadeDaTela | null>(null);
  const [historicoDe, setHistoricoDe] = useState<string | null>(null);
  const situacao = situacaoDaCobranca(empresa.resumo, hoje);

  const rodar = async (rotulo: string, acao: () => Promise<unknown>, sucesso: string) => {
    setOcupado(rotulo);
    try {
      await acao();
      await onMudou();
      showSuccess(sucesso);
    } catch (e) {
      showError('Não foi possível concluir', msg(e));
    } finally {
      setOcupado(null);
    }
  };

  const salvarPlano = () => {
    const diaNumero = dia ? Number(dia) : null;
    if (ativa && (!diaNumero || diaNumero < 1 || diaNumero > 31)) { showError('Dia de vencimento', 'Informe o dia de vencimento, de 1 a 31.'); return; }
    if (proprios) {
      const erro = validarPrazos(prazos);
      if (erro) { showError('Prazos inválidos', erro); return; }
    }
    void rodar('plano', () => salvarPlanoDaEmpresa({ tenantId: empresa.id, ativa, diaVencimento: diaNumero, prazos: proprios ? prazos : null }), 'Cobrança da empresa salva.');
  };

  const pedirGerar = async () => {
    const sugestao = empresa.mensalidades.length
      ? competenciaSeguinte(empresa.mensalidades[0].competencia)
      : competenciaDaData(hoje);
    const r = await NexusSwal.fire({
      title: 'Gerar mensalidade',
      text: `Mês da mensalidade de ${empresa.nome}. O valor é o atual (${formatarMoeda(empresa.valorTotal)}) e o vencimento, o dia da cobrança.`,
      input: 'month',
      inputValue: sugestao,
      showCancelButton: true,
      confirmButtonText: 'Gerar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? null : 'Escolha o mês.'),
    });
    if (!r.isConfirmed) return;
    void rodar('gerar', () => gerarMensalidade(empresa.id, String(r.value)), `Mensalidade de ${rotuloCompetencia(String(r.value))} criada.`);
  };

  const pedirPagamento = async (m: MensalidadeDaTela) => {
    const r = await NexusSwal.fire({
      title: 'Registrar pagamento',
      text: `${rotuloCompetencia(m.competencia)} — ${formatarMoeda(m.valor)}. Data em que o cliente pagou:`,
      input: 'date',
      inputValue: hoje,
      inputAttributes: { max: hoje },
      showCancelButton: true,
      confirmButtonText: 'Marcar como paga',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!v ? 'Informe a data do pagamento.' : String(v) > hoje ? 'A data não pode ser depois de hoje.' : null),
    });
    if (!r.isConfirmed) return;
    void rodar(`pagar-${m.id}`, () => marcarMensalidadePaga(m.id, String(r.value)), 'Pagamento registrado. Se a empresa estava bloqueada, já foi liberada.');
  };

  const pedirMotivo = async (titulo: string, confirmar: string) => {
    const r = await NexusSwal.fire({
      title: titulo,
      input: 'text',
      inputLabel: 'Motivo',
      showCancelButton: true,
      confirmButtonText: confirmar,
      cancelButtonText: 'Voltar',
      inputValidator: (v) => (String(v || '').trim() ? null : 'Informe o motivo.'),
    });
    return r.isConfirmed ? String(r.value).trim() : null;
  };

  const pedirEnvio = async (m: MensalidadeDaTela) => {
    if (!temBoleto(m.boleto)) { showError('Falta o boleto', 'Anexe o boleto antes de enviar a cobrança.'); return; }
    const r = await NexusSwal.fire({
      title: 'Enviar cobrança',
      html: `<div style="text-align:left;display:flex;flex-direction:column;gap:10px;">
        <label><input type="checkbox" id="cob-email" checked> Por e-mail (${escaparHtml(empresa.email || 'e-mail do cadastro')})</label>
        <label><input type="checkbox" id="cob-whats" checked> Pelo WhatsApp (abre com o texto pronto)</label>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Enviar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const porEmail = (document.getElementById('cob-email') as HTMLInputElement | null)?.checked === true;
        const porWhatsapp = (document.getElementById('cob-whats') as HTMLInputElement | null)?.checked === true;
        if (!porEmail && !porWhatsapp) { NexusSwal.showValidationMessage('Marque e-mail, WhatsApp ou os dois.'); return false; }
        return { porEmail, porWhatsapp };
      },
    });
    if (!r.isConfirmed || !r.value) return;
    const { porEmail, porWhatsapp } = r.value as { porEmail: boolean; porWhatsapp: boolean };
    // Abre a aba ANTES da chamada (o navegador bloqueia pop-up aberto depois de esperar o servidor).
    const aba = porWhatsapp ? window.open('', '_blank') : null;
    setOcupado(`enviar-${m.id}`);
    try {
      const resposta = await enviarCobranca(m.id, porEmail, porWhatsapp);
      if (resposta.whatsapp) {
        const url = `https://wa.me/${resposta.whatsapp.telefone}?text=${encodeURIComponent(resposta.whatsapp.texto)}`;
        if (aba) aba.location.href = url; else window.open(url, '_blank', 'noopener');
      }
      await onMudou();
      showSuccess(resposta.emailPara ? `Cobrança enviada para ${resposta.emailPara}.` : 'WhatsApp aberto com a cobrança.');
    } catch (e) {
      aba?.close();
      showError('Não foi possível enviar a cobrança', msg(e));
    } finally {
      setOcupado(null);
    }
  };

  const pedirLiberacao = async () => {
    const r = await NexusSwal.fire({
      title: 'Liberar sem pagamento',
      html: `<p style="margin:0 0 10px;">O sistema fica liberado até o dia escolhido. Se não pagar, bloqueia de novo no dia seguinte (no máximo 30 dias).</p>
        <label style="display:block;text-align:left;font-weight:600;margin-top:8px;">Liberado até
          <input type="date" id="lib-ate" class="swal2-input" min="${hoje}" style="margin:4px 0 0;width:100%;"></label>
        <label style="display:block;text-align:left;font-weight:600;margin-top:12px;">Motivo (ex.: prometeu pagar dia 28)
          <input type="text" id="lib-motivo" class="swal2-input" style="margin:4px 0 0;width:100%;"></label>`,
      showCancelButton: true,
      confirmButtonText: 'Liberar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const ate = (document.getElementById('lib-ate') as HTMLInputElement | null)?.value || '';
        const motivo = (document.getElementById('lib-motivo') as HTMLInputElement | null)?.value.trim() || '';
        if (!ate) { NexusSwal.showValidationMessage('Escolha até que dia fica liberado.'); return false; }
        if (!motivo) { NexusSwal.showValidationMessage('Informe o motivo.'); return false; }
        return { ate, motivo };
      },
    });
    if (!r.isConfirmed || !r.value) return;
    const { ate, motivo } = r.value as { ate: string; motivo: string };
    void rodar('liberar', () => liberarEmpresaAte(empresa.id, ate, motivo), `Liberado até ${formatarData(ate)}.`);
  };

  const ocupadoCom = (chave: string) => ocupado === chave;

  return (
    <Janela titulo={`Mensalidades — ${empresa.nome}`} onFechar={onFechar}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <span style={estiloSelo(COR_DA_ETAPA[situacao.etapa])}>
          {situacao.etapa === 'bloqueada' ? <Ban size={16} /> : situacao.etapa === 'em_dia' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {rotuloDaEtapa(situacao)}
          {empresa.resumo ? ` · bloqueio em ${formatarData(empresa.resumo.bloqueioEm)}` : ''}
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="btn-primary" onClick={() => { void pedirGerar(); }} disabled={ocupado !== null || !empresa.plano.diaVencimento}
            title={empresa.plano.diaVencimento ? 'Cria a mensalidade de um mês' : 'Defina o dia de vencimento abaixo antes'}>
            Gerar mensalidade
          </button>
          <MenuMaisOpcoes
            itens={[
              { texto: 'Liberar sem pagamento…', Icone: Clock, onClick: () => { void pedirLiberacao(); }, oculto: !empresa.resumo },
              {
                texto: `Retirar a liberação (até ${formatarData(empresa.plano.liberadoAte)})`,
                Icone: Ban,
                oculto: !empresa.plano.liberadoAte,
                onClick: () => { void rodar('liberar', () => liberarEmpresaAte(empresa.id, null, ''), 'Liberação retirada.'); },
              },
            ]}
          />
        </div>
      </div>

      <section style={{ padding: '14px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Cobrança da empresa</h3>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
            <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
            Cobrança ligada (cria a mensalidade todo mês, {ANTECEDENCIA_DE_GERACAO_DIAS} dias antes do vencimento)
          </label>
          <Campo rotulo="Dia do vencimento" largura="150px">
            <input type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} />
          </Campo>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Mensalidade atual: <strong>{formatarMoeda(empresa.valorTotal)}</strong> (muda na aba Empresas)</span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={proprios} onChange={(e) => setProprios(e.target.checked)} />
          Prazos próprios desta empresa (sem marcar: lembrete {prazosPadrao.diasLembreteAntes}, aviso {prazosPadrao.diasAvisoForte}, bloqueio {prazosPadrao.diasBloqueio})
        </label>
        {proprios && <CamposDosPrazos valor={prazos} onChange={setPrazos} />}
        <div>
          <button type="button" className="btn-secondary" onClick={salvarPlano} disabled={ocupado !== null}>
            {ocupadoCom('plano') ? 'Salvando…' : 'Salvar cobrança da empresa'}
          </button>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Mensalidades</h3>
        {!empresa.mensalidades.length && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>Nenhuma mensalidade ainda.</p>}
        {empresa.mensalidades.map((m) => {
          const vencida = m.situacao === 'aberta' && m.vencimento < hoje;
          return (
            <div key={m.id} style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ textTransform: 'capitalize' }}>{rotuloCompetencia(m.competencia)}</strong>
                  <span>{formatarMoeda(m.valor)}</span>
                  <span style={{ color: vencida ? '#ef4444' : 'var(--text-secondary)' }}>vence {formatarData(m.vencimento)}</span>
                  <span style={{ color: m.situacao === 'paga' ? '#10b981' : m.situacao === 'cancelada' ? 'var(--text-muted)' : vencida ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                    {ROTULO_SITUACAO[m.situacao]}{m.pagoEm ? ` em ${formatarData(m.pagoEm)}` : ''}
                  </span>
                  {m.situacao === 'aberta' && (
                    <span style={{ fontSize: '12px', color: temBoleto(m.boleto) ? 'var(--text-muted)' : '#f59e0b' }}>
                      {temBoleto(m.boleto) ? `Boleto: ${[m.boleto.pdfUrl && 'PDF', m.boleto.linhaDigitavel && 'linha', m.boleto.link && 'link', m.boleto.pixCopiaECola && 'Pix'].filter(Boolean).join(', ')}` : 'Sem boleto'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {m.situacao === 'aberta' && (
                    <>
                      <button type="button" className="btn-secondary" onClick={() => setBoletoDe(m)} disabled={ocupado !== null} style={{ fontSize: '13px', padding: '6px 12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <FileText size={14} /> Boleto
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => { void pedirEnvio(m); }} disabled={ocupado !== null} style={{ fontSize: '13px', padding: '6px 12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <Send size={14} /> {ocupadoCom(`enviar-${m.id}`) ? 'Enviando…' : 'Enviar cobrança'}
                      </button>
                      <button type="button" className="btn-primary" onClick={() => { void pedirPagamento(m); }} disabled={ocupado !== null} style={{ fontSize: '13px', padding: '6px 12px' }}>
                        Marcar paga
                      </button>
                    </>
                  )}
                  <MenuMaisOpcoes
                    compacto
                    rotulo={`Mais opções de ${rotuloCompetencia(m.competencia)}`}
                    itens={[
                      { texto: 'Ver histórico', Icone: Clock, onClick: () => setHistoricoDe(historicoDe === m.id ? null : m.id) },
                      { texto: 'Abrir o PDF do boleto', Icone: FileText, oculto: !m.boleto.pdfUrl, onClick: () => { window.open(m.boleto.pdfUrl, '_blank', 'noopener'); } },
                      {
                        texto: 'Desfazer pagamento', Icone: RefreshCw, oculto: m.situacao !== 'paga',
                        onClick: () => { void pedirMotivo('Desfazer pagamento', 'Desfazer').then((motivo) => { if (motivo) void rodar(`desfazer-${m.id}`, () => desfazerPagamento(m.id, motivo), 'Pagamento desfeito: a mensalidade voltou a ficar em aberto.'); }); },
                      },
                      {
                        texto: 'Cancelar mensalidade', Icone: Ban, perigo: true, separadorAntes: true, oculto: m.situacao !== 'aberta',
                        onClick: () => { void pedirMotivo('Cancelar mensalidade', 'Cancelar mensalidade').then((motivo) => { if (motivo) void rodar(`cancelar-${m.id}`, () => cancelarMensalidade(m.id, motivo), 'Mensalidade cancelada.'); }); },
                      },
                    ]}
                  />
                </div>
              </div>
              {historicoDe === m.id && (
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {m.eventos.map((ev) => (
                    <li key={`${ev.em}-${ev.tipo}`}>
                      {new Date(ev.em).toLocaleString('pt-BR')} — {ROTULO_EVENTO[ev.tipo] || ev.tipo}{ev.detalhe ? `: ${ev.detalhe}` : ''} ({ev.por})
                    </li>
                  ))}
                  {!m.eventos.length && <li>Sem registros.</li>}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {boletoDe && (
        <BoletoDaMensalidadeJanela
          mensalidade={boletoDe}
          onFechar={() => setBoletoDe(null)}
          onSalvo={async () => { setBoletoDe(null); await onMudou(); }}
        />
      )}
    </Janela>
  );
};

const BoletoDaMensalidadeJanela: React.FC<{ mensalidade: MensalidadeDaTela; onFechar: () => void; onSalvo: () => Promise<void> }> = ({ mensalidade, onFechar, onSalvo }) => {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linha, setLinha] = useState(mensalidade.boleto.linhaDigitavel ? formatarLinhaDigitavel(mensalidade.boleto.linhaDigitavel) : '');
  const [link, setLink] = useState(mensalidade.boleto.link || '');
  const [pix, setPix] = useState(mensalidade.boleto.pixCopiaECola || '');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    // Confere antes de subir o PDF: erro de digitacao nao deixa arquivo solto no Storage.
    const previa = validarBoletoDigitado({
      pdfUrl: arquivo ? 'https://pendente' : mensalidade.boleto.pdfUrl,
      linhaDigitavel: linha,
      link,
      pixCopiaECola: pix,
    });
    if ('erro' in previa) { showError('Confira o boleto', previa.erro); return; }
    setSalvando(true);
    try {
      const pdf = arquivo
        ? await subirPdfDoBoleto(mensalidade.tenantId, mensalidade.id, arquivo)
        : { pdfUrl: mensalidade.boleto.pdfUrl, pdfCaminho: mensalidade.boleto.pdfCaminho };
      await anexarBoleto(mensalidade.id, { ...pdf, linhaDigitavel: linha, link, pixCopiaECola: pix });
      showSuccess('Boleto anexado. A empresa já vê o boleto no sistema.');
      await onSalvo();
    } catch (e) {
      showError('Não foi possível anexar o boleto', msg(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Janela titulo={`Boleto — ${rotuloCompetencia(mensalidade.competencia)} (${formatarMoeda(mensalidade.valor)})`} onFechar={onFechar} largura={640}>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Gere o boleto no PicPay PJ e anexe aqui o PDF e a linha digitável. O link de pagamento e o Pix copia e cola são opcionais.
      </p>
      <Campo rotulo={mensalidade.boleto.pdfUrl ? 'PDF do boleto (já anexado; escolha outro para trocar)' : 'PDF do boleto'}>
        <input type="file" accept="application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
      </Campo>
      <Campo rotulo="Linha digitável">
        <input value={linha} onChange={(e) => setLinha(e.target.value)} inputMode="numeric" />
      </Campo>
      <Campo rotulo="Link de pagamento do PicPay (opcional)">
        <input value={link} onChange={(e) => setLink(e.target.value)} />
      </Campo>
      <Campo rotulo="Pix copia e cola (opcional)">
        <textarea rows={3} value={pix} onChange={(e) => setPix(e.target.value)} />
      </Campo>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" className="btn-secondary" onClick={onFechar}>Cancelar</button>
        <button type="button" className="btn-primary" onClick={() => { void salvar(); }} disabled={salvando}>{salvando ? 'Anexando…' : 'Anexar boleto'}</button>
      </div>
    </Janela>
  );
};

export default SuperAdminMensalidades;

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../../utils/fetchComTimeout';

/**
 * SITUACAO DOS BACKUPS DE TODAS AS EMPRESAS (12/11/2026).
 *
 * O painel so' mostrava uma empresa por vez, o backup automatico vinha
 * desligado e as filiais nem apareciam: nao havia como saber quem estava sem
 * backup. Este quadro lista toda empresa e filial com o ultimo backup, se a
 * copia externa saiu e se esta' em dia -- e avisa no topo quando alguma nao
 * esta'. So' a equipe da plataforma ve (rota /api/backups/resumo).
 */

type Situacao = 'em_dia' | 'atrasado' | 'nunca' | 'desligado';

interface EmpresaDoResumo {
  id: string;
  nome: string;
  automatico: { enabled: boolean; frequency: 'diario' | 'semanal' | 'mensal'; time: string; padrao: boolean };
  ultimoBackup: { createdAt: string; status: string; filename: string; sizeBytes: number; externo: 'enviado' | 'erro' | 'nao_configurado' } | null;
  emAndamento: boolean;
  situacao: Situacao;
  diasSemBackup: number | null;
}

interface Resumo {
  externoConfigurado: boolean;
  contagem: { total: number; emDia: number; atrasados: number; nunca: number; desligados: number };
  empresas: EmpresaDoResumo[];
}

interface Props {
  apiUrl: string;
  obterCabecalhos: () => Promise<Record<string, string>>;
  empresaSelecionada: string;
  onEscolherEmpresa: (id: string) => void;
  /** Muda quando o painel fez algo (gerou, restaurou, salvou): recarrega o quadro. */
  versao: number;
}

const ROTULO: Record<Situacao, { texto: string; cor: string }> = {
  em_dia: { texto: 'Em dia', cor: '#10b981' },
  atrasado: { texto: 'Atrasado', cor: '#ef4444' },
  nunca: { texto: 'Sem nenhum backup', cor: '#ef4444' },
  desligado: { texto: 'Automático desligado', cor: '#f59e0b' },
};
const ORDEM: Record<Situacao, number> = { atrasado: 0, nunca: 1, desligado: 2, em_dia: 3 };
const FREQUENCIA = { diario: 'Diário', semanal: 'Semanal', mensal: 'Mensal' } as const;

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const SituacaoDosBackups: React.FC<Props> = ({ apiUrl, obterCabecalhos, empresaSelecionada, onEscolherEmpresa, versao }) => {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [soProblemas, setSoProblemas] = useState(false);

  const carregar = useCallback(async () => {
    if (!apiUrl) return;
    setCarregando(true);
    setErro('');
    try {
      const resposta = await fetchComTimeout(`${apiUrl}/api/backups/resumo`, { headers: await obterCabecalhos() });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) { setErro(dados.error || 'Não foi possível carregar a situação dos backups.'); return; }
      setResumo(dados as Resumo);
    } catch (falha) {
      setErro(mensagemDeFalhaDeRede(falha, 'Não foi possível falar com o servidor de backup.'));
    } finally {
      setCarregando(false);
    }
    // obterCabecalhos muda de identidade a cada desenho do painel; o que importa e' a versao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, versao]);

  useEffect(() => { void carregar(); }, [carregar]);

  const problemas = resumo ? resumo.contagem.atrasados + resumo.contagem.nunca : 0;
  const empresas = resumo
    ? [...resumo.empresas].sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || a.nome.localeCompare(b.nome, 'pt-BR')).filter((e) => !soProblemas || e.situacao !== 'em_dia')
    : [];

  return (
    <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <ShieldCheck size={24} color="#8b5cf6" />
          Situação dos backups de todas as empresas
        </h3>
        <button type="button" className="btn-secondary" onClick={() => void carregar()} disabled={carregando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {erro && <div role="alert" style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid #ef4444', color: 'var(--text-primary)', fontSize: '14px' }}>{erro}</div>}

      {resumo && (
        <>
          <div role="status" style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '8px', border: `1px solid ${problemas > 0 ? '#ef4444' : '#10b981'}`, backgroundColor: problemas > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)' }}>
            {problemas > 0 ? <AlertTriangle size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} /> : <CheckCircle2 size={20} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />}
            <div style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
              {problemas > 0
                ? <><strong>{problemas} de {resumo.contagem.total} {problemas === 1 ? 'empresa está' : 'empresas estão'} sem backup em dia.</strong> O servidor faz o backup sozinho na próxima ronda (a cada 10 minutos, até 3 empresas por vez). Se continuar assim, abra a empresa abaixo e veja o histórico.</>
                : <><strong>Todas as {resumo.contagem.emDia} empresas com backup automático estão em dia.</strong></>}
              {resumo.contagem.desligados > 0 && <> {resumo.contagem.desligados} {resumo.contagem.desligados === 1 ? 'empresa está' : 'empresas estão'} com o backup automático desligado.</>}
            </div>
          </div>

          {!resumo.externoConfigurado && (
            <div role="alert" style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 16px', borderRadius: '8px', border: '1px solid #f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
              <CloudOff size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                <strong>A cópia externa ainda não está ligada.</strong> Hoje os backups ficam só no mesmo projeto do banco. Para ligar, cadastre no servidor as variáveis BACKUP_EXTERNO_ENDPOINT, _REGIAO, _BUCKET, _CHAVE_ID e _CHAVE_SECRETA de um armazenamento em outra conta.
              </div>
            </div>
          )}

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer', width: 'fit-content' }}>
            <input type="checkbox" checked={soProblemas} onChange={(e) => setSoProblemas(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#8b5cf6' }} />
            Mostrar só as que não estão em dia
          </label>

          <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Empresa</th>
                  <th style={{ padding: '12px' }}>Automático</th>
                  <th style={{ padding: '12px' }}>Último backup</th>
                  <th style={{ padding: '12px' }}>Cópia externa</th>
                  <th style={{ padding: '12px' }}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {empresas.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Nenhuma empresa nesta lista.</td></tr>
                )}
                {empresas.map((e) => {
                  const rotulo = ROTULO[e.situacao];
                  const escolhida = e.id === empresaSelecionada;
                  return (
                    <tr
                      key={e.id}
                      onClick={() => onEscolherEmpresa(e.id)}
                      title="Abrir o histórico e a configuração desta empresa"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', backgroundColor: escolhida ? 'rgba(139, 92, 246, 0.10)' : 'transparent' }}
                    >
                      <td style={{ padding: '12px', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{e.nome}</td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {e.automatico.enabled ? `${FREQUENCIA[e.automatico.frequency]}, ${e.automatico.time}` : 'Desligado'}
                        {e.automatico.padrao && <span style={{ color: 'var(--text-muted)' }}> (padrão)</span>}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {e.emAndamento ? 'Gerando agora...' : e.ultimoBackup ? dataHora(e.ultimoBackup.createdAt) : '—'}
                        {e.ultimoBackup?.status === 'pendente' && <div style={{ color: '#f59e0b' }}>aguardando envio à nuvem</div>}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600, color: e.ultimoBackup?.externo === 'enviado' ? '#10b981' : e.ultimoBackup?.externo === 'erro' ? '#ef4444' : 'var(--text-muted)' }}>
                        {!e.ultimoBackup ? '—' : e.ultimoBackup.externo === 'enviado' ? 'Enviada' : e.ultimoBackup.externo === 'erro' ? 'Falhou (tenta de novo em 1 hora)' : 'Não ligada'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ backgroundColor: `${rotulo.cor}1a`, color: rotulo.cor, padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {rotulo.texto}{e.situacao === 'atrasado' && e.diasSemBackup !== null ? ` · ${e.diasSemBackup} ${e.diasSemBackup === 1 ? 'dia' : 'dias'}` : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default SituacaoDosBackups;

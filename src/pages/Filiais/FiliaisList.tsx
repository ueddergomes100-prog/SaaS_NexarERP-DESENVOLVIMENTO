import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, LogIn, Pencil, Plus, Power } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { limparAbasSalvas } from '../../contexts/TabsContext';
import { alterarFilial, carregarFiliais, type ResumoDasFiliais } from '../../services/filialService';
import { rotuloFilial, type FilialDoGrupo } from '../../utils/filialDomain';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import EstadoVazio from '../../components/common/EstadoVazio';
import FilialFormModal from './FilialFormModal';
import ResumoDoGrupo from './ResumoDoGrupo';

const formatarCnpj = (cnpj: string) => (
  cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj
);

/**
 * FILIAIS (2026-10-06) -- Configuracoes → Filiais. Lista as filiais do grupo
 * (como a "Consulta de Filial" do Integra: codigo, nome, ativa, "Mostrar
 * inativas"), cadastra, edita, inativa e deixa entrar numa filial. So' o dono
 * e os administradores mexem; o servidor confere de novo.
 */
const FiliaisList: React.FC = () => {
  const { ehGestorDasFiliais, filialAtual, trocarFilial } = useAuth();
  const [resumo, setResumo] = useState<ResumoDasFiliais | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<FilialDoGrupo | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setResumo(await carregarFiliais());
    } catch (erro) {
      showError('Não foi possível carregar as filiais', erro instanceof Error ? erro.message : undefined);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void recarregar(); }, [recarregar]);

  const filiais = useMemo(() => {
    const todas = resumo?.todasAsFiliais?.length ? resumo.todasAsFiliais : (resumo?.filiais ?? []);
    return mostrarInativas ? todas : todas.filter((f) => f.ativa);
  }, [resumo, mostrarInativas]);
  const inativas = (resumo?.todasAsFiliais ?? []).filter((f) => !f.ativa).length;
  const semGrupo = Boolean(resumo && !resumo.grupo);
  // Plano (07/10): vagas de filial alem da matriz.
  const limite = resumo?.limiteFiliais ?? 0;
  const emUso = resumo?.filiaisEmUso ?? 0;
  const semVaga = Boolean(resumo) && emUso >= limite;

  const abrirNova = () => { setEmEdicao(null); setFormAberto(true); };
  const abrirEdicao = (filial: FilialDoGrupo) => { setEmEdicao(filial); setFormAberto(true); };

  const alternarSituacao = async (filial: FilialDoGrupo) => {
    const inativar = filial.ativa;
    const resposta = await NexusSwal.fire({
      title: inativar ? `Inativar a filial ${rotuloFilial(filial)}?` : `Reativar a filial ${rotuloFilial(filial)}?`,
      html: inativar
        ? 'Ninguém consegue entrar nela enquanto estiver inativa. Vendas, notas e financeiro dela continuam guardados.'
        : `A filial <strong>${escaparHtml(filial.nome)}</strong> volta a aparecer no seletor do topo.`,
      icon: inativar ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: inativar ? 'Inativar filial' : 'Reativar filial',
      cancelButtonText: 'Cancelar',
    });
    if (!resposta.isConfirmed) return;
    try {
      await alterarFilial(filial.tenantId, { ativa: !inativar });
      showSuccess(inativar ? 'Filial inativada.' : 'Filial reativada.');
      await recarregar();
    } catch (erro) {
      showError('Não foi possível mudar a situação da filial', erro instanceof Error ? erro.message : undefined);
    }
  };

  const entrar = async (filial: FilialDoGrupo) => {
    const resposta = await NexusSwal.fire({
      title: `Entrar na filial ${rotuloFilial(filial)}?`,
      html: 'As abas abertas serão fechadas. Salve antes o que estiver editando.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Entrar na filial',
      cancelButtonText: 'Cancelar',
    });
    if (!resposta.isConfirmed) return;
    try {
      await trocarFilial(filial.tenantId);
      limparAbasSalvas();
      window.location.assign('/dashboard');
    } catch (erro) {
      showError('Não foi possível trocar de filial', erro instanceof Error ? erro.message : undefined);
    }
  };

  if (!carregando && semGrupo && limite === 0) {
    return (
      <div className="card" style={{ padding: '32px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <EstadoVazio titulo="Filiais não estão liberadas no plano da sua empresa." texto="Fale com o suporte para contratar filiais. Depois da liberação, o menu Configurações → Filiais passa a cadastrar lojas e depósitos da mesma empresa." />
      </div>
    );
  }

  if (!carregando && !ehGestorDasFiliais) {
    return (
      <div className="card" style={{ padding: '32px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <EstadoVazio titulo="Só o dono ou um administrador da empresa cadastra filiais." texto="Para trocar de filial, use o seletor no topo da tela." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <Building2 size={26} style={{ color: 'var(--accent-purple)' }} /> Filiais
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '6px', maxWidth: '680px' }}>
            Lojas e depósitos da mesma empresa. Cada filial tem vendas, notas, financeiro, caixa e numeração próprios.
            As configurações de cada uma ficam em Configurações, dentro dela.
          </p>
        </div>
        {!semGrupo && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            <button className="btn-primary" onClick={abrirNova} disabled={semVaga} title={semVaga ? 'Todas as filiais do plano estão em uso' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={20} /> Nova filial
            </button>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {emUso} de {limite} {limite === 1 ? 'filial' : 'filiais'} do plano em uso{semVaga ? ' · fale com o suporte para aumentar' : ''}
            </span>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        {carregando ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>
        ) : semGrupo ? (
          <EstadoVazio
            titulo="Sua empresa ainda não tem filiais"
            texto="Cadastre a primeira filial (outra loja ou um depósito). A empresa atual vira a matriz, com o código 10."
            acao={semVaga ? undefined : { rotulo: 'Cadastrar a primeira filial', onClick: abrirNova, icone: <Plus size={16} /> }}
          />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '15px' }}>{resumo?.grupo?.nome}</strong>
              {inativas > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} style={{ accentColor: 'var(--accent-purple)' }} />
                  Mostrar filiais inativas ({inativas})
                </label>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '12px 14px', width: '70px' }}>Cód.</th>
                    <th style={{ padding: '12px 14px' }}>Filial</th>
                    <th style={{ padding: '12px 14px' }}>CNPJ</th>
                    <th style={{ padding: '12px 14px' }}>Cidade</th>
                    <th style={{ padding: '12px 14px' }}>Situação</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filiais.map((f) => {
                    const atual = f.tenantId === filialAtual?.tenantId;
                    return (
                      <tr key={f.tenantId} style={{ borderBottom: '1px solid var(--border-color)', opacity: f.ativa ? 1 : 0.6 }}>
                        <td style={{ padding: '12px 14px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f.codigo}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 600 }}>{f.nome}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {f.matriz ? 'Matriz' : f.tipo === 'mesmo_cnpj' ? 'Mesmo CNPJ da matriz' : 'CNPJ próprio'}
                            {atual ? ' · você está aqui' : ''}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{formatarCnpj(f.cnpj)}</td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{[f.cidade, f.uf].filter(Boolean).join(' · ')}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                            background: f.ativa ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-tertiary)', color: f.ativa ? '#10b981' : 'var(--text-muted)',
                          }}
                          >
                            {f.ativa ? 'Ativa' : 'Inativa'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                            {f.ativa && !atual && (
                              <button type="button" className="btn-secondary" onClick={() => { void entrar(f); }} title="Entrar nesta filial" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '12px' }}>
                                <LogIn size={14} /> Entrar
                              </button>
                            )}
                            <button type="button" className="btn-secondary" onClick={() => abrirEdicao(f)} title="Editar cadastro" aria-label={`Editar filial ${rotuloFilial(f)}`} style={{ padding: '6px 10px', display: 'inline-flex' }}>
                              <Pencil size={14} />
                            </button>
                            {!f.matriz && (
                              <button type="button" className="btn-secondary" onClick={() => { void alternarSituacao(f); }} title={f.ativa ? 'Inativar filial' : 'Reativar filial'} aria-label={f.ativa ? `Inativar filial ${rotuloFilial(f)}` : `Reativar filial ${rotuloFilial(f)}`} style={{ padding: '6px 10px', display: 'inline-flex', color: f.ativa ? '#ef4444' : '#10b981' }}>
                                <Power size={14} />
                              </button>
                            )}
                          </div>
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

      {!carregando && !semGrupo && <ResumoDoGrupo filialAtualId={filialAtual?.tenantId} />}

      <FilialFormModal
        aberto={formAberto}
        filial={emEdicao}
        proximoCodigo={resumo?.proximoCodigo || '20'}
        primeiraFilial={semGrupo}
        onFechar={() => setFormAberto(false)}
        onSalvo={() => { setFormAberto(false); void recarregar(); }}
      />
    </div>
  );
};

export default FiliaisList;

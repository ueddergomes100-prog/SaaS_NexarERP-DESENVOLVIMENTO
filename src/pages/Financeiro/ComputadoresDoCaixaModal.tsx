import React, { useEffect, useState } from 'react';
import { MonitorCheck, MonitorX, X } from 'lucide-react';
import { desativarComputadorDoCaixa, listarComputadoresDoCaixa, type ComputadorDoCaixa } from '../../services/terminalCaixaService';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';

/**
 * Computadores ativados como caixa (22/11/2026): onde cada funcionario entra
 * so' com codigo e senha. Desativar um (computador trocado, roubado, que saiu
 * da loja) faz ele voltar a pedir usuario e senha -- ninguem mais entra nele
 * com codigo ate' um gerente ativar de novo. Ativar e' feito no proprio
 * computador, na tela de entrada do caixa.
 */
const dataHora = (ms: number | null) => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const ComputadoresDoCaixaModal: React.FC<{ onFechar: () => void }> = ({ onFechar }) => {
  const [lista, setLista] = useState<ComputadorDoCaixa[] | null>(null);
  const [erro, setErro] = useState('');

  const carregar = () => {
    setErro('');
    listarComputadoresDoCaixa()
      .then(setLista)
      .catch((e) => { setErro(e instanceof Error ? e.message : 'Não foi possível carregar os computadores do caixa.'); setLista([]); });
  };
  useEffect(carregar, []);

  const desativar = async (computador: ComputadorDoCaixa) => {
    const resposta = await NexusSwal.fire({
      title: `Desativar "${computador.nome}"?`,
      text: 'Ninguém mais entra neste computador com código e senha; ele volta a pedir usuário e senha. Para usar de novo, um gerente ativa outra vez na tela de entrada do caixa.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Desativar',
      cancelButtonText: 'Voltar',
    });
    if (!resposta.isConfirmed) return;
    try {
      await desativarComputadorDoCaixa(computador.id);
      showSuccess(`"${computador.nome}" desativado.`);
      carregar();
    } catch (e) {
      showError('Não foi possível desativar', e instanceof Error ? e.message : 'Tente de novo em instantes.');
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Computadores do caixa" onClick={onFechar}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 'min(760px, 100%)', maxHeight: '85vh', overflow: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Computadores do caixa</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Nestes computadores cada funcionário entra só com o código e a senha dele (cadastrados em Usuários).
              Para ativar outro, abra a Frente de Caixa nele e use "Ative-o como caixa" na tela de entrada.
            </p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        {lista === null && <p style={{ margin: 0, color: 'var(--text-muted)' }}>Carregando…</p>}
        {erro && <p style={{ margin: 0, color: '#f87171' }}>{erro}</p>}
        {lista && lista.length === 0 && !erro && (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhum computador ativado ainda.</p>
        )}
        {lista && lista.length > 0 && (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>Computador</th><th>Situação</th><th>Último uso</th><th>Último operador</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.55 }}>
                  <td className="font-medium">{c.nome}</td>
                  <td>
                    {c.ativo
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#10b981', fontWeight: 600 }}><MonitorCheck size={15} /> Ativo</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}><MonitorX size={15} /> Desativado</span>}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{dataHora(c.ultimoUsoEmMs)}</td>
                  <td>{c.ultimoOperadorNome || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {c.ativo && (
                      <button type="button" className="btn-secondary" onClick={() => void desativar(c)}>Desativar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
};

export default ComputadoresDoCaixaModal;

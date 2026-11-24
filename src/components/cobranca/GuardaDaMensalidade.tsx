import React from 'react';
import { Lock, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { TEXTO_BLOQUEIO_FUNCIONARIO, textoDoAviso } from '../../utils/mensalidadeDomain';
import { useSituacaoDaCobranca } from './useSituacaoDaCobranca';
import PagamentoDaMensalidade from './PagamentoDaMensalidade';

/**
 * BLOQUEIO POR MENSALIDADE EM ATRASO (24/11/2026, decisao do dono): tela
 * inteira, no sistema, na Frente de Caixa e no app Vendas/tecnico/motorista.
 * Dono e administrador veem o boleto; o resto da equipe, so' o aviso para
 * chamar o responsavel. A trava de verdade mora nas firestore.rules e no
 * servidor (cobrancaBloqueioEm no perfil); esta tela so' explica o que houve.
 * O admin da plataforma nunca cai aqui (useSituacaoDaCobranca).
 */
const TelaBloqueioMensalidade: React.FC = () => {
  const { resumo, situacao, quemPaga } = useSituacaoDaCobranca();
  const { logout } = useAuth();
  if (!resumo) return null;
  const aviso = textoDoAviso(resumo, situacao);
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '620px', padding: '28px', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Lock size={26} />
          </div>
          <h1 style={{ margin: 0, fontSize: '21px' }}>Sistema bloqueado</h1>
        </div>
        <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {quemPaga ? aviso.texto : TEXTO_BLOQUEIO_FUNCIONARIO}
        </p>
        {quemPaga && <PagamentoDaMensalidade resumo={resumo} />}
        <div>
          <button type="button" className="btn-secondary" onClick={() => { void logout(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <LogOut size={16} /> Sair
          </button>
        </div>
      </div>
    </div>
  );
};

const GuardaDaMensalidade: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { resumo, situacao } = useSituacaoDaCobranca();
  if (resumo && situacao.etapa === 'bloqueada') return <TelaBloqueioMensalidade />;
  return <>{children}</>;
};

export default GuardaDaMensalidade;

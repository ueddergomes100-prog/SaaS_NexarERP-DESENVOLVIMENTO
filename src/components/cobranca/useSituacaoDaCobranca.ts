import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hojeEmBrasilia, situacaoDaCobranca, veAvisoDeCobranca } from '../../utils/mensalidadeDomain';

/**
 * Situacao da mensalidade da empresa logada (24/11/2026). O resumo vem do
 * proprio perfil (AuthContext); o dia e' conferido a cada minuto para o aviso
 * e o bloqueio virarem sozinhos a meia-noite, sem recarregar a tela.
 * O admin da plataforma nunca ve aviso nem bloqueio.
 */
export const useSituacaoDaCobranca = () => {
  const { cobrancaEmpresa, userRole, isPlatformAdmin } = useAuth();
  const [hoje, setHoje] = useState(hojeEmBrasilia);

  useEffect(() => {
    const relogio = window.setInterval(() => setHoje(hojeEmBrasilia()), 60_000);
    return () => window.clearInterval(relogio);
  }, []);

  const resumo = isPlatformAdmin ? null : cobrancaEmpresa;
  const situacao = useMemo(() => situacaoDaCobranca(resumo, hoje), [resumo, hoje]);
  return { resumo, situacao, hoje, quemPaga: veAvisoDeCobranca(userRole) };
};

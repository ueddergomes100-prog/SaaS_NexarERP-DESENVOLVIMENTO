import React, { useEffect, useState } from 'react';

/**
 * CAMPO DE BUSCA QUE SO' AVISA A TELA QUANDO A PESSOA PARA DE DIGITAR
 * (24/11/2026, mesma ideia do useTermoAdiado de 17/11).
 *
 * Para telas que refazem contas pesadas a cada mudanca da busca (o Contas a
 * Receber reagrupa todos os titulos e recalcula juros e multa: ~80 ms por
 * tecla com 500 clientes). O texto aparece no campo na hora; a tela so' e'
 * avisada depois de `esperaMs` sem tecla. Apagar tudo vale na hora.
 *
 * Diferenca para o useTermoAdiado: la' a tela ainda redesenha a cada tecla (o
 * texto mora nela). Aqui o texto mora no campo, e a tela so' redesenha na pausa.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valor: string;
  /** Use uma funcao estavel (o proprio setState da tela). */
  aoMudar: (valor: string) => void;
  esperaMs?: number;
};

const CampoBuscaAdiado: React.FC<Props> = ({ valor, aoMudar, esperaMs = 250, ...resto }) => {
  const [local, setLocal] = useState(valor);
  // A tela mudou o valor por fora (ex.: "Limpar filtros"): o campo acompanha.
  const [valorVisto, setValorVisto] = useState(valor);
  if (valor !== valorVisto) {
    setValorVisto(valor);
    setLocal(valor);
  }

  useEffect(() => {
    if (local === valor) return undefined;
    if (local.trim() === '') { aoMudar(local); return undefined; }
    const espera = window.setTimeout(() => aoMudar(local), esperaMs);
    return () => window.clearTimeout(espera);
  }, [local, valor, aoMudar, esperaMs]);

  return <input type="text" {...resto} value={local} onChange={(evento) => setLocal(evento.target.value)} />;
};

export default CampoBuscaAdiado;

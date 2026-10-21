import React, { useCallback, useState } from 'react';
import EscolherRotaModal from '../components/romaneio/EscolherRotaModal';
import { listarRotasAbertas } from '../services/rotaPreVendaService';
import {
  decidirRota,
  perguntaRotaNaPreVenda,
  preVendaEntraNaRota,
  type ModoRotaPreVenda,
  type RotaAberta,
} from '../utils/rotaPreVendaDomain';

/**
 * Pergunta a rota antes de gravar/enviar a pre-venda (rotaPreVendaDomain.ts):
 * mais de uma rota em montagem -> abre o modal; so' uma -> volta ela sem
 * perguntar; nenhuma (ou sem conseguir ler) -> sem rota. Usado no Pedido de
 * Venda e no app Vendas.
 */
export type EscolhaDeRota =
  | { cancelou: true }
  | { cancelou: false; rota: RotaAberta | null; semLista: boolean };

interface Pendente {
  rotas: RotaAberta[];
  entraAgora: boolean;
  resolver: (escolha: EscolhaDeRota) => void;
}

export const useEscolhaDeRota = (modo: ModoRotaPreVenda) => {
  const [pendente, setPendente] = useState<Pendente | null>(null);

  const escolherRota = useCallback(async (): Promise<EscolhaDeRota> => {
    if (!perguntaRotaNaPreVenda(modo)) return { cancelou: false, rota: null, semLista: false };
    let rotas: RotaAberta[];
    try {
      rotas = await listarRotasAbertas();
    } catch {
      // Sem sinal ou servidor fora: o pedido segue; no envio/faturamento o
      // servidor decide a rota de novo.
      return { cancelou: false, rota: null, semLista: true };
    }
    const decisao = decidirRota(rotas);
    if (decisao.acao === 'automatica') return { cancelou: false, rota: decisao.rota, semLista: false };
    if (decisao.acao === 'sem_rota') return { cancelou: false, rota: null, semLista: false };
    return new Promise<EscolhaDeRota>((resolver) => {
      setPendente({ rotas: decisao.rotas, entraAgora: preVendaEntraNaRota(modo), resolver });
    });
  }, [modo]);

  const responder = (escolha: EscolhaDeRota) => {
    pendente?.resolver(escolha);
    setPendente(null);
  };

  const modalDeRota = pendente ? (
    <EscolherRotaModal
      rotas={pendente.rotas}
      entraAgora={pendente.entraAgora}
      onEscolher={(rota) => responder({ cancelou: false, rota, semLista: false })}
      onSemRota={() => responder({ cancelou: false, rota: null, semLista: false })}
      onCancelar={() => responder({ cancelou: true })}
    />
  ) : null;

  return { escolherRota, modalDeRota };
};

import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { lerComReserva } from '../../services/consultaComReserva';
import RelatorioPreview from '../Reports/RelatorioPreview';
import { NexusSwal } from '../../utils/alerts';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { validarDataBaixa } from '../../utils/baixaFinanceiraDomain';
import { montarDocumentoDeRecebimentos, type FiltroDeRecebimentos } from '../../utils/relatorioRecebimentosDomain';
import type { TransacaoRelatorioFinanceiro } from '../../utils/relatorioFinanceiroDomain';

/*
 * RECEBIMENTOS DO PERIODO (24/11/2026, pedido do dono para a Jomarly):
 * Financeiro > Contas a Receber > Mais opcoes > Recebimentos. A conta esta' em
 * utils/relatorioRecebimentosDomain.ts.
 */

const ESTILO_ROTULO = 'display:block;text-align:left;font-size:13px;margin-top:12px;color:var(--text-secondary);';
const ESTILO_CAMPO = 'width:100%;margin:6px 0 0;box-sizing:border-box;';

/** Pergunta o periodo (abre em hoje). Devolve null se a pessoa cancelar. */
export const pedirPeriodoDosRecebimentos = async (): Promise<FiltroDeRecebimentos | null> => {
  const hoje = getDateInputInTimeZone();
  const resultado = await NexusSwal.fire({
    title: 'Recebimentos',
    html: `
      <div style="text-align:left;font-size:13.5px;color:var(--text-secondary);">Para os recebimentos de hoje, é só confirmar. Para outro dia ou um período, troque as datas.</div>
      <label for="receb-de" style="${ESTILO_ROTULO}">De</label>
      <input id="receb-de" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${ESTILO_CAMPO}" />
      <label for="receb-ate" style="${ESTILO_ROTULO}">Até</label>
      <input id="receb-ate" type="date" class="swal2-input" value="${hoje}" max="${hoje}" style="${ESTILO_CAMPO}" />
      <label style="display:flex;align-items:center;gap:8px;text-align:left;font-size:13.5px;margin-top:14px;color:var(--text-primary);cursor:pointer;">
        <input id="receb-so-contas" type="checkbox" style="width:16px;height:16px;" />
        Só contas a receber baixadas (sem venda e OS recebidas na hora)
      </label>`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Gerar relatório',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const inicio = (document.getElementById('receb-de') as HTMLInputElement | null)?.value || '';
      const fim = (document.getElementById('receb-ate') as HTMLInputElement | null)?.value || '';
      const erro = validarDataBaixa(inicio, hoje) || validarDataBaixa(fim, hoje);
      if (erro) {
        NexusSwal.showValidationMessage('Informe as duas datas (até hoje).');
        return false;
      }
      if (inicio > fim) {
        NexusSwal.showValidationMessage('A data "De" precisa ser igual ou anterior à data "Até".');
        return false;
      }
      const somenteContas = Boolean((document.getElementById('receb-so-contas') as HTMLInputElement | null)?.checked);
      return { inicio, fim, somenteContas } as FiltroDeRecebimentos;
    },
  });
  return resultado.isConfirmed ? (resultado.value as FiltroDeRecebimentos) : null;
};

interface Props {
  tenantId: string;
  filtro: FiltroDeRecebimentos;
  onFechar: () => void;
}

const RelatorioRecebimentos: React.FC<Props> = ({ tenantId, filtro, onFechar }) => {
  const [entradas, setEntradas] = useState<TransacaoRelatorioFinanceiro[]>([]);
  const [saidas, setSaidas] = useState<TransacaoRelatorioFinanceiro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      setCarregando(true);
      setErro('');
      try {
        // Pagos no periodo pela data do pagamento e, nos que nao tem, pela data
        // (mesma leitura de Relatorios Diversos > Recebimentos).
        const doTipo = async (tipo: 'entrada' | 'saida') => {
          const todos = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('tipo', '==', tipo), where('status', '==', 'Paga'));
          const snaps = await Promise.all(['dataPagamento', 'data'].map((campo) => lerComReserva(
            query(todos, where(campo, '>=', filtro.inicio), where(campo, '<=', filtro.fim)),
            todos,
            `Recebimentos (${tipo} por ${campo})`,
          )));
          const porId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
          snaps.forEach((snap) => snap.docs.forEach((d) => porId.set(d.id, d)));
          return Array.from(porId.values()).map((d) => ({ id: d.id, ...d.data() }) as TransacaoRelatorioFinanceiro);
        };
        const [lidasEntradas, lidasSaidas] = await Promise.all([doTipo('entrada'), doTipo('saida')]);
        if (cancelado) return;
        setEntradas(lidasEntradas);
        setSaidas(lidasSaidas);
      } catch (falha) {
        console.error('Erro ao buscar os recebimentos:', falha);
        if (!cancelado) setErro('Não foi possível carregar os recebimentos. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [tenantId, filtro.inicio, filtro.fim]);

  const documento = useMemo(
    () => (carregando || erro ? null : montarDocumentoDeRecebimentos(entradas, filtro, saidas)),
    [carregando, erro, entradas, saidas, filtro],
  );

  return (
    <RelatorioPreview
      relatorioId={filtro.somenteContas ? 'contas-recebidas' : 'recebimentos'}
      documento={documento}
      nomeArquivo={nomeArquivoRelatorio(filtro.somenteContas ? 'Contas Recebidas' : 'Recebimentos', filtro.inicio, filtro.fim)}
      onFechar={onFechar}
      carregando={carregando}
      erro={erro}
      rotuloFechar="Voltar para Contas a Receber"
    />
  );
};

export default RelatorioRecebimentos;

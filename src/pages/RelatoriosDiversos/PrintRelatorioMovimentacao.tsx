import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { lerComReserva } from '../../services/consultaComReserva';
import { useAuth } from '../../contexts/AuthContext';
import { useDadosRelatorioVendas } from '../../hooks/useDadosRelatorioVendas';
import { dateInputToUtcEnd, dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { enriquecerVendas, vendaNoPeriodo } from '../../utils/relatorioVendasDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import type { TransacaoRelatorioFinanceiro } from '../../utils/relatorioFinanceiroDomain';
import { montarDocumentoDaMovimentacao, type SangriaDaMovimentacao } from '../../utils/relatorioMovimentacaoDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/*
 * Relatorios Diversos > Movimentacao do Periodo (28/11/2026). Vendas,
 * recebimentos, contas pagas e sangrias da empresa toda num papel so'. A conta
 * mora em utils/relatorioMovimentacaoDomain.ts.
 */

const horaBr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const paraData = (valor: unknown): Date | null => {
  if (!valor) return null;
  const comToDate = valor as { toDate?: () => Date };
  if (typeof comToDate.toDate === 'function') return comToDate.toDate();
  const data = new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data;
};

/** Sangrias gravadas no documento de cada caixa (caixas_pdv.sangrias). */
const sangriasDosCaixas = (docs: QueryDocumentSnapshot<DocumentData>[]): SangriaDaMovimentacao[] => docs.flatMap((d) => {
  const caixa = d.data();
  const lista = Array.isArray(caixa.sangrias) ? caixa.sangrias : [];
  return lista.flatMap((s: Record<string, unknown>) => {
    const quando = paraData(s?.registradoEm);
    if (!quando) return [];
    return [{
      dia: getDateInputInTimeZone(quando),
      hora: horaBr.format(quando),
      operadorNome: String(s?.registradoPorNome || caixa.operadorNome || ''),
      motivo: String(s?.motivo || ''),
      bancoNome: String(s?.bancoNome || ''),
      valorCentavos: Number(s?.valorCentavos || 0),
    }];
  });
});

const PrintRelatorioMovimentacao: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const params = new URLSearchParams(search);
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';
  const periodoInvalido = !inicio || !fim || inicio > fim;

  const vendasLidas = useDadosRelatorioVendas({ de: inicio, ate: fim });
  const [entradas, setEntradas] = useState<TransacaoRelatorioFinanceiro[]>([]);
  const [saidas, setSaidas] = useState<TransacaoRelatorioFinanceiro[]>([]);
  const [sangrias, setSangrias] = useState<SangriaDaMovimentacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      if (!currentUser || !tenantId || periodoInvalido) {
        setCarregando(false);
        return;
      }
      setCarregando(true);
      setErro('');
      try {
        // Pagos no periodo pela data do pagamento e, nos que nao tem, pela data
        // (a mesma leitura do relatorio de Recebimentos).
        const doTipo = async (tipo: 'entrada' | 'saida') => {
          const todos = query(collection(db, 'transacoes'), where('tenantId', '==', tenantId), where('tipo', '==', tipo), where('status', '==', 'Paga'));
          const snaps = await Promise.all(['dataPagamento', 'data'].map((campo) => lerComReserva(
            query(todos, where(campo, '>=', inicio), where(campo, '<=', fim)),
            todos,
            `Movimentação (${tipo} por ${campo})`,
          )));
          const porId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
          snaps.forEach((snap) => snap.docs.forEach((d) => porId.set(d.id, d)));
          return Array.from(porId.values()).map((d) => ({ id: d.id, ...d.data() }) as TransacaoRelatorioFinanceiro);
        };
        // Caixa aberto ate' 2 dias antes pode ter sangria dentro do periodo.
        const desde = dateInputToUtcStart(inicio) as Date;
        const ate = dateInputToUtcEnd(fim) as Date;
        const caixas = query(collection(db, 'caixas_pdv'), where('tenantId', '==', tenantId));
        const [lidasEntradas, lidasSaidas, caixasSnap] = await Promise.all([
          doTipo('entrada'),
          doTipo('saida'),
          lerComReserva(
            query(caixas, where('createdAt', '>=', Timestamp.fromMillis(desde.getTime() - 2 * 86400000)), where('createdAt', '<=', Timestamp.fromDate(ate))),
            caixas,
            'Movimentação (caixas da Frente de Caixa)',
          ),
        ]);
        if (cancelado) return;
        setEntradas(lidasEntradas);
        setSaidas(lidasSaidas);
        setSangrias(sangriasDosCaixas(caixasSnap.docs));
      } catch (falha) {
        console.error('Erro ao buscar a movimentação do período:', falha);
        if (!cancelado) setErro('Não foi possível carregar a movimentação. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [currentUser, tenantId, inicio, fim, periodoInvalido]);

  const vendas = useMemo(() => {
    const start = dateInputToUtcStart(inicio);
    const end = dateInputToUtcEnd(fim);
    return enriquecerVendas(vendasLidas.data)
      .filter((venda) => vendaNoPeriodo(venda, start, end))
      .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  }, [vendasLidas.data, inicio, fim]);

  const lendo = carregando || vendasLidas.loading;
  const falha = erro || vendasLidas.error;

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => (
    lendo || falha ? null : montarDocumentoDaMovimentacao({ vendas, entradasPagas: entradas, saidasPagas: saidas, sangrias }, { inicio, fim })
  ), [lendo, falha, vendas, entradas, saidas, sangrias, inicio, fim]);

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId="movimentacao"
        documento={periodoInvalido ? null : documento}
        nomeArquivo={nomeArquivoRelatorio('Movimentacao', inicio, fim)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={lendo}
        erro={periodoInvalido ? 'Período inválido: volte e confira a data inicial e a data final.' : falha}
      />
    </div>
  );
};

export default PrintRelatorioMovimentacao;

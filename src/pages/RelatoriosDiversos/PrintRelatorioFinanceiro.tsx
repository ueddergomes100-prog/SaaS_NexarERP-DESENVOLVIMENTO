import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { lerComReserva } from '../../services/consultaComReserva';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  idRelatorioFinanceiro,
  montarDocumentoFinanceiro,
  tituloRelatorioFinanceiro,
  type StatusRelatorioFinanceiro,
  type TipoRelatorioFinanceiro,
  type TransacaoRelatorioFinanceiro,
} from '../../utils/relatorioFinanceiroDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

/*
 * Relatorios Diversos > Financeiro (a receber, recebidos, a pagar, pagos).
 * Abre no padrao de relatorio do sistema (PDF na tela, colunas por caixa de
 * marcar). Periodo, estornos e totais moram em relatorioFinanceiroDomain.
 */
const PrintRelatorioFinanceiro: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();

  const params = new URLSearchParams(search);
  const tipoParam = params.get('tipo');
  const statusParam = params.get('status');
  const tipo: TipoRelatorioFinanceiro = tipoParam === 'saida' ? 'saida' : 'entrada';
  const status: StatusRelatorioFinanceiro = statusParam === 'Paga' ? 'Paga' : 'Pendente';
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';
  const filtroInvalido = (tipoParam !== 'entrada' && tipoParam !== 'saida')
    || (statusParam !== 'Pendente' && statusParam !== 'Paga');
  const periodoInvalido = !inicio || !fim || inicio > fim;

  const [transacoes, setTransacoes] = useState<TransacaoRelatorioFinanceiro[]>([]);
  const [saidasPagas, setSaidasPagas] = useState<TransacaoRelatorioFinanceiro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      if (!currentUser || !tenantId) return;
      if (filtroInvalido || periodoInvalido) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        // So' o periodo, pela mesma data que o relatorio usa (otimizacao de
        // leituras, 2026-10-14 -- antes lia todos os lancamentos do tipo e
        // situacao): pagos por dataPagamento e, sem ela, por data; pendentes
        // por data (vencimento). O relatorio continua cortando: a reserva
        // (sem indice) traz todos.
        const doTenant = async (tipoBusca: string, statusBusca: string) => {
          const todos = query(
            collection(db, 'transacoes'),
            where('tenantId', '==', tenantId),
            where('tipo', '==', tipoBusca),
            where('status', '==', statusBusca),
          );
          const campos = statusBusca === 'Paga' ? ['dataPagamento', 'data'] : ['data'];
          const snaps = await Promise.all(campos.map((campo) => lerComReserva(
            query(todos, where(campo, '>=', inicio), where(campo, '<=', fim)),
            todos,
            `Relatório financeiro (${tipoBusca} ${statusBusca} por ${campo})`,
          )));
          const porId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
          snaps.forEach((snap) => snap.docs.forEach((d) => porId.set(d.id, d)));
          return { docs: Array.from(porId.values()) };
        };
        // Recebidos: os estornos (saidas pagas) abatem o total.
        const precisaEstornos = tipo === 'entrada' && status === 'Paga';
        const [snapshot, estornosSnap] = await Promise.all([
          doTenant(tipo, status),
          precisaEstornos ? doTenant('saida', 'Paga') : Promise.resolve(null),
        ]);
        if (cancelado) return;
        setTransacoes(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as TransacaoRelatorioFinanceiro));
        setSaidasPagas(estornosSnap
          ? estornosSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as TransacaoRelatorioFinanceiro)
          : []);
      } catch (erro) {
        console.error('Erro ao buscar relatório financeiro:', erro);
        if (!cancelado) setError('Não foi possível carregar o relatório financeiro. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [currentUser, tenantId, tipo, status, inicio, fim, filtroInvalido, periodoInvalido]);

  const titulo = tituloRelatorioFinanceiro(tipo, status);

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => (
    loading ? null : montarDocumentoFinanceiro(transacoes, { tipo, status, inicio, fim }, saidasPagas)
  ), [fim, inicio, loading, saidasPagas, status, tipo, transacoes]);

  const erro = filtroInvalido
    ? 'Tipo de relatório inválido: volte e escolha o relatório financeiro de novo.'
    : periodoInvalido
      ? 'Período inválido: volte e confira a data inicial e a data final.'
      : error;

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId={idRelatorioFinanceiro(tipo, status)}
        documento={filtroInvalido || periodoInvalido ? null : documento}
        nomeArquivo={nomeArquivoRelatorio(titulo, inicio, fim)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={loading}
        erro={erro}
      />
    </div>
  );
};

export default PrintRelatorioFinanceiro;

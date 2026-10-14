import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, Timestamp, type DocumentData, type QuerySnapshot } from 'firebase/firestore';
import { lerComReserva } from '../../services/consultaComReserva';
import { dateInputToUtcEnd, dateInputToUtcStart } from '../../utils/dateTime';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoDescontos, type FontesRelatorioDescontos } from '../../utils/relatorioDescontosDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

const VAZIO: FontesRelatorioDescontos = { pedidos: [], ordens: [], orcamentos: [] };

/*
 * Relatorios Diversos > Descontos concedidos. Abre no padrao de relatorio do
 * sistema (PDF na tela, colunas por caixa de marcar). Periodo, visibilidade
 * de vendas e totais moram em relatorioDescontosDomain.
 */
const PrintRelatorioDescontos: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();

  const params = new URLSearchParams(search);
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';
  const periodoInvalido = !inicio || !fim || inicio > fim;

  const [fontes, setFontes] = useState<FontesRelatorioDescontos>(VAZIO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    const carregar = async () => {
      if (!currentUser || !tenantId || periodoInvalido) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        // So' o periodo, pelo mesmo campo de data que o relatorio usa
        // (otimizacao de leituras, 2026-10-14 -- antes lia pedidos, OS e
        // orcamentos INTEIROS). montarDocumentoDescontos continua cortando:
        // a reserva (sem indice) traz a colecao toda.
        const doTenant = (nome: string) => query(collection(db, nome), where('tenantId', '==', tenantId));
        const porTexto = (nome: string, campo: string) => lerComReserva(
          query(doTenant(nome), where(campo, '>=', inicio), where(campo, '<=', fim)),
          doTenant(nome),
          `Relatório de descontos (${nome} por ${campo})`,
        );
        const inicioTs = Timestamp.fromDate(dateInputToUtcStart(inicio) as Date);
        const fimTs = Timestamp.fromDate(dateInputToUtcEnd(fim) as Date);
        const [pedidosSnap, osPorSaida, osPorEntrada, orcamentosSnap] = await Promise.all([
          porTexto('pedidos_venda', 'dataVenda'),
          // OS: data = dataSaida e, sem ela, dataEntrada -- as duas consultas, juntadas.
          porTexto('ordens_de_servico', 'dataSaida'),
          porTexto('ordens_de_servico', 'dataEntrada'),
          lerComReserva(
            query(doTenant('orcamentos'), where('createdAt', '>=', inicioTs), where('createdAt', '<=', fimTs)),
            doTenant('orcamentos'),
            'Relatório de descontos (orcamentos por createdAt)',
          ),
        ]);
        if (cancelado) return;
        const lista = (...snaps: QuerySnapshot<DocumentData>[]) => {
          const porId = new Map<string, DocumentData & { id: string }>();
          snaps.forEach((snap) => snap.docs.forEach((docSnap) => porId.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })));
          return Array.from(porId.values());
        };
        setFontes({ pedidos: lista(pedidosSnap), ordens: lista(osPorSaida, osPorEntrada), orcamentos: lista(orcamentosSnap) });
      } catch (erro) {
        console.error('Erro ao buscar relatório de descontos concedidos:', erro);
        if (!cancelado) setError('Não foi possível carregar os descontos concedidos. Verifique sua conexão e tente de novo.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };
    void carregar();
    return () => { cancelado = true; };
  }, [currentUser, tenantId, inicio, fim, periodoInvalido]);

  const titulo = 'Descontos Concedidos';

  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => (
    loading ? null : montarDocumentoDescontos(fontes, { inicio, fim, vendasVisiveisDeUsuarioId })
  ), [fim, fontes, inicio, loading, vendasVisiveisDeUsuarioId]);

  return (
    <div style={{ padding: '20px' }}>
      <RelatorioPreview
        relatorioId="descontos"
        documento={periodoInvalido ? null : documento}
        nomeArquivo={nomeArquivoRelatorio(titulo, inicio, fim)}
        onFechar={() => navigate('/relatorios-diversos')}
        carregando={loading}
        erro={periodoInvalido ? 'Período inválido: volte e confira a data inicial e a data final.' : error}
      />
    </div>
  );
};

export default PrintRelatorioDescontos;

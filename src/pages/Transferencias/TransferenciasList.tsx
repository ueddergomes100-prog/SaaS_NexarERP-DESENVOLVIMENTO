import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Eye, FileText, Plus } from 'lucide-react';
import { collection, onSnapshot, query, where, Timestamp, type DocumentData, type QuerySnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { assinarComReserva } from '../../services/consultaComReserva';
import { dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import AvisoHistoricoDoPeriodo from '../../components/common/AvisoHistoricoDoPeriodo';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import EstadoVazio from '../../components/common/EstadoVazio';
import MenuMaisOpcoes from '../../components/common/MenuMaisOpcoes';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarDocumentoTransferencias } from '../../utils/relatorioMovimentosDomain';
import { ROTULO_STATUS_TRANSFERENCIA } from '../../utils/transferenciaDomain';
import { rotuloStatusNota } from '../../utils/notaTransferenciaDomain';
import { ESTILO_STATUS_TRANSFERENCIA, dataHora, moeda, type TransferenciaDoc } from './transferenciaTipos';

type Aba = 'receber' | 'transito' | 'concluidas' | 'todas';

/**
 * TRANSFERENCIAS (Filiais, fase 3 -- 2026-10-06). Mercadoria entre as filiais
 * do grupo: quem envia baixa o estoque; quem recebe confere e da' entrada.
 * As duas filiais enxergam a mesma transferencia.
 */
const TransferenciasList: React.FC = () => {
  const { tenantId, filialAtual } = useAuth();
  const { openTab } = useTabs();
  const [lista, setLista] = useState<TransferenciaDoc[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>('receber');
  // Relatorio (19/10/2026): sai o que a lista mostra (aba e periodo).
  const [previewAberto, setPreviewAberto] = useState(false);

  // Em transito de qualquer data + as enviadas neste mes -- ou de todo o
  // periodo quando a pessoa pede (otimizacao de leituras, 2026-10-14; antes:
  // todas as transferencias das filiais). Sem o indice (tenantIds,
  // enviadoEm) publicado, cai em todas e o mesmo corte e' feito aqui.
  const [todoPeriodo, setTodoPeriodo] = useState(false);
  const inicioDoMes = `${getDateInputInTimeZone().slice(0, 7)}-01`;
  useEffect(() => {
    if (!tenantId) return undefined;
    setCarregando(true);
    const daFilial = query(collection(db, 'transferencias'), where('tenantIds', 'array-contains', tenantId));
    const inicio = todoPeriodo ? null : dateInputToUtcStart(inicioDoMes);
    const partes = new Map<string, TransferenciaDoc[]>();
    const publicar = () => {
      const porId = new Map<string, TransferenciaDoc>();
      partes.forEach((docs) => docs.forEach((t) => porId.set(t.id, t)));
      const docs = Array.from(porId.values());
      docs.sort((a, b) => (b.enviadoEm?.toDate?.()?.getTime() ?? 0) - (a.enviadoEm?.toDate?.()?.getTime() ?? 0));
      setLista(docs);
      if (partes.size >= 2) setCarregando(false);
    };
    // Mesmos cortes das consultas enxutas, para a reserva (sem indice) mostrar o mesmo.
    const receber = (nome: string) => (snap: QuerySnapshot<DocumentData>) => {
      partes.set(nome, snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as TransferenciaDoc))
        .filter((t) => (nome === 'emTransito'
          ? t.status === 'em_transito'
          : !inicio || (t.enviadoEm?.toDate?.() ?? new Date(0)) >= inicio)));
      publicar();
    };
    const falhar = (nome: string) => (erro: unknown) => {
      console.error('Erro ao carregar as transferências:', erro);
      if (!partes.has(nome)) partes.set(nome, []);
      publicar();
    };
    const parar = [
      // array-contains + igualdade exige indice composto: pela reserva, nunca escuta crua.
      assinarComReserva(query(daFilial, where('status', '==', 'em_transito')), daFilial, 'Transferências (em trânsito)', receber('emTransito'), falhar('emTransito')),
      inicio
        ? assinarComReserva(query(daFilial, where('enviadoEm', '>=', Timestamp.fromDate(inicio))), daFilial, 'Transferências (enviadas no mês)', receber('periodo'), falhar('periodo'))
        : onSnapshot(daFilial, receber('periodo'), falhar('periodo')),
    ];
    return () => parar.forEach((fn) => fn());
  }, [tenantId, todoPeriodo, inicioDoMes]);

  const filtradas = useMemo(() => lista.filter((t) => {
    if (aba === 'receber') return t.status === 'em_transito' && t.tenantDestino === tenantId;
    if (aba === 'transito') return t.status === 'em_transito' && t.tenantOrigem === tenantId;
    if (aba === 'concluidas') return t.status !== 'em_transito';
    return true;
  }), [lista, aba, tenantId]);

  const contagem = useMemo(() => ({
    receber: lista.filter((t) => t.status === 'em_transito' && t.tenantDestino === tenantId).length,
    transito: lista.filter((t) => t.status === 'em_transito' && t.tenantOrigem === tenantId).length,
    concluidas: lista.filter((t) => t.status !== 'em_transito').length,
    todas: lista.length,
  }), [lista, tenantId]);

  const ABAS: Array<{ valor: Aba; rotulo: string }> = [
    { valor: 'receber', rotulo: 'A receber' },
    { valor: 'transito', rotulo: 'Enviadas em trânsito' },
    { valor: 'concluidas', rotulo: 'Concluídas' },
    { valor: 'todas', rotulo: 'Todas' },
  ];

  const abrir = (t: TransferenciaDoc) => openTab(`/estoque/transferencias/${t.id}`, `Transferência #${t.numeroTransferencia}`);

  if (previewAberto) {
    const hoje = getDateInputInTimeZone();
    const emTransito = aba === 'receber' || aba === 'transito';
    return (
      <RelatorioPreview
        relatorioId="transferencias"
        documento={montarDocumentoTransferencias(filtradas, {
          periodo: emTransito ? 'Em trânsito, de qualquer data' : todoPeriodo ? 'Todo o período' : 'Enviadas neste mês',
          filtrosAplicados: [
            `Lista: ${ABAS.find((a) => a.valor === aba)?.rotulo || aba}`,
            filialAtual ? `Filial: ${filialAtual.codigo} · ${filialAtual.nome}` : '',
          ].filter(Boolean),
        })}
        nomeArquivo={nomeArquivoRelatorio('Transferencias', hoje, hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar às transferências"
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
            <ArrowLeftRight size={26} style={{ color: 'var(--accent-purple)' }} /> Transferências
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '6px', maxWidth: '680px' }}>
            Mercadoria entre as filiais. Quem envia baixa o estoque; quem recebe confere e dá entrada — o que faltar volta para quem enviou.
            {filialAtual && <> Você está na filial <strong>{filialAtual.codigo} · {filialAtual.nome}</strong>.</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <MenuMaisOpcoes
            itens={[{
              texto: 'Relatório', Icone: FileText,
              titulo: 'Abre em PDF as transferências da lista, com origem, destino, valor e nota (dali dá para imprimir, salvar o PDF ou salvar em Excel)',
              desabilitado: carregando,
              onClick: () => setPreviewAberto(true),
            }]}
          />
          <button className="btn-primary" onClick={() => openTab('/estoque/transferencias/nova', 'Nova transferência')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={20} /> Nova transferência
          </button>
        </div>
      </div>

      {contagem.receber > 0 && aba !== 'receber' && (
        <button
          type="button"
          onClick={() => setAba('receber')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245, 158, 11, 0.4)', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', cursor: 'pointer', textAlign: 'left' }}
        >
          <ArrowLeftRight size={18} />
          <span><strong>{contagem.receber}</strong> transferência(s) chegando nesta filial. Clique para conferir e receber.</span>
        </button>
      )}

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {ABAS.map(({ valor, rotulo }) => (
            <button
              key={valor}
              type="button"
              onClick={() => setAba(valor)}
              style={{
                padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${aba === valor ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                backgroundColor: aba === valor ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                color: aba === valor ? '#fff' : 'var(--text-primary)',
              }}
            >
              {rotulo} ({contagem[valor]})
            </button>
          ))}
        </div>
        {(aba === 'concluidas' || aba === 'todas') && (
          <AvisoHistoricoDoPeriodo
            todoPeriodo={todoPeriodo}
            onAlternar={() => setTodoPeriodo((atual) => !atual)}
            textoRecente="Em trânsito de qualquer data; as demais, só as enviadas neste mês."
            textoTodo="Transferências de todo o período."
            botaoRecente="Ver só as deste mês"
          />
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 14px' }}>Nº</th>
                <th style={{ padding: '12px 14px' }}>Envio</th>
                <th style={{ padding: '12px 14px' }}>De → Para</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Itens</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Valor (custo)</th>
                <th style={{ padding: '12px 14px' }}>Situação</th>
                <th style={{ padding: '12px 14px' }}>Nota</th>
                <th style={{ padding: '12px 14px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '8px' }}><EstadoVazio titulo="Nenhuma transferência nesta lista." compacto /></td></tr>
              ) : filtradas.map((t) => {
                const estilo = ESTILO_STATUS_TRANSFERENCIA[t.status];
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }} onClick={() => abrir(t)}>
                    <td style={{ padding: '12px 14px', fontWeight: 700 }}>#{t.numeroTransferencia}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{dataHora(t.enviadoEm)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <strong style={{ color: t.tenantOrigem === tenantId ? 'var(--accent-purple)' : undefined }}>{t.origemCodigo}</strong> {t.origemNome}
                        <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                        <strong style={{ color: t.tenantDestino === tenantId ? 'var(--accent-purple)' : undefined }}>{t.destinoCodigo}</strong> {t.destinoNome}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>{(t.itens || []).length}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>{moeda(t.valorCentavos)}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: estilo.fundo, color: estilo.cor }}>
                        {ROTULO_STATUS_TRANSFERENCIA[t.status]}{t.divergente ? ' (com falta)' : ''}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {t.comNota
                        ? `NF-e${t.notaFiscal?.number ? ` nº ${t.notaFiscal.number}` : ''} · ${rotuloStatusNota(t.notaFiscal?.status)}`
                        : 'Sem nota'}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <button type="button" className="btn-secondary" aria-label={`Abrir a transferência ${t.numeroTransferencia}`} onClick={(e) => { e.stopPropagation(); abrir(t); }} style={{ padding: '6px 10px', display: 'inline-flex' }}>
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TransferenciasList;

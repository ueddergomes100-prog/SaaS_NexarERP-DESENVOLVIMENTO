import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, ChevronDown, RefreshCw } from 'lucide-react';
import { consultarResumoDoGrupo } from '../../services/filialService';
import type { ResumoDaFilial } from '../../utils/resumoGrupoDomain';
import { addMonthsToDateInput, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import './ResumoDoGrupo.css';

/**
 * RESUMO DO GRUPO (Filiais, fase 5 -- 2026-10-06): vendas, a receber e
 * estoque de cada filial lado a lado, so' para o dono/administrador. Fica
 * FECHADO por padrao (le o estoque inteiro de cada filial; so' busca quando
 * abre) -- telas sem poluicao. Contas em src/utils/resumoGrupoDomain.ts.
 */

type Periodo = 'hoje' | 'mes' | 'mes_passado';

const PERIODOS: Array<{ id: Periodo; rotulo: string }> = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes_passado', rotulo: 'Mês passado' },
];

const CHAVE_ABERTO = 'hennder.filiais.resumoAberto';

const lerAberto = () => {
  try { return window.localStorage.getItem(CHAVE_ABERTO) === '1'; } catch { return false; }
};
const gravarAberto = (aberto: boolean) => {
  try { window.localStorage.setItem(CHAVE_ABERTO, aberto ? '1' : '0'); } catch { /* sem armazenamento: so' nao lembra */ }
};

const intervaloDoPeriodo = (periodo: Periodo): { inicio: string; fim: string } => {
  const hoje = getDateInputInTimeZone();
  if (periodo === 'hoje') return { inicio: hoje, fim: hoje };
  const inicioDoMes = `${hoje.slice(0, 7)}-01`;
  if (periodo === 'mes') return { inicio: inicioDoMes, fim: hoje };
  const inicioPassado = addMonthsToDateInput(inicioDoMes, -1);
  const fimPassado = new Date(Date.parse(`${inicioDoMes}T12:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { inicio: inicioPassado, fim: fimPassado };
};

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (centavos: number) => moeda.format((centavos || 0) / 100);

interface Resultado {
  filiais: ResumoDaFilial[];
  total: Omit<ResumoDaFilial, 'tenantId' | 'codigo' | 'nome'>;
}

const ResumoDoGrupo: React.FC<{ filialAtualId?: string }> = ({ filialAtualId }) => {
  const [aberto, setAberto] = useState(lerAberto);
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [dados, setDados] = useState<Resultado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const buscar = useCallback(async (p: Periodo) => {
    const { inicio, fim } = intervaloDoPeriodo(p);
    setCarregando(true);
    setErro('');
    try {
      const r = await consultarResumoDoGrupo(inicio, fim);
      setDados({ filiais: r.filiais, total: r.total });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível montar o resumo das filiais. Tente de novo.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (aberto) void buscar(periodo);
  }, [aberto, periodo, buscar]);

  const alternar = () => {
    const novo = !aberto;
    gravarAberto(novo);
    setAberto(novo);
  };

  const { inicio, fim } = intervaloDoPeriodo(periodo);
  const textoDoPeriodo = inicio === fim ? formatDateInputPtBr(inicio) : `${formatDateInputPtBr(inicio)} a ${formatDateInputPtBr(fim)}`;
  const maiorVenda = Math.max(1, ...(dados?.filiais ?? []).map((f) => f.vendasCentavos));

  return (
    <section className={`resumo-grupo card${aberto ? ' resumo-grupo--aberto' : ''}`}>
      <button type="button" className="resumo-grupo__cabeca" onClick={alternar} aria-expanded={aberto}>
        <BarChart3 size={18} aria-hidden="true" />
        <span className="resumo-grupo__titulo">Resumo do grupo</span>
        <span className="resumo-grupo__dica">{aberto ? textoDoPeriodo : 'Vendas, a receber e estoque de cada filial'}</span>
        <ChevronDown size={18} className="resumo-grupo__seta" aria-hidden="true" />
      </button>

      {aberto && (
        <div className="resumo-grupo__corpo">
          <div className="resumo-grupo__barra">
            <div className="resumo-grupo__periodos" role="group" aria-label="Período das vendas">
              {PERIODOS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`resumo-grupo__periodo${periodo === p.id ? ' resumo-grupo__periodo--ativo' : ''}`}
                  aria-pressed={periodo === p.id}
                  onClick={() => setPeriodo(p.id)}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
            <button type="button" className="resumo-grupo__atualizar" onClick={() => { void buscar(periodo); }} disabled={carregando}>
              <RefreshCw size={14} className={carregando ? 'resumo-grupo__girando' : undefined} aria-hidden="true" /> Atualizar
            </button>
          </div>

          {erro ? (
            <p className="resumo-grupo__erro" role="alert">{erro}</p>
          ) : !dados ? (
            <p className="resumo-grupo__vazio">Carregando...</p>
          ) : (
            <div className="resumo-grupo__tabela-rolagem" aria-busy={carregando}>
              <table className="resumo-grupo__tabela">
                <thead>
                  <tr>
                    <th scope="col">Filial</th>
                    <th scope="col" className="resumo-grupo__num">Vendas no período</th>
                    <th scope="col" className="resumo-grupo__num">Pedidos</th>
                    <th scope="col" className="resumo-grupo__num">Ticket médio</th>
                    <th scope="col" className="resumo-grupo__num">A receber hoje</th>
                    <th scope="col" className="resumo-grupo__num">Estoque a custo</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.filiais.map((f) => {
                    const fatia = dados.total.vendasCentavos > 0 ? Math.round((f.vendasCentavos / dados.total.vendasCentavos) * 100) : 0;
                    return (
                      <tr key={f.tenantId}>
                        <th scope="row">
                          <span className="resumo-grupo__codigo">{f.codigo}</span>
                          {f.nome}
                          {f.tenantId === filialAtualId && <span className="resumo-grupo__aqui">você está aqui</span>}
                        </th>
                        <td className="resumo-grupo__num">
                          <div className="resumo-grupo__venda">
                            <span>{reais(f.vendasCentavos)}</span>
                            <span className="resumo-grupo__fatia" title={`${fatia}% das vendas do grupo`}>
                              <span style={{ width: `${Math.round((f.vendasCentavos / maiorVenda) * 100)}%` }} />
                            </span>
                            <span className="resumo-grupo__pct">{fatia}%</span>
                          </div>
                        </td>
                        <td className="resumo-grupo__num">{f.pedidos}</td>
                        <td className="resumo-grupo__num">{reais(f.ticketMedioCentavos)}</td>
                        <td className="resumo-grupo__num">{reais(f.aReceberCentavos)}</td>
                        <td className="resumo-grupo__num">{reais(f.estoqueCentavos)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total do grupo</th>
                    <td className="resumo-grupo__num">{reais(dados.total.vendasCentavos)}</td>
                    <td className="resumo-grupo__num">{dados.total.pedidos}</td>
                    <td className="resumo-grupo__num">{reais(dados.total.ticketMedioCentavos)}</td>
                    <td className="resumo-grupo__num">{reais(dados.total.aReceberCentavos)}</td>
                    <td className="resumo-grupo__num">{reais(dados.total.estoqueCentavos)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="resumo-grupo__nota">
                Vendas contam pela data da venda, sem pré-vendas e canceladas. A receber são os títulos em aberto, sem cartão. Estoque é a quantidade atual vezes o custo.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default ResumoDoGrupo;

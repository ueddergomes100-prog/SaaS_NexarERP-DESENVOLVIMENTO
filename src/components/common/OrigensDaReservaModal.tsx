import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ExternalLink, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useTabs } from '../../contexts/TabsContext';
import { STATUS_PEDIDO_ABERTO } from '../../utils/preVendaDomain';
import {
  ROTULO_ORIGEM_RESERVA,
  quantidadeDoProdutoNosItens,
  resumoDeReserva,
  type ReservaEncontrada,
} from '../../utils/estoqueReservaDomain';

/*
 * DE ONDE VEM A RESERVA (maquinas pesadas, fase 2 -- 2026-10-07).
 *
 * O produto guarda so' o numero (`quantidadeReservada`); quem segura cada
 * unidade sao os documentos em aberto: pre-venda, OS com "Reservar no Pedido
 * e na OS", condicional e troca. Esta janela procura o produto nesses
 * documentos e lista um por linha, com o botao de abrir. Se a soma nao bater
 * com o reservado do produto, avisa -- e' sinal de documento antigo ou de
 * ajuste pendente, nao de erro da tela.
 */

interface ProdutoDaReserva {
  id: string;
  nome: string;
  quantidade?: number;
  quantidadeReservada?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
}

interface Props {
  tenantId: string;
  produto: ProdutoDaReserva;
  onFechar: () => void;
}

const ROTA_POR_ORIGEM: Partial<Record<ReservaEncontrada['origem'], (id: string) => string>> = {
  pre_venda: (id) => `/pedidos-venda/visualizar/${id}`,
  ordem_de_servico: (id) => `/os/editar/${id}`,
};

const OrigensDaReservaModal: React.FC<Props> = ({ tenantId, produto, onFechar }) => {
  const { openTab } = useTabs();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [reservas, setReservas] = useState<ReservaEncontrada[]>([]);

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      try {
        const base = (colecao: string) => collection(db, colecao);
        const [pedidos, ordens, condicionais, trocas] = await Promise.all([
          getDocs(query(base('pedidos_venda'), where('tenantId', '==', tenantId), where('estoqueReservado', '==', true))),
          getDocs(query(base('ordens_de_servico'), where('tenantId', '==', tenantId), where('estoqueReservado', '==', true))),
          getDocs(query(base('condicionais'), where('tenantId', '==', tenantId), where('status', '==', 'aberto'))),
          getDocs(query(base('trocas'), where('tenantId', '==', tenantId), where('estoqueReservado', '==', true))),
        ]);
        const achadas: ReservaEncontrada[] = [];
        pedidos.docs.forEach((d) => {
          const dados = d.data();
          if (!STATUS_PEDIDO_ABERTO.includes(String(dados.status || ''))) return;
          const qtd = quantidadeDoProdutoNosItens(dados.itens, produto.id);
          if (qtd > 0) achadas.push({ origem: 'pre_venda', documentoId: d.id, numero: String(dados.numeroPedido || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
        });
        ordens.docs.forEach((d) => {
          const dados = d.data();
          const qtd = quantidadeDoProdutoNosItens(dados.pecas, produto.id);
          if (qtd > 0) achadas.push({ origem: 'ordem_de_servico', documentoId: d.id, numero: String(dados.numeroOS || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
        });
        condicionais.docs.forEach((d) => {
          const dados = d.data();
          const qtd = quantidadeDoProdutoNosItens(dados.itens, produto.id);
          if (qtd > 0) achadas.push({ origem: 'condicional', documentoId: d.id, numero: String(dados.numero || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
        });
        trocas.docs.forEach((d) => {
          const dados = d.data();
          const qtd = quantidadeDoProdutoNosItens(dados.itens, produto.id);
          if (qtd > 0) achadas.push({ origem: 'troca', documentoId: d.id, numero: String(dados.numero || ''), cliente: String(dados.clienteNome || ''), quantidade: qtd });
        });
        if (vivo) setReservas(achadas);
      } catch (e) {
        console.error('Erro ao procurar as reservas do produto:', e);
        if (vivo) setErro('Não foi possível listar de onde vem a reserva. Tente de novo em instantes.');
      } finally {
        if (vivo) setCarregando(false);
      }
    };
    void buscar();
    return () => { vivo = false; };
  }, [tenantId, produto.id]);

  const resumo = resumoDeReserva(produto);
  const casas = produto.unidadeMedidaCasasDecimais ?? 0;
  const sigla = produto.unidadeMedidaSigla || 'UN';
  const qtd = (v: number) => `${v.toFixed(casas)} ${sigla}`;
  const somaEncontrada = reservas.reduce((t, r) => t + r.quantidade, 0);
  const divergente = !carregando && !erro && Math.abs(somaEncontrada - resumo.reservada) > 0.0001;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Reservas de ${produto.nome}`} onClick={onFechar}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 'min(720px, 100%)', maxHeight: '85vh', overflow: 'auto', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Reservas de {produto.nome}</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Em estoque {qtd(resumo.quantidade)} · Reservado {qtd(resumo.reservada)} · <b style={{ color: 'var(--text-primary)' }}>Disponível {qtd(resumo.disponivel)}</b>
            </p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        {carregando && <p style={{ margin: 0, color: 'var(--text-muted)' }}>Procurando nos documentos em aberto…</p>}
        {erro && <p style={{ margin: 0, color: '#f87171' }}>{erro}</p>}
        {!carregando && !erro && reservas.length === 0 && (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nenhum documento em aberto segura este produto. Se o reservado continua maior que zero, é sobra de documento antigo: um ajuste manual de estoque zera.</p>
        )}
        {reservas.length > 0 && (
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>Origem</th><th>Nº</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Quantidade</th><th /></tr>
            </thead>
            <tbody>
              {reservas.map((r) => {
                const rota = ROTA_POR_ORIGEM[r.origem];
                return (
                  <tr key={`${r.origem}-${r.documentoId}`}>
                    <td>{ROTULO_ORIGEM_RESERVA[r.origem]}</td>
                    <td className="font-medium">{r.numero ? `#${r.numero}` : r.documentoId.slice(0, 6).toUpperCase()}</td>
                    <td>{r.cliente || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{qtd(r.quantidade)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {rota && (
                        <button type="button" className="icon-btn" title="Abrir o documento" onClick={() => { onFechar(); openTab(rota(r.documentoId)); }}>
                          <ExternalLink size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {divergente && (
          <p style={{ margin: 0, fontSize: '12px', color: '#fbbf24' }}>
            Os documentos encontrados somam {qtd(somaEncontrada)}, mas o produto marca {qtd(resumo.reservada)} reservado. A diferença costuma ser documento antigo (de antes da reserva existir) — um ajuste manual de estoque acerta o número.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
};

export default OrigensDaReservaModal;

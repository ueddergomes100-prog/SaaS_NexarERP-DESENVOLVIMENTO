import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, Printer, ReceiptText, RefreshCw, Search, X } from 'lucide-react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import { fromCents } from '../../../utils/financeDomain';
import {
  filtrarVendasDoCaixa,
  ofereceEmitirCupomFiscal,
  vendasDoCaixa,
  type DocumentoDoCupom,
  type VendaDoCaixa,
} from '../../../utils/cupomDoCaixaDomain';
import { currency } from '../pdvHelpers';

/**
 * Historico de vendas do caixa aberto (F9, 23/11/2026, pedido do dono): para
 * reimprimir o cupom sem sair da Frente de Caixa. Ao vivo enquanto a janela
 * esta' aberta. Regras (o que "Reimprimir" faz, quando oferece emitir o cupom
 * fiscal) em cupomDoCaixaDomain.ts.
 */
interface VendasDoCaixaModalProps {
  open: boolean;
  tenantId?: string | null;
  /** Caixa aberto (caixas_pdv): as vendas listadas sao as dele. */
  sessaoId: string | null;
  documentoDaEmpresa: DocumentoDoCupom;
  /** Uma acao por vez (imprimindo/emitindo): os botoes esperam. */
  ocupadoId: string | null;
  /** Muda depois de emitir uma nota: a situacao da nota e' lida de novo. */
  versaoDasNotas: number;
  onClose: () => void;
  onReimprimir: (venda: VendaDoCaixa) => void;
  onEmitirFiscal: (venda: VendaDoCaixa) => void;
}

type Registro = Record<string, unknown> & { id: string };

/** O "in" do Firestore aceita ate' 30 valores por consulta. */
const LOTE_DO_IN = 30;

const hora = (quando: Date | null): string => (quando
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(quando)
  : '—');

const ROTULO_DA_NOTA: Record<string, string> = {
  autorizada: 'NFC-e',
  aguardando: 'NFC-e na SEFAZ',
  rejeitada: 'NFC-e rejeitada',
};

const VendasDoCaixaModal: React.FC<VendasDoCaixaModalProps> = ({
  open, tenantId, sessaoId, documentoDaEmpresa, ocupadoId, versaoDasNotas, onClose, onReimprimir, onEmitirFiscal,
}) => {
  const [vendas, setVendas] = useState<Registro[]>([]);
  const [notas, setNotas] = useState<Record<string, unknown>[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [busca, setBusca] = useState('');
  const buscaRef = useRef<HTMLInputElement | null>(null);

  // As vendas deste caixa, ao vivo enquanto a janela esta' aberta.
  useEffect(() => {
    if (!open || !tenantId || !sessaoId) return undefined;
    setCarregando(true);
    setErro('');
    return onSnapshot(
      query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('pdvSessionId', '==', sessaoId)),
      (snap) => {
        setVendas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCarregando(false);
      },
      (falha) => {
        console.error('Erro ao acompanhar as vendas do caixa:', falha);
        setCarregando(false);
        setErro('Não foi possível carregar as vendas deste caixa. Confira a conexão e toque em Tentar de novo.');
      },
    );
  }, [open, tenantId, sessaoId, tentativa]);

  // A nota de cada venda (para reimprimir o cupom fiscal e saber se falta emitir).
  const idsDasVendas = useMemo(() => vendas.map((v) => v.id).sort().join(','), [vendas]);
  useEffect(() => {
    if (!open || !tenantId || !idsDasVendas) { setNotas([]); return undefined; }
    let ativo = true;
    const ids = idsDasVendas.split(',');
    const lotes: string[][] = [];
    for (let i = 0; i < ids.length; i += LOTE_DO_IN) lotes.push(ids.slice(i, i + LOTE_DO_IN));
    Promise.all(lotes.map((lote) => getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId), where('pedidoId', 'in', lote)))))
      .then((resultados) => {
        if (ativo) setNotas(resultados.flatMap((snap) => snap.docs.map((d) => d.data())));
      })
      .catch((falha) => {
        // Sem a situacao da nota a lista continua util (reimprime o nao fiscal); so' avisa no console.
        console.warn('Não foi possível ler as notas das vendas do caixa:', falha);
        if (ativo) setNotas([]);
      });
    return () => { ativo = false; };
  }, [open, tenantId, idsDasVendas, versaoDasNotas]);

  useEffect(() => {
    if (!open) return;
    setBusca('');
    buscaRef.current?.focus();
  }, [open]);

  const linhas = useMemo(() => vendasDoCaixa(vendas, notas), [vendas, notas]);
  const filtradas = useMemo(() => filtrarVendasDoCaixa(linhas, busca), [linhas, busca]);

  if (!open) return null;

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal pdv-prevendas-modal pdv-vendas-modal" role="dialog" aria-modal="true" aria-label="Vendas deste caixa">
        <div className="pdv-modal-header">
          <div>
            <span>F9</span>
            <h2>Vendas deste caixa</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar" disabled={Boolean(ocupadoId)}>
            <X size={20} />
          </button>
        </div>

        <div className="pdv-modal-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={buscaRef}
            value={busca}
            autoFocus
            onChange={(event) => setBusca(event.target.value)}
            aria-label="Buscar venda pelo número ou pelo cliente"
            title="Busque pelo número da venda ou pelo nome do cliente."
          />
        </div>

        {!sessaoId ? (
          <div className="pdv-modal-empty">Abra o caixa para ver as vendas dele.</div>
        ) : carregando && linhas.length === 0 ? (
          <div className="pdv-modal-empty"><Loader2 className="spin-animation" size={20} /> Carregando vendas...</div>
        ) : erro ? (
          <div className="pdv-modal-empty pdv-prevendas-erro">
            <p>{erro}</p>
            <button type="button" className="pdv-prevendas-atualizar" onClick={() => setTentativa((n) => n + 1)}>
              <RefreshCw size={16} aria-hidden="true" /> Tentar de novo
            </button>
          </div>
        ) : filtradas.length === 0 ? (
          <div className="pdv-modal-empty">
            <ReceiptText size={26} aria-hidden="true" />
            <p>{linhas.length === 0 ? 'Nenhuma venda neste caixa ainda.' : 'Nenhuma venda com esse número ou cliente.'}</p>
          </div>
        ) : (
          <div className="pdv-prevendas-lista pdv-vendas-lista" role="list" aria-label="Vendas deste caixa">
            <div className="pdv-prevendas-cabecalho pdv-vendas-linha" aria-hidden="true">
              <span>Número</span>
              <span>Hora</span>
              <span>Cliente</span>
              <span>Valor</span>
              <span />
            </div>
            {filtradas.map((venda) => {
              const ocupado = ocupadoId === venda.id;
              const emitir = ofereceEmitirCupomFiscal(venda, documentoDaEmpresa);
              return (
                <div key={venda.id} role="listitem" className={`pdv-vendas-linha pdv-vendas-item${venda.cancelada ? ' parada' : ''}`}>
                  <strong>#{venda.numeroPedido}</strong>
                  <span>{hora(venda.quando)}</span>
                  <span className="pdv-prevendas-cliente">
                    {venda.clienteNome}
                    <small>
                      {[venda.formas, venda.vendedorNome ? `Vendedor: ${venda.vendedorNome}` : '', venda.cancelada ? 'Cancelada' : (venda.nota ? ROTULO_DA_NOTA[venda.nota.situacao] : '')]
                        .filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <b>{currency.format(fromCents(venda.totalCentavos))}</b>
                  <span className="pdv-vendas-acoes">
                    {emitir && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => onEmitirFiscal(venda)}
                        disabled={Boolean(ocupadoId)}
                        title="Esta venda ficou sem cupom fiscal: emitir a NFC-e agora"
                      >
                        <FileText size={15} aria-hidden="true" /> Emitir cupom fiscal
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onReimprimir(venda)}
                      disabled={Boolean(ocupadoId) || venda.cancelada}
                      title={venda.cancelada
                        ? 'Venda cancelada: não se reimprime o cupom'
                        : venda.nota?.situacao === 'autorizada' ? 'Abre de novo o cupom fiscal (NFC-e) para imprimir' : 'Imprime a 2ª via do cupom não fiscal'}
                    >
                      {ocupado ? <Loader2 className="spin-animation" size={15} /> : <Printer size={15} aria-hidden="true" />}
                      Reimprimir
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="pdv-prevendas-rodape">
          <span title="A lista acompanha as vendas ao vivo">
            {linhas.length} venda(s) neste caixa · atualiza sozinha
          </span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(VendasDoCaixaModal);

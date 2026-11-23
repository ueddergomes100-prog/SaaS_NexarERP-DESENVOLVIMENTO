import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useTravasAtivas } from '../../../hooks/useTravaDeEdicao';
import { descreverTrava, mensagemDeBloqueio } from '../../../utils/travaEdicaoDomain';
import { STATUS_PRE_VENDA } from '../../../utils/preVendaDomain';
import { filtrarVendasVisiveis } from '../../../utils/visibilidadeVendasDomain';
import { filtrarPreVendasDoCaixa, preVendasDoCaixa, type PreVendaDoCaixa } from '../../../utils/preVendaNoCaixaDomain';
import { formatDateInputPtBr, getDateInputInTimeZone } from '../../../utils/dateTime';
import { fromCents } from '../../../utils/financeDomain';
import { NexusSwal, showWarning } from '../../../utils/alerts';
import { currency } from '../pdvHelpers';

/**
 * Pre-vendas em aberto da filial, dentro da Frente de Caixa (F8, 23/11/2026).
 *
 * O caixa acha a pre-venda pelo numero ou pelo cliente e puxa para o cupom,
 * para receber e faturar sem sair do caixa. A lista mostra o VENDEDOR de cada
 * uma: e' ele que continua na venda (regra em preVendaNoCaixaDomain.ts).
 * A lista e' AO VIVO enquanto a janela esta' aberta: nao tem "Atualizar".
 * Pre-venda aberta por outra pessoa fica cinza e nao e' puxada (trava de
 * edicao, um documento aberto por vez).
 */
interface PreVendasModalProps {
  open: boolean;
  tenantId?: string | null;
  /** Lendo a pre-venda escolhida: a lista espera. */
  puxando?: boolean;
  onClose: () => void;
  onEscolher: (linha: PreVendaDoCaixa) => void;
}

interface PedidoDaLista {
  id: string;
  vendedorId?: string | null;
  usuarioResponsavelId?: string | null;
  criadoPor?: string | null;
  [campo: string]: unknown;
}

const PreVendasModal: React.FC<PreVendasModalProps> = ({ open, tenantId, puxando = false, onClose, onEscolher }) => {
  const { vendasVisiveisDeUsuarioId } = useAuth();
  const travas = useTravasAtivas('pedido_venda', open);
  const [pedidos, setPedidos] = useState<PedidoDaLista[]>([]);
  const [nomes, setNomes] = useState<Record<string, string> | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [busca, setBusca] = useState('');
  const [marcadaId, setMarcadaId] = useState('');
  const buscaRef = useRef<HTMLInputElement | null>(null);

  // AO VIVO (pedido do dono, 23/11/2026): com a janela aberta, pre-venda nova
  // entra na lista e a faturada/cancelada/alterada some ou muda sozinha, sem
  // "Atualizar" nem recarregar a pagina. A escuta so' existe enquanto a janela
  // esta' aberta (fechou, parou de ler) e, depois da primeira leitura, cada
  // mudanca custa so' o documento que mudou.
  useEffect(() => {
    if (!open || !tenantId) return undefined;
    setCarregando(true);
    setErro('');
    return onSnapshot(
      query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('status', '==', STATUS_PRE_VENDA)),
      (snap) => {
        setPedidos(filtrarVendasVisiveis(
          snap.docs.map((documento) => ({ id: documento.id, ...documento.data() } as PedidoDaLista)),
          vendasVisiveisDeUsuarioId,
        ));
        setCarregando(false);
        setErro('');
      },
      (falha) => {
        console.error('Erro ao acompanhar as pré-vendas em aberto:', falha);
        setCarregando(false);
        setErro('Não foi possível carregar as pré-vendas em aberto. Confira a conexão e toque em Tentar de novo.');
      },
    );
  }, [open, tenantId, vendasVisiveisDeUsuarioId, tentativa]);

  // Cada abertura comeca com a busca limpa e o cursor nela.
  useEffect(() => {
    if (!open) return;
    setBusca('');
    setMarcadaId('');
    buscaRef.current?.focus();
  }, [open]);

  // Pre-venda antiga sem o nome do vendedor gravado: busca os nomes no cadastro, uma vez e so' quando precisa.
  const faltaNomeDeVendedor = open && nomes === null && pedidos.some((p) => !String(p.vendedorNome || '').trim());
  useEffect(() => {
    if (!faltaNomeDeVendedor || !tenantId) return undefined;
    let ativo = true;
    getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId)))
      .then((usuarios) => {
        if (ativo) setNomes(Object.fromEntries(usuarios.docs.map((u) => [u.id, String(u.data().nome || u.data().nomeResponsavel || '')])));
      })
      .catch((falha) => {
        console.warn('Não foi possível ler os nomes dos vendedores:', falha);
        if (ativo) setNomes({});
      });
    return () => { ativo = false; };
  }, [faltaNomeDeVendedor, tenantId]);

  const linhas = useMemo(() => preVendasDoCaixa(pedidos, nomes || {}), [pedidos, nomes]);
  const filtradas = useMemo(() => filtrarPreVendasDoCaixa(linhas, busca), [linhas, busca]);
  // Sem escolha feita, a marca comeca na primeira que da' para puxar (Enter puxa direto).
  const marcada = filtradas.find((linha) => linha.id === marcadaId)
    || filtradas.find((linha) => !linha.soNoSistema && !travas.has(linha.id))
    || filtradas[0]
    || null;

  if (!open) return null;

  const escolher = (linha: PreVendaDoCaixa | null) => {
    if (!linha || puxando) return;
    if (linha.soNoSistema) {
      void showWarning('Esta pré-venda é faturada no sistema', linha.soNoSistema);
      return;
    }
    const trava = travas.get(linha.id);
    if (trava) {
      void NexusSwal.fire({ title: 'Em edição por outra pessoa', text: mensagemDeBloqueio('pedido_venda', trava), icon: 'info', confirmButtonText: 'Entendi' });
      return;
    }
    onEscolher(linha);
  };

  const moverMarca = (passo: number) => {
    if (filtradas.length === 0) return;
    const atual = Math.max(0, filtradas.findIndex((linha) => linha.id === (marcada?.id || '')));
    const proximo = Math.min(filtradas.length - 1, Math.max(0, atual + passo));
    setMarcadaId(filtradas[proximo].id);
  };

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal pdv-prevendas-modal" role="dialog" aria-modal="true" aria-label="Pré-vendas em aberto">
        <div className="pdv-modal-header">
          <div>
            <span>F8</span>
            <h2>Pré-vendas em aberto</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar" disabled={puxando}>
            <X size={20} />
          </button>
        </div>

        <div className="pdv-modal-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={buscaRef}
            value={busca}
            autoFocus
            onChange={(event) => { setBusca(event.target.value); setMarcadaId(''); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); moverMarca(1); }
              if (event.key === 'ArrowUp') { event.preventDefault(); moverMarca(-1); }
              if (event.key === 'Enter') { event.preventDefault(); escolher(marcada); }
            }}
            aria-label="Buscar pré-venda pelo número ou pelo cliente"
            title="Busque pelo número da pré-venda ou pelo nome do cliente. Setas escolhem, Enter puxa para o caixa."
          />
        </div>

        {carregando && linhas.length === 0 ? (
          <div className="pdv-modal-empty"><Loader2 className="spin-animation" size={20} /> Carregando pré-vendas...</div>
        ) : erro ? (
          <div className="pdv-modal-empty pdv-prevendas-erro">
            <p>{erro}</p>
            <button type="button" className="pdv-prevendas-atualizar" onClick={() => setTentativa((n) => n + 1)}>
              <RefreshCw size={16} aria-hidden="true" /> Tentar de novo
            </button>
          </div>
        ) : filtradas.length === 0 ? (
          <div className="pdv-modal-empty">
            <ClipboardList size={26} aria-hidden="true" />
            <p>{linhas.length === 0 ? 'Nenhuma pré-venda em aberto nesta filial.' : 'Nenhuma pré-venda com esse número ou cliente.'}</p>
          </div>
        ) : (
          <div className="pdv-prevendas-lista" role="listbox" aria-label="Pré-vendas em aberto">
            <div className="pdv-prevendas-cabecalho" aria-hidden="true">
              <span>Número</span>
              <span>Data</span>
              <span>Cliente</span>
              <span>Vendedor</span>
              <span>Valor</span>
            </div>
            {filtradas.map((linha) => {
              const trava = travas.get(linha.id);
              const parada = Boolean(trava || linha.soNoSistema);
              const aviso = trava ? descreverTrava(trava) : linha.soNoSistema ? 'Faturada só no sistema' : '';
              return (
                <button
                  type="button"
                  key={linha.id}
                  role="option"
                  aria-selected={marcada?.id === linha.id}
                  className={`pdv-prevendas-linha${marcada?.id === linha.id ? ' marcada' : ''}${parada ? ' parada' : ''}`}
                  onClick={() => setMarcadaId(linha.id)}
                  onDoubleClick={() => escolher(linha)}
                  title={trava ? mensagemDeBloqueio('pedido_venda', trava) : linha.soNoSistema || 'Duplo clique (ou Enter) puxa a pré-venda para o caixa'}
                >
                  <strong>#{linha.numeroPedido}</strong>
                  <span>{linha.data ? formatDateInputPtBr(getDateInputInTimeZone(linha.data)) : '—'}</span>
                  <span className="pdv-prevendas-cliente">
                    {linha.clienteNome}
                    {aviso && <small>{aviso}</small>}
                  </span>
                  <span>{linha.vendedorNome}</span>
                  <b>{currency.format(fromCents(linha.totalCents))}</b>
                </button>
              );
            })}
          </div>
        )}

        <div className="pdv-prevendas-rodape">
          <span title="A lista acompanha as pré-vendas ao vivo: não precisa atualizar a página">
            {filtradas.length === linhas.length
              ? `${linhas.length} pré-venda(s) em aberto`
              : `${filtradas.length} de ${linhas.length} pré-venda(s)`}
            {!erro && !carregando ? ' · atualiza sozinha' : ''}
          </span>
          <button type="button" className="btn-primary" onClick={() => escolher(marcada)} disabled={!marcada || puxando}>
            {puxando ? <Loader2 className="spin-animation" size={18} /> : <ClipboardList size={18} aria-hidden="true" />}
            {puxando ? 'Abrindo...' : 'Puxar para o caixa'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(PreVendasModal);

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ClipboardList, Loader2, Plus } from 'lucide-react';
import LeitorCameraCodigo, { cameraLeCodigo } from '../common/LeitorCameraCodigo';
import { NexusSwal, showSuccess, showWarning } from '../../utils/alerts';
import { erroDaQuantidade } from '../../utils/balancoDomain';
import {
  balancosParaContar,
  concluirMinhaParte,
  contarItem,
  minhaListaDoBalanco,
  procurarCodigoNoBalanco,
  type ItemContado,
  type ItemParaContar,
} from '../../services/balancoService';
import './contagemBalanco.css';

/**
 * CONTAR O BALANCO (21/10/2026) -- a mesma tela no app e no computador.
 * Contagem CEGA (decisao do dono): aqui nunca aparece o saldo do sistema.
 * So' os itens da lista da pessoa (o sistema dividiu ao abrir o balanco).
 *
 * Fluxo rapido: bipa/digita o codigo (ou toca no item) -> digita a quantidade
 * -> "Somar" (o mesmo item achado em outro lugar soma) ou "Corrigir total".
 * Produto com lote: escolhe o lote (ou "lote novo") e conta cada um.
 */

type Filtro = 'pendentes' | 'contados' | 'todos';
/** De quanto em quanto tempo a lista e' recarregada do servidor (item que um colega bipou some daqui). */
const INTERVALO_ATUALIZACAO_MS = 15000;

const formatar = (n: number | null, sigla: string) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${sigla}`);
const dataBr = (iso: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

const ContagemBalanco: React.FC<{ comCamera?: boolean }> = ({ comCamera = true }) => {
  const [balancos, setBalancos] = useState<Array<{ id: string; nome: string; itens: number }> | null>(null);
  const [balancoId, setBalancoId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [concluido, setConcluido] = useState(false);
  const [itens, setItens] = useState<ItemParaContar[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('pendentes');
  const [aberto, setAberto] = useState<ItemParaContar | null>(null);
  const [camera, setCamera] = useState(false);
  const [procurando, setProcurando] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  const carregarLista = useCallback(async (id: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await minhaListaDoBalanco(id);
      setNome(r.balanco.nome);
      setConcluido(r.balanco.concluido);
      setItens(r.itens);
      setBalancoId(id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    let cancelado = false;
    balancosParaContar()
      .then((lista) => {
        if (cancelado) return;
        setBalancos(lista);
        if (lista.length === 1) void carregarLista(lista[0].id);
      })
      .catch((e) => { if (!cancelado) setErro((e as Error).message); });
    return () => { cancelado = true; };
  }, [carregarLista]);

  const contados = itens.filter((i) => i.contado !== null).length;
  const visiveis = useMemo(() => {
    const termo = busca.trim().toUpperCase();
    return itens.filter((i) => {
      if (filtro === 'pendentes' && i.contado !== null) return false;
      if (filtro === 'contados' && i.contado === null) return false;
      if (!termo) return true;
      return i.nome.toUpperCase().includes(termo) || i.codigo.toUpperCase().includes(termo) || i.codigoBarras.toUpperCase() === termo;
    });
  }, [itens, busca, filtro]);

  /**
   * Codigo bipado/digitado: abre direto o item da lista. Se nao esta' na
   * minha lista, pergunta ao servidor (22/10/2026, pedido do dono no cliente):
   * item de outra pessoa abre a folha avisando de quem e' -- ao lancar, passa
   * para quem bipou (ou soma ao total do colega, se ele ja' contou).
   */
  const procurarCodigo = async (codigo: string) => {
    const c = codigo.trim().toUpperCase();
    if (!c || !balancoId) return;
    const achado = itens.find((i) => i.codigoBarras.toUpperCase() === c || i.codigo.toUpperCase() === c);
    if (achado) { setBusca(''); setAberto(achado); return; }
    setProcurando(true);
    try {
      const r = await procurarCodigoNoBalanco(balancoId, codigo.trim());
      setBusca('');
      setAberto({ ...r.item, deOutraPessoa: r.deOutraPessoa || null });
    } catch (e) {
      showWarning((e as Error).message);
    } finally {
      setProcurando(false);
    }
  };

  const ordenar = (lista: ItemParaContar[]) => [...lista].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome));

  const aoContar = (r: ItemContado) => {
    const { assumido, somadoAoDe, ...item } = r;
    const limpo: ItemParaContar = { ...item, deOutraPessoa: null };
    if (somadoAoDe) {
      // Somou ao total do colega: o item continua na lista dele.
      showSuccess(`${limpo.nome}: somado ao total de ${somadoAoDe}.`);
    } else if (assumido) {
      // Passou para a minha lista (e saiu da lista do outro).
      setItens((lista) => ordenar([...lista.filter((i) => i.chave !== limpo.chave), limpo]));
      showSuccess(`${limpo.nome} passou para a sua lista.`);
    } else {
      setItens((lista) => lista.map((i) => (i.chave === limpo.chave ? { ...i, contado: limpo.contado, lotes: limpo.lotes } : i)));
    }
    setAberto(null);
    setTimeout(() => buscaRef.current?.focus(), 50);
  };

  // A lista de cada pessoa muda por fora (um colega bipou um item meu, o
  // gestor passou itens): recarrega ao voltar para a tela e de tempos em
  // tempos, nunca com a folha de contagem aberta.
  useEffect(() => {
    if (!balancoId) return undefined;
    let ativo = true;
    const recarregar = () => {
      if (!ativo || aberto || document.visibilityState === 'hidden') return;
      minhaListaDoBalanco(balancoId).then((r) => {
        if (!ativo) return;
        setItens(r.itens);
        setConcluido(r.balanco.concluido);
      }).catch(() => { /* a proxima tentativa cobre; a tela continua com o que tem */ });
    };
    const timer = window.setInterval(recarregar, INTERVALO_ATUALIZACAO_MS);
    window.addEventListener('focus', recarregar);
    document.addEventListener('visibilitychange', recarregar);
    return () => {
      ativo = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', recarregar);
      document.removeEventListener('visibilitychange', recarregar);
    };
  }, [balancoId, aberto]);

  const concluir = async () => {
    if (!balancoId) return;
    const faltam = itens.length - contados;
    const r = await NexusSwal.fire({
      icon: faltam > 0 ? 'warning' : 'question',
      title: 'Concluir a sua contagem?',
      html: faltam > 0
        ? `<p style="text-align:left;margin:0">Ainda faltam <strong>${faltam}</strong> item(ns) na sua lista. <strong>Item não contado fica com estoque ZERO</strong> quando o balanço for fechado.</p>`
        : '<p style="margin:0">Todos os itens da sua lista foram contados. Você ainda pode corrigir até o gestor fechar o balanço.</p>',
      showCancelButton: true,
      confirmButtonText: 'Concluir',
      cancelButtonText: 'Voltar',
    });
    if (!r.isConfirmed) return;
    try {
      await concluirMinhaParte(balancoId);
      setConcluido(true);
      showSuccess('Contagem concluída. Avise o gestor.');
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (!balancoId) {
    return (
      <div className="cb">
        {erro && <div className="cb-erro" role="alert">{erro}</div>}
        {balancos === null || carregando ? (
          <div className="cb-cartao"><p className="cb-sub">Carregando...</p></div>
        ) : balancos.length === 0 ? (
          <div className="cb-cartao">
            <p className="cb-titulo">Nenhum balanço para você contar agora</p>
            <p className="cb-sub">Quando o gestor abrir um balanço com você na lista, ele aparece aqui.</p>
          </div>
        ) : (
          balancos.map((b) => (
            <button key={b.id} type="button" className="cb-item" onClick={() => void carregarLista(b.id)}>
              <ClipboardList size={22} />
              <span className="cb-item-nome"><strong>{b.nome}</strong><small>{b.itens} item(ns) na sua lista</small></span>
            </button>
          ))
        )}
      </div>
    );
  }

  let grupoAnterior = '';
  return (
    <div className="cb">
      <div className="cb-cartao">
        <p className="cb-titulo">{nome}</p>
        <p className="cb-sub">{contados} de {itens.length} contados{concluido ? ' · você concluiu (ainda dá para corrigir)' : ''}</p>
        <div className="cb-progresso" aria-hidden="true"><span style={{ width: `${itens.length ? (contados / itens.length) * 100 : 0}%` }} /></div>
      </div>

      {erro && <div className="cb-erro" role="alert">{erro}</div>}

      <form className="cb-busca" onSubmit={(e) => { e.preventDefault(); void procurarCodigo(busca); }}>
        <input
          ref={buscaRef}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar por nome, código ou código de barras"
          title="Digite o nome ou bipe o código de barras e aperte Enter. Código que está na lista de outra pessoa também abre: ao lançar, o item passa para você."
          autoComplete="off"
          enterKeyHint="search"
          disabled={procurando}
        />
        {comCamera && cameraLeCodigo() && (
          <button type="button" onClick={() => setCamera(true)} aria-label="Ler código pela câmera"><Camera size={18} /></button>
        )}
      </form>

      <div className="cb-filtros" role="group" aria-label="Mostrar">
        {(['pendentes', 'contados', 'todos'] as Filtro[]).map((f) => (
          <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {f === 'pendentes' ? `Faltam (${itens.length - contados})` : f === 'contados' ? `Contados (${contados})` : `Todos (${itens.length})`}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="cb-cartao"><p className="cb-sub">{filtro === 'pendentes' && contados === itens.length ? 'Tudo contado. Toque em "Concluir minha contagem".' : 'Nenhum item aqui.'}</p></div>
      ) : (
        <ul className="cb-lista">
          {visiveis.map((i) => {
            const cabecalho = i.grupo !== grupoAnterior ? i.grupo : null;
            grupoAnterior = i.grupo;
            return (
              <React.Fragment key={i.chave}>
                {cabecalho && <li className="cb-grupo">{cabecalho}</li>}
                <li>
                  <button type="button" className="cb-item" onClick={() => setAberto(i)}>
                    <span className="cb-item-nome">
                      <strong>{i.nome}</strong>
                      <small>{i.codigo}{i.controlaLote ? ' · por lote' : ''}</small>
                    </span>
                    <span className={`cb-selo ${i.contado === null ? 'cb-selo--pendente' : 'cb-selo--ok'}`}>
                      {i.contado === null ? 'Contar' : formatar(i.contado, i.unidade.sigla)}
                    </span>
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      )}

      <div className="cb-rodape">
        <button type="button" className="btn-primary" onClick={() => void concluir()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px' }}>
          <Check size={18} /> Concluir minha contagem
        </button>
      </div>

      {aberto && balancoId && (
        <FolhaDeContagem balancoId={balancoId} item={aberto} onFechar={() => setAberto(null)} onContado={aoContar} />
      )}
      {camera && (
        <LeitorCameraCodigo aberto onLido={(codigo) => { setCamera(false); void procurarCodigo(codigo); }} onFechar={() => setCamera(false)} />
      )}
    </div>
  );
};

/** Folha (de baixo, no celular) para digitar a quantidade de um item. */
const FolhaDeContagem: React.FC<{
  balancoId: string;
  item: ItemParaContar;
  onFechar: () => void;
  onContado: (r: ItemContado) => void;
}> = ({ balancoId, item, onFechar, onContado }) => {
  const [qtd, setQtd] = useState('');
  const [loteIndice, setLoteIndice] = useState<number | 'novo' | null>(item.controlaLote ? (item.lotes.length ? 0 : 'novo') : null);
  const [loteNovo, setLoteNovo] = useState({ lote: '', validade: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const qtdRef = useRef<HTMLInputElement>(null);

  useEffect(() => { qtdRef.current?.focus(); }, [loteIndice]);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salvando) onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [salvando, onFechar]);

  const jaContado = item.controlaLote
    ? (typeof loteIndice === 'number' ? item.lotes[loteIndice]?.contado ?? null : null)
    : item.contado;
  // Item da lista de outra pessoa (22/10/2026): ainda nao contado passa para
  // mim ao lancar; ja' contado pelo colega so' soma (com confirmacao).
  const deOutro = item.deOutraPessoa || null;
  const colegaJaContou = Boolean(deOutro && deOutro.contado !== null);

  const salvar = async (modo: 'somar' | 'definir') => {
    const quantidade = Number(qtd.replace(',', '.'));
    if (qtd.trim() === '') { setErro('Digite a quantidade contada.'); return; }
    const problema = erroDaQuantidade(quantidade, item.unidade, item.nome);
    if (problema) { setErro(problema); return; }
    if (item.controlaLote && loteIndice === 'novo' && !loteNovo.lote.trim()) { setErro('Informe o número do lote novo.'); return; }
    setErro(null);
    if (colegaJaContou && deOutro) {
      const r = await NexusSwal.fire({
        icon: 'question',
        title: `Somar ao total de ${deOutro.nome}?`,
        html: `<p style="text-align:left;margin:0">${deOutro.nome} já contou <strong>${formatar(deOutro.contado, item.unidade.sigla)}</strong> de ${item.nome}. Se você achou mais em outro lugar, a sua quantidade é somada ao total dele. Se é a mesma prateleira, não some: combine com ${deOutro.nome}.</p>`,
        showCancelButton: true,
        confirmButtonText: 'Somar',
        cancelButtonText: 'Voltar',
      });
      if (!r.isConfirmed) return;
    }
    setSalvando(true);
    try {
      const r = await contarItem(balancoId, {
        chave: item.chave,
        quantidade,
        modo,
        ...(deOutro ? { assumir: true } : {}),
        ...(item.controlaLote && typeof loteIndice === 'number' ? { loteIndice } : {}),
        ...(item.controlaLote && loteIndice === 'novo' ? { loteNovo: { lote: loteNovo.lote, validade: loteNovo.validade } } : {}),
      });
      onContado(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="cb-fundo" onClick={(e) => { if (e.target === e.currentTarget && !salvando) onFechar(); }}>
      <div className="cb-folha" role="dialog" aria-modal="true" aria-labelledby="cb-folha-titulo">
        <div>
          <p id="cb-folha-titulo" className="cb-titulo">{item.nome}</p>
          <p className="cb-sub">{item.codigo}{item.codigoBarras ? ` · ${item.codigoBarras}` : ''} · contado em {item.unidade.sigla}{item.unidade.fracionado ? '' : ' (sem fração)'}</p>
        </div>
        {deOutro && (
          <div className="cb-aviso" role="status">
            {colegaJaContou
              ? <>Já contado por <strong>{deOutro.nome}</strong>: {formatar(deOutro.contado, item.unidade.sigla)}. Aqui só dá para <strong>somar</strong> ao total dele.</>
              : <>Este item está na lista de <strong>{deOutro.nome}</strong>. Ao lançar, ele passa para a sua lista e sai da dele.</>}
          </div>
        )}

        {item.controlaLote && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {item.lotes.map((l, k) => (
              <button key={`${l.lote}-${k}`} type="button" className="cb-lote" aria-pressed={loteIndice === k} onClick={() => setLoteIndice(k)}>
                <span style={{ flex: 1 }}><strong>Lote {l.lote}</strong>{l.validade ? ` · vence ${dataBr(l.validade)}` : ''}</span>
                <span className={`cb-selo ${l.contado === null ? 'cb-selo--pendente' : 'cb-selo--ok'}`}>{l.contado === null ? 'Contar' : formatar(l.contado, item.unidade.sigla)}</span>
              </button>
            ))}
            <button type="button" className="cb-lote" aria-pressed={loteIndice === 'novo'} onClick={() => setLoteIndice('novo')}>
              <Plus size={16} /> <span>Achei um lote que não está na lista</span>
            </button>
            {loteIndice === 'novo' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input className="cb-campo" aria-label="Número do lote" title="Número do lote" value={loteNovo.lote} onChange={(e) => setLoteNovo((v) => ({ ...v, lote: e.target.value.toUpperCase() }))} />
                <input className="cb-campo" type="date" aria-label="Validade do lote" title="Validade do lote" value={loteNovo.validade} onChange={(e) => setLoteNovo((v) => ({ ...v, validade: e.target.value }))} />
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="cb-qtd" className="cb-sub" style={{ display: 'block', marginBottom: '6px' }}>
            Quantidade encontrada{jaContado !== null && !deOutro ? ` (já contou ${formatar(jaContado, item.unidade.sigla)})` : ''}
          </label>
          <input
            id="cb-qtd"
            ref={qtdRef}
            className="cb-qtd"
            inputMode={item.unidade.fracionado ? 'decimal' : 'numeric'}
            value={qtd}
            onChange={(e) => { setQtd(e.target.value.replace(/[^\d.,]/g, '')); setErro(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void salvar('somar'); } }}
            autoComplete="off"
          />
        </div>

        {erro && <div className="cb-erro" role="alert">{erro}</div>}

        <div className="cb-acoes">
          <button type="button" className="btn-secondary" disabled={salvando || colegaJaContou} onClick={() => void salvar('definir')} title={colegaJaContou ? `O total é de ${deOutro?.nome}: só dá para somar` : 'Troca o total contado por este número'}>
            Corrigir total
          </button>
          <button type="button" className="btn-primary" disabled={salvando} onClick={() => void salvar('somar')} title="Soma ao que já foi contado (o mesmo item em outro lugar)" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {salvando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={16} />} Somar
          </button>
        </div>
        <p className="cb-sub" style={{ margin: 0 }}>"Somar" acrescenta ao que já contou (o mesmo item em outra prateleira). "Corrigir total" troca o número.</p>
        <button type="button" className="btn-secondary" onClick={onFechar} disabled={salvando}>Voltar</button>
      </div>
    </div>
  );
};

export default ContagemBalanco;

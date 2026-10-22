import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { abrirCotacaoPublica, responderCotacaoPublica, type CotacaoPublica as DadosDaCotacao } from '../../services/comprasService';
import { formatarReais } from '../../utils/comprasDomain';

/**
 * PAGINA DO FORNECEDOR (sem login, 22/10/2026): /cotacao/:token. Ele digita
 * o codigo de acesso que a empresa mandou, ve os itens e preenche preco por
 * item, prazo de entrega e condicao de pagamento. Pode corrigir enquanto a
 * cotacao estiver aberta e dentro do prazo. Nada do banco e' lido aqui:
 * tudo passa pelo servidor (server/routes/cotacaoPublica.routes.js).
 */

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const centavosDoTexto = (texto: string): number | null => {
  const limpo = String(texto || '').trim();
  if (!limpo) return null;
  const n = Number(limpo.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const textoDosCentavos = (c: number) => (c / 100).toFixed(2).replace('.', ',');

const campo: React.CSSProperties = { width: '100%', height: '44px', borderRadius: '10px', border: '1px solid #cfd4e2', padding: '0 12px', fontSize: '16px', backgroundColor: '#fff', color: '#1f2235', boxSizing: 'border-box' };
const rotulo: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#5b6178', fontWeight: 600 };

const CotacaoPublica: React.FC = () => {
  const { token = '' } = useParams();
  const [codigo, setCodigo] = useState('');
  const [dados, setDados] = useState<DadosDaCotacao | null>(null);
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [prazo, setPrazo] = useState('');
  const [condicao, setCondicao] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [enviada, setEnviada] = useState(false);

  const abrir = async () => {
    setErro('');
    setOcupado(true);
    try {
      const r = await abrirCotacaoPublica(token, codigo.trim());
      setDados(r);
      if (r.respostaAnterior) {
        setPrecos(Object.fromEntries(Object.entries(r.respostaAnterior.precos).map(([k, v]) => [k, textoDosCentavos(Number(v))])));
        setPrazo(r.respostaAnterior.prazoEntregaDias === null ? '' : String(r.respostaAnterior.prazoEntregaDias));
        setCondicao(r.respostaAnterior.condicaoPagamento);
        setObservacao(r.respostaAnterior.observacao);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a cotação.');
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    if (!dados) return;
    const lidos: Record<string, number> = {};
    for (const item of dados.itens) {
      const c = centavosDoTexto(precos[item.produtoId] || '');
      if (precos[item.produtoId] && c === null) { setErro(`Preço inválido em ${item.nome}. Use só números, ex.: 12,50.`); return; }
      if (c !== null && c > 0) lidos[item.produtoId] = c;
    }
    if (Object.keys(lidos).length === 0) { setErro('Informe o preço de pelo menos um item.'); return; }
    setErro('');
    setOcupado(true);
    try {
      await responderCotacaoPublica(token, codigo.trim(), { precos: lidos, prazoEntregaDias: prazo.trim() ? Number(prazo) : null, condicaoPagamento: condicao.trim(), observacao: observacao.trim() });
      setEnviada(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar a proposta.');
    } finally {
      setOcupado(false);
    }
  };

  const total = dados ? dados.itens.reduce((t, i) => { const c = centavosDoTexto(precos[i.produtoId] || ''); return t + (c ? Math.round(c * i.quantidade) : 0); }, 0) : 0;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f3f4fa', padding: '24px 16px', fontFamily: 'Inter, system-ui, sans-serif', color: '#1f2235' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, #7c3aed, #4c1d95)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ClipboardList size={22} /></span>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 800 }}>Cotação de compra</div>
            <div style={{ fontSize: '13px', color: '#5b6178' }}>{dados ? `${dados.empresa} · nº ${String(dados.numero).padStart(4, '0')}` : 'Informe o código de acesso enviado pela empresa'}</div>
          </div>
        </div>

        {erro && <div style={{ borderRadius: '12px', padding: '12px 14px', backgroundColor: '#fde8e8', border: '1px solid #f5b5b5', color: '#b42318', fontSize: '14px' }}>{erro}</div>}

        {!dados && (
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '20px', border: '1px solid #e1e4ef', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={rotulo}>Código de acesso (6 números)
              <input value={codigo} inputMode="numeric" maxLength={6} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void abrir(); }} style={{ ...campo, letterSpacing: '0.3em', fontSize: '22px', textAlign: 'center' }} />
            </label>
            <button type="button" onClick={() => void abrir()} disabled={ocupado || codigo.length !== 6} style={{ height: '46px', borderRadius: '12px', border: 'none', background: '#6d28d9', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: 'pointer', opacity: ocupado || codigo.length !== 6 ? 0.6 : 1 }}>
              {ocupado ? 'Abrindo...' : 'Ver a cotação'}
            </button>
          </div>
        )}

        {dados && enviada && (
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '28px 20px', border: '1px solid #e1e4ef', textAlign: 'center' }}>
            <CheckCircle2 size={44} color="#10b981" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontSize: '18px', fontWeight: 800 }}>Proposta enviada</div>
            <p style={{ color: '#5b6178', fontSize: '14px', margin: '8px 0 16px' }}>{dados.empresa} recebeu seus preços. Se precisar corrigir até {dataBr(dados.responderAte)}, abra este link de novo com o mesmo código.</p>
            <button type="button" onClick={() => setEnviada(false)} style={{ height: '42px', padding: '0 18px', borderRadius: '12px', border: '1px solid #cfd4e2', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Rever a proposta</button>
          </div>
        )}

        {dados && !enviada && (
          <>
            <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '18px 20px', border: '1px solid #e1e4ef', fontSize: '14px', lineHeight: 1.5 }}>
              <div style={{ fontSize: '16px', fontWeight: 800 }}>{dados.titulo}</div>
              <div style={{ color: '#5b6178' }}>Para: <strong>{dados.fornecedorNome}</strong> · Responder até <strong>{dataBr(dados.responderAte)}</strong></div>
              {dados.observacao && <div style={{ marginTop: '6px' }}>{dados.observacao}</div>}
              {dados.respostaAnterior && !dados.bloqueio && <div style={{ marginTop: '8px', color: '#0f766e', fontWeight: 600 }}>Você já respondeu esta cotação; pode corrigir os valores abaixo.</div>}
              {dados.bloqueio && <div style={{ marginTop: '8px', color: '#b42318', fontWeight: 600 }}>{dados.bloqueio}</div>}
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e1e4ef', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f6f7fb', color: '#5b6178', fontSize: '12px', textTransform: 'uppercase' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Produto</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Qtd.</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px', width: '150px' }}>Preço unitário (R$)</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.itens.map((item) => {
                      const c = centavosDoTexto(precos[item.produtoId] || '');
                      return (
                        <tr key={item.produtoId} style={{ borderTop: '1px solid #eceef5' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 600 }}>{item.nome}</div>
                            <div style={{ fontSize: '12px', color: '#5b6178' }}>{item.codigo ? `Cód. ${item.codigo}` : ''}{item.observacao ? ` · ${item.observacao}` : ''}</div>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{item.quantidade.toLocaleString('pt-BR')} {item.unidade}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <input value={precos[item.produtoId] || ''} inputMode="decimal" disabled={Boolean(dados.bloqueio)} onChange={(e) => setPrecos({ ...precos, [item.produtoId]: e.target.value })} style={{ ...campo, height: '40px' }} aria-label={`Preço de ${item.nome}`} />
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{c ? formatarReais(Math.round(c * item.quantidade)) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e1e4ef' }}>
                      <td colSpan={3} style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>Total dos itens cotados</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800, fontSize: '16px' }}>{formatarReais(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '18px 20px', border: '1px solid #e1e4ef', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <label style={rotulo}>Prazo de entrega (dias)
                <input value={prazo} inputMode="numeric" disabled={Boolean(dados.bloqueio)} onChange={(e) => setPrazo(e.target.value.replace(/\D/g, ''))} style={campo} />
              </label>
              <label style={rotulo}>Condição de pagamento
                <input value={condicao} maxLength={120} disabled={Boolean(dados.bloqueio)} onChange={(e) => setCondicao(e.target.value)} style={campo} title="Ex.: à vista, 28 dias, 30/60" />
              </label>
              <label style={{ ...rotulo, gridColumn: '1 / -1' }}>Observação (opcional)
                <input value={observacao} maxLength={500} disabled={Boolean(dados.bloqueio)} onChange={(e) => setObservacao(e.target.value)} style={campo} />
              </label>
            </div>

            {!dados.bloqueio && (
              <button type="button" onClick={() => void enviar()} disabled={ocupado} style={{ height: '50px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #7c3aed, #4c1d95)', color: '#fff', fontWeight: 800, fontSize: '16px', cursor: 'pointer', opacity: ocupado ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {ocupado && <Loader2 size={18} className="spin-icon" />} {ocupado ? 'Enviando...' : 'Enviar proposta'}
              </button>
            )}
            <p style={{ fontSize: '12px', color: '#8b90a6', textAlign: 'center', margin: 0 }}>Item sem preço = você não cota esse item. Preços em reais, sem impostos adicionais além dos informados na observação.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default CotacaoPublica;

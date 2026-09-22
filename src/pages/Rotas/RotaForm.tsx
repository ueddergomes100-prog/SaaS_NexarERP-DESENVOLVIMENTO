import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Save, Trash2, Truck } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  CATEGORIA_DESPESA_ROTA,
  TIPOS_DESPESA_ROTA,
  avisosDaRota,
  descricaoDaDespesaNoFinanceiro,
  despesaVazia,
  despesasValidas,
  errosDaRota,
  totaisPorTipo,
  totalDaRota,
  type DespesaRota,
  type RotaRascunho,
  type TipoDespesaRota,
} from '../../utils/rotaDomain';

/**
 * LANCAMENTO DE ROTA: UMA VIAGEM, VARIAS DESPESAS, UM SALVAR SO' (2026-09-21).
 *
 * Pedido do dono, na letra: "o motorista tal, com caminhao tal, gastou
 * aluguel, almoco, gasolina, pedagio -- lanca tudo num so'. Nao ter que
 * lancar uma despesa de gasolina, outra de almoco, outra de hospedagem."
 *
 * Por isso a tela e' uma so': escolhe motorista, veiculo e dia, e vai
 * empilhando as despesas numa tabela. Ao salvar, a rota vira UM documento em
 * `rotas` e cada despesa vira uma linha em `transacoes` (saida, categoria
 * DESPESAS DE ROTA) -- porque e' assim que Contas a Pagar e os relatorios
 * enxergam dinheiro. Quem lanca faz isso uma vez.
 *
 * Tudo num `writeBatch`: ou a rota e todas as despesas entram, ou nada entra.
 * Rota gravada pela metade viraria despesa sem dono no financeiro.
 *
 * As despesas nascem `status: 'Paga'` porque o dinheiro JA saiu -- o
 * motorista pagou o pedagio na hora. E `movimentaCaixaFisico: false`: nao foi
 * o caixa da loja que pagou, foi adiantamento/bolso do motorista.
 */

interface MotoristaBasico { id: string; nome?: string; ativo?: boolean }

const RotaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const somenteLeitura = Boolean(id);
  const { currentUser, tenantId } = useAuth();
  const { items: motoristas } = useTenantCollection<MotoristaBasico>('motoristas', tenantId);

  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(Boolean(id));
  const [rota, setRota] = useState<RotaRascunho>({
    motoristaId: '',
    motoristaNome: '',
    veiculo: '',
    data: getDateInputInTimeZone(),
    observacao: '',
    despesas: [despesaVazia()],
  });

  useEffect(() => {
    const carregar = async () => {
      if (!id || !tenantId) return;
      try {
        const snap = await getDoc(doc(db, 'rotas', id));
        if (!snap.exists() || snap.data().tenantId !== tenantId) {
          showError('Rota não encontrada', 'Esta rota não existe ou é de outra empresa.');
          navigate('/operacoes/rotas');
          return;
        }
        const dados = snap.data();
        setRota({
          motoristaId: dados.motoristaId || '',
          motoristaNome: dados.motoristaNome || '',
          veiculo: dados.veiculo || '',
          data: dados.data || '',
          observacao: dados.observacao || '',
          despesas: Array.isArray(dados.despesas) ? dados.despesas : [],
        });
      } catch (erro) {
        console.error('Erro ao carregar a rota:', erro);
        showError('Erro ao abrir', 'Não foi possível carregar esta rota. Tente de novo.');
      } finally {
        setCarregando(false);
      }
    };
    void carregar();
  }, [id, tenantId, navigate]);

  const mudarDespesa = (indice: number, mudanca: Partial<DespesaRota>) => {
    setRota((atual) => ({
      ...atual,
      despesas: atual.despesas.map((d, i) => (i === indice ? { ...d, ...mudanca } : d)),
    }));
  };

  const adicionarLinha = () => setRota((atual) => ({ ...atual, despesas: [...atual.despesas, despesaVazia()] }));

  const removerLinha = (indice: number) => {
    setRota((atual) => {
      const restantes = atual.despesas.filter((_, i) => i !== indice);
      // Nunca deixa a tabela sem nenhuma linha: sem campo pra digitar, a
      // pessoa teria de descobrir sozinha que precisa clicar em "adicionar".
      return { ...atual, despesas: restantes.length > 0 ? restantes : [despesaVazia()] };
    });
  };

  const salvar = async () => {
    if (!currentUser || !tenantId) return;

    const erros = errosDaRota(rota);
    if (erros.length > 0) {
      showError('Confira a rota', erros.join(' '));
      return;
    }

    const avisos = avisosDaRota(rota);
    if (avisos.length > 0) {
      const confirma = await NexusSwal.fire({
        icon: 'warning',
        title: 'Confira antes de salvar',
        html: `${avisos.map((a) => `• ${a}`).join('<br/>')}<br/><br/>Salvar assim mesmo?`,
        showCancelButton: true,
        confirmButtonText: 'Salvar mesmo assim',
        cancelButtonText: 'Voltar e revisar',
      });
      if (!confirma.isConfirmed) return;
    }

    setSalvando(true);
    try {
      const despesas = despesasValidas(rota.despesas);
      const lote = writeBatch(db);
      const metadata = buildDocumentMetadata(currentUser.uid, serverTimestamp());

      // A rota primeiro, pra cada despesa ja nascer apontando pra ela.
      const rotaRef = doc(collection(db, 'rotas'));
      const transacaoIds: string[] = [];

      despesas.forEach((despesa) => {
        const transacaoRef = doc(collection(db, 'transacoes'));
        transacaoIds.push(transacaoRef.id);
        lote.set(transacaoRef, {
          descricao: descricaoDaDespesaNoFinanceiro(despesa, rota.motoristaNome, rota.data),
          data: rota.data,
          dataPagamento: rota.data,
          valor: Number(despesa.valor) || 0,
          categoria: CATEGORIA_DESPESA_ROTA,
          // O dinheiro ja saiu (o motorista pagou na estrada), mas nao saiu do
          // caixa da loja -- por isso Paga e sem movimento de caixa fisico.
          status: 'Paga',
          tipo: 'saida',
          movimentaCaixaFisico: false,
          rotaId: rotaRef.id,
          motoristaId: rota.motoristaId,
          motoristaNome: rota.motoristaNome,
          tipoDespesaRota: despesa.tipo,
          ...(String(despesa.comprovante || '').trim() ? { comprovante: despesa.comprovante.trim() } : {}),
          tenantId,
          createdAt: serverTimestamp(),
          ...metadata,
        });
      });

      lote.set(rotaRef, {
        motoristaId: rota.motoristaId,
        motoristaNome: rota.motoristaNome,
        veiculo: rota.veiculo.trim(),
        data: rota.data,
        observacao: rota.observacao.trim(),
        despesas,
        totalCentavos: Math.round(totalDaRota(despesas) * 100),
        total: totalDaRota(despesas),
        transacaoIds,
        tenantId,
        createdAt: serverTimestamp(),
        ...metadata,
      });

      await lote.commit();
      showSuccess(`Rota salva! ${despesas.length} despesa(s) lançada(s) no financeiro.`);
      navigate('/operacoes/rotas');
    } catch (erro) {
      console.error('Erro ao salvar a rota:', erro);
      showError('Erro ao salvar', 'Não foi possível salvar a rota. Verifique sua conexão e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando rota...</div>;

  const total = totalDaRota(rota.despesas);
  const totais = totaisPorTipo(rota.despesas);
  const motoristasAtivos = motoristas.filter((m) => m.ativo !== false);
  const avisos = avisosDaRota(rota);

  const estiloCampo: React.CSSProperties = {
    padding: '10px 12px',
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" onClick={() => navigate('/operacoes/rotas')} style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Truck size={26} color="var(--accent-purple)" />
              {somenteLeitura ? 'Rota lançada' : 'Nova Rota'}
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              {somenteLeitura
                ? 'Despesas já lançadas no financeiro.'
                : 'Lance de uma vez tudo o que o motorista gastou na viagem: combustível, pedágio, alimentação, hospedagem.'}
            </p>
          </div>
        </div>
        {!somenteLeitura && (
          <button className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: salvando ? 0.6 : 1 }}>
            {salvando ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} />}
            {salvando ? 'Salvando...' : 'Salvar Rota'}
          </button>
        )}
      </div>

      <fieldset disabled={somenteLeitura} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Motorista *</label>
            <select
              value={rota.motoristaId}
              onChange={(e) => {
                const escolhido = motoristasAtivos.find((m) => m.id === e.target.value);
                setRota({ ...rota, motoristaId: e.target.value, motoristaNome: escolhido?.nome || '' });
              }}
              style={estiloCampo}
            >
              <option value="">Escolha o motorista...</option>
              {motoristasAtivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            {motoristasAtivos.length === 0 && (
              <span style={{ fontSize: '11.5px', color: '#f59e0b' }}>
                Nenhum motorista cadastrado. Cadastre em Operações &gt; Motoristas.
              </span>
            )}
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Veículo</label>
            <input type="text" value={rota.veiculo} onChange={(e) => setRota({ ...rota, veiculo: e.target.value })} placeholder="Placa e/ou modelo" style={{ ...estiloCampo, textTransform: 'uppercase' }} />
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data da rota *</label>
            <input type="date" value={rota.data} onChange={(e) => setRota({ ...rota, data: e.target.value })} style={estiloCampo} />
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Observação</label>
            <input type="text" value={rota.observacao} onChange={(e) => setRota({ ...rota, observacao: e.target.value })} placeholder="Opcional — ex.: entrega em Manhuaçu e Caratinga" style={estiloCampo} />
          </div>
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Despesas da viagem</h3>
            {!somenteLeitura && (
              <button type="button" className="btn-secondary" onClick={adicionarLinha} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={16} /> Adicionar despesa
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 8px', minWidth: '150px' }}>Tipo</th>
                  <th style={{ padding: '10px 8px' }}>Descrição</th>
                  <th style={{ padding: '10px 8px', minWidth: '130px' }}>Comprovante</th>
                  <th style={{ padding: '10px 8px', minWidth: '120px', textAlign: 'right' }}>Valor (R$)</th>
                  {!somenteLeitura && <th style={{ padding: '10px 8px', width: '50px' }} />}
                </tr>
              </thead>
              <tbody>
                {rota.despesas.map((despesa, indice) => (
                  <tr key={indice} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '8px' }}>
                      <select value={despesa.tipo} onChange={(e) => mudarDespesa(indice, { tipo: e.target.value as TipoDespesaRota })} style={{ ...estiloCampo, padding: '8px 10px' }}>
                        {TIPOS_DESPESA_ROTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={despesa.descricao} onChange={(e) => mudarDespesa(indice, { descricao: e.target.value })} placeholder={despesa.tipo === 'outros' ? 'Obrigatório em "Outros"' : 'Opcional'} style={{ ...estiloCampo, padding: '8px 10px' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={despesa.comprovante} onChange={(e) => mudarDespesa(indice, { comprovante: e.target.value })} placeholder="Nº da notinha" style={{ ...estiloCampo, padding: '8px 10px' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="number" min="0" step="0.01" value={despesa.valor || ''} onChange={(e) => mudarDespesa(indice, { valor: Number(e.target.value) || 0 })} placeholder="0,00" style={{ ...estiloCampo, padding: '8px 10px', textAlign: 'right', fontWeight: 600 }} />
                    </td>
                    {!somenteLeitura && (
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <button type="button" className="icon-btn" title="Remover esta despesa" onClick={() => removerLinha(indice)} style={{ color: '#ef4444' }}><Trash2 size={16} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '20px', flexWrap: 'wrap', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {totais.map((t) => (
                <span key={t.tipo}>
                  {t.label}: <strong style={{ color: 'var(--text-primary)' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.totalCentavos / 100)}</strong>
                </span>
              ))}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total da rota</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#ef4444' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}
              </div>
            </div>
          </div>

          {!somenteLeitura && avisos.length > 0 && (
            <div style={{ marginTop: '16px', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '13px', display: 'flex', gap: '10px' }}>
              <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>{avisos.join(' ')}</div>
            </div>
          )}

          <p style={{ marginTop: '16px', marginBottom: 0, fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Ao salvar, cada despesa vira um lançamento em <strong>{CATEGORIA_DESPESA_ROTA}</strong>, já como paga — o dinheiro
            saiu na viagem. Não movimenta o caixa da loja.
          </p>
        </div>
      </fieldset>
    </div>
  );
};

export default RotaForm;

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Save, Settings2, Trash2, Truck, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { hasTenantFullAccess } from '../../utils/roles';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import CampoComSugestoes from '../../components/common/CampoComSugestoes';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { buildDocumentMetadata } from '../../utils/documentMetadata';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  CATEGORIA_DESPESA_ROTA,
  TIPO_DESPESA_OUTROS,
  avisosDaRota,
  descricaoDaDespesaNoFinanceiro,
  despesaVazia,
  despesasValidas,
  erroDoTipoPersonalizado,
  errosDaRota,
  normalizarTipoPersonalizado,
  tiposDeDespesaDisponiveis,
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
  const { currentUser, tenantId, userRole, isOwner } = useAuth();
  const { items: motoristas } = useTenantCollection<MotoristaBasico>('motoristas', tenantId);
  // Veiculos do cadastro (Cadastros > Veiculos): viram sugestao no campo Veiculo.
  const { items: veiculosCadastrados } = useTenantCollection<{ id: string; placa?: string; modelo?: string; ativo?: boolean }>('veiculos', tenantId);
  const opcoesVeiculo = veiculosCadastrados
    .filter((v) => v.ativo !== false && (v.placa || v.modelo))
    .map((v) => [v.placa, v.modelo].map((x) => String(x || '').trim()).filter(Boolean).join(' - ').toUpperCase());

  // Tipos de despesa que a empresa cadastrou (configuracoes/{tenantId}.tiposDespesaRota).
  const [tiposPersonalizados, setTiposPersonalizados] = useState<string[]>([]);
  const [gerenciandoTipos, setGerenciandoTipos] = useState(false);
  const [novoTipo, setNovoTipo] = useState('');
  const [salvandoTipos, setSalvandoTipos] = useState(false);
  const podeGerenciarTipos = hasTenantFullAccess(userRole, isOwner) && !somenteLeitura;
  const tiposDisponiveis = tiposDeDespesaDisponiveis(tiposPersonalizados);

  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        const lista = snap.exists() ? snap.data().tiposDespesaRota : [];
        setTiposPersonalizados(Array.isArray(lista) ? lista.map(normalizarTipoPersonalizado).filter(Boolean) : []);
      })
      .catch((erro) => console.error('Erro ao carregar os tipos de despesa da rota:', erro));
  }, [tenantId]);

  const gravarTipos = async (novaLista: string[]) => {
    if (!tenantId || !currentUser) return false;
    setSalvandoTipos(true);
    try {
      await updateDoc(doc(db, 'configuracoes', tenantId), { tiposDespesaRota: novaLista });
      setTiposPersonalizados(novaLista);
      return true;
    } catch (erro) {
      console.error('Erro ao salvar os tipos de despesa da rota:', erro);
      showError('Não foi possível salvar', 'Confira sua conexão e se você tem permissão de administrador.');
      return false;
    } finally {
      setSalvandoTipos(false);
    }
  };

  const adicionarTipo = async () => {
    const erro = erroDoTipoPersonalizado(novoTipo, tiposPersonalizados);
    if (erro) { showError('Tipo de despesa', erro); return; }
    if (await gravarTipos([...tiposPersonalizados, normalizarTipoPersonalizado(novoTipo)])) setNovoTipo('');
  };

  const removerTipo = async (nome: string) => {
    const confirma = await NexusSwal.fire({
      icon: 'question',
      title: `Remover "${nome}"?`,
      text: 'Rotas que já usaram esse tipo continuam mostrando o nome. Ele só deixa de aparecer para novas despesas.',
      showCancelButton: true,
      confirmButtonText: 'Remover',
      cancelButtonText: 'Cancelar',
    });
    if (confirma.isConfirmed) await gravarTipos(tiposPersonalizados.filter((t) => t !== nome));
  };

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
            <CampoComSugestoes
              opcoes={opcoesVeiculo}
              value={rota.veiculo}
              onChange={(e) => setRota({ ...rota, veiculo: aplicarCaixaAltaCadastro(e.target, e.target.value) })}
              placeholder={opcoesVeiculo.length > 0 ? 'Escolha o veículo ou digite a placa' : 'Placa e/ou modelo'}
              style={{ ...estiloCampo, textTransform: 'uppercase' }}
            />
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
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {podeGerenciarTipos && (
                  <button type="button" className="btn-secondary" onClick={() => setGerenciandoTipos(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Settings2 size={16} /> Tipos de despesa
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={adicionarLinha} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Plus size={16} /> Adicionar despesa
                </button>
              </div>
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
                        {tiposDisponiveis.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        {/* Rota antiga com tipo que saiu do cadastro: continua aparecendo. */}
                        {!tiposDisponiveis.some((t) => t.value === despesa.tipo) && <option value={despesa.tipo}>{despesa.tipo}</option>}
                      </select>
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={despesa.descricao} onChange={(e) => mudarDespesa(indice, { descricao: aplicarCaixaAltaCadastro(e.target, e.target.value) })} placeholder={despesa.tipo === TIPO_DESPESA_OUTROS ? 'Obrigatório em "Outros"' : 'Opcional'} style={{ ...estiloCampo, padding: '8px 10px' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={despesa.comprovante} onChange={(e) => mudarDespesa(indice, { comprovante: aplicarCaixaAltaCadastro(e.target, e.target.value) })} placeholder="Nº da notinha" style={{ ...estiloCampo, padding: '8px 10px' }} />
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

      {gerenciandoTipos && (
        <div
          onClick={() => setGerenciandoTipos(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '460px', maxHeight: '85vh', overflowY: 'auto', padding: '24px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Tipos de despesa da rota</h3>
              <button type="button" onClick={() => setGerenciandoTipos(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} aria-label="Fechar"><X size={20} /></button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Cadastre outros tipos além dos padrões (ex.: Lavagem, Estacionamento). Eles aparecem na lista de "Tipo" de toda nova despesa.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                type="text"
                value={novoTipo}
                maxLength={30}
                onChange={(e) => setNovoTipo(aplicarCaixaAltaCadastro(e.target, e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void adicionarTipo(); } }}
                placeholder="Novo tipo, ex.: LAVAGEM"
                style={{ ...estiloCampo, flex: 1 }}
              />
              <button type="button" className="btn-primary" disabled={salvandoTipos} onClick={() => void adicionarTipo()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {salvandoTipos ? <Loader2 size={16} className="spin-icon" /> : <Plus size={16} />} Adicionar
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {tiposDisponiveis.map((t) => {
                const cadastrado = tiposPersonalizados.includes(t.value);
                return (
                  <div key={t.value} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-tertiary)', fontSize: '14px' }}>
                    <span>{t.label}{!cadastrado && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>padrão</span>}</span>
                    {cadastrado && (
                      <button type="button" disabled={salvandoTipos} onClick={() => void removerTipo(t.value)} title="Remover tipo" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex' }}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RotaForm;

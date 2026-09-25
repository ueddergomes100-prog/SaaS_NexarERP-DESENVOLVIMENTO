import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { FileText, Loader2, Package, Pencil, Plus, Power, Search, X } from 'lucide-react';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import { aplicarCaixaAltaCadastro } from '../../utils/textoCadastroDomain';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  abaixoDoMinimo,
  erroDoInsumo,
  montarDocumentoInsumos,
  numeroDoInsumo,
  type FiltroRelatorioInsumos,
  type FormularioDoInsumo,
  type InsumoDoCadastro,
} from '../../utils/insumoDomain';
import FiltroSituacao, { passaNaSituacao, SITUACAO_PADRAO, type Situacao } from '../../components/common/FiltroSituacao';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';

/**
 * INSUMOS (2026-09-25): material de CONSUMO da empresa (caixa, fita, etiqueta,
 * EPI). Cadastro proprio: nao e' vendido (nao esta em Estoque) e nao entra na
 * receita de nenhum produto (nao e' Materia-Prima). O saldo sobe pela Entrada de
 * NF-e e pelo Ajuste Manual de Estoque; ver insumoDomain.ts.
 *
 * Modal em vez de tela propria (poucos campos), no molde de Frota/Motoristas.
 */

const FORM_VAZIO: FormularioDoInsumo = { codigo: '', nome: '', unidade: 'UN', estoqueMinimo: '', precoCusto: '', quantidade: '', fornecedor: '', observacao: '' };

const campoStyle: React.CSSProperties = { padding: '11px 13px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' };
const rotuloStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };

const quantidadeBr = (n: number | undefined): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(n || 0));
const moedaBr = (n: number | undefined): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(n || 0));

const InsumosList: React.FC = () => {
  const { currentUser, tenantId } = useAuth();
  const { linha } = useLinhaSelecionavel();
  const [insumos, setInsumos] = useState<InsumoDoCadastro[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao>(SITUACAO_PADRAO);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState<FormularioDoInsumo>(FORM_VAZIO);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [filtroRelatorio, setFiltroRelatorio] = useState<FiltroRelatorioInsumos['situacao']>('ativos');

  useEffect(() => {
    if (!tenantId) return undefined;
    return onSnapshot(query(collection(db, 'insumos'), where('tenantId', '==', tenantId)), (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsumoDoCadastro));
      lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
      setInsumos(lista);
      setLoading(false);
    }, (erro) => {
      console.error('Erro ao buscar insumos:', erro);
      setLoading(false);
    });
  }, [tenantId]);

  const hoje = getDateInputInTimeZone();
  const documento = useMemo<DocumentoRelatorioSemEmpresa>(
    () => montarDocumentoInsumos(insumos, { situacao: filtroRelatorio }, hoje),
    [insumos, filtroRelatorio, hoje],
  );

  const abrirNovo = () => {
    setForm(FORM_VAZIO);
    setEditandoId(null);
    setModalAberto(true);
  };

  const abrirEdicao = (insumo: InsumoDoCadastro) => {
    if (insumo.ativo === false) {
      showError('Insumo inativo', `${insumo.nome} está inativo e não pode ser alterado. Reative-o na lista para editar.`);
      return;
    }
    setForm({
      codigo: insumo.codigo || '',
      nome: insumo.nome || '',
      unidade: insumo.unidade || '',
      estoqueMinimo: insumo.estoqueMinimo ? String(insumo.estoqueMinimo) : '',
      precoCusto: insumo.precoCusto ? String(insumo.precoCusto) : '',
      // O saldo so' se altera por Entrada de NF-e ou Ajuste de Estoque (deixa historico).
      quantidade: String(insumo.quantidade ?? 0),
      fornecedor: insumo.fornecedor || '',
      observacao: insumo.observacao || '',
    });
    setEditandoId(insumo.id);
    setModalAberto(true);
  };

  const salvar = async () => {
    if (!currentUser || !tenantId) return;
    const problema = erroDoInsumo(form, insumos, editandoId);
    if (problema) {
      showError('Confira o insumo', problema);
      return;
    }
    setSalvando(true);
    try {
      const custo = numeroDoInsumo(form.precoCusto);
      const dados = {
        codigo: form.codigo.trim(),
        nome: form.nome.toUpperCase().trim(),
        unidade: form.unidade.toUpperCase().trim(),
        estoqueMinimo: numeroDoInsumo(form.estoqueMinimo),
        fornecedor: form.fornecedor.trim(),
        observacao: form.observacao.trim(),
        tenantId,
      };
      if (editandoId) {
        // Na edicao o custo so' e' gravado se a pessoa o mudou aqui; o custo medio
        // vem das entradas e nao e' reescrito por engano.
        const atual = insumos.find((i) => i.id === editandoId);
        const custoMudou = Math.abs(custo - Number(atual?.precoCusto || 0)) > 0.00005;
        await updateDoc(doc(db, 'insumos', editandoId), {
          ...dados,
          ...(custoMudou ? { precoCusto: custo, ultimoCusto: custo, custoMedio: custo } : {}),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Insumo atualizado!');
      } else {
        const quantidade = numeroDoInsumo(form.quantidade);
        await addDoc(collection(db, 'insumos'), {
          ...dados,
          categoria: 'DIVERSOS',
          quantidade,
          precoCusto: custo,
          ultimoCusto: custo,
          custoMedio: custo,
          ativo: true,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Insumo cadastrado!');
      }
      setModalAberto(false);
    } catch (erro) {
      console.error('Erro ao salvar insumo:', erro);
      showError('Erro ao salvar', 'Não foi possível salvar o insumo. Verifique sua conexão e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarSituacao = async (insumo: InsumoDoCadastro) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'insumos', insumo.id), { ativo: insumo.ativo === false, ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()) });
      showSuccess(insumo.ativo === false ? 'Insumo reativado!' : 'Insumo inativado!');
    } catch (erro) {
      console.error('Erro ao mudar a situação do insumo:', erro);
      showError('Erro', 'Não foi possível mudar a situação deste insumo.');
    }
  };

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="estoque-insumos"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Estoque de Insumos', hoje, hoje)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos insumos"
      />
    );
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = insumos
    .filter((i) => passaNaSituacao(i.ativo !== false, situacao))
    .filter((i) => !termo || `${i.nome} ${i.codigo || ''} ${i.fornecedor || ''}`.toLowerCase().includes(termo));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Package size={26} color="var(--accent-purple)" />
            Insumos
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Material de consumo da empresa (caixa, fita, etiqueta, EPI). Não é vendido nem entra na receita de produto: o saldo sobe pela Entrada de NF-e e pelo Ajuste de Estoque.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filtroRelatorio} onChange={(e) => setFiltroRelatorio(e.target.value as FiltroRelatorioInsumos['situacao'])} className="form-select" style={{ ...campoStyle, padding: '9px 12px' }} aria-label="Quais insumos entram no relatório">
            <option value="ativos">Relatório: ativos</option>
            <option value="abaixo_minimo">Relatório: abaixo do mínimo</option>
            <option value="todos">Relatório: todos (com inativos)</option>
          </select>
          <button className="btn-secondary" onClick={() => setPreviewAberto(true)} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Relatório
          </button>
          <button className="btn-primary" onClick={abrirNovo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo Insumo
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar por nome, código ou fornecedor..." value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...campoStyle, width: '100%', padding: '10px 14px 10px 42px' }} />
          </div>
          <FiltroSituacao valor={situacao} onChange={setSituacao} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Código</th>
                <th style={{ padding: '14px' }}>Insumo</th>
                <th style={{ padding: '14px' }}>Un.</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Em estoque</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Mínimo</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Custo médio</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px' }}>Carregando os insumos...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <Package size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{insumos.length === 0 ? 'Nenhum insumo cadastrado ainda. Cadastre aqui ou classifique o item como Insumo ao dar entrada numa nota.' : 'Nenhum insumo com esses filtros.'}</div>
                  </td>
                </tr>
              ) : filtrados.map((i) => (
                <tr key={i.id} {...linha(i.id, () => abrirEdicao(i))} style={{ borderBottom: '1px solid var(--border-color)', opacity: i.ativo === false ? 0.55 : 1 }}>
                  <td style={{ padding: '14px', fontFamily: 'monospace' }}>{i.codigo || '-'}</td>
                  <td style={{ padding: '14px', fontWeight: 600 }}>{i.nome}{i.fornecedor ? <span style={{ display: 'block', fontSize: '12px', fontWeight: 400, color: 'var(--text-muted)' }}>{i.fornecedor}</span> : null}</td>
                  <td style={{ padding: '14px' }}>{i.unidade || '-'}</td>
                  <td style={{ padding: '14px', textAlign: 'right', fontWeight: 700, color: abaixoDoMinimo(i) ? '#ef4444' : 'inherit' }}>{quantidadeBr(i.quantidade)}</td>
                  <td style={{ padding: '14px', textAlign: 'right' }}>{i.estoqueMinimo ? quantidadeBr(i.estoqueMinimo) : '-'}</td>
                  <td style={{ padding: '14px', textAlign: 'right' }}>{moedaBr(i.custoMedio ?? i.precoCusto)}</td>
                  <td style={{ padding: '14px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '12px', backgroundColor: i.ativo === false ? 'rgba(239,68,68,0.15)' : (abaixoDoMinimo(i) ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)'), color: i.ativo === false ? '#ef4444' : (abaixoDoMinimo(i) ? '#f59e0b' : '#10b981') }}>
                      {i.ativo === false ? 'Inativo' : (abaixoDoMinimo(i) ? 'Abaixo do mínimo' : 'Ativo')}
                    </span>
                  </td>
                  <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                    <button className="icon-btn" title="Editar" onClick={() => abrirEdicao(i)} style={{ color: '#f59e0b' }}><Pencil size={16} /></button>
                    <button className="icon-btn" title={i.ativo === false ? 'Reativar' : 'Inativar'} onClick={() => void alternarSituacao(i)} style={{ color: i.ativo === false ? '#10b981' : '#ef4444' }}><Power size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalAberto && (
        <div onClick={() => setModalAberto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '620px', maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '17px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={20} color="var(--accent-purple)" />
                {editandoId ? 'Editar Insumo' : 'Novo Insumo'}
              </h2>
              <button onClick={() => setModalAberto(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} aria-label="Fechar"><X size={22} /></button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Código</label>
                  <input type="text" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Opcional" style={campoStyle} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Nome *</label>
                  <input type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: aplicarCaixaAltaCadastro(e.target, e.target.value) })} placeholder="Ex: CAIXA DE PAPELÃO 30X20" style={{ ...campoStyle, textTransform: 'uppercase' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Unidade *</label>
                  <input type="text" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value.toUpperCase() })} placeholder="UN, CX, KG, ROLO" maxLength={6} style={{ ...campoStyle, textTransform: 'uppercase' }} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Estoque mínimo</label>
                  <input type="text" inputMode="decimal" value={form.estoqueMinimo} onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })} placeholder="0" style={campoStyle} />
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Custo (R$ por unidade)</label>
                  <input type="text" inputMode="decimal" value={form.precoCusto} onChange={(e) => setForm({ ...form, precoCusto: e.target.value })} placeholder="0,00" style={campoStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>{editandoId ? 'Em estoque (só leitura)' : 'Saldo inicial'}</label>
                  <input type="text" inputMode="decimal" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} disabled={Boolean(editandoId)} placeholder="0" style={{ ...campoStyle, opacity: editandoId ? 0.6 : 1 }} />
                  {editandoId && <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Para mudar o saldo use Entrada de NF-e ou Ajuste de Estoque (fica no histórico).</span>}
                </div>
                <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={rotuloStyle}>Fornecedor</label>
                  <input type="text" value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} placeholder="Opcional" style={campoStyle} />
                </div>
              </div>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={rotuloStyle}>Observação</label>
                <textarea value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} rows={2} placeholder="Opcional" style={{ ...campoStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-secondary" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              <button className="btn-primary" onClick={() => void salvar()} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {salvando ? <Loader2 size={17} className="spin-icon" /> : <Plus size={17} />}
                {salvando ? 'Salvando...' : 'Salvar Insumo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InsumosList;

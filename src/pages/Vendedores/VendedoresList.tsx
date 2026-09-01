import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Edit, KeyRound, Plus, Search, Trash2, UserCheck, X } from 'lucide-react';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDelete, showError, showSuccess, showWarning, NexusSwal } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import { isTenantManagerRole } from '../../utils/roles';
import { DEFAULT_NIVEL_ACESSO } from '../../utils/visibilidadeVendasDomain';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import { PERMISSAO_LIBERAR_DESCONTO } from '../../utils/permissionCatalog';
import { parseComissaoPercentualInput } from '../../utils/financeDomain';
import {
  CODIGO_VENDEDOR_DIGITOS,
  isPinVendedorFraco,
  isPinVendedorValido,
  MENSAGEM_CODIGO_INVALIDO,
  MENSAGEM_PIN_FRACO,
  MENSAGEM_PIN_INVALIDO,
  normalizarCodigoVendedor,
  AJUDA_TAMANHO_PIN,
  PIN_VENDEDOR_MAX_DIGITOS,
} from '../../utils/vendedorPinDomain';
import { definirPinVendedor, VendedorPinError } from '../../services/vendedorPinService';


/**
 * Cadastro de vendedores de balcao -- pessoas que VENDEM mas nao ENTRAM no
 * sistema. O porque de tudo isto (e por que o registro mora em `usuarios`)
 * esta em src/utils/vendedorCadastroDomain.ts.
 *
 * Duas coisas que o desenho desta tela leva a serio:
 *
 * 1. **Cadastrar tem que caber numa tela so.** Nome, codigo e senha de 2 a 10
 *    digitos saem juntos. O fluxo antigo (criar o usuario, salvar, entrar de
 *    novo pra definir a senha) existia por limitacao do backend, que exige o
 *    registro criado antes de aceitar o PIN -- aqui a tela faz os dois
 *    passos sozinha e so incomoda o operador se o segundo falhar.
 * 2. **Vendedor com venda nao se apaga.** Excluir quem ja vendeu deixaria o
 *    Relatorio de Comissoes com "Não identificado" no lugar do nome. Nesse
 *    caso a tela manda inativar, que o backend ja recusa na identificacao.
 */

interface VendedorData {
  id: string;
  nome: string;
  codigoVendedor?: string;
  status?: string;
  recebeComissaoServicos?: boolean;
  comissaoPercentualServicos?: number;
  recebeComissaoPecas?: boolean;
  comissaoPercentualPecas?: number;
  permissoes?: string[];
  /** Carimbo gravado pelo backend quando a senha e' definida. Nao e' a
   *  senha nem o hash dela -- e' so "ja tem senha", pra tela conseguir
   *  avisar ANTES do vendedor descobrir isso no balcao com cliente na
   *  frente. Ver server/services/vendedorPin.js. */
  pinDefinidoEm?: unknown;
}

interface FormState {
  nome: string;
  codigoVendedor: string;
  pin: string;
  status: string;
  recebeComissaoServicos: boolean;
  comissaoPercentualServicos: string;
  recebeComissaoPecas: boolean;
  comissaoPercentualPecas: string;
  /** Pode liberar desconto acima do limite, digitando o proprio PIN. */
  liberaDesconto: boolean;
}

const FORM_VAZIO: FormState = {
  nome: '',
  codigoVendedor: '',
  pin: '',
  status: 'Ativo',
  recebeComissaoServicos: false,
  comissaoPercentualServicos: '',
  recebeComissaoPecas: false,
  comissaoPercentualPecas: '',
  liberaDesconto: false,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
};

const VendedoresList: React.FC = () => {
  const { tenantId, currentUser, userRole, exigirIdentificacaoVendedor } = useAuth();
  const [vendedores, setVendedores] = useState<VendedorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<VendedorData | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  const podeGerenciar = isTenantManagerRole(userRole);

  useKeyboardShortcuts([
    { key: 'F2', handler: () => buscaRef.current?.focus() },
    { key: 'F6', handler: () => podeGerenciar && abrirNovo() },
  ]);

  useEffect(() => {
    if (!tenantId) return;
    // Filtra o tipo no cliente, e nao com um segundo where(): a lista de
    // pessoas de uma empresa e' curta, e assim nao dependemos de indice novo.
    const q = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const lista: VendedorData[] = [];
      snapshot.forEach((documento) => {
        const data = documento.data();
        if (isRegistroDeVendedor(data)) {
          lista.push({ id: documento.id, ...data } as VendedorData);
        }
      });
      lista.sort((a, b) => (a.codigoVendedor || '').localeCompare(b.codigoVendedor || ''));
      setVendedores(lista);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao carregar vendedores:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantId]);

  const listaFiltrada = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return vendedores;
    return vendedores.filter((v) =>
      (v.nome || '').toLowerCase().includes(termo) || (v.codigoVendedor || '').includes(termo));
  }, [vendedores, busca]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_VAZIO);
    setModalAberto(true);
  };

  const abrirEdicao = (vendedor: VendedorData) => {
    setEditando(vendedor);
    setForm({
      nome: vendedor.nome || '',
      codigoVendedor: vendedor.codigoVendedor || '',
      pin: '',
      status: vendedor.status || 'Ativo',
      recebeComissaoServicos: vendedor.recebeComissaoServicos === true,
      comissaoPercentualServicos: vendedor.comissaoPercentualServicos != null ? String(vendedor.comissaoPercentualServicos) : '',
      recebeComissaoPecas: vendedor.recebeComissaoPecas === true,
      comissaoPercentualPecas: vendedor.comissaoPercentualPecas != null ? String(vendedor.comissaoPercentualPecas) : '',
      liberaDesconto: (vendedor.permissoes || []).includes(PERMISSAO_LIBERAR_DESCONTO),
    });
    setModalAberto(true);
  };

  /** O codigo ja e' de outra pessoa desta empresa? A checagem varre TODOS os
   *  registros (vendedores e contas de login juntos): o backend procura o
   *  codigo na empresa inteira e recusa a venda se achar dois. */
  const codigoJaEmUso = async (codigo: string, ignorarId: string | null): Promise<boolean> => {
    const snap = await getDocs(query(
      collection(db, 'usuarios'),
      where('tenantId', '==', tenantId),
      where('codigoVendedor', '==', codigo),
    ));
    return snap.docs.some((documento) => documento.id !== ignorarId);
  };

  /** Confirma o uso de um PIN obvio. Nao bloqueia -- a decisao e' do dono. */
  const pinLiberado = async (pin: string): Promise<boolean> => {
    if (!isPinVendedorFraco(pin)) return true;
    const confirma = await NexusSwal.fire({
      title: 'Senha fácil de adivinhar',
      text: MENSAGEM_PIN_FRACO,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Usar mesmo assim',
      cancelButtonText: 'Escolher outra',
      reverseButtons: true,
    });
    return confirma.isConfirmed;
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !currentUser || salvando) return;

    const nome = form.nome.trim();
    if (!nome) {
      showError('Falta o nome', 'Informe o nome do vendedor. É ele que aparece na venda e no relatório de comissões.');
      return;
    }

    const codigo = normalizarCodigoVendedor(form.codigoVendedor);
    if (!codigo) {
      showError('Código inválido', MENSAGEM_CODIGO_INVALIDO);
      return;
    }

    // Senha e' obrigatoria no cadastro novo: vendedor sem senha nao consegue
    // se identificar, e so descobriria isso no balcao, na primeira venda.
    const definindoPin = !!form.pin;
    if (!editando && !definindoPin) {
      showError('Falta a senha', `Informe a senha deste vendedor (${AJUDA_TAMANHO_PIN.toLowerCase()}). É com ela que ele se identifica em cada venda.`);
      return;
    }
    if (definindoPin && !isPinVendedorValido(form.pin)) {
      showError('Senha inválida', MENSAGEM_PIN_INVALIDO);
      return;
    }
    if (definindoPin && !(await pinLiberado(form.pin))) return;

    setSalvando(true);
    try {
      if (await codigoJaEmUso(codigo, editando?.id ?? null)) {
        showError('Código já usado', `O código ${codigo} já é de outra pessoa desta empresa. Escolha um código diferente — dois cadastros com o mesmo código carimbariam a venda e a comissão na pessoa errada.`);
        return;
      }

      const percentualServicos = parseComissaoPercentualInput(form.comissaoPercentualServicos);
      const percentualPecas = parseComissaoPercentualInput(form.comissaoPercentualPecas);

      // Percentual em branco sai do documento em vez de virar `undefined`
      // (o Firestore recusa undefined) ou 0 (que seria "zero por cento de
      // proposito", coisa diferente de "usa o padrao do sistema").
      const comissao: Record<string, unknown> = {
        recebeComissaoServicos: form.recebeComissaoServicos,
        recebeComissaoPecas: form.recebeComissaoPecas,
      };

      // Mesma permissao do usuario com login -- conceito unico no sistema, so
      // que este aqui aprova digitando o PIN em vez da senha. Ver
      // SolicitarAprovacaoDescontoModal.
      const permissoes = form.liberaDesconto ? [PERMISSAO_LIBERAR_DESCONTO] : [];

      let vendedorId = editando?.id || '';

      if (editando) {
        await updateDoc(doc(db, 'usuarios', editando.id), {
          nome,
          codigoVendedor: codigo,
          status: form.status,
          permissoes,
          ...comissao,
          comissaoPercentualServicos: percentualServicos === undefined ? deleteField() : percentualServicos,
          comissaoPercentualPecas: percentualPecas === undefined ? deleteField() : percentualPecas,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
      } else {
        const novo = await addDoc(collection(db, 'usuarios'), {
          nome,
          codigoVendedor: codigo,
          // A marca que diz "este registro nao tem login". Sem ela, o
          // vendedor apareceria em Equipe & Acessos e comeria uma vaga do
          // plano -- ver vendedorCadastroDomain.ts.
          tipoRegistro: 'vendedor',
          role: 'Funcionario',
          permissoes,
          nivelAcesso: DEFAULT_NIVEL_ACESSO,
          status: form.status,
          tenantId,
          ...comissao,
          ...(percentualServicos !== undefined ? { comissaoPercentualServicos: percentualServicos } : {}),
          ...(percentualPecas !== undefined ? { comissaoPercentualPecas: percentualPecas } : {}),
          createdAt: serverTimestamp(),
          createdBy: currentUser.uid,
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        vendedorId = novo.id;
      }

      if (definindoPin) {
        try {
          await definirPinVendedor(vendedorId, form.pin);
        } catch (error) {
          // O cadastro JA existe neste ponto. Dizer "erro ao salvar" faria o
          // operador cadastrar tudo de novo e criar um codigo duplicado.
          const motivo = error instanceof VendedorPinError ? error.message : 'O servidor não respondeu.';
          showWarning(`${nome} foi salvo, mas a senha não. ${motivo} Edite o vendedor e cadastre a senha antes de ele vender.`);
          setModalAberto(false);
          return;
        }
      }

      showSuccess(editando ? 'Vendedor atualizado!' : `${nome} cadastrado com o código ${codigo}.`);
      setModalAberto(false);
    } catch (error) {
      console.error('Erro ao salvar vendedor:', error);
      showError('Não foi possível salvar', 'O vendedor não foi gravado. Verifique a internet e tente de novo — se continuar, avise o suporte.');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async (vendedor: VendedorData) => {
    if (!podeGerenciar) {
      showError('Sem permissão', 'Apenas o administrador da empresa pode excluir vendedores.');
      return;
    }

    try {
      const snapVendas = await getDocs(query(
        collection(db, 'pedidos_venda'),
        where('vendedorId', '==', vendedor.id),
        limit(1),
      ));
      if (!snapVendas.empty) {
        showError(
          'Não dá para excluir',
          `${vendedor.nome} já tem vendas registradas, e excluí-lo deixaria essas vendas sem vendedor no relatório de comissões. Se ele saiu da empresa, mude o status para Inativo — ele para de conseguir vender na hora, e o histórico continua certo.`,
        );
        return;
      }
    } catch (error) {
      console.error('Erro ao verificar vendas do vendedor:', error);
    }

    if (!(await confirmDelete(`o vendedor ${vendedor.nome}`))) return;

    try {
      await deleteDoc(doc(db, 'usuarios', vendedor.id));
      showSuccess('Vendedor excluído.');
    } catch {
      showError('Não foi possível excluir', 'O vendedor continua cadastrado. Tente de novo em instantes.');
    }
  };

  const badge = (texto: string, cor: string) => (
    <span style={{ backgroundColor: `${cor}1a`, color: cor, padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {texto}
    </span>
  );

  const textoComissao = (vendedor: VendedorData) => {
    const partes: string[] = [];
    if (vendedor.recebeComissaoPecas === true) {
      partes.push(`Produtos ${vendedor.comissaoPercentualPecas != null ? `${vendedor.comissaoPercentualPecas}%` : 'padrão'}`);
    }
    if (vendedor.recebeComissaoServicos === true) {
      partes.push(`Serviços ${vendedor.comissaoPercentualServicos != null ? `${vendedor.comissaoPercentualServicos}%` : 'padrão'}`);
    }
    return partes.length ? partes.join(' · ') : 'Não recebe';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCheck size={28} color="var(--accent-purple)" />
            Vendedores
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Quem vende no balcão. Não entra no sistema: identifica-se com código e senha a cada venda.
          </p>
        </div>
        {podeGerenciar && (
          <button className="btn-primary" onClick={abrirNovo} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={20} /> Novo Vendedor
          </button>
        )}
      </div>

      <div style={{ padding: '14px 18px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <BadgeCheck size={18} style={{ color: '#3b82f6', flexShrink: 0, marginTop: '1px' }} />
        <span>
          O vendedor cadastrado aqui <strong>não tem login</strong> e não ocupa vaga do seu plano. Os logins das
          estações (balcão 01, balcão 02, financeiro, fiscal) continuam em <strong>Equipe &amp; Acessos</strong>.
          {!exigirIdentificacaoVendedor && (
            <>
              {' '}Atenção: a opção <strong>&quot;Exigir identificação do vendedor a cada venda&quot;</strong> está
              desligada em Configurações → Configurações Avançadas, então o sistema ainda não está pedindo o código
              na hora da venda.
            </>
          )}
        </span>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ position: 'relative', marginBottom: '20px', maxWidth: '420px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            ref={buscaRef}
            type="text"
            placeholder="Buscar por nome ou código (F2)"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ ...inputStyle, paddingLeft: '38px' }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px', width: '100px' }}>Código</th>
                <th style={{ padding: '16px' }}>Nome</th>
                <th style={{ padding: '16px' }}>Senha</th>
                <th style={{ padding: '16px' }}>Comissão</th>
                <th style={{ padding: '16px' }}>Status</th>
                {podeGerenciar && <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando vendedores...</td>
                </tr>
              ) : listaFiltrada.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {vendedores.length === 0
                      ? 'Nenhum vendedor cadastrado ainda. Cadastre quem vende no balcão — cada um com um código de 2 dígitos e uma senha numérica.'
                      : 'Nenhum vendedor encontrado com esse termo.'}
                  </td>
                </tr>
              ) : (
                listaFiltrada.map((vendedor) => (
                  <tr key={vendedor.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '16px', fontWeight: 700, fontSize: '17px', letterSpacing: '3px' }}>{vendedor.codigoVendedor || '--'}</td>
                    <td style={{ padding: '16px', fontWeight: 500 }}>{vendedor.nome}</td>
                    <td style={{ padding: '16px' }}>
                      {vendedor.pinDefinidoEm
                        ? badge('Cadastrada', '#10b981')
                        : badge('Sem senha — não vende', '#ef4444')}
                    </td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>{textoComissao(vendedor)}</td>
                    <td style={{ padding: '16px' }}>
                      {(vendedor.status || 'Ativo') === 'Ativo' ? badge('Ativo', '#10b981') : badge('Inativo', '#6b7280')}
                    </td>
                    {podeGerenciar && (
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            className="icon-btn"
                            style={{ color: '#3b82f6' }}
                            title="Editar vendedor / trocar senha"
                            onClick={() => abrirEdicao(vendedor)}
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ color: '#ef4444' }}
                            title="Excluir vendedor"
                            onClick={() => void handleExcluir(vendedor)}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalAberto && (
        <div
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 1200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
          onClick={() => !salvando && setModalAberto(false)}
        >
          <form
            className="card"
            onSubmit={handleSalvar}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: '560px', padding: '28px', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                {editando ? `Editar ${editando.nome}` : 'Novo Vendedor'}
              </h3>
              <button type="button" className="icon-btn" onClick={() => setModalAberto(false)} disabled={salvando}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px' }}>
              <div className="input-group" style={{ gridColumn: 'span 2' }}>
                <label>Nome do Vendedor *</label>
                <input
                  type="text"
                  placeholder="Ex: Juliano"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  autoFocus
                  style={inputStyle}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  É este nome que aparece na venda e no relatório de comissões.
                </span>
              </div>

              <div className="input-group">
                <label>Código ({CODIGO_VENDEDOR_DIGITOS} dígitos) *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 07"
                  value={form.codigoVendedor}
                  onChange={(e) => setForm({ ...form, codigoVendedor: e.target.value.replace(/\D/g, '').slice(0, CODIGO_VENDEDOR_DIGITOS) })}
                  onBlur={(e) => {
                    const normalizado = normalizarCodigoVendedor(e.target.value);
                    if (normalizado) setForm((atual) => ({ ...atual, codigoVendedor: normalizado }));
                  }}
                  style={{ ...inputStyle, fontSize: '18px', letterSpacing: '4px', fontWeight: 700 }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  O que ele digita no balcão. Os colegas veem — o segredo é a senha.
                </span>
              </div>

              <div className="input-group">
                <label>
                  Senha ({AJUDA_TAMANHO_PIN.toLowerCase()}) {editando ? '' : '*'}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder={editando ? 'Deixe vazio para manter' : 'Senha'}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, PIN_VENDEDOR_MAX_DIGITOS) })}
                  style={{ ...inputStyle, fontSize: '18px', letterSpacing: '6px', fontWeight: 700 }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <KeyRound size={12} />
                  {editando
                    ? 'Digite uma senha nova quando ele esquecer — salvar destrava na hora quem estiver bloqueado.'
                    : 'Só ele deve saber. Ninguém consegue consultá-la depois, nem o administrador.'}
                </span>
              </div>

              <div className="input-group" style={{ gridColumn: 'span 2' }}>
                <label>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  style={inputStyle}
                >
                  <option value="Ativo">Ativo</option>
                  <option value="Inativo">Inativo (não consegue vender)</option>
                </select>
              </div>

              <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border-color)', paddingTop: '18px' }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }}></span>
                  Liberação de Desconto
                </h4>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', marginTop: '10px' }}>
                  <input
                    type="checkbox"
                    checked={form.liberaDesconto}
                    onChange={(e) => setForm({ ...form, liberaDesconto: e.target.checked })}
                    style={{ width: '18px', height: '18px', accentColor: '#ef4444', cursor: 'pointer' }}
                  />
                  Pode liberar desconto acima do limite
                </label>
                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Para o vendedor que também é supervisor. Quando alguém passar do limite configurado e a empresa exigir
                  senha, o nome dele aparece na lista de quem pode liberar — e ele confirma com o <strong>próprio código e
                  PIN</strong>, o mesmo que usa em cada venda. Não precisa de login no sistema e não ocupa vaga do plano.
                  Toda liberação (e toda tentativa recusada) fica registrada nos Logs.
                </p>
              </div>

              <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border-color)', paddingTop: '18px' }}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }}></span>
                  Regras de Comissão
                </h4>
                <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Produto com comissão própria vence esta configuração. Sem a marcação abaixo, o vendedor recebe 0% —
                  não cai para o padrão do sistema.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={form.recebeComissaoPecas}
                        onChange={(e) => setForm({ ...form, recebeComissaoPecas: e.target.checked })}
                        style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                      />
                      Comissão em Produtos?
                    </label>
                    {form.recebeComissaoPecas && (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        placeholder="Usa o padrão do sistema"
                        value={form.comissaoPercentualPecas}
                        onChange={(e) => setForm({ ...form, comissaoPercentualPecas: e.target.value })}
                        style={{ ...inputStyle, width: '200px' }}
                      />
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={form.recebeComissaoServicos}
                        onChange={(e) => setForm({ ...form, recebeComissaoServicos: e.target.checked })}
                        style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                      />
                      Comissão em Serviços?
                    </label>
                    {form.recebeComissaoServicos && (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        placeholder="Usa o padrão do sistema"
                        value={form.comissaoPercentualServicos}
                        onChange={(e) => setForm({ ...form, comissaoPercentualServicos: e.target.value })}
                        style={{ ...inputStyle, width: '200px' }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" className="btn-secondary" onClick={() => setModalAberto(false)} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar Vendedor'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default VendedoresList;

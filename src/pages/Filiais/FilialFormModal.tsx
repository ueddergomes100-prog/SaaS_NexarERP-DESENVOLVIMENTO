import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import BuscarDocumentoButton from '../../components/common/BuscarDocumentoButton';
import type { ConsultaCnpjResultado } from '../../services/documentoService';
import { alterarFilial, cadastrarFilial, lerCadastroDaFilial } from '../../services/filialService';
import { UFS, lerDadosDaFilial, type DadosDaFilial, type FilialDoGrupo, type TipoFilial } from '../../utils/filialDomain';
import { showError, showSuccess } from '../../utils/alerts';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import { fetchComTimeout } from '../../utils/fetchComTimeout';

interface FilialFormModalProps {
  aberto: boolean;
  /** Filial em edicao; sem ela, cadastro de filial nova. */
  filial: FilialDoGrupo | null;
  proximoCodigo: string;
  /** A empresa ainda nao tem filiais: a atual vira a matriz (10). */
  primeiraFilial: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}

const VAZIO: DadosDaFilial = lerDadosDaFilial({});

const estiloCampo: React.CSSProperties = {
  width: '100%', padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '14px',
};
const estiloRotulo: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' };
const estiloSecao: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginTop: '4px',
};

/** ViaCEP responde em menos de 1 s; mais de 10 s e' instabilidade dele. */
const TEMPO_LIMITE_CEP_MS = 10_000;

/**
 * Cadastro de filial (2026-10-06): o cabecalho e a aba Endereco do "Cadastro
 * de Filial" do Integra. O resto das abas de la' (Complemento, Parametros,
 * Outros) sao as Configuracoes de cada filial, que a filial nova recebe da
 * matriz e ajusta depois, dentro dela.
 */
const FilialFormModal: React.FC<FilialFormModalProps> = ({ aberto, filial, proximoCodigo, primeiraFilial, onFechar, onSalvo }) => {
  const [dados, setDados] = useState<DadosDaFilial>(VAZIO);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const editando = Boolean(filial);

  useEscapeLayer(aberto, onFechar);

  useEffect(() => {
    if (!aberto) return;
    if (!filial) {
      setDados({ ...VAZIO, codigo: proximoCodigo });
      return;
    }
    let cancelado = false;
    setCarregando(true);
    lerCadastroDaFilial(filial.tenantId)
      .then((r) => { if (!cancelado) setDados(r.dados); })
      .catch((erro) => {
        if (cancelado) return;
        showError('Não foi possível abrir o cadastro da filial', erro instanceof Error ? erro.message : undefined);
        onFechar();
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [aberto, filial, proximoCodigo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aberto) return null;

  const mudar = (campo: keyof DadosDaFilial, valor: string) => setDados((atual) => ({ ...atual, [campo]: valor }));

  const preencherDeCnpj = (r: ConsultaCnpjResultado) => {
    setDados((atual) => ({
      ...atual,
      razaoSocial: (r.razaoSocial || atual.razaoSocial).toUpperCase(),
      nome: atual.nome || (r.nomeFantasia || '').toUpperCase(),
      rua: (r.logradouro || atual.rua).toUpperCase(),
      numero: (r.numero || atual.numero).toUpperCase(),
      bairro: (r.bairro || atual.bairro).toUpperCase(),
      cidade: (r.municipio || atual.cidade).toUpperCase(),
      uf: (r.uf || atual.uf).toUpperCase(),
      telefone: atual.telefone || r.telefone || '',
      email: atual.email || (r.email || '').toLowerCase(),
    }));
  };

  const buscarCep = async () => {
    const cep = dados.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const resposta = await fetchComTimeout(`https://viacep.com.br/ws/${cep}/json/`, {}, TEMPO_LIMITE_CEP_MS);
      const r = await resposta.json();
      if (r.erro) return;
      setDados((atual) => ({
        ...atual,
        rua: atual.rua || String(r.logradouro || '').toUpperCase(),
        bairro: atual.bairro || String(r.bairro || '').toUpperCase(),
        cidade: String(r.localidade || atual.cidade).toUpperCase(),
        uf: String(r.uf || atual.uf).toUpperCase(),
      }));
    } catch {
      // Sem CEP automatico: a pessoa digita o endereco.
    }
  };

  const salvar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      if (filial) {
        await alterarFilial(filial.tenantId, dados);
        showSuccess('Filial atualizada!');
      } else {
        await cadastrarFilial({ ...dados });
        showSuccess(primeiraFilial ? 'Filial cadastrada! Sua empresa virou a matriz (10).' : 'Filial cadastrada!');
      }
      onSalvo();
    } catch (erro) {
      showError(filial ? 'Não foi possível salvar a filial' : 'Não foi possível cadastrar a filial', erro instanceof Error ? erro.message : undefined);
    } finally {
      setSalvando(false);
    }
  };

  const campo = (rotulo: string, nome: keyof DadosDaFilial, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}, largura = '1fr') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: largura === 'full' ? '1 / -1' : undefined }}>
      <span style={estiloRotulo}>{rotulo}</span>
      <input
        value={String(dados[nome] ?? '')}
        onChange={(e) => mudar(nome, e.target.value)}
        style={{ ...estiloCampo, textTransform: nome === 'email' ? 'none' : 'uppercase' }}
        {...extra}
      />
    </label>
  );

  const tipo: TipoFilial = dados.tipo;

  return (
    <div
      role="presentation"
      onMouseDown={onFechar}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="filial-form-titulo"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={salvar}
        style={{ width: 'min(760px, 100%)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <h3 id="filial-form-titulo" style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
            {editando ? `Filial ${filial?.codigo} · ${filial?.nome}` : 'Nova filial'}
          </h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'transparent', border: 0, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        {carregando ? (
          <div style={{ padding: '48px', display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}><Loader2 size={24} className="spin-icon" /></div>
        ) : (
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {primeiraFilial && !editando && (
              <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb, var(--accent-purple) 12%, transparent)', fontSize: '13px', color: 'var(--text-primary)' }}>
                Esta é a primeira filial: sua empresa atual vira a <strong>matriz (código 10)</strong>, com tudo o que já tem.
              </div>
            )}

            <div style={estiloSecao}>Identificação</div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: '12px' }}>
              {campo('Código', 'codigo', { inputMode: 'numeric', maxLength: 3, required: true })}
              {campo('Nome resumido', 'nome', { required: true, maxLength: 40, placeholder: 'Como aparece no seletor do topo' })}
            </div>

            {!editando && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={estiloRotulo}>CNPJ da filial</span>
                <div role="radiogroup" aria-label="CNPJ da filial" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {([['cnpj_proprio', 'CNPJ próprio'], ['mesmo_cnpj', 'Mesmo CNPJ da matriz (loja ou depósito)']] as Array<[TipoFilial, string]>).map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      type="button"
                      role="radio"
                      aria-checked={tipo === valor}
                      onClick={() => setDados((atual) => ({ ...atual, tipo: valor }))}
                      style={{
                        padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${tipo === valor ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                        background: tipo === valor ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                        color: tipo === valor ? '#fff' : 'var(--text-primary)',
                      }}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(tipo === 'cnpj_proprio' || editando) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: '12px', alignItems: 'end' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    {campo('CNPJ', 'cnpj', { inputMode: 'numeric', disabled: editando, title: editando ? 'O CNPJ não muda depois de cadastrado. Para trocar, fale com o suporte.' : undefined })}
                  </div>
                  {!editando && <BuscarDocumentoButton documento={dados.cnpj} onEncontrarCnpj={preencherDeCnpj} onEncontrarCpf={() => undefined} />}
                </div>
                {campo('Razão social', 'razaoSocial', { disabled: tipo === 'mesmo_cnpj' })}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
              {campo('Inscrição estadual', 'inscricaoEstadual')}
              {campo('Inscrição municipal', 'inscricaoMunicipal')}
            </div>

            <div style={estiloSecao}>Endereço</div>
            <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr) 90px', gap: '12px' }}>
              {campo('CEP', 'cep', { inputMode: 'numeric', maxLength: 9, onBlur: () => { void buscarCep(); } })}
              {campo('Endereço', 'rua')}
              {campo('Nº', 'numero')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
              {campo('Complemento', 'complemento')}
              {campo('Bairro', 'bairro')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: '12px' }}>
              {campo('Cidade', 'cidade', { required: true })}
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={estiloRotulo}>UF</span>
                <select value={dados.uf} onChange={(e) => mudar('uf', e.target.value)} required style={estiloCampo}>
                  <option value="">—</option>
                  {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
            </div>

            <div style={estiloSecao}>Contato</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
              {campo('Telefone', 'telefone', { inputMode: 'tel' })}
              {campo('E-mail', 'email', { type: 'email' })}
              {campo('Contato', 'contato')}
            </div>

            {!editando && (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                As configurações da matriz (formas de pagamento, regras de venda, impressões) vêm junto. Depois, entre na filial
                e confira <strong>Configurações</strong> e o cadastro dela na Spedy antes de emitir nota.
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '14px 20px', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" className="btn-secondary" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={salvando || carregando} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {salvando && <Loader2 size={16} className="spin-icon" />}
            {editando ? 'Salvar filial' : 'Cadastrar filial'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default FilialFormModal;

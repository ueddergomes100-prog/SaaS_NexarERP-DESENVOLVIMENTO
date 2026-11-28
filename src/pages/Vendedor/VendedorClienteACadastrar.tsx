import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CIDADE_SEM_CADASTRO_MAX, clienteSemCadastroCompleto, lerClienteSemCadastro, NOME_SEM_CADASTRO_MAX, resumoDoClienteSemCadastro, telefoneFormatado } from '../../utils/clienteSemCadastroDomain';

/*
 * Bloco "Cliente a cadastrar" do app Vendas (27/11/2026; recolher em 28/11/2026,
 * dono: "quando digitar os 3 campos, nome cidade e telefone ele fechar em
 * dropdown, pq do jeito que a barra de produto desce muito pra baixo").
 * Com os 3 campos preenchidos, ao sair do bloco ele vira uma linha com o resumo;
 * um toque abre de novo. Regra dos campos em clienteSemCadastroDomain.ts.
 */

export interface ValorClienteACadastrar {
  nome: string;
  cidade: string;
  telefone: string;
}

type Campo = keyof ValorClienteACadastrar;

const CAMPOS: ReadonlyArray<readonly [Campo, string, 'text' | 'tel', number]> = [
  ['nome', 'Nome', 'text', NOME_SEM_CADASTRO_MAX],
  ['cidade', 'Cidade', 'text', CIDADE_SEM_CADASTRO_MAX],
  ['telefone', 'Telefone', 'tel', 15],
];

const estiloCaixa: React.CSSProperties = {
  marginTop: '10px', borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)',
  boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
};

const estiloTitulo: React.CSSProperties = {
  fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
};

interface Props {
  valor: ValorClienteACadastrar;
  onChange: (proximo: ValorClienteACadastrar) => void;
}

const VendedorClienteACadastrar: React.FC<Props> = ({ valor, onChange }) => {
  const completo = clienteSemCadastroCompleto(valor);
  // Rascunho que ja' volta com os 3 campos abre fechado.
  const [aberto, setAberto] = useState(() => !clienteSemCadastroCompleto(valor));
  const caixaRef = useRef<HTMLDivElement>(null);
  const camposRef = useRef<Partial<Record<Campo, HTMLInputElement | null>>>({});

  const abrir = () => {
    setAberto(true);
    requestAnimationFrame(() => camposRef.current.nome?.focus());
  };

  if (!aberto) {
    const resumo = resumoDoClienteSemCadastro(valor);
    const lido = lerClienteSemCadastro(valor);
    const detalhe = lido ? [lido.cidade, lido.telefone ? telefoneFormatado(lido.telefone) : ''].filter(Boolean).join(' · ') : '';
    return (
      <button
        type="button"
        onClick={abrir}
        aria-expanded={false}
        aria-label={`Cliente a cadastrar: ${resumo || 'sem nome'}. Toque para alterar.`}
        style={{ ...estiloCaixa, width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', color: 'inherit', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', minHeight: '48px' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: lido ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {lido ? lido.nome : 'Toque para informar o cliente'}
            </span>
            <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(124, 58, 237, 0.14)', color: 'var(--brand-400)' }}>a cadastrar</span>
          </span>
          {detalhe && (
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detalhe}</span>
          )}
        </span>
        <ChevronDown size={20} aria-hidden="true" style={{ color: 'var(--brand-400)', flexShrink: 0 }} />
      </button>
    );
  }

  return (
    <div
      ref={caixaRef}
      onBlur={(evento) => {
        // Fecha quando o foco sai do bloco com os 3 campos preenchidos.
        const destino = evento.relatedTarget as Node | null;
        if (destino && caixaRef.current?.contains(destino)) return;
        if (completo) setAberto(false);
      }}
      style={{ ...estiloCaixa, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <button
        type="button"
        onClick={() => setAberto(false)}
        aria-expanded
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', minHeight: '28px' }}
      >
        <span style={estiloTitulo}>Cliente a cadastrar</span>
        <ChevronUp size={20} aria-label="Fechar" style={{ color: 'var(--brand-400)', flexShrink: 0 }} />
      </button>
      {CAMPOS.map(([campo, rotulo, tipo, max], indice) => (
        <label key={campo} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
          {rotulo}
          <input
            ref={(el) => { camposRef.current[campo] = el; }}
            type={tipo}
            inputMode={tipo === 'tel' ? 'tel' : undefined}
            enterKeyHint={indice === CAMPOS.length - 1 ? 'done' : 'next'}
            maxLength={max}
            value={valor[campo]}
            onChange={(evento) => {
              const texto = campo === 'telefone' ? evento.target.value.replace(/[^\d()\s-]/g, '') : evento.target.value.toUpperCase();
              onChange({ ...valor, [campo]: texto });
            }}
            onKeyDown={(evento) => {
              if (evento.key !== 'Enter') return;
              evento.preventDefault();
              const proximo = CAMPOS[indice + 1]?.[0];
              if (proximo) camposRef.current[proximo]?.focus();
              else evento.currentTarget.blur();
            }}
            style={{ width: '100%', padding: '11px 12px', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '16px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </label>
      ))}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sai no pedido, na minuta e no romaneio. Sem cadastro, a venda é só à vista (sem boleto e sem a prazo).</div>
    </div>
  );
};

export default VendedorClienteACadastrar;

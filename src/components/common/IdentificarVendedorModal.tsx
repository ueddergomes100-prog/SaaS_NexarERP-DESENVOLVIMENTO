import React, { useEffect, useRef, useState } from 'react';
import { UserCheck, X, Loader2 } from 'lucide-react';
import {
  CODIGO_VENDEDOR_DIGITOS,
  isCodigoVendedorValido,
  isPinVendedorValido,
  MENSAGEM_CODIGO_INVALIDO,
  MENSAGEM_PIN_INVALIDO,
  PIN_VENDEDOR_DIGITOS,
  type VendedorIdentificado,
} from '../../utils/vendedorPinDomain';
import { validarVendedor, VendedorPinError } from '../../services/vendedorPinService';

/**
 * Popup de identificacao do vendedor, exibido a cada venda quando a empresa
 * liga "Exigir identificação do vendedor a cada venda".
 *
 * Cenario que este componente atende: estacao de balcao logada o dia inteiro
 * (`balcao01`, ...), varios vendedores usando a mesma maquina. O popup diz
 * QUEM esta vendendo -- a venda e a comissao ficam no nome dele.
 *
 * TRES COISAS QUE O DESENHO LEVA A SERIO:
 *
 * 1. **Erro aqui nao pode custar a venda.** O modal nunca toca no carrinho:
 *    ele so devolve o vendedor por `onIdentificado`. Errar o PIN, cair a
 *    internet ou fechar o popup deixa a venda exatamente como estava --
 *    refazer 30 itens na frente do cliente seria inaceitavel.
 * 2. **E' teclado, nao mouse.** Balcao nao usa mouse pra isso: foco entra no
 *    codigo, Enter salta pro PIN, Enter no PIN confirma. Digitar o codigo
 *    completo tambem salta sozinho.
 * 3. **A mensagem do servidor vence a generica.** O backend distingue senha
 *    errada, vendedor bloqueado por tentativas, vendedor sem senha cadastrada
 *    e codigo duplicado -- cada uma dizendo o que fazer. Sobrescrever isso
 *    com "erro ao validar" jogaria fora justamente a parte util.
 */

interface IdentificarVendedorModalProps {
  open: boolean;
  /** Texto curto dizendo o que vai ser feito (ex: "Finalizar venda de R$ 250,00"). */
  descricaoOperacao?: string;
  onClose: () => void;
  onIdentificado: (vendedor: VendedorIdentificado) => void;
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '12px',
  color: 'var(--text-primary)',
  fontSize: '22px',
  letterSpacing: '6px',
  textAlign: 'center',
  fontWeight: 700,
  width: '100%',
};

const IdentificarVendedorModal: React.FC<IdentificarVendedorModalProps> = ({
  open,
  descricaoOperacao,
  onClose,
  onIdentificado,
}) => {
  const [codigo, setCodigo] = useState('');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');
  const [validando, setValidando] = useState(false);
  const codigoRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCodigo('');
    setPin('');
    setErro('');
    setValidando(false);
    // Timeout pra garantir que o input existe quando o foco e' pedido.
    const timer = setTimeout(() => codigoRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const somenteDigitos = (valor: string, max: number) => valor.replace(/\D/g, '').slice(0, max);

  const confirmar = async () => {
    if (validando) return;

    if (!isCodigoVendedorValido(codigo)) {
      setErro(MENSAGEM_CODIGO_INVALIDO);
      codigoRef.current?.focus();
      return;
    }
    if (!isPinVendedorValido(pin)) {
      setErro(MENSAGEM_PIN_INVALIDO);
      pinRef.current?.focus();
      return;
    }

    setValidando(true);
    setErro('');
    try {
      const vendedor = await validarVendedor(codigo, pin);
      onIdentificado(vendedor);
      onClose();
    } catch (error) {
      // A mensagem do backend e' a boa: ela distingue senha errada de
      // bloqueio, de vendedor sem senha e de codigo duplicado.
      const mensagem = error instanceof VendedorPinError
        ? error.message
        : 'Não foi possível validar o vendedor. Tente novamente.';
      setErro(mensagem);
      // Limpa so o PIN: o codigo quase sempre esta certo, e reescrever os
      // dois a cada erro irrita quem digita rapido.
      setPin('');
      pinRef.current?.focus();
    } finally {
      setValidando(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1300,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        className="card"
        style={{
          backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          width: '100%', maxWidth: '420px', overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <UserCheck size={20} color="#8b5cf6" />
            Identificação do vendedor
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={validando}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: validando ? 'not-allowed' : 'pointer' }}
            title="Cancelar (a venda continua aberta)"
          >
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {descricaoOperacao && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{descricaoOperacao}</p>
          )}

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="vendedor-codigo" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Código
              </label>
              <input
                id="vendedor-codigo"
                ref={codigoRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={validando}
                value={codigo}
                onChange={(e) => {
                  const valor = somenteDigitos(e.target.value, CODIGO_VENDEDOR_DIGITOS);
                  setCodigo(valor);
                  // Codigo completo salta sozinho pro PIN -- uma tecla a
                  // menos, repetida dezenas de vezes por dia.
                  if (valor.length === CODIGO_VENDEDOR_DIGITOS) pinRef.current?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); pinRef.current?.focus(); }
                }}
                style={inputStyle}
                placeholder="00"
              />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="vendedor-pin" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Senha
              </label>
              <input
                id="vendedor-pin"
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                disabled={validando}
                value={pin}
                onChange={(e) => setPin(somenteDigitos(e.target.value, PIN_VENDEDOR_DIGITOS))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void confirmar(); }
                }}
                style={inputStyle}
                placeholder="0000"
              />
            </div>
          </div>

          {erro && (
            <div
              role="alert"
              style={{
                backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 'var(--radius-md)', padding: '12px', fontSize: '13px', color: '#ef4444',
              }}
            >
              {erro}
            </div>
          )}

          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
            A venda fica registrada no nome de quem se identificar aqui, e a comissão também.
          </p>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={validando}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void confirmar()}
            disabled={validando}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: validando ? 0.7 : 1 }}
          >
            {validando ? <><Loader2 size={16} className="spin-animation" /> Validando...</> : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IdentificarVendedorModal;

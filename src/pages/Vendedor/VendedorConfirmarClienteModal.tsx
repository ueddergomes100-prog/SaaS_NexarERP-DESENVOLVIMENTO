import React, { useEffect } from 'react';
import { AlertTriangle, FileText, MapPin, Phone } from 'lucide-react';
import { mascaraDocumento, mascaraTelefone } from '../../utils/clienteCadastroMobileDomain';
import { camposDeEnderecoQueFaltam, enderecoEmLinhas } from '../../utils/pedidoVendedorDomain';

/**
 * Pop-up "Confirmar cliente" do app do vendedor: ao tocar num cliente da busca
 * ele NAO e' selecionado direto -- mostra nome, documento, telefone e endereco
 * completo, e o vendedor confirma ou cancela (e escolhe outro). Evita vender
 * pro homonimo errado. Regras de texto em src/utils/pedidoVendedorDomain.ts.
 */

export interface ClienteConfirmavel {
  id: string;
  nome: string;
  fantasia?: string;
  documento?: string;
  telefone?: string;
  celular?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  enderecoEntrega?: string;
  numeroEntrega?: string;
  bairroEntrega?: string;
  cidadeEntrega?: string;
  estadoEntrega?: string;
  cepEntrega?: string;
}

interface VendedorConfirmarClienteModalProps {
  cliente: ClienteConfirmavel | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}

const linhaDado = (icone: React.ReactNode, conteudo: React.ReactNode) => (
  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
    <span style={{ flexShrink: 0, marginTop: '2px', display: 'inline-flex' }}>{icone}</span>
    <div style={{ minWidth: 0, wordBreak: 'break-word' }}>{conteudo}</div>
  </div>
);

const VendedorConfirmarClienteModal: React.FC<VendedorConfirmarClienteModalProps> = ({ cliente, onConfirmar, onCancelar }) => {
  useEffect(() => {
    if (!cliente) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onCancelar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [cliente, onCancelar]);

  if (!cliente) return null;

  const telefone = cliente.telefone || cliente.celular || '';
  const documento = cliente.documento ? mascaraDocumento(cliente.documento) : '';
  const linhasEndereco = enderecoEmLinhas(cliente);
  const faltando = camposDeEnderecoQueFaltam(cliente);
  const entrega = enderecoEmLinhas({
    endereco: cliente.enderecoEntrega,
    numero: cliente.numeroEntrega,
    bairro: cliente.bairroEntrega,
    cidade: cliente.cidadeEntrega,
    estado: cliente.estadoEntrega,
    cep: cliente.cepEntrega,
  });
  const entregaIgual = entrega.length > 0 && entrega.join('|') === linhasEndereco.join('|');

  return (
    <div
      onClick={onCancelar}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1300, backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-cliente-titulo"
        onClick={(evento) => evento.stopPropagation()}
        style={{
          width: '100%', maxWidth: '480px', maxHeight: '88vh', overflowY: 'auto', backgroundColor: 'var(--bg-elevated)',
          borderTopLeftRadius: '22px', borderTopRightRadius: '22px', border: '1px solid var(--border-color)',
          padding: '22px 20px calc(20px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '16px',
        }}
      >
        <div>
          <div id="confirmar-cliente-titulo" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Confirmar cliente
          </div>
          <div style={{ fontSize: '19px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px', wordBreak: 'break-word' }}>
            {cliente.nome}
          </div>
          {cliente.fantasia && cliente.fantasia !== cliente.nome && (
            <div style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginTop: '2px', wordBreak: 'break-word' }}>{cliente.fantasia}</div>
          )}
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {documento && linhaDado(<FileText size={17} color="var(--brand-400)" />, documento)}
          {telefone && linhaDado(<Phone size={17} color="var(--brand-400)" />, mascaraTelefone(telefone))}
          {linhaDado(
            <MapPin size={17} color="var(--brand-400)" />,
            linhasEndereco.length > 0
              ? linhasEndereco.map((linha) => <div key={linha}>{linha}</div>)
              : <span style={{ color: 'var(--text-muted)' }}>Endereço não cadastrado</span>,
          )}
          {entrega.length > 0 && !entregaIgual && linhaDado(
            <MapPin size={17} color="var(--brand-400)" />,
            <>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Entrega</div>
              {entrega.map((linha) => <div key={linha}>{linha}</div>)}
            </>,
          )}
        </div>

        {faltando.length > 0 && (
          <div
            role="status"
            style={{ display: 'flex', gap: '10px', padding: '11px 13px', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.5)', fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.45 }}
          >
            <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>Cadastro sem {faltando.join(', ')}. Se o pedido for com nota fiscal, o endereço completo é obrigatório: peça para completar o cadastro no sistema.</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            onClick={onConfirmar}
            autoFocus
            style={{
              height: '52px', borderRadius: '14px', border: 'none', fontSize: '15px', fontWeight: 700, color: '#fff', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
            }}
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={onCancelar}
            style={{
              height: '48px', borderRadius: '14px', fontSize: '14.5px', fontWeight: 600, cursor: 'pointer',
              color: 'var(--text-primary)', backgroundColor: 'transparent', border: '1px solid var(--border-color)',
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

export default VendedorConfirmarClienteModal;

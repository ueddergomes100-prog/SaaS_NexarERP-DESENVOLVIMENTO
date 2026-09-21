import React, { useEffect, useRef, useState } from 'react';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import type { SearchableClient } from '../../utils/clientSearch';
import VendedorConfirmarClienteModal, { type ClienteConfirmavel } from './VendedorConfirmarClienteModal';

/**
 * Busca de cliente do app do vendedor com CONFIRMACAO: tocar num cliente da
 * lista abre o pop-up com os dados dele (VendedorConfirmarClienteModal) e so'
 * "Confirmar" escolhe de fato. "Cancelar" fecha o pop-up, limpa a busca e deixa
 * a lista aberta pra escolher outro -- que abre o pop-up de novo.
 * Usado por Novo Pedido e Novo Orcamento.
 */

type ClienteDaLista = SearchableClient & ClienteConfirmavel;

interface VendedorSeletorClienteProps<T extends ClienteDaLista> {
  clientes: T[];
  /** Chamado so' quando o vendedor toca em "Confirmar" no pop-up. */
  onConfirmar: (cliente: T) => void;
}

function VendedorSeletorCliente<T extends ClienteDaLista>({ clientes, onConfirmar }: VendedorSeletorClienteProps<T>) {
  const [busca, setBusca] = useState('');
  /** Muda a cada cancelamento: refaz o campo (o autocomplete trava depois de escolher). */
  const [tentativa, setTentativa] = useState(0);
  const [emConfirmacao, setEmConfirmacao] = useState<T | null>(null);
  const campoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Depois de cancelar, volta pro campo com a lista aberta pra escolher outro cliente.
    if (tentativa > 0) campoRef.current?.focus();
  }, [tentativa]);

  const cancelar = () => {
    setEmConfirmacao(null);
    setBusca('');
    setTentativa((atual) => atual + 1);
  };

  return (
    <>
      <ClientAutocomplete
        key={tentativa}
        value={busca}
        onChange={setBusca}
        clients={clientes}
        onSelect={(cliente) => setEmConfirmacao(cliente)}
        renderItem={(cliente) => <span>{cliente.nome}</span>}
        placeholder="Buscar cliente por nome"
        ariaLabel="Buscar cliente"
        inputRef={campoRef}
      />
      <VendedorConfirmarClienteModal
        cliente={emConfirmacao}
        onConfirmar={() => { if (emConfirmacao) onConfirmar(emConfirmacao); }}
        onCancelar={cancelar}
      />
    </>
  );
}

export default VendedorSeletorCliente;

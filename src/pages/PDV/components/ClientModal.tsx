import React, { useState } from 'react';
import { UserPlus, UserRound } from 'lucide-react';
import type { PdvClient } from '../types';
import CadastroRapidoClienteModal, { type ClienteCadastradoRapido } from '../../../components/common/CadastroRapidoClienteModal';
import ConsultaClientesModal from '../../../components/common/ConsultaClientesModal';
import { mostrarAlertaDoCliente } from '../../../components/common/AlertaDoCliente';
import { FILTROS_CONSULTA_PADRAO, type FiltrosConsultaCliente } from '../../../utils/clientSearch';

interface ClientModalProps {
  open: boolean;
  clients: PdvClient[];
  selectedClient: PdvClient | null;
  onClose: () => void;
  onSelect: (client: PdvClient | null) => void;
}

/**
 * Cliente do PDV (F2). Desde 2026-10-06 e' a mesma Consulta de clientes do
 * Pedido/OS/Orcamento (todos os filtros do Integra: cidade, estado,
 * situacao, buscar em, comeca/contem), com "Consumidor final" e "Cadastrar
 * cliente" no rodape. Os filtros ficam valendo enquanto o PDV estiver aberto
 * -- o caixa costuma atender a mesma cidade a manha inteira. Escolher cliente
 * com alerta no cadastro abre o alerta.
 */
const ClientModal: React.FC<ClientModalProps> = ({
  open,
  clients,
  selectedClient,
  onClose,
  onSelect,
}) => {
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosConsultaCliente>(FILTROS_CONSULTA_PADRAO);

  const escolher = (client: PdvClient) => {
    onSelect(client);
    mostrarAlertaDoCliente(client);
  };

  const handleClienteCriado = (cliente: ClienteCadastradoRapido) => {
    onSelect({ id: cliente.id, codigo: cliente.codigo, nome: cliente.nome, telefone: cliente.telefone, documento: cliente.documento });
    onClose();
  };

  return (
    <>
      <ConsultaClientesModal
        open={open && !cadastroAberto}
        onClose={onClose}
        clients={clients}
        onSelect={escolher}
        filtros={filtros}
        onFiltrosChange={setFiltros}
        selecionadoId={selectedClient?.id ?? null}
        acoesExtras={(
          <>
            <button
              type="button"
              className={`btn-secondary${!selectedClient ? ' is-ativo' : ''}`}
              onClick={() => { onSelect(null); onClose(); }}
              title="Venda sem cliente identificado"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <UserRound size={16} aria-hidden="true" /> Consumidor final
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCadastroAberto(true)}
              title="Novo cadastro rápido, sem sair da venda"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <UserPlus size={16} aria-hidden="true" /> Cadastrar cliente
            </button>
          </>
        )}
      />

      <CadastroRapidoClienteModal
        open={open && cadastroAberto}
        onClose={() => setCadastroAberto(false)}
        onCriado={(cliente) => { setCadastroAberto(false); handleClienteCriado(cliente); }}
      />
    </>
  );
};

export default React.memo(ClientModal);

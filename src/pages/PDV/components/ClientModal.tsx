import React, { useMemo, useState } from 'react';
import { Search, UserPlus, UserRound, X } from 'lucide-react';
import type { PdvClient } from '../types';
import CadastroRapidoClienteModal, { type ClienteCadastradoRapido } from '../../../components/common/CadastroRapidoClienteModal';

interface ClientModalProps {
  open: boolean;
  clients: PdvClient[];
  selectedClient: PdvClient | null;
  onClose: () => void;
  onSelect: (client: PdvClient | null) => void;
}

const ClientModal: React.FC<ClientModalProps> = ({
  open,
  clients,
  selectedClient,
  onClose,
  onSelect,
}) => {
  const [search, setSearch] = useState('');
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients.slice(0, 40);

    return clients.filter((client) => [
      client.nome,
      client.codigo,
      client.documento,
      client.telefone,
      client.email,
    ].filter(Boolean).join(' ').toLowerCase().includes(term)).slice(0, 40);
  }, [clients, search]);

  if (!open) return null;

  const handleClienteCriado = (cliente: ClienteCadastradoRapido) => {
    onSelect({ id: cliente.id, codigo: cliente.codigo, nome: cliente.nome, telefone: cliente.telefone, documento: cliente.documento });
    onClose();
  };

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal" role="dialog" aria-modal="true" aria-label="Selecionar cliente">
        <div className="pdv-modal-header">
          <div>
            <span>F2</span>
            <h2>Cliente</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar">
            <X size={20} />
          </button>
        </div>

        <button
          type="button"
          className={!selectedClient ? 'pdv-customer-option active' : 'pdv-customer-option'}
          onClick={() => { onSelect(null); onClose(); }}
        >
          <UserRound size={20} />
          <span>
            <strong>CONSUMIDOR FINAL</strong>
            <small>Venda sem cliente identificado</small>
          </span>
        </button>

        <div className="pdv-modal-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente, código, CPF/CNPJ, telefone ou e-mail"
            autoFocus
          />
        </div>

        <button
          type="button"
          className="pdv-customer-option"
          onClick={() => setCadastroAberto(true)}
        >
          <UserPlus size={20} />
          <span>
            <strong>Cadastrar Cliente</strong>
            <small>Novo cadastro rápido, sem sair da venda</small>
          </span>
        </button>

        <div className="pdv-customer-list">
          {filteredClients.map((client) => (
            <button
              type="button"
              key={client.id}
              className={selectedClient?.id === client.id ? 'pdv-customer-option active' : 'pdv-customer-option'}
              onClick={() => { onSelect(client); onClose(); }}
            >
              <UserRound size={20} />
              <span>
                <strong>{client.codigo ? `#${client.codigo} — ${client.nome}` : client.nome}</strong>
                <small>{client.documento || client.telefone || client.email || 'Cliente cadastrado'}</small>
              </span>
            </button>
          ))}

          {filteredClients.length === 0 && (
            <div className="pdv-modal-empty">Nenhum cliente encontrado.</div>
          )}
        </div>
      </div>

      <CadastroRapidoClienteModal
        open={cadastroAberto}
        onClose={() => setCadastroAberto(false)}
        onCriado={handleClienteCriado}
      />
    </div>
  );
};

export default React.memo(ClientModal);

import React from 'react';
import { TriangleAlert } from 'lucide-react';
import type { SearchableClient } from '../../utils/clientSearch';
import { normalizeSearchText } from '../../utils/textSearch';
import { formatarDocumento } from '../../utils/documentoValidacao';
import { alertaDoCliente, type ClienteComAlerta } from '../../utils/clienteAlertaDomain';

/**
 * Linha padrao de cliente nas buscas (2026-10-06): o nome em destaque com o
 * codigo antes; embaixo fantasia, CPF/CNPJ e telefone; a cidade a direita.
 * Com a cidade na linha, dois "SUPERMERCADO ..." de lugares diferentes param
 * de parecer o mesmo cliente.
 */
const LinhaCliente: React.FC<{ cliente: SearchableClient }> = ({ cliente }) => {
  const nome = String(cliente.nome || '').trim();
  const fantasia = String(cliente.fantasia || '').trim();
  const mostrarFantasia = fantasia !== '' && normalizeSearchText(fantasia) !== normalizeSearchText(nome);
  const documento = cliente.documento ? formatarDocumento(String(cliente.documento)) : '';
  const telefone = String(cliente.telefone || cliente.celular || '').trim();
  const detalhe = [mostrarFantasia ? fantasia : '', documento, telefone].filter(Boolean).join(' · ');
  const cidade = String(cliente.cidade || '').trim().toUpperCase();
  const uf = String(cliente.estado || '').trim().toUpperCase();
  const local = cidade && uf ? `${cidade} · ${uf}` : cidade || uf;
  // Aviso discreto ANTES de escolher: o alerta completo abre ao escolher.
  const temAlerta = Boolean(alertaDoCliente(cliente as ClienteComAlerta));

  return (
    <span className="linha-cliente">
      <span className="linha-cliente__principal">
        <span className="linha-cliente__nome">
          {cliente.codigo && <span className="linha-cliente__codigo">{cliente.codigo}</span>}
          {temAlerta && <TriangleAlert size={13} className="linha-cliente__alerta" aria-label="Tem alerta no cadastro" />}
          {nome}
        </span>
        {detalhe && <span className="linha-cliente__detalhe">{detalhe}</span>}
      </span>
      {local && <span className="linha-cliente__local">{local}</span>}
    </span>
  );
};

export default LinhaCliente;

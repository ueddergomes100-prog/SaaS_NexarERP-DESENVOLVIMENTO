import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { showError, showWarning } from '../../utils/alerts';
import { documentoService, type ConsultaCnpjResultado, type ConsultaCpfResultado } from '../../services/documentoService';
import { isCnpjValido, isCpfValido, tipoDocumento } from '../../utils/documentoValidacao';

/**
 * Botao "Buscar" ao lado do campo CPF/CNPJ no formulario de cadastro --
 * preenche/atualiza o formulario com dado oficial (CNPJ: Receita Federal,
 * gratis) ou pago (CPF: apicpf.com, so nome). Cada tela decide quais
 * campos aplicar (endereco existe em Cliente, nao em Fornecedor, por
 * exemplo), por isso recebe callbacks em vez de escrever direto no form.
 */

interface Props {
  documento: string;
  onEncontrarCnpj: (dados: ConsultaCnpjResultado) => void;
  onEncontrarCpf: (dados: ConsultaCpfResultado) => void;
}

const BuscarDocumentoButton: React.FC<Props> = ({ documento, onEncontrarCnpj, onEncontrarCpf }) => {
  const [carregando, setCarregando] = useState(false);
  const tipo = tipoDocumento(documento);
  const digitoOk = tipo === 'CPF' ? isCpfValido(documento) : tipo === 'CNPJ' ? isCnpjValido(documento) : false;

  if (!tipo) return null;

  const buscar = async () => {
    setCarregando(true);
    try {
      if (tipo === 'CNPJ') {
        const resultado = await documentoService.consultarCnpj(documento);
        if (!resultado.encontrado) {
          showWarning('CNPJ não encontrado', 'Os dígitos são válidos, mas não achamos esse cadastro na Receita Federal.');
          return;
        }
        onEncontrarCnpj(resultado);
        showWarning('Dados preenchidos a partir da Receita Federal', 'Confira antes de salvar.');
      } else {
        const resultado = await documentoService.consultarCpf(documento);
        if (!resultado.encontrado) {
          showWarning('CPF não encontrado', 'Os dígitos são válidos, mas não achamos esse CPF na consulta.');
          return;
        }
        onEncontrarCpf(resultado);
        showWarning('Nome preenchido a partir da consulta de CPF', 'Confira antes de salvar.');
      }
    } catch (error) {
      showError('Erro ao buscar', error instanceof Error ? error.message : 'Não foi possível consultar agora.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={buscar}
      disabled={carregando || !digitoOk}
      title={digitoOk ? (tipo === 'CNPJ' ? 'Buscar dados na Receita Federal' : 'Buscar nome pelo CPF') : 'Confira os dígitos antes de buscar'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px',
        padding: '8px 12px', whiteSpace: 'nowrap', marginTop: '24px', opacity: digitoOk ? 1 : 0.5,
      }}
    >
      {carregando ? <Loader2 size={14} className="spin-animation" /> : <Search size={14} />}
      Buscar {tipo}
    </button>
  );
};

export default BuscarDocumentoButton;

import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { NexusSwal, showError } from '../../utils/alerts';
import { documentoService } from '../../services/documentoService';
import { apenasDigitos, formatarDocumento, isCnpjValido, isCpfValido, tipoDocumento } from '../../utils/documentoValidacao';

/**
 * "Lupa" pra validar um CPF/CNPJ ja cadastrado (Clientes/Fornecedores).
 * CPF: so confere digito verificador (nao existe consulta publica de
 * dados de CPF no Brasil). CNPJ: confere digito verificador e, se bater,
 * consulta a Receita Federal (via backend) pra trazer razao social e
 * situacao cadastral -- nunca grava nada, so mostra o resultado.
 */

interface Props {
  documento: string;
}

const escapeHtml = (valor: string): string => valor
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const ValidarDocumentoButton: React.FC<Props> = ({ documento }) => {
  const [carregando, setCarregando] = useState(false);
  const digitos = apenasDigitos(documento);
  const tipo = tipoDocumento(digitos);

  if (!digitos || !tipo) return null;

  const validarCpf = async () => {
    if (!isCpfValido(digitos)) {
      NexusSwal.fire({
        icon: 'error',
        title: 'CPF inválido',
        text: `${formatarDocumento(digitos)} — os dígitos verificadores não conferem. Corrija o cadastro.`,
        confirmButtonText: 'Entendi',
      });
      return;
    }

    setCarregando(true);
    try {
      const resultado = await documentoService.consultarCpf(digitos);

      if (!resultado.encontrado) {
        NexusSwal.fire({
          icon: 'warning',
          title: 'CPF válido, mas não encontrado na consulta',
          text: `${formatarDocumento(digitos)} — os dígitos batem, mas não achamos esse CPF na base consultada. Confira se o número está correto.`,
          confirmButtonText: 'Entendi',
        });
        return;
      }

      NexusSwal.fire({
        icon: 'success',
        title: 'CPF válido e encontrado',
        html: `<div style="text-align:left; font-size:14px; line-height:1.7;">
          <p><strong>${escapeHtml(formatarDocumento(digitos))}</strong></p>
          <p><strong>Nome:</strong> ${escapeHtml(resultado.nome || '-')}</p>
          ${resultado.dataNascimento ? `<p><strong>Data de nascimento:</strong> ${escapeHtml(resultado.dataNascimento)}</p>` : ''}
          <p style="opacity:0.7; font-size:12px; margin-top:8px;">Confira se o nome bate com o cadastrado — a consulta não traz endereço nem situação cadastral.</p>
        </div>`,
        confirmButtonText: 'Fechar',
      });
    } catch (error) {
      // Consulta paga pode estar indisponivel/nao configurada -- nao
      // bloqueia a validacao, so cai pro resultado so-checksum.
      NexusSwal.fire({
        icon: 'success',
        title: 'CPF com dígitos verificadores válidos',
        html: `<div style="text-align:left; font-size:14px; line-height:1.6;">
          <p><strong>${escapeHtml(formatarDocumento(digitos))}</strong></p>
          <p style="opacity:0.7; font-size:12px;">Não foi possível consultar o nome agora (${escapeHtml(error instanceof Error ? error.message : 'consulta indisponível')}) — confirmamos só que o número é matematicamente válido.</p>
        </div>`,
        confirmButtonText: 'Entendi',
      });
    } finally {
      setCarregando(false);
    }
  };

  const validarCnpj = async () => {
    if (!isCnpjValido(digitos)) {
      NexusSwal.fire({
        icon: 'error',
        title: 'CNPJ inválido',
        text: `${formatarDocumento(digitos)} — os dígitos verificadores não conferem. Corrija o cadastro.`,
        confirmButtonText: 'Entendi',
      });
      return;
    }

    setCarregando(true);
    try {
      const resultado = await documentoService.consultarCnpj(digitos);

      if (!resultado.encontrado) {
        NexusSwal.fire({
          icon: 'warning',
          title: 'CNPJ válido, mas não encontrado na Receita Federal',
          text: `${formatarDocumento(digitos)} — os dígitos batem, mas a consulta pública não achou esse cadastro. Confira se o número está correto.`,
          confirmButtonText: 'Entendi',
        });
        return;
      }

      const endereco = [
        [resultado.logradouro, resultado.numero].filter(Boolean).join(', '),
        resultado.bairro,
        [resultado.municipio, resultado.uf].filter(Boolean).join('/'),
      ].filter(Boolean).join(' — ');

      NexusSwal.fire({
        icon: resultado.ativo ? 'success' : 'warning',
        title: resultado.ativo ? 'CNPJ ativo na Receita Federal' : `CNPJ encontrado — situação: ${resultado.situacao || 'não informada'}`,
        html: `<div style="text-align:left; font-size:14px; line-height:1.7;">
          <p><strong>${escapeHtml(formatarDocumento(digitos))}</strong></p>
          <p><strong>Razão Social:</strong> ${escapeHtml(resultado.razaoSocial || '-')}</p>
          ${resultado.nomeFantasia ? `<p><strong>Nome Fantasia:</strong> ${escapeHtml(resultado.nomeFantasia)}</p>` : ''}
          <p><strong>Situação:</strong> ${escapeHtml(resultado.situacao || '-')}</p>
          ${endereco ? `<p><strong>Endereço:</strong> ${escapeHtml(endereco)}</p>` : ''}
        </div>`,
        confirmButtonText: 'Fechar',
      });
    } catch (error) {
      showError('Erro ao consultar', error instanceof Error ? error.message : 'Não foi possível consultar este CNPJ agora.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <button
      type="button"
      className="icon-btn"
      title={tipo === 'CPF' ? 'Validar CPF' : 'Validar CNPJ na Receita Federal'}
      onClick={(e) => {
        e.stopPropagation();
        if (tipo === 'CPF') void validarCpf();
        else void validarCnpj();
      }}
      disabled={carregando}
    >
      {carregando ? <Loader2 size={16} className="spin-animation" /> : <Search size={16} />}
    </button>
  );
};

export default ValidarDocumentoButton;

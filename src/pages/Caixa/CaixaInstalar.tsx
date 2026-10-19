import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, MonitorDown, MoreVertical } from 'lucide-react';
import wordmarkDark from '../../assets/hennder-wordmark-dark.webp';
import wordmarkLight from '../../assets/hennder-wordmark-light.webp';
import { estaInstalado } from '../../utils/pwaInstalado';
import { CAMINHO_APP_CAIXA } from '../../utils/frenteDeCaixaDomain';
// As classes .auth-brand-img.is-dark/.is-light (uma logo por tema) moram aqui.
import '../Auth/Auth.css';

/**
 * Porta de entrada da INSTALACAO da Frente de Caixa (`/caixa.html`), pelo
 * mesmo motivo de VendedorInstalar.tsx: a hospedagem de producao nao
 * reescreve caminhos, entao o unico HTML com o manifest e o icone do caixa
 * e' o arquivo real `caixa.html`. O manifest aponta o start_url para ele.
 *
 *  - aberto pelo atalho instalado: vai direto para o caixa;
 *  - aberto no navegador: mostra como instalar e deixa seguir sem instalar.
 */
const passoStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
};

const CaixaInstalar: React.FC = () => {
  const navigate = useNavigate();

  if (estaInstalado()) {
    return <Navigate to={CAMINHO_APP_CAIXA} replace />;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <span>
          <img className="auth-brand-img is-dark" src={wordmarkDark} alt="Hennder Company" style={{ width: '170px' }} />
          <img className="auth-brand-img is-light" src={wordmarkLight} alt="Hennder Company" style={{ width: '170px' }} />
        </span>

        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Instalar a Frente de Caixa</h1>
          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '8px' }}>
            Instalada, a Frente de Caixa abre numa janela própria, sem o resto do sistema, com ícone na área de trabalho.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={passoStyle}>
            <MonitorDown size={20} color="var(--brand-400)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '14.5px', color: 'var(--text-secondary)' }}>
              No Chrome ou no Edge, clique no ícone <strong style={{ color: 'var(--text-primary)' }}>Instalar</strong> que aparece na barra de endereço
            </span>
          </div>
          <div style={passoStyle}>
            <MoreVertical size={20} color="var(--brand-400)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '14.5px', color: 'var(--text-secondary)' }}>
              Ou abra o menu do navegador e escolha <strong style={{ color: 'var(--text-primary)' }}>Instalar app</strong>
            </span>
          </div>
        </div>

        <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
          Instale por esta página. Instalando a partir de outra tela do sistema, o atalho abre o sistema completo em vez do caixa.
        </p>

        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate(CAMINHO_APP_CAIXA)}
          style={{ height: '48px', justifyContent: 'center', gap: '8px' }}
        >
          Abrir a Frente de Caixa <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default CaixaInstalar;

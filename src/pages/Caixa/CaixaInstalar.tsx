import React, { useState, useSyncExternalStore } from 'react';
import { acompanharPedidoDeInstalacao, pedirInstalacao, podeInstalarAgora } from '../../utils/pedidoDeInstalacao';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, MonitorDown, MoreVertical } from 'lucide-react';
import wordmarkDark from '../../assets/hennder-wordmark-dark.webp';
import wordmarkLight from '../../assets/hennder-wordmark-light.webp';
import { estaInstalado } from '../../utils/pwaInstalado';
import { CAMINHO_APP_CAIXA } from '../../utils/frenteDeCaixaDomain';
// As classes .auth-brand-img.is-dark/.is-light (uma logo por tema) moram aqui.
import '../Auth/Auth.css';

/**
 * Porta de entrada da INSTALACAO da Frente de Caixa (`/caixa.html`): o HTML
 * com o manifest e o icone do caixa (id proprio e escopo /caixa, para instalar
 * separado do sistema completo -- 17/11/2026). O manifest aponta o start_url
 * para ele; o .htaccess da producao manda /caixa/** para o mesmo arquivo. Com
 * o navegador oferecendo (Chrome/Edge), mostra o botao Instalar
 * (pedidoDeInstalacao.ts); sem isso, o passo a passo.
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
  // Botao "Instalar" de verdade quando o navegador oferece (Chrome/Edge).
  const podeInstalar = useSyncExternalStore(acompanharPedidoDeInstalacao, podeInstalarAgora);
  const [instalou, setInstalou] = useState(false);
  const instalar = async () => {
    if (await pedirInstalacao()) setInstalou(true);
  };

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

        {instalou && (
          <p style={{ fontSize: '14.5px', color: 'var(--text-primary)', margin: 0 }}>
            Pronto! A Frente de Caixa foi instalada. Abra pelo ícone &quot;Caixa&quot; na área de trabalho ou no menu Iniciar.
          </p>
        )}
        {podeInstalar && !instalou && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void instalar()}
            style={{ height: '52px', justifyContent: 'center', gap: '8px', fontSize: '16px' }}
          >
            <MonitorDown size={20} /> Instalar a Frente de Caixa
          </button>
        )}

        <div style={{ display: podeInstalar || instalou ? 'none' : 'flex', flexDirection: 'column', gap: '10px' }}>
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
          A Frente de Caixa é um app separado do sistema completo: pode instalar os dois no mesmo computador. Instale por esta página — instalando a partir de outra tela, o atalho abre o sistema completo.
        </p>

        <button
          type="button"
          className={podeInstalar && !instalou ? 'btn-secondary' : 'btn-primary'}
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

import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Share, SquarePlus } from 'lucide-react';
import wordmarkDark from '../../assets/hennder-wordmark-dark.png';
import { estaInstalado } from './pwa';
import './vendedorMobile.css';

/**
 * Porta de entrada da INSTALACAO do app do vendedor (`/vendedor.html`).
 *
 * Por que existe um arquivo `.html` de verdade no meio das rotas:
 *
 * A producao roda numa hospedagem estatica (Hostinger) que NAO aceita regra
 * de reescrita -- `/vendedor` cai no fallback padrao dela e entrega o
 * `index.html` do sistema desktop, cujo <head> aponta pro manifest do
 * desktop (`start_url: "/"`). Como o iPhone le manifest e icone do HTML
 * ESTATICO (antes de qualquer JS rodar), "Adicionar a Tela de Inicio" feito
 * a partir de `/vendedor` sempre gravava o atalho apontando pra raiz do
 * sistema -- e o atalho abria no /login do desktop. Testado e confirmado:
 * `/vendedor` devolve o index.html, `/vendedor.html` devolve o certo.
 *
 * Entao o manifest do vendedor aponta `start_url` pro arquivo que existe de
 * verdade (`/vendedor.html`), e esta tela cuida dos dois casos de quem chega
 * nele:
 *
 *  - aberto pelo ICONE (standalone): manda direto pro app, em `/vendedor`;
 *  - aberto no SAFARI: mostra como instalar -- e' esta a pagina que precisa
 *    estar na tela quando o usuario toca em "Adicionar a Tela de Inicio",
 *    porque e' a unica com o <head> certo.
 */

const passoStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '14px',
  backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
};

const VendedorInstalar: React.FC = () => {
  const navigate = useNavigate();

  // Abriu pelo icone da tela de inicio: nao tem nada pra instalar, segue
  // direto pro app (que vive em /vendedor, com as sub-rotas normais).
  if (estaInstalado()) {
    return <Navigate to="/vendedor" replace />;
  }

  return (
    <div
      className="vendedor-app"
      style={{
        minHeight: '100dvh', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column',
        gap: '22px',
        padding: 'calc(28px + env(safe-area-inset-top)) 24px calc(32px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--brand-700) 24%, var(--bg-primary)) 0%, var(--bg-primary) 46%)',
      }}
    >
      <img src={wordmarkDark} alt="Hennder Company" style={{ width: '170px', maxWidth: '60%' }} />

      <div>
        <h1 style={{ fontSize: '23px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          Instalar o app de vendas
        </h1>
        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '8px' }}>
          Adicione à tela de início do celular para abrir como um aplicativo, em tela cheia e com ícone próprio.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={passoStyle}>
          <Share size={20} color="var(--brand-400)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '14.5px', color: 'var(--text-secondary)' }}>
            1. Toque no botão <strong style={{ color: 'var(--text-primary)' }}>Compartilhar</strong> do navegador
          </span>
        </div>
        <div style={passoStyle}>
          <SquarePlus size={20} color="var(--brand-400)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '14.5px', color: 'var(--text-secondary)' }}>
            2. Escolha <strong style={{ color: 'var(--text-primary)' }}>Adicionar à Tela de Início</strong>
          </span>
        </div>
      </div>

      <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Importante: instale por esta página. Se adicionar a partir de outra tela do sistema, o atalho abre no login do
        sistema completo em vez do app de vendas.
      </p>

      <button
        type="button"
        onClick={() => navigate('/vendedor')}
        style={{
          marginTop: 'auto', height: '52px', borderRadius: '14px', border: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '15.5px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer',
        }}
      >
        Continuar no navegador <ArrowRight size={18} />
      </button>
    </div>
  );
};

export default VendedorInstalar;

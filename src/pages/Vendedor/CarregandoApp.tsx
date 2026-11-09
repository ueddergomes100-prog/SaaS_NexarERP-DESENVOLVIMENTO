import React from 'react';
import './carregandoApp.css';

/**
 * Tela de carregamento do app Vendas (09/11/2026). Mesmo desenho da que vem
 * pronta no vendedor.html (ver carregandoApp.css): quando o React assume o
 * #root, troca uma pela outra sem a pessoa perceber. Usada enquanto a tela
 * pedida baixa (Suspense) e enquanto o login e' conferido (VendedorShell).
 */
const CarregandoApp: React.FC = () => (
  <div className="hv-carregando" role="status" aria-live="polite">
    <img className="hv-carregando-icone" src="/icon-vendedor-192.png" alt="" width={88} height={88} />
    <div className="hv-carregando-nome">Hennder Vendas</div>
    <div className="hv-carregando-barra" aria-hidden="true" />
    <div className="hv-carregando-texto">Carregando…</div>
    <div className="hv-carregando-lento">Está demorando mais que o normal. Confira a internet do celular; o aplicativo abre sozinho assim que carregar.</div>
  </div>
);

export default CarregandoApp;

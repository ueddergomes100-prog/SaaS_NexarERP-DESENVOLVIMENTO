import { useEffect } from 'react';

/**
 * Enquanto o usuario esta em qualquer tela /vendedor/*, troca as tags de
 * "instalar como app" do <head> pras do app do vendedor (start_url e scope
 * = /vendedor, nome proprio), e devolve as do sistema desktop
 * (manifest.webmanifest, start_url "/") ao sair. As duas experiencias
 * (desktop e vendedor) compartilham o mesmo index.html -- sem isto, "Adicionar
 * a Tela de Inicio" no celular sempre abria na raiz do sistema (start_url "/"
 * do manifest do desktop), caindo no /login normal em vez do /vendedor.
 */
const MANIFEST_VENDEDOR = '/manifest-vendedor.webmanifest';
const MANIFEST_DESKTOP = '/manifest.webmanifest';
const APPLE_ICON_VENDEDOR = '/icon-vendedor-192.png';
const APPLE_ICON_DESKTOP = '/icon-192.png';

export const useVendedorAppTags = () => {
  useEffect(() => {
    const linkManifest = document.querySelector('link[rel="manifest"]');
    const hrefOriginal = linkManifest?.getAttribute('href') || MANIFEST_DESKTOP;
    linkManifest?.setAttribute('href', MANIFEST_VENDEDOR);

    // iOS le o icone do "Adicionar a Tela de Inicio" desta tag, nao do
    // manifest -- sem trocar aqui tambem, o atalho do vendedor sairia com
    // o icone do sistema desktop.
    const linkAppleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const appleIconOriginal = linkAppleIcon?.getAttribute('href') || APPLE_ICON_DESKTOP;
    linkAppleIcon?.setAttribute('href', APPLE_ICON_VENDEDOR);

    const metaCapable = document.createElement('meta');
    metaCapable.name = 'apple-mobile-web-app-capable';
    metaCapable.content = 'yes';
    document.head.appendChild(metaCapable);

    const metaTitle = document.createElement('meta');
    metaTitle.name = 'apple-mobile-web-app-title';
    metaTitle.content = 'Hennder Vendas';
    document.head.appendChild(metaTitle);

    const metaStatusBar = document.createElement('meta');
    metaStatusBar.name = 'apple-mobile-web-app-status-bar-style';
    metaStatusBar.content = 'black-translucent';
    document.head.appendChild(metaStatusBar);

    return () => {
      linkManifest?.setAttribute('href', hrefOriginal);
      linkAppleIcon?.setAttribute('href', appleIconOriginal);
      metaCapable.remove();
      metaTitle.remove();
      metaStatusBar.remove();
    };
  }, []);
};

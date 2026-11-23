import { descricaoDaVersao, lerVersaoDoSistema, rotuloDaVersao } from './versaoDoSistemaDomain';

/**
 * A versao do sistema que esta' rodando nesta aba: o carimbo que o Vite poe no
 * build (vite.config.ts). `typeof` porque em teste e em ferramenta fora do
 * Vite as constantes nao existem -- ai a versao fica vazia e nada aparece.
 */
export const VERSAO_ATUAL = lerVersaoDoSistema({
  construidaEm: typeof __VERSAO_CONSTRUIDA_EM__ === 'string' ? __VERSAO_CONSTRUIDA_EM__ : '',
  commit: typeof __VERSAO_COMMIT__ === 'string' ? __VERSAO_COMMIT__ : '',
  desenvolvimento: import.meta.env.DEV === true,
});

export const ROTULO_DA_VERSAO_ATUAL = rotuloDaVersao(VERSAO_ATUAL);
export const DESCRICAO_DA_VERSAO_ATUAL = descricaoDaVersao(VERSAO_ATUAL);

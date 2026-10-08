/**
 * Reduz uma foto no proprio aparelho antes de subir (app do tecnico, fase 3
 * -- 2026-10-08): lado maior em LADO_MAXIMO px e JPEG com qualidade 0,82.
 * Foto de celular de 4-8 MB vira ~200-400 KB, boa para ver detalhe e leve
 * para sair da roca com sinal fraco. Respeita a orientacao EXIF (foto em pe
 * continua em pe) quando o navegador suporta `createImageBitmap`.
 *
 * Nao e' dominio puro (precisa de canvas), por isso mora fora do *Domain.
 */
export const comprimirImagem = async (arquivo: Blob, ladoMaximo = 1280, qualidade = 0.82): Promise<Blob> => {
  const bitmap = await carregarImagem(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível preparar a foto neste aparelho.');
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não foi possível reduzir a foto. Tente outra imagem.');
  return blob;
};

const carregarImagem = async (arquivo: Blob): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(arquivo, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      // cai no <img>
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Este arquivo não é uma imagem que o aparelho consiga abrir.')); };
    img.src = url;
  });
};

/** Canvas da assinatura -> PNG com fundo transparente. */
export const canvasParaPng = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível guardar a assinatura. Tente de novo.'))), 'image/png');
});

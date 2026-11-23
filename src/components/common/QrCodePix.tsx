import React, { useMemo } from 'react';
import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library';

/**
 * QR Code em SVG (nitido em qualquer impressora), a partir de um texto -- aqui,
 * o "Pix copia e cola" (pixPedidoDomain.ts). Usa o @zxing que o sistema ja' tem
 * para ler codigo de barras: nada de biblioteca nova. Correcao de erro "M": o
 * papel pode amassar, e o QR continua lendo.
 */
interface QrCodePixProps {
  texto: string;
  /** Lado do QR (ex.: '22mm'). */
  tamanho: string;
  titulo?: string;
}

const QrCodePix: React.FC<QrCodePixProps> = ({ texto, tamanho, titulo }) => {
  const desenho = useMemo(() => {
    try {
      const dicas = new Map<EncodeHintType, unknown>();
      dicas.set(EncodeHintType.ERROR_CORRECTION, 'M');
      dicas.set(EncodeHintType.MARGIN, 0);
      // Largura 1: um ponto por modulo (o SVG e' quem escala).
      const matriz = new QRCodeWriter().encode(texto, BarcodeFormat.QR_CODE, 1, 1, dicas);
      const lado = matriz.getWidth();
      let caminho = '';
      for (let y = 0; y < lado; y += 1) {
        for (let x = 0; x < lado; x += 1) {
          if (matriz.get(x, y)) caminho += `M${x} ${y}h1v1h-1z`;
        }
      }
      return { lado, caminho };
    } catch (erro) {
      console.error('Não foi possível desenhar o QR Code:', erro);
      return null;
    }
  }, [texto]);

  if (!desenho) return null;
  // Margem de 2 modulos em branco em volta: o leitor do celular precisa dela.
  const margem = 2;
  const total = desenho.lado + margem * 2;
  return (
    <svg
      viewBox={`${-margem} ${-margem} ${total} ${total}`}
      width={tamanho}
      height={tamanho}
      shapeRendering="crispEdges"
      role="img"
      aria-label={titulo || 'QR Code'}
      style={{ display: 'block', background: '#fff' }}
    >
      <rect x={-margem} y={-margem} width={total} height={total} fill="#fff" />
      <path d={desenho.caminho} fill="#000" />
    </svg>
  );
};

export default React.memo(QrCodePix);

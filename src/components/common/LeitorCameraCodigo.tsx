import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Leitura de codigo de barras pela CAMERA do celular (conferencia no app,
 * pedido do dono 15/10/2026). Usa o leitor embutido do navegador
 * (`BarcodeDetector`, presente no Chrome do Android) quando existe. Onde nao
 * existe (Safari do iPhone -- o dono nao achou o icone da camera no balanco,
 * 21/10), le pelo ZXing em JavaScript, carregado so' quando a camera abre.
 */

interface BarcodeDetectorLike {
  detect: (fonte: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (opcoes?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATOS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];

export const cameraLeCodigo = (): boolean => (
  typeof window !== 'undefined'
  && typeof navigator !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
);

/** Le um quadro do video; devolve o codigo achado ou null. */
type LerQuadro = (video: HTMLVideoElement) => Promise<string | null>;

const leitorNativo = (): LerQuadro | null => {
  if (!('BarcodeDetector' in window)) return null;
  const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
  const detector = new Detector({ formats: FORMATOS });
  return async (video) => (await detector.detect(video)).find((a) => a.rawValue)?.rawValue ?? null;
};

// O ZXing em JavaScript le so' o miolo do quadro (onde fica a moldura de
// mirar), em resolucao cheia: e' mais rapido, e reduzir a imagem borra as
// barras finas do EAN a ponto de nao ler.
const RECORTE_LARGURA = 0.9;
const RECORTE_ALTURA = 0.5;

const leitorZxing = async (): Promise<LerQuadro> => {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const dicas = new Map<(typeof DecodeHintType)[keyof typeof DecodeHintType], unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
      BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
    ]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const leitor = new BrowserMultiFormatReader(dicas);
  const tela = document.createElement('canvas');
  const contexto = tela.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!contexto || !video.videoWidth) return null;
    tela.width = Math.round(video.videoWidth * RECORTE_LARGURA);
    tela.height = Math.round(video.videoHeight * RECORTE_ALTURA);
    const x = Math.round((video.videoWidth - tela.width) / 2);
    const y = Math.round((video.videoHeight - tela.height) / 2);
    contexto.drawImage(video, x, y, tela.width, tela.height, 0, 0, tela.width, tela.height);
    try {
      return leitor.decodeFromCanvas(tela).getText() || null;
    } catch {
      return null; // Nenhum codigo neste quadro.
    }
  };
};

interface Props {
  aberto: boolean;
  onLido: (codigo: string) => void;
  onFechar: () => void;
}

const LeitorCameraCodigo: React.FC<Props> = ({ aberto, onLido, onFechar }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto) return undefined;
    setErro('');
    let fluxo: MediaStream | null = null;
    let parado = false;
    let timer = 0;

    const comecar = async () => {
      if (!cameraLeCodigo()) {
        setErro('Este celular não lê código de barras pela câmera no navegador. Digite o código ou use um leitor.');
        return;
      }
      try {
        // 1280x720 "ideal": o Safari do iPhone abre em 640x480 se ninguem
        // pedir, e nessa resolucao o EAN so' le muito perto da lente.
        fluxo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (parado) { fluxo.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) {
          video.current.srcObject = fluxo;
          await video.current.play().catch(() => undefined);
        }
        const lerQuadro = leitorNativo() ?? await leitorZxing();
        const procurar = async () => {
          if (parado || !video.current) return;
          try {
            if (video.current.readyState >= 2) {
              const codigo = await lerQuadro(video.current);
              if (codigo && !parado) {
                if (typeof navigator.vibrate === 'function') navigator.vibrate(60);
                onLido(codigo.trim());
                return;
              }
            }
          } catch {
            // Quadro ruim: tenta o proximo.
          }
          timer = window.setTimeout(procurar, 200);
        };
        void procurar();
      } catch (e) {
        const nome = (e as { name?: string })?.name;
        setErro(nome === 'NotAllowedError'
          ? 'O app não tem permissão para usar a câmera. Libere a câmera nas configurações do celular (permissões do app/navegador) e tente de novo.'
          : 'Não foi possível abrir a câmera. Feche outros apps que estejam usando a câmera e tente de novo, ou digite o código.');
      }
    };
    void comecar();

    return () => {
      parado = true;
      window.clearTimeout(timer);
      fluxo?.getTracks().forEach((t) => t.stop());
    };
  }, [aberto, onLido]);

  if (!aberto) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Ler código pela câmera" style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', color: '#fff' }}>
        <strong style={{ fontSize: '16px' }}>Aponte para o código de barras</strong>
        <button type="button" onClick={onFechar} aria-label="Fechar câmera" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={22} />
        </button>
      </div>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* Moldura para a pessoa mirar. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '10%', right: '10%', top: '38%', height: '24%', border: '3px solid rgba(255,255,255,0.9)', borderRadius: '16px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }} />
        {erro && (
          <div style={{ position: 'absolute', left: '16px', right: '16px', bottom: '24px', padding: '14px 16px', borderRadius: '14px', backgroundColor: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: '14px', lineHeight: 1.45 }}>
            {erro}
          </div>
        )}
      </div>
    </div>
  );
};

export default LeitorCameraCodigo;

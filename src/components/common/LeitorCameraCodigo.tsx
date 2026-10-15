import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Leitura de codigo de barras pela CAMERA do celular (conferencia no app,
 * pedido do dono 15/10/2026). Usa o leitor embutido do navegador
 * (`BarcodeDetector`, presente no Chrome do Android -- onde o app Vendas
 * roda); sem biblioteca nova. Onde nao existe (ex.: Safari do iPhone), a tela
 * avisa e a pessoa digita o codigo ou usa um leitor bluetooth.
 */

interface BarcodeDetectorLike {
  detect: (fonte: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (opcoes?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATOS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];

export const cameraLeCodigo = (): boolean => (
  typeof window !== 'undefined'
  && 'BarcodeDetector' in window
  && typeof navigator !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
);

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
        fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (parado) { fluxo.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) {
          video.current.srcObject = fluxo;
          await video.current.play().catch(() => undefined);
        }
        const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
        const detector = new Detector({ formats: FORMATOS });
        const procurar = async () => {
          if (parado || !video.current) return;
          try {
            if (video.current.readyState >= 2) {
              const achados = await detector.detect(video.current);
              const codigo = achados.find((a) => a.rawValue)?.rawValue;
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, RotateCcw, X } from 'lucide-react';
import { cameraLeCodigo } from './LeitorCameraCodigo';

/**
 * Foto tirada DENTRO do app (09/11/2026, video do dono: canhoto que nao salvava).
 *
 * O `<input type="file" capture>` abre o aplicativo de camera do Android.
 * Em celular com pouca memoria o Android fecha o app Vendas enquanto a camera
 * esta' aberta; na volta o app abre do zero (tela de carregamento) e a foto
 * chega numa pagina que nao existe mais -- some sem erro nenhum. Aqui a
 * camera roda na propria pagina (getUserMedia, o mesmo do leitor de codigo
 * de barras): o app nao sai da tela, entao nao tem o que fechar.
 *
 * Sem camera no navegador ou sem permissao: explica e oferece o caminho
 * antigo (`onUsarCameraDoCelular`).
 */

interface Props {
  aberto: boolean;
  /** "Foto do canhoto", "Foto da OS"... */
  titulo: string;
  onFoto: (arquivo: File) => void;
  onFechar: () => void;
  /** Caminho antigo (camera do Android), para quando a camera por dentro nao abre. */
  onUsarCameraDoCelular?: () => void;
}

const botaoRedondo: React.CSSProperties = {
  background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: '40px', height: '40px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

const botaoBarra: React.CSSProperties = {
  flex: 1, height: '52px', borderRadius: '14px', border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
};

const CameraFoto: React.FC<Props> = ({ aberto, titulo, onFoto, onFechar, onUsarCameraDoCelular }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [pronta, setPronta] = useState(false);
  const [erro, setErro] = useState('');
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [tirando, setTirando] = useState(false);

  const descartarFoto = useCallback(() => {
    setFoto((atual) => {
      if (atual) URL.revokeObjectURL(atual.url);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;
    setErro('');
    setPronta(false);
    let fluxo: MediaStream | null = null;
    let parado = false;

    const comecar = async () => {
      if (!cameraLeCodigo()) {
        setErro('Este celular não deixa o app usar a câmera por dentro.');
        return;
      }
      try {
        fluxo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (parado) { fluxo.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) {
          video.current.srcObject = fluxo;
          await video.current.play().catch(() => undefined);
        }
        setPronta(true);
      } catch (e) {
        const nome = (e as { name?: string })?.name;
        setErro(nome === 'NotAllowedError'
          ? 'O app não tem permissão para usar a câmera. Libere a câmera nas configurações do celular (permissões do app/navegador) e tente de novo.'
          : 'Não foi possível abrir a câmera. Feche outros apps que estejam usando a câmera e tente de novo.');
      }
    };
    void comecar();

    return () => {
      parado = true;
      fluxo?.getTracks().forEach((t) => t.stop());
    };
  }, [aberto]);

  // Fechou ou trocou de tela: solta a foto da memoria.
  useEffect(() => { if (!aberto) descartarFoto(); }, [aberto, descartarFoto]);

  if (!aberto) return null;

  const disparar = () => {
    const v = video.current;
    if (!v || !v.videoWidth || tirando) return;
    setTirando(true);
    const tela = document.createElement('canvas');
    tela.width = v.videoWidth;
    tela.height = v.videoHeight;
    const contexto = tela.getContext('2d');
    if (!contexto) { setTirando(false); setErro('Não foi possível tirar a foto. Tente de novo.'); return; }
    contexto.drawImage(v, 0, 0, tela.width, tela.height);
    tela.toBlob((blob) => {
      setTirando(false);
      if (!blob) { setErro('Não foi possível tirar a foto. Tente de novo.'); return; }
      if (typeof navigator.vibrate === 'function') navigator.vibrate(40);
      setFoto({ blob, url: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.9);
  };

  const usar = () => {
    if (!foto) return;
    const arquivo = new File([foto.blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
    descartarFoto();
    onFoto(arquivo);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: '#000', display: 'flex', flexDirection: 'column', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 14px' }}>
        <strong style={{ fontSize: '16px' }}>{titulo}</strong>
        <button type="button" onClick={onFechar} aria-label="Fechar câmera" style={botaoRedondo}><X size={22} /></button>
      </div>

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* contain: a pessoa ve exatamente o que vai sair na foto. */}
        <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain', display: foto ? 'none' : 'block' }} />
        {foto && <img src={foto.url} alt="Foto tirada" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        {!pronta && !erro && !foto && (
          <div style={{ position: 'absolute', fontSize: '14px', color: 'rgba(255,255,255,0.75)' }}>Abrindo a câmera…</div>
        )}
        {erro && (
          <div style={{ position: 'absolute', left: '16px', right: '16px', bottom: '24px', padding: '14px 16px', borderRadius: '14px', backgroundColor: 'rgba(0,0,0,0.85)', fontSize: '14px', lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span>{erro}</span>
            {onUsarCameraDoCelular && (
              <button type="button" onClick={onUsarCameraDoCelular} style={{ ...botaoBarra, flex: 'none', height: '46px', backgroundColor: '#fff', color: '#111' }}>
                <Camera size={18} /> Usar a câmera do celular
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '16px 20px calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center', minHeight: '104px', boxSizing: 'border-box' }}>
        {foto ? (
          <>
            <button type="button" onClick={descartarFoto} style={{ ...botaoBarra, backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff' }}>
              <RotateCcw size={18} /> Tirar outra
            </button>
            <button type="button" onClick={usar} style={{ ...botaoBarra, backgroundColor: '#7c3aed', color: '#fff' }}>
              <Check size={18} /> Usar foto
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={disparar}
            disabled={!pronta || tirando}
            aria-label="Tirar foto"
            style={{
              width: '72px', height: '72px', borderRadius: '50%', border: '4px solid rgba(255,255,255,0.5)', backgroundColor: '#fff',
              backgroundClip: 'padding-box', cursor: 'pointer', opacity: pronta ? 1 : 0.4,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default CameraFoto;

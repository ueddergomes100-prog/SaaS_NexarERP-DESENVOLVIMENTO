import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenLine, X } from 'lucide-react';
import { canvasParaPng } from '../../utils/comprimirImagem';
import { showError } from '../../utils/alerts';

/*
 * Assinatura do cliente na tela do celular (app do tecnico, fase 3 --
 * 2026-10-08). Canvas em tela cheia, traco com o dedo (pointer events, que
 * cobre dedo, caneta e mouse), nome de quem assina e Confirmar -> PNG com
 * fundo transparente, que sai na impressao da OS no lugar da linha
 * "Ass. do Cliente". Quem decide se e' obrigatoria e' a configuracao da
 * empresa (osCampoDomain.validarConclusaoAtendimento).
 */

interface Props {
  nomeSugerido: string;
  onConfirmar: (png: Blob, nomeAssinante: string) => Promise<void>;
  onFechar: () => void;
}

const VendedorAssinaturaModal: React.FC<Props> = ({ nomeSugerido, onConfirmar, onFechar }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);
  const [nome, setNome] = useState(nomeSugerido);
  const [enviando, setEnviando] = useState(false);

  // Canvas no tamanho real do elemento (sem isso o traco sai deslocado em tela retina).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ajustar = () => {
      const escala = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * escala);
      canvas.height = Math.round(height * escala);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(escala, escala);
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#111827';
      }
      setTemTraco(false);
    };
    ajustar();
  }, []);

  const posicao = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const comecar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    desenhando.current = true;
    const { x, y } = posicao(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!temTraco) setTemTraco(true);
  };

  const parar = () => { desenhando.current = false; };

  const limpar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setTemTraco(false);
  };

  const confirmar = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !temTraco) {
      showError('Assinatura em branco', 'Peça para o cliente assinar com o dedo na área clara antes de confirmar.');
      return;
    }
    setEnviando(true);
    try {
      const png = await canvasParaPng(canvas);
      await onConfirmar(png, nome.trim());
    } catch (erro) {
      showError('Assinatura não guardada', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Assinatura do cliente" style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <PenLine size={20} color="var(--brand-400)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: '16px' }}>Assinatura do cliente</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Vire o celular na horizontal se preferir mais espaço.</div>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" disabled={enviando} style={{ width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: '12px 16px 0' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Quem está assinando</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome de quem assina"
          style={{ width: '100%', height: '44px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 14px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ flex: 1, padding: '12px 16px' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={comecar}
          onPointerMove={mover}
          onPointerUp={parar}
          onPointerCancel={parar}
          onPointerLeave={parar}
          style={{ width: '100%', height: '100%', minHeight: '220px', borderRadius: '14px', backgroundColor: '#f8fafc', border: '2px dashed #94a3b8', touchAction: 'none', display: 'block' }}
        />
      </div>

      <div style={{ padding: '12px 16px 20px', display: 'flex', gap: '10px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button type="button" onClick={limpar} disabled={enviando} className="btn-secondary" style={{ flex: 1, height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Eraser size={18} /> Limpar
        </button>
        <button type="button" onClick={() => void confirmar()} disabled={enviando} className="btn-primary" style={{ flex: 2, height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <PenLine size={18} /> {enviando ? 'Guardando…' : 'Confirmar assinatura'}
        </button>
      </div>
    </div>
  );
};

export default VendedorAssinaturaModal;

import React, { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TriangleAlert } from 'lucide-react';
import Animacao from './Animacao';
import { alertaDoCliente, type ClienteComAlerta } from '../../utils/clienteAlertaDomain';
import './AlertaDoCliente.css';

/**
 * Janela do ALERTA DO CLIENTE (2026-10-06). Aberta por
 * `mostrarAlertaDoCliente(cliente)` logo depois que o cliente e' escolhido
 * (PDV, Pedido de Venda, Orcamento, OS, Condicional, Trocas, app Vendas).
 *
 * Nao usa o SweetAlert de proposito: as telas de venda disparam avisos do
 * SweetAlert no mesmo momento (desconto do cliente, credito de devolucao), e
 * o SweetAlert so' mostra um por vez -- o alerta seria fechado por cima sem a
 * pessoa ler. Aqui ele mora numa camada propria, acima de tudo, e so' fecha
 * no "Entendi".
 */

interface AlertaProps {
  nome: string;
  texto: string;
  onFechar: () => void;
}

const JanelaAlerta: React.FC<AlertaProps> = ({ nome, texto, onFechar }) => {
  const botaoRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    botaoRef.current?.focus();
    // Esc/Enter fecham SO' o alerta: escuta na captura e para a tecla aqui,
    // senao o Esc tambem fecharia a janela de baixo (PDV, consulta...).
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape' && evento.key !== 'Enter') return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      onFechar();
    };
    window.addEventListener('keydown', aoTeclar, true);
    return () => window.removeEventListener('keydown', aoTeclar, true);
  }, [onFechar]);

  return (
    <div className="alerta-cliente__fundo" role="presentation">
      <div className="alerta-cliente" role="alertdialog" aria-modal="true" aria-labelledby="alerta-cliente-titulo" aria-describedby="alerta-cliente-texto">
        <div className="alerta-cliente__icone">
          <Animacao animacao="aviso" tamanho={56} fallback={<TriangleAlert size={34} />} />
        </div>
        <div className="alerta-cliente__corpo">
          <div className="alerta-cliente__rotulo">Alerta do cliente</div>
          <h2 id="alerta-cliente-titulo" className="alerta-cliente__nome">{nome}</h2>
          <p id="alerta-cliente-texto" className="alerta-cliente__texto">{texto}</p>
        </div>
        <button ref={botaoRef} type="button" className="btn-primary alerta-cliente__botao" onClick={onFechar}>
          Entendi
        </button>
      </div>
    </div>
  );
};

let atual: { raiz: Root; container: HTMLElement } | null = null;

const fecharAtual = () => {
  if (!atual) return;
  const { raiz, container } = atual;
  atual = null;
  // Desmonta fora do ciclo de render de quem chamou.
  setTimeout(() => { raiz.unmount(); container.remove(); }, 0);
};

/**
 * Mostra o alerta do cliente, se ele tiver um (caixa marcada + texto). Sem
 * alerta, nao faz nada -- as telas podem chamar sempre que escolherem cliente.
 */
export const mostrarAlertaDoCliente = (cliente: ClienteComAlerta | null | undefined): void => {
  const texto = alertaDoCliente(cliente);
  if (!texto || typeof document === 'undefined') return;
  fecharAtual();
  const container = document.createElement('div');
  container.className = 'alerta-cliente__raiz';
  document.body.appendChild(container);
  const raiz = createRoot(container);
  atual = { raiz, container };
  raiz.render(<JanelaAlerta nome={String(cliente?.nome || 'Cliente').toUpperCase()} texto={texto} onFechar={fecharAtual} />);
};

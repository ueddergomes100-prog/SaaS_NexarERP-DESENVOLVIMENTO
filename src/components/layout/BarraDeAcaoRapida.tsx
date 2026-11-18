import React, { useContext, useEffect, useRef, useState } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import { TabActiveContext } from '../../contexts/TabsContext';
import { ehAcaoDeCadastro, textoDoBotao } from '../../utils/acaoRapidaDomain';
import { acharTopo } from './useFaixaDoTopo';
import './barraDeAcaoRapida.css';

/*
 * BARRA QUE ACOMPANHA A ROLAGEM (18/11/2026) -- ver acaoRapidaDomain.ts.
 *
 * Quando o botao de cadastrar do cabecalho ("Novo Produto", "Novo Cliente"...)
 * some na rolagem, esta barra fina aparece no topo da tela, na mesma faixa
 * violeta, com o titulo da tela e o MESMO botao. Vale para toda tela de uma
 * vez: ela mora no TabPane e le o cabecalho que a tela ja' desenhou, entao
 * nenhuma tela precisa saber dela.
 *
 * O botao daqui nao tem acao propria: ele clica no botao original. Assim a
 * permissao, o "desabilitado" e o que o clique faz continuam vindo de um lugar
 * so' (a tela) e nunca ficam diferentes do que esta' la' em cima.
 */

interface AcaoDaBarra {
  texto: string;
  dica: string;
  desabilitada: boolean;
}

interface Estado {
  visivel: boolean;
  titulo: string;
  acoes: AcaoDaBarra[];
  /* O respiro (padding) da area rolavel: a barra vai de ponta a ponta e encosta no topo, por cima dele. */
  recuoTopo: number;
  recuoEsquerda: number;
  recuoDireita: number;
}

const VAZIO: Estado = { visivel: false, titulo: '', acoes: [], recuoTopo: 0, recuoEsquerda: 0, recuoDireita: 0 };

const iguais = (a: Estado, b: Estado): boolean => (
  a.visivel === b.visivel
  && a.titulo === b.titulo
  && a.recuoTopo === b.recuoTopo
  && a.recuoEsquerda === b.recuoEsquerda
  && a.recuoDireita === b.recuoDireita
  && a.acoes.length === b.acoes.length
  && a.acoes.every((acao, i) => (
    acao.texto === b.acoes[i].texto && acao.dica === b.acoes[i].dica && acao.desabilitada === b.acoes[i].desabilitada
  ))
);

const botoesDeCadastro = (topo: HTMLElement): HTMLButtonElement[] => (
  Array.from(topo.querySelectorAll<HTMLButtonElement>('button.btn-primary')).filter((botao) => (
    botao.getClientRects().length > 0
    && ehAcaoDeCadastro({
      texto: botao.textContent || '',
      temIconeMais: !!botao.querySelector('svg[class*="lucide-plus"]'),
      abreMenu: botao.hasAttribute('aria-haspopup'),
      marca: botao.getAttribute('data-acao-rapida'),
    })
  ))
);

const BarraDeAcaoRapida: React.FC = () => {
  const raizRef = useRef<HTMLDivElement>(null);
  const originaisRef = useRef<HTMLButtonElement[]>([]);
  const agendarRef = useRef<() => void>(() => undefined);
  const abaAtiva = useContext(TabActiveContext);
  const [estado, setEstado] = useState<Estado>(VAZIO);

  useEffect(() => {
    const pagina = raizRef.current?.parentElement;
    if (!pagina) return undefined;
    let quadro = 0;

    const ler = () => {
      quadro = 0;
      // Aba escondida nao tem medida: fica como estava e le de novo ao voltar.
      if (!pagina.getClientRects().length) return;
      const topo = acharTopo(pagina);
      const botoes = topo ? botoesDeCadastro(topo) : [];
      originaisRef.current = botoes;
      const estilo = getComputedStyle(pagina);
      const novo: Estado = {
        // So' aparece depois que o botao de cima saiu inteiro da vista.
        visivel: botoes.length > 0 && botoes[0].getBoundingClientRect().bottom <= pagina.getBoundingClientRect().top,
        titulo: textoDoBotao(topo?.querySelector('h1, h2, .page-title')?.textContent),
        acoes: botoes.map((botao) => ({
          texto: textoDoBotao(botao.textContent),
          dica: botao.title || '',
          desabilitada: botao.disabled,
        })),
        recuoTopo: Math.round(parseFloat(estilo.paddingTop) || 0),
        recuoEsquerda: Math.round(parseFloat(estilo.paddingLeft) || 0),
        recuoDireita: Math.round(parseFloat(estilo.paddingRight) || 0),
      };
      setEstado((antes) => (iguais(antes, novo) ? antes : novo));
    };
    const agendar = () => {
      if (!quadro) quadro = requestAnimationFrame(ler);
    };
    agendarRef.current = agendar;

    // Olha so' o conteudo da tela (a barra e' irma dele, nao entra na conta).
    const conteudo = pagina.querySelector(':scope > .page-transition');
    const observador = new MutationObserver(agendar);
    if (conteudo) {
      observador.observe(conteudo, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['disabled', 'class', 'style', 'title', 'data-acao-rapida'],
      });
    }
    pagina.addEventListener('scroll', agendar, { passive: true });
    window.addEventListener('resize', agendar);
    agendar();

    return () => {
      observador.disconnect();
      pagina.removeEventListener('scroll', agendar);
      window.removeEventListener('resize', agendar);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  // Voltou para esta aba: a medida feita com ela escondida nao vale.
  useEffect(() => {
    if (abaAtiva) agendarRef.current();
  }, [abaAtiva]);

  const voltarAoTopo = () => {
    const pagina = raizRef.current?.parentElement;
    if (!pagina) return;
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pagina.scrollTo({ top: 0, behavior: semMovimento ? 'auto' : 'smooth' });
  };

  return (
    <div
      ref={raizRef}
      className="acao-rapida"
      // O "grudar" conta a partir de dentro do respiro da area rolavel: sem o top negativo
      // sobraria uma fresta da lista aparecendo acima da barra.
      style={{ top: -estado.recuoTopo, marginLeft: -estado.recuoEsquerda, marginRight: -estado.recuoDireita }}
    >
      {estado.visivel && (
        <div
          className="acao-rapida__barra"
          role="toolbar"
          aria-label={estado.titulo ? `Atalhos de ${estado.titulo}` : 'Atalhos da tela'}
          style={{ paddingLeft: estado.recuoEsquerda, paddingRight: estado.recuoDireita }}
        >
          <button
            type="button"
            className="acao-rapida__topo"
            title="Voltar ao topo da tela"
            aria-label="Voltar ao topo da tela"
            onClick={voltarAoTopo}
          >
            <ArrowUp size={18} />
          </button>
          <span className="acao-rapida__titulo">{estado.titulo}</span>
          <div className="acao-rapida__acoes">
            {estado.acoes.map((acao, indice) => (
              <button
                key={`${indice}-${acao.texto}`}
                type="button"
                className="acao-rapida__botao"
                title={acao.dica || undefined}
                disabled={acao.desabilitada}
                onClick={() => originaisRef.current[indice]?.click()}
              >
                <Plus size={16} strokeWidth={2.6} />
                {acao.texto}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BarraDeAcaoRapida;

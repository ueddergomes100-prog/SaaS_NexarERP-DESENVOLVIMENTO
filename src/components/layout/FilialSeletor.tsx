import React, { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Loader2, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { limparAbasSalvas } from '../../contexts/TabsContext';
import { NexusSwal, escaparHtml, showError } from '../../utils/alerts';
import { rotuloFilial } from '../../utils/filialDomain';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import './FilialSeletor.css';

/**
 * Seletor de FILIAL na barra do topo (2026-10-06) -- o "Filial: 20 - SOL
 * LIFE" do Integra. So' aparece em empresa com filiais. Quem pode trocar
 * (dono, administrador ou "Utiliza outras filiais") abre a lista; os demais
 * so' veem em qual filial estao.
 *
 * Trocar de filial pede ao servidor, esquece as abas abertas (sao dados da
 * filial anterior) e recarrega o sistema ja' na filial nova.
 */
const FilialSeletor: React.FC = () => {
  const { grupo, filialAtual, filiaisDoUsuario, podeTrocarFilial, ehGestorDasFiliais, trocarFilial } = useAuth();
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [trocandoPara, setTrocandoPara] = useState<string | null>(null);
  const raizRef = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(aberto, () => setAberto(false));

  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (evento: MouseEvent) => {
      if (raizRef.current && !raizRef.current.contains(evento.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto]);

  if (!grupo || !filialAtual) return null;

  const entrar = async (tenantId: string) => {
    const destino = filiaisDoUsuario.find((f) => f.tenantId === tenantId);
    if (!destino || destino.tenantId === filialAtual.tenantId) {
      setAberto(false);
      return;
    }
    setAberto(false);
    const resposta = await NexusSwal.fire({
      title: `Entrar na filial ${rotuloFilial(destino)}?`,
      html: `As abas abertas serão fechadas. Salve antes o que estiver editando.<br/><br/>Vendas, notas, financeiro e caixa passam a ser os da filial <strong>${escaparHtml(destino.nome)}</strong>.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Entrar na filial',
      cancelButtonText: 'Cancelar',
    });
    if (!resposta.isConfirmed) return;
    setTrocandoPara(destino.tenantId);
    try {
      await trocarFilial(destino.tenantId);
      limparAbasSalvas();
      window.location.assign('/dashboard');
    } catch (erro) {
      setTrocandoPara(null);
      showError('Não foi possível trocar de filial', erro instanceof Error ? erro.message : 'Tente de novo em instantes.');
    }
  };

  const conteudo = (
    <>
      {trocandoPara ? <Loader2 size={15} className="filial-seletor__girando" aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}
      <span className="filial-seletor__codigo">{filialAtual.codigo}</span>
      <span className="filial-seletor__nome">{filialAtual.nome}</span>
    </>
  );

  if (!podeTrocarFilial) {
    return (
      <div className="filial-seletor filial-seletor--fixo" title={`Você está na filial ${rotuloFilial(filialAtual)}`}>
        {conteudo}
      </div>
    );
  }

  return (
    <div className="filial-seletor" ref={raizRef}>
      <button
        type="button"
        className="filial-seletor__botao"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={`Filial ${rotuloFilial(filialAtual)}. Trocar de filial`}
        title="Trocar de filial"
        disabled={Boolean(trocandoPara)}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="filial-seletor__rotulo">Filial</span>
        {conteudo}
        <ChevronDown size={14} aria-hidden="true" className="filial-seletor__seta" />
      </button>

      {aberto && (
        <div className="filial-seletor__painel">
          <div className="filial-seletor__titulo">{grupo.nome}</div>
          <div role="listbox" aria-label="Filiais">
            {filiaisDoUsuario.map((filial) => {
              const atual = filial.tenantId === filialAtual.tenantId;
              return (
                <button
                  key={filial.tenantId}
                  type="button"
                  role="option"
                  aria-selected={atual}
                  className={`filial-seletor__opcao${atual ? ' is-atual' : ''}`}
                  onClick={() => { void entrar(filial.tenantId); }}
                >
                  <span className="filial-seletor__opcao-codigo">{filial.codigo}</span>
                  <span className="filial-seletor__opcao-texto">
                    <span className="filial-seletor__opcao-nome">{filial.nome}{filial.matriz && <em> · matriz</em>}</span>
                    <span className="filial-seletor__opcao-local">{[filial.cidade, filial.uf].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="filial-seletor__opcao-marca" aria-hidden="true">{atual && <Check size={15} />}</span>
                </button>
              );
            })}
          </div>
          {ehGestorDasFiliais && (
            <button
              type="button"
              className="filial-seletor__gerenciar"
              onClick={() => { setAberto(false); navigate('/configuracoes/filiais'); }}
            >
              <Settings2 size={14} aria-hidden="true" /> Gerenciar filiais
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FilialSeletor;

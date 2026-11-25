import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { textoDaPasta, type TipoDePasta } from '../../utils/pastasDoBoletoDomain';
import {
  escolherPasta,
  esquecerPasta,
  lerPasta,
  liberarPasta,
  permissaoDaPasta,
  suportaPastas,
  type Permissao,
} from '../../utils/pastasDoBoletoStorage';

/**
 * Boletos › Mais opcoes › Pastas do computador (25/11/2026, pedido do dono).
 * Remessa: o arquivo gerado ja' e' gravado na pasta escolhida. Retorno: o
 * sistema olha a pasta e avisa quando chega arquivo novo. Vale para ESTE
 * computador (cada computador escolhe as suas pastas).
 */

interface SituacaoDaPasta {
  nome: string | null;
  permissao: Permissao | null;
}

const VAZIA: SituacaoDaPasta = { nome: null, permissao: null };

const TEXTOS: Record<TipoDePasta, { titulo: string; ajuda: string }> = {
  remessa: {
    titulo: 'Pasta da remessa',
    ajuda: 'O arquivo de remessa gerado aqui já é gravado nesta pasta (a mesma que o programa do Sicoob usa para enviar ao banco).',
  },
  retorno: {
    titulo: 'Pasta do retorno',
    ajuda: 'Com a tela de Boletos aberta, o sistema olha esta pasta a cada minuto e avisa quando chega um arquivo de retorno novo, para importar com um clique.',
  },
};

const PastasDosBoletosModal: React.FC<{ tenantId: string; onFechar: () => void; onMudou: () => void }> = ({ tenantId, onFechar, onMudou }) => {
  const [situacao, setSituacao] = useState<Record<TipoDePasta, SituacaoDaPasta>>({ remessa: VAZIA, retorno: VAZIA });
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    const ler = async (tipo: TipoDePasta): Promise<SituacaoDaPasta> => {
      const pasta = await lerPasta(tipo, tenantId);
      return { nome: pasta?.name || null, permissao: await permissaoDaPasta(pasta, tipo) };
    };
    const [remessa, retorno] = await Promise.all([ler('remessa'), ler('retorno')]);
    setSituacao({ remessa, retorno });
  }, [tenantId]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  const agir = async (acao: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await acao();
      await recarregar();
      onMudou();
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pastas do computador para os boletos"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderRadius: '16px', padding: '22px', width: 'min(620px, 100%)', boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '17px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen size={20} /> Pastas do computador
          </h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        {!suportaPastas() ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Este navegador não deixa o sistema usar uma pasta do computador. Abra o sistema no <b>Google Chrome</b> ou no{' '}
            <b>Microsoft Edge</b> (ou no sistema instalado como aplicativo) neste computador para escolher as pastas.
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Vale só para este computador. Depois de reiniciar o navegador, ele pede para liberar de novo: é um clique em "Liberar".
            </p>
            {(['remessa', 'retorno'] as TipoDePasta[]).map((tipo) => {
              const s = situacao[tipo];
              return (
                <div key={tipo} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px', borderRadius: '12px', background: 'var(--bg-tertiary)' }}>
                  <strong style={{ fontSize: '14px' }}>{TEXTOS[tipo].titulo}</strong>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{textoDaPasta(s.nome, s.permissao)}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.45 }}>{TEXTOS[tipo].ajuda}</span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button type="button" className="btn-primary" disabled={ocupado} onClick={() => void agir(() => escolherPasta(tipo, tenantId))} style={{ padding: '6px 12px', fontSize: '13px' }}>
                      {s.nome ? 'Trocar pasta' : 'Escolher pasta'}
                    </button>
                    {s.nome && s.permissao !== 'granted' && (
                      <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => void agir(async () => liberarPasta(await lerPasta(tipo, tenantId), tipo))} style={{ padding: '6px 12px', fontSize: '13px' }}>
                        Liberar
                      </button>
                    )}
                    {s.nome && (
                      <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => void agir(() => esquecerPasta(tipo, tenantId))} style={{ padding: '6px 12px', fontSize: '13px' }}>
                        Não usar pasta
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};

export default PastasDosBoletosModal;

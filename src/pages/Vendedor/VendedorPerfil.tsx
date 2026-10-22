import React, { useEffect, useState } from 'react';
import { BellRing, LogOut, Moon, RefreshCw, SquarePlus, Sun, SunMoon } from 'lucide-react';
import { showError, showSuccess } from '../../utils/alerts';
import { ativarAvisosNoCelular, desativarAvisosNoCelular, estadoDosAvisos, type EstadoDosAvisos } from '../../services/notificacoesPushService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { usePreferenciaTema } from '../../hooks/usePreferenciaTema';
import { DESCRICAO_TEMA, PREFERENCIAS_TEMA, ROTULO_TEMA, type PreferenciaTema } from '../../utils/temaDomain';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { CAMINHO_INSTALACAO, estaInstalado, sincronizarApp } from './pwa';

interface DadosDaEmpresa {
  logo: string;
  nome: string;
  linhas: Array<{ rotulo: string; valor: string }>;
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

/**
 * Dados da empresa so' para ver (pedido do dono 21/10): o vendedor confere
 * CNPJ, endereco e contato sem abrir Configuracoes. Com filiais, mostra a
 * filial em que o app esta' (cada filial tem o proprio cadastro). Linha sem
 * dado nao aparece.
 */
const montarDadosDaEmpresa = (config: Record<string, unknown>): DadosDaEmpresa => {
  const nome = texto(config.nomeOficina) || texto(config.razaoSocial);
  const cidade = texto(config.cidade) || texto(config.nfseCidadeNome);
  const uf = texto(config.uf) || texto(config.nfseCidadeEstado);
  const endereco = [
    [texto(config.rua), texto(config.numero)].filter(Boolean).join(', '),
    texto(config.bairro),
    [cidade, uf].filter(Boolean).join(' / '),
  ].filter(Boolean).join(' — ') || texto(config.endereco);
  const linhas = [
    { rotulo: 'Razão social', valor: texto(config.razaoSocial) !== nome ? texto(config.razaoSocial) : '' },
    { rotulo: 'CNPJ', valor: texto(config.cnpj) },
    { rotulo: 'Inscrição estadual', valor: texto(config.inscricaoEstadual) },
    { rotulo: 'Endereço', valor: endereco },
    { rotulo: 'CEP', valor: texto(config.cep) },
    { rotulo: 'Telefone', valor: texto(config.telefone) },
    { rotulo: 'WhatsApp', valor: texto(config.whatsapp) },
    { rotulo: 'E-mail', valor: texto(config.email) },
  ].filter((linha) => linha.valor);
  return { logo: texto(config.logo), nome, linhas };
};

const VendedorPerfil: React.FC = () => {
  const { userNome, currentUser, logout, tenantId } = useAuth();
  const [empresa, setEmpresa] = useState<DadosDaEmpresa | null>(null);

  useEffect(() => {
    if (!tenantId) return undefined;
    let ativo = true;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => { if (ativo && snap.exists()) setEmpresa(montarDadosDaEmpresa(snap.data())); })
      // Sem internet o cartao so' nao aparece; o resto do perfil segue.
      .catch(() => undefined);
    return () => { ativo = false; };
  }, [tenantId]);
  const nome = userNome || currentUser?.displayName || 'Vendedor';
  const podeInstalar = !estaInstalado();
  const [sincronizando, setSincronizando] = useState(false);

  const handleSincronizar = () => {
    setSincronizando(true);
    void sincronizarApp();
  };

  const { preferencia: temaPreferido, escolher: escolherTema } = usePreferenciaTema();

  // Avisos no celular (21/10/2026): primeiro uso e' "Liberar desconto?" para
  // quem pode liberar; o cartao aparece para todos (outros avisos virao).
  const [avisos, setAvisos] = useState<EstadoDosAvisos | null>(null);
  const [mexendoAvisos, setMexendoAvisos] = useState(false);
  useEffect(() => {
    let ativo = true;
    void estadoDosAvisos().then((estado) => { if (ativo) setAvisos(estado); });
    return () => { ativo = false; };
  }, []);
  const alternarAvisos = async () => {
    setMexendoAvisos(true);
    try {
      if (avisos === 'ativo') {
        await desativarAvisosNoCelular();
        showSuccess('Avisos desligados neste aparelho.');
      } else {
        const r = await ativarAvisosNoCelular();
        if (r.ok) showSuccess('Avisos ligados. Este aparelho recebe os pedidos de liberação de desconto.');
        else showError('Não foi possível ligar os avisos', r.motivo || 'Tente de novo.');
      }
    } catch (erro) {
      showError('Não foi possível mudar os avisos', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setAvisos(await estadoDosAvisos());
      setMexendoAvisos(false);
    }
  };
  const TEXTO_AVISOS: Record<EstadoDosAvisos, string> = {
    ativo: 'Ligados neste aparelho: você recebe o aviso quando um vendedor pede liberação de desconto.',
    inativo: 'Desligados. Ligue para receber no celular os pedidos de liberação de desconto, mesmo com o app fechado.',
    bloqueado: 'Bloqueados nas configurações do aparelho. Libere as notificações deste app no celular e tente de novo.',
    sem_suporte: 'Este navegador não recebe avisos. No iPhone, instale o app na tela de início e ligue por lá.',
  };
  const iconeDoTema: Record<PreferenciaTema, React.ReactNode> = { dark: <Moon size={18} />, light: <Sun size={18} />, auto: <SunMoon size={18} /> };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Perfil" />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 20px' }}>
        <div style={{ borderRadius: '18px', padding: '24px', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '18px', backgroundColor: 'var(--brand-600)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700 }}>
            {nome.trim().charAt(0).toUpperCase() || 'V'}
          </div>
          <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>{nome}</div>

          {podeInstalar && (
            <button
              type="button"
              // Navegacao REAL (nao React Router): so' um carregamento de
              // verdade do /vendedor.html traz o <head> certo do app, que e'
              // o que o iPhone le ao adicionar a tela de inicio.
              onClick={() => window.location.assign(CAMINHO_INSTALACAO)}
              style={{
                marginTop: '10px', width: '100%', height: '48px', borderRadius: '14px', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
                color: '#fff', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
              }}
            >
              <SquarePlus size={18} /> Instalar na tela de início
            </button>
          )}

          <button
            type="button"
            onClick={handleSincronizar}
            disabled={sincronizando}
            style={{
              marginTop: '10px', width: '100%', height: '48px', borderRadius: '14px', border: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
              color: 'var(--text-primary)', cursor: sincronizando ? 'default' : 'pointer', backgroundColor: 'var(--bg-tertiary)',
              opacity: sincronizando ? 0.7 : 1,
            }}
          >
            <RefreshCw size={18} className={sincronizando ? 'spin-icon' : undefined} />
            {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            style={{
              marginTop: '2px', width: '100%', height: '48px', borderRadius: '14px', border: '1px solid rgba(239,68,68,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
              color: '#f87171', cursor: 'pointer', backgroundColor: 'rgba(239,68,68,0.10)',
            }}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>

        {empresa && (empresa.nome || empresa.linhas.length > 0) && (
          <div style={{ marginTop: '14px', borderRadius: '18px', padding: '18px', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Empresa</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {empresa.logo && (
                <img src={empresa.logo} alt="" style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'contain', backgroundColor: '#fff', border: '1px solid var(--border-color)', flexShrink: 0 }} />
              )}
              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3, minWidth: 0, overflowWrap: 'anywhere' }}>{empresa.nome}</div>
            </div>
            {empresa.linhas.length > 0 && (
              <dl style={{ margin: '14px 0 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {empresa.linhas.map((linha) => (
                  <div key={linha.rotulo}>
                    <dt style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{linha.rotulo}</dt>
                    <dd style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{linha.valor}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {avisos && (
          <div style={{ marginTop: '14px', borderRadius: '18px', padding: '18px', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Avisos no celular</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <span style={{ width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: avisos === 'ativo' ? 'rgba(16,185,129,0.16)' : 'var(--bg-tertiary)', color: avisos === 'ativo' ? '#10b981' : 'var(--text-secondary)' }}>
                <BellRing size={20} />
              </span>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{TEXTO_AVISOS[avisos]}</div>
            </div>
            {(avisos === 'ativo' || avisos === 'inativo') && (
              <button
                type="button"
                onClick={() => void alternarAvisos()}
                disabled={mexendoAvisos}
                style={{
                  marginTop: '12px', width: '100%', height: '44px', borderRadius: '12px', border: '1px solid var(--border-color)',
                  fontSize: '14px', fontWeight: 700, cursor: mexendoAvisos ? 'default' : 'pointer', opacity: mexendoAvisos ? 0.7 : 1,
                  color: avisos === 'ativo' ? 'var(--text-primary)' : '#fff',
                  background: avisos === 'ativo' ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
                }}
              >
                {mexendoAvisos ? 'Aguarde...' : avisos === 'ativo' ? 'Desligar os avisos' : 'Ligar os avisos'}
              </button>
            )}
          </div>
        )}

        {/* Aparencia: a mesma preferencia do sistema (utils/temaDomain.ts). */}
        <div style={{ marginTop: '14px', borderRadius: '18px', padding: '18px', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Aparência</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {PREFERENCIAS_TEMA.map((opcao) => (
              <button
                key={opcao}
                type="button"
                onClick={() => escolherTema(opcao)}
                aria-pressed={temaPreferido === opcao}
                style={{
                  flex: 1, height: '58px', borderRadius: '12px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  fontSize: '13px', fontWeight: 700,
                  border: `2px solid ${temaPreferido === opcao ? 'var(--brand-500)' : 'var(--border-color)'}`,
                  backgroundColor: temaPreferido === opcao ? 'rgba(139, 92, 246, 0.14)' : 'var(--bg-tertiary)',
                  color: temaPreferido === opcao ? 'var(--brand-400)' : 'var(--text-primary)',
                }}
              >
                {iconeDoTema[opcao]} {ROTULO_TEMA[opcao]}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>{DESCRICAO_TEMA[temaPreferido]}</div>
        </div>
      </div>
    </div>
  );
};

export default VendedorPerfil;

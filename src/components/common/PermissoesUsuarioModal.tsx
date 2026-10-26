import React, { useEffect, useMemo, useState } from 'react';
import { X, Shield, Loader2, Save, Search } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import SeletorTodas from './SeletorTodas';
import {
  PERMISSION_GROUPS,
  PERMISSION_CATALOG,
  desmarcarPermissoes,
  estadoDaSelecao,
  marcarPermissoes,
} from '../../utils/permissionCatalog';
import {
  DEFAULT_NIVEL_ACESSO,
  NIVEIS_ACESSO,
  NIVEL_ACESSO_LABELS,
  parseNivelAcesso,
  type NivelAcesso,
} from '../../utils/visibilidadeVendasDomain';
import { checarLimiteAcessoMobile } from '../../utils/acessoMobileDomain';
import { MENSAGEM_FORA_DO_PLANO, permissaoForaDoPlano } from '../../utils/permissaoModuloDomain';
import { alterarAcessoAppNoServidor, salvarPermissoesNoServidor } from '../../services/usuarioAcessoService';
import { permissoesEfetivas } from '../../utils/permissoesAppDomain';
import { hasTenantFullAccess } from '../../utils/roles';
import { podeUsarOutrasFiliais, rotuloFilial } from '../../utils/filialDomain';
import { definirFilialPadrao } from '../../services/filialService';

interface PermissoesUsuarioModalProps {
  usuarioId: string;
  usuarioNome: string;
  onClose: () => void;
  /** Chamado apos salvar com sucesso, pra tela dona atualizar o que precisar. */
  onSaved?: (permissoes: string[]) => void;
}

/**
 * Define as permissoes de um funcionario sem sair da tela de Usuarios.
 *
 * Por que popup e nao um link pra Configuracoes: as duas telas exigem
 * permissoes DIFERENTES -- /usuarios pede `administrativo.equipe` e
 * /configuracoes pede `administrativo.config` (ver routeAccess.ts). Quem
 * administra a equipe sem ter acesso a Configuracoes clicaria no link e
 * bateria numa parede. O popup funciona pra quem ja esta na tela.
 */
const PermissoesUsuarioModal: React.FC<PermissoesUsuarioModalProps> = ({ usuarioId, usuarioNome, onClose, onSaved }) => {
  const { currentUser, tenantId, userRole, isOwner, restringirVendasPorUsuario, grupo, userPermissions, blockedModules } = useAuth();
  // Gerente (nivel de vendas) tambem abre este popup agora, mas so' pode
  // mexer nos modulos liberados -- nivel de acesso e acesso mobile
  // continuam so' Admin/Master/Dono (a regra do Firestore recusa a troca
  // desses dois campos vinda de quem nao e' isso; ver firestore.rules).
  const podeAlterarNivelEMobile = hasTenantFullAccess(userRole, isOwner);
  // Gerente so' da' e tira o que ELE MESMO tem (decisao do dono, 19/10/2026;
  // o banco recusa o resto -- ver permissoesMexidasSoAsDoGerente nas rules).
  // Modulo bloqueado pelo SuperAdmin (19/10/2026): a permissao dele fica apagada e ninguem liga.
  const foraDoPlano = (id: string) => permissaoForaDoPlano(id, blockedModules);
  const podeMexer = (id: string) => !foraDoPlano(id) && (podeAlterarNivelEMobile || userPermissions.includes(id));
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [nivelAcesso, setNivelAcesso] = useState<NivelAcesso>(DEFAULT_NIVEL_ACESSO);
  const [busca, setBusca] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [acessoAppMobile, setAcessoAppMobile] = useState(false);
  /** O que estava gravado quando o popup abriu -- so cobra vaga do limite
   *  quando o admin esta LIGANDO agora, nao quando so salva outra coisa
   *  de quem ja tinha acesso. Ver acessoMobileDomain.ts. */
  const [acessoAppMobileOriginal, setAcessoAppMobileOriginal] = useState(false);
  // Filial padrao (15/10/2026): onde o usuario comeca a cada login.
  const [casaDoUsuario, setCasaDoUsuario] = useState('');
  const [papelDoUsuario, setPapelDoUsuario] = useState('');
  const [filialPadrao, setFilialPadrao] = useState('');
  const [filialPadraoOriginal, setFilialPadraoOriginal] = useState('');

  useEscapeLayer(true, onClose);

  useEffect(() => {
    const carregar = async () => {
      setIsLoading(true);
      try {
        const snap = await getDoc(doc(db, 'usuarios', usuarioId));
        // Efetivas (26/10/2026): quem nunca teve o app gravado ja' aparece com as chaves do app marcadas.
        setPermissoes(permissoesEfetivas(snap.exists() ? snap.data().permissoes : []));
        setNivelAcesso(parseNivelAcesso(snap.exists() ? snap.data().nivelAcesso : undefined));
        const acessoMobileAtual = snap.exists() && snap.data().acessoAppMobile === true;
        setAcessoAppMobile(acessoMobileAtual);
        setAcessoAppMobileOriginal(acessoMobileAtual);
        const dados = snap.exists() ? snap.data() : {};
        const casa = typeof dados.tenantId === 'string' && dados.tenantId ? dados.tenantId : usuarioId;
        const padrao = typeof dados.filialPadrao === 'string' && dados.filialPadrao ? dados.filialPadrao : casa;
        setCasaDoUsuario(casa);
        setPapelDoUsuario(typeof dados.role === 'string' ? dados.role : '');
        setFilialPadrao(padrao);
        setFilialPadraoOriginal(padrao);
      } catch (err) {
        console.error('Erro ao carregar permissões do usuário:', err);
        showError('Erro', 'Não foi possível carregar as permissões deste usuário.');
      } finally {
        setIsLoading(false);
      }
    };
    carregar();
  }, [usuarioId]);

  const toggle = (id: string) => {
    if (!podeMexer(id)) return;
    setPermissoes(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  /** Liga/desliga de uma vez o que esta VISIVEL na tela (a busca filtra).
   *  Ver a explicacao em permissionCatalog.ts. */
  const alternarVarias = (ids: string[], marcar: boolean) => {
    const permitidas = ids.filter(podeMexer);
    setPermissoes(prev => (marcar ? marcarPermissoes(prev, permitidas) : desmarcarPermissoes(prev, permitidas)));
  };

  const gruposFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return PERMISSION_GROUPS;
    return PERMISSION_GROUPS
      .map(grupo => ({ ...grupo, itens: grupo.itens.filter(item => item.label.toLowerCase().includes(termo)) }))
      .filter(grupo => grupo.itens.length > 0);
  }, [busca]);

  /** O que o seletor do topo alcanca: so' o que a busca deixou na tela. */
  const idsVisiveis = useMemo(
    () => gruposFiltrados.flatMap(grupo => grupo.itens.map(item => item.id)).filter(podeMexer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gruposFiltrados, podeAlterarNivelEMobile, userPermissions],
  );
  const estadoVisivel = estadoDaSelecao(permissoes, idsVisiveis);

  // Sem "Utiliza outras filiais", a padrao e' sempre a filial de cadastro (acompanha a permissao marcada aqui).
  const usaOutrasFiliais = podeUsarOutrasFiliais(grupo, { uid: usuarioId, role: papelDoUsuario, permissoes, tenantId: casaDoUsuario });
  const filialPadraoEfetiva = usaOutrasFiliais ? filialPadrao : casaDoUsuario;
  const filiaisParaPadrao = (grupo?.filiais ?? []).filter((f) => f.ativa || f.tenantId === filialPadraoEfetiva);
  const filialDeCadastro = grupo?.filiais.find((f) => f.tenantId === casaDoUsuario);

  const handleSalvar = async () => {
    if (!currentUser) return;

    const ligandoAcessoMobileAgora = podeAlterarNivelEMobile && acessoAppMobile && !acessoAppMobileOriginal;
    if (ligandoAcessoMobileAgora && tenantId) {
      const checagem = await checarLimiteAcessoMobile(tenantId, grupo?.matrizTenantId || tenantId);
      if (!checagem.ok) {
        showError('Limite de acesso mobile atingido', checagem.motivo);
        return;
      }
    }

    setIsSaving(true);
    try {
      // Pelo servidor (26/10/2026): ele grava o marcador do app e confere o gerente
      // (so' o que ele mesmo tem, contando as chaves do app). Gerente nao manda o nivel.
      await salvarPermissoesNoServidor(usuarioId, permissoes, podeAlterarNivelEMobile ? nivelAcesso : undefined);
      // App Vendas (19/10/2026): ligar/desligar passa pelo servidor, que confere a vaga contratada.
      if (podeAlterarNivelEMobile && acessoAppMobile !== acessoAppMobileOriginal) {
        try {
          await alterarAcessoAppNoServidor(usuarioId, acessoAppMobile);
        } catch (erroApp) {
          showError('Permissões salvas, mas o aplicativo não', erroApp instanceof Error ? erroApp.message : 'Tente de novo em instantes.');
          onSaved?.(permissoes);
          return;
        }
      }
      // Filial padrao vai pelo servidor (so' ele grava, conferindo o grupo e a permissao).
      if (grupo && podeAlterarNivelEMobile && casaDoUsuario && filialPadraoEfetiva !== filialPadraoOriginal) {
        try {
          await definirFilialPadrao(usuarioId, filialPadraoEfetiva);
        } catch (erroFilial) {
          showError('Permissões salvas, mas a filial padrão não', erroFilial instanceof Error ? erroFilial.message : 'Tente salvar de novo em instantes.');
          onSaved?.(permissoes);
          return;
        }
      }
      showSuccess('Permissões salvas!');
      onSaved?.(permissoes);
      onClose();
    } catch (err) {
      console.error('Erro ao salvar permissões:', err);
      showError('Não foi possível salvar', err instanceof Error && err.message ? err.message : 'Não foi possível salvar as permissões.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '760px',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(139, 92, 246, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Shield size={20} style={{ color: 'var(--accent-purple)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>Permissões de Acesso</h3>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{usuarioNome}</span>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" title="Fechar" style={{ color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label htmlFor="nivel-acesso-usuario" style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Nível de acesso
            </label>
            <select
              id="nivel-acesso-usuario"
              value={nivelAcesso}
              onChange={(e) => setNivelAcesso(parseNivelAcesso(e.target.value))}
              disabled={isLoading || !podeAlterarNivelEMobile}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', opacity: podeAlterarNivelEMobile ? 1 : 0.6 }}
            >
              {NIVEIS_ACESSO.map((nivel) => (
                <option key={nivel} value={nivel}>{NIVEL_ACESSO_LABELS[nivel]}</option>
              ))}
            </select>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
            {!podeAlterarNivelEMobile
              ? 'Só um Administrador, Master ou o Dono pode mudar o nível de acesso.'
              : restringirVendasPorUsuario
              ? (nivelAcesso === 'funcionario'
                ? 'Sua empresa está com "Não visualizar vendas de outro usuário" ligado: este usuário verá somente as vendas em que ele é o vendedor.'
                : 'Este usuário verá as vendas de todos os vendedores, mesmo com a restrição ligada.')
              : 'O nível só decide quais vendas a pessoa enxerga, e hoje ele não muda nada: a opção "Não visualizar vendas de outro usuário" está desligada em Configurações → Configurações da filial → Configurações Avançadas.'}
          </p>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: (isLoading || !podeAlterarNivelEMobile) ? 'default' : 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', opacity: podeAlterarNivelEMobile ? 1 : 0.6 }}>
            <input
              type="checkbox"
              checked={acessoAppMobile}
              disabled={isLoading || !podeAlterarNivelEMobile}
              onChange={(e) => setAcessoAppMobile(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
            />
            Acesso ao aplicativo mobile
          </label>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
            {podeAlterarNivelEMobile
              ? 'Libera este usuário pra entrar no aplicativo do vendedor externo, com o mesmo login (CNPJ, usuário e senha) que ele já usa aqui. Consome uma vaga do limite de acesso mobile contratado pela empresa.'
              : 'Só um Administrador, Master ou o Dono pode liberar o acesso ao aplicativo mobile.'}
          </p>
        </div>

        {grupo && (
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label htmlFor="filial-padrao-usuario" style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Filial padrão
              </label>
              <select
                id="filial-padrao-usuario"
                value={filialPadraoEfetiva}
                onChange={(e) => setFilialPadrao(e.target.value)}
                disabled={isLoading || !podeAlterarNivelEMobile || !usaOutrasFiliais}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '13px', opacity: podeAlterarNivelEMobile && usaOutrasFiliais ? 1 : 0.6 }}
              >
                {filiaisParaPadrao.map((f) => (
                  <option key={f.tenantId} value={f.tenantId}>{rotuloFilial(f)}</option>
                ))}
              </select>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
              {!podeAlterarNivelEMobile
                ? 'Só um Administrador, Master ou o Dono muda a filial padrão.'
                : !usaOutrasFiliais
                ? `Sem a permissão "Utiliza outras filiais", ele entra sempre na filial em que foi cadastrado${filialDeCadastro ? ` (${rotuloFilial(filialDeCadastro)})` : ''}.`
                : 'Toda vez que ele entrar no sistema, começa nesta filial. Depois pode trocar pelo seletor Filial do topo.'}
            </p>
          </div>
        )}

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar permissão..."
              style={{ width: '100%', padding: '9px 12px 9px 36px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '13px' }}
            />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {PERMISSION_CATALOG.filter((i) => !foraDoPlano(i.id) && permissoes.includes(i.id)).length} de {PERMISSION_CATALOG.filter((i) => !foraDoPlano(i.id)).length} liberadas
          </span>
          {!podeAlterarNivelEMobile && (
            <p style={{ margin: 0, width: '100%', fontSize: '12px', color: 'var(--text-muted)' }}>
              Você só pode liberar ou retirar as permissões que você mesmo tem. As outras aparecem apagadas; para mudar essas, peça ao dono ou a um administrador.
            </p>
          )}
          <SeletorTodas
            estado={estadoVisivel}
            onAlternar={(marcar) => alternarVarias(idsVisiveis, marcar)}
            rotulo={busca.trim() ? 'as encontradas' : 'todas'}
            desabilitado={isLoading || idsVisiveis.length === 0}
          />
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Carregando permissões...</div>
          ) : gruposFiltrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Nenhuma permissão encontrada para "{busca}".</div>
          ) : (
            gruposFiltrados.map(grupo => (
              <div key={grupo.grupo}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', margin: '0 0 12px' }}>
                  <h4 style={{ margin: 0, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700 }}>
                    {grupo.grupo}
                    {grupo.itens.every((i) => foraDoPlano(i.id)) && (
                      <span style={{ marginLeft: '8px', textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: 'var(--text-muted)' }}>· não liberado para a empresa</span>
                    )}
                  </h4>
                  <SeletorTodas
                    estado={estadoDaSelecao(permissoes, grupo.itens.map((i) => i.id).filter(podeMexer))}
                    onAlternar={(marcar) => alternarVarias(grupo.itens.map((i) => i.id), marcar)}
                    rotulo="todas"
                    desabilitado={!grupo.itens.some((i) => podeMexer(i.id))}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
                  {grupo.itens.map(item => {
                    // Fora do plano: aparece desligada (a empresa nao tem o modulo), sem mexer no que esta gravado.
                    const fora = foraDoPlano(item.id);
                    const marcada = !fora && permissoes.includes(item.id);
                    const bloqueada = !podeMexer(item.id);
                    return (
                      <label
                        key={item.id}
                        title={fora ? MENSAGEM_FORA_DO_PLANO : bloqueada ? 'Você não tem esta permissão, então não pode liberar nem retirar.' : undefined}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: bloqueada ? 'not-allowed' : 'pointer',
                          opacity: bloqueada ? 0.5 : 1,
                          fontSize: '13px', color: marcada ? 'var(--text-primary)' : 'var(--text-secondary)',
                          backgroundColor: marcada ? 'rgba(255,255,255,0.03)' : 'var(--bg-primary)',
                          padding: '12px 14px', borderRadius: 'var(--radius-md)',
                          border: `1px solid ${marcada ? item.color : 'var(--border-color)'}`,
                          borderLeft: `4px solid ${marcada ? item.color : 'transparent'}`,
                          transition: 'all 0.2s',
                        }}
                      >
                        <span style={{ fontWeight: marcada ? 600 : 400 }}>{item.label}</span>
                        <span style={{ position: 'relative', width: '38px', height: '21px', backgroundColor: marcada ? item.color : 'var(--bg-tertiary)', borderRadius: '20px', transition: 'all 0.3s', border: `1px solid ${marcada ? item.color : 'var(--border-color)'}`, flexShrink: 0, marginLeft: '10px' }}>
                          <span style={{ position: 'absolute', top: '2px', left: marcada ? '19px' : '2px', width: '15px', height: '15px', backgroundColor: marcada ? '#fff' : 'var(--text-muted)', borderRadius: '50%', transition: 'all 0.3s' }} />
                        </span>
                        <input type="checkbox" checked={marcada} disabled={bloqueada} onChange={() => toggle(item.id)} style={{ display: 'none' }} />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>Cancelar</button>
          <button
            className="btn-primary"
            onClick={handleSalvar}
            disabled={isSaving || isLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSaving || isLoading ? 0.7 : 1 }}
          >
            {isSaving ? <Loader2 size={18} className="spin-icon" /> : <Save size={18} />}
            {isSaving ? 'Salvando...' : 'Salvar Permissões'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissoesUsuarioModal;

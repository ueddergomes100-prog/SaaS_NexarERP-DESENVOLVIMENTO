import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { X, FileCheck2, Building2, ShieldCheck, Loader2 } from 'lucide-react';
import { showError, showSuccess } from '../../utils/alerts';
import { spedyAdminService, type SpedyEnv } from '../../services/spedyAdminService';
import { formatDateInputPtBr } from '../../utils/dateTime';

/**
 * Cadastro de empresa+certificado digital na Spedy, pelo admin da
 * plataforma -- substitui o passo manual de pedir a chave pro consultor da
 * Spedy e colar em Configuracoes (ver server/routes/spedyCompanies.routes.js).
 * Dois passos: 1) criar a empresa (usa CNPJ/endereco/regime ja cadastrados
 * em Configuracoes do tenant), 2) enviar o certificado digital A1 (.pfx).
 */

interface CadastrarEmpresaSpedyModalProps {
  aberto: boolean;
  tenantId: string;
  tenantNome: string;
  onFechar: () => void;
}

interface EstadoSpedyTenant {
  spedyCompanyId: string | null;
  spedyEnvironment: SpedyEnv;
  spedyCertificadoValidade: string | null;
  spedyCertificadoStatus: string | null;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 14px',
  color: 'var(--text-primary)',
};

const CadastrarEmpresaSpedyModal: React.FC<CadastrarEmpresaSpedyModalProps> = ({
  aberto, tenantId, tenantNome, onFechar,
}) => {
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<EstadoSpedyTenant | null>(null);
  const [ambiente, setAmbiente] = useState<SpedyEnv>('sandbox');
  const [criandoEmpresa, setCriandoEmpresa] = useState(false);
  const [certificadoArquivo, setCertificadoArquivo] = useState<File | null>(null);
  const [certificadoSenha, setCertificadoSenha] = useState('');
  const [enviandoCertificado, setEnviandoCertificado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const carregar = async () => {
      setCarregando(true);
      try {
        const snap = await getDoc(doc(db, 'configuracoes', tenantId));
        const data = snap.exists() ? snap.data() : {};
        setEstado({
          spedyCompanyId: data.spedyCompanyId || null,
          spedyEnvironment: data.spedyEnvironment === 'production' ? 'production' : 'sandbox',
          spedyCertificadoValidade: data.spedyCertificadoValidade || null,
          spedyCertificadoStatus: data.spedyCertificadoStatus || null,
        });
        if (data.spedyEnvironment === 'production') setAmbiente('production');
      } catch (error) {
        console.error('Erro ao carregar estado da Spedy para o tenant:', error);
        showError('Erro ao carregar', 'Não foi possível carregar a situação atual desta empresa na Spedy.');
      } finally {
        setCarregando(false);
      }
    };
    carregar();
  }, [aberto, tenantId]);

  if (!aberto) return null;

  const criarEmpresa = async () => {
    setCriandoEmpresa(true);
    try {
      const resultado = await spedyAdminService.createCompany(tenantId, ambiente);
      setEstado((atual) => ({
        spedyCompanyId: resultado.companyId,
        spedyEnvironment: resultado.environment,
        spedyCertificadoValidade: atual?.spedyCertificadoValidade || null,
        spedyCertificadoStatus: atual?.spedyCertificadoStatus || null,
      }));
      showSuccess('Empresa cadastrada na Spedy! A chave já foi salva em Configurações desta empresa.');
    } catch (error) {
      console.error('Erro ao cadastrar empresa na Spedy:', error);
      showError('Erro ao cadastrar empresa', error instanceof Error ? error.message : 'Não foi possível cadastrar a empresa na Spedy.');
    } finally {
      setCriandoEmpresa(false);
    }
  };

  const enviarCertificado = async () => {
    if (!certificadoArquivo) {
      showError('Selecione o certificado', 'Escolha o arquivo .pfx do certificado digital A1 antes de enviar.');
      return;
    }
    if (!certificadoSenha) {
      showError('Senha obrigatória', 'Informe a senha do certificado digital.');
      return;
    }
    setEnviandoCertificado(true);
    try {
      const resultado = await spedyAdminService.uploadCertificate(tenantId, ambiente, certificadoArquivo, certificadoSenha);
      setEstado((atual) => (atual ? {
        ...atual,
        spedyCertificadoValidade: resultado.expirationAt,
        spedyCertificadoStatus: resultado.isActive ? 'ativo' : 'inativo',
      } : atual));
      setCertificadoArquivo(null);
      setCertificadoSenha('');
      showSuccess('Certificado digital enviado! Esta empresa já pode emitir notas fiscais.');
    } catch (error) {
      console.error('Erro ao enviar certificado para a Spedy:', error);
      showError('Erro ao enviar certificado', error instanceof Error ? error.message : 'Não foi possível enviar o certificado digital.');
    } finally {
      setEnviandoCertificado(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}
    >
      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '560px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={20} color="var(--accent-purple)" />
            Cadastro na Spedy — {tenantNome}
          </h2>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {carregando ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Carregando situação atual...</div>
          ) : (
            <>
              <div className="input-group">
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Ambiente</label>
                <select
                  value={ambiente}
                  onChange={(e) => setAmbiente(e.target.value as SpedyEnv)}
                  disabled={!!estado?.spedyCompanyId}
                  style={inputStyle}
                >
                  <option value="sandbox">Sandbox (Homologação / Testes)</option>
                  <option value="production">Produção (Valor Fiscal Real)</option>
                </select>
                {estado?.spedyCompanyId && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    Ambiente travado — a empresa já foi cadastrada. Pra trocar de ambiente, é um cadastro novo.
                  </p>
                )}
              </div>

              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Building2 size={18} color={estado?.spedyCompanyId ? '#10b981' : 'var(--text-muted)'} />
                  <strong>Passo 1 — Cadastrar empresa</strong>
                </div>
                {estado?.spedyCompanyId ? (
                  <p style={{ fontSize: '13px', color: '#10b981', margin: 0 }}>Empresa já cadastrada na Spedy (id {estado.spedyCompanyId}).</p>
                ) : (
                  <>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                      Usa o CNPJ, endereço e regime tributário já cadastrados em Configurações desta empresa. A chave devolvida é salva automaticamente lá.
                    </p>
                    <button className="btn-primary" onClick={criarEmpresa} disabled={criandoEmpresa} style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', opacity: criandoEmpresa ? 0.7 : 1 }}>
                      {criandoEmpresa ? <Loader2 size={16} className="spin-animation" /> : <Building2 size={16} />}
                      {criandoEmpresa ? 'Cadastrando...' : 'Cadastrar empresa na Spedy'}
                    </button>
                  </>
                )}
              </div>

              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', opacity: estado?.spedyCompanyId ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FileCheck2 size={18} color={estado?.spedyCertificadoStatus === 'ativo' ? '#10b981' : 'var(--text-muted)'} />
                  <strong>Passo 2 — Enviar certificado digital (A1)</strong>
                </div>
                {estado?.spedyCertificadoStatus === 'ativo' && estado.spedyCertificadoValidade && (
                  <p style={{ fontSize: '13px', color: '#10b981', margin: 0 }}>
                    Certificado ativo, válido até {formatDateInputPtBr(estado.spedyCertificadoValidade.slice(0, 10))}.
                  </p>
                )}
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Arquivo do certificado (.pfx)</label>
                  <input
                    type="file"
                    accept=".pfx,.p12"
                    disabled={!estado?.spedyCompanyId}
                    onChange={(e) => setCertificadoArquivo(e.target.files?.[0] || null)}
                    style={inputStyle}
                  />
                </div>
                <div className="input-group">
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Senha do certificado</label>
                  <input
                    type="password"
                    disabled={!estado?.spedyCompanyId}
                    value={certificadoSenha}
                    onChange={(e) => setCertificadoSenha(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <button
                  className="btn-primary"
                  onClick={enviarCertificado}
                  disabled={!estado?.spedyCompanyId || enviandoCertificado}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', opacity: (!estado?.spedyCompanyId || enviandoCertificado) ? 0.7 : 1 }}
                >
                  {enviandoCertificado ? <Loader2 size={16} className="spin-animation" /> : <FileCheck2 size={16} />}
                  {enviandoCertificado ? 'Enviando...' : (estado?.spedyCertificadoStatus === 'ativo' ? 'Substituir certificado' : 'Enviar certificado')}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-primary)' }}>
          <button className="btn-secondary" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
};

export default CadastrarEmpresaSpedyModal;

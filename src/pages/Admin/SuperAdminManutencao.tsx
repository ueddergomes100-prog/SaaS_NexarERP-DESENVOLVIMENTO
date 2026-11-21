import React, { useState } from 'react';
import { Building2, CalendarCheck, KeyRound, Loader2, PackageX, RotateCcw, Ruler, Search, Wrench } from 'lucide-react';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import {
  rodarDatasFaltantes,
  rodarProtecaoDeSegredos,
  rodarUnificacaoConfiguracoesGerais,
  rodarZerarEstoqueMigracao,
  rodarVendaFracionada,
  type ModoDatasFaltantes,
  type ResultadoConfiguracoesGerais,
  type ResultadoDatasFaltantes,
  type ResultadoProtecaoDeSegredos,
  type ResultadoZerarEstoqueMigracao,
  type OpcoesAjusteMigracao,
  type ResultadoVendaFracionada,
} from '../../services/manutencaoService';

/**
 * MANUTENCAO DO BANCO (Painel da Plataforma, 2026-10-15).
 *
 * Tarefas de uma vez so' que rodam no servidor do PROPRIO ambiente (em
 * producao, o backend de producao -- unico lugar com acesso ao banco dela).
 * Primeira tarefa: preencher as datas que faltam em pedidos e lancamentos
 * antigos (regra em server/utils/datasFaltantesDomain.js). Sempre Simular
 * antes de Aplicar; Desfazer volta so' o que a tarefa gravou.
 */

const ROTULO_COLECAO: Record<string, string> = {
  pedidos_venda: 'Pedidos de venda (data da venda)',
  transacoes: 'Lançamentos pagos (data do pagamento)',
};

const rotuloDoProjeto = (projeto: string | null) => {
  if (projeto === 'nexus-erp-2026') return 'Produção (nexus-erp-2026)';
  if (projeto === 'sistema-nexus-dev') return 'Teste (sistema-nexus-dev)';
  return projeto || 'não identificado';
};

const ListaDetalhe: React.FC<{ titulo: string; total: number; itens: string[] }> = ({ titulo, total, itens }) => {
  if (total === 0) return null;
  return (
    <details style={{ marginTop: '8px', fontSize: '13px' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600 }}>
        {titulo}: {total}{total > itens.length ? ` (mostrando ${itens.length})` : ''}
      </summary>
      <ul style={{ margin: '8px 0 0', paddingLeft: '18px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {itens.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </details>
  );
};

/**
 * Configuracoes Gerais (15/10/2026): os campos que valem para o grupo inteiro
 * (plano de contas, cadastro, credito, transferencia) ficam iguais em todas as
 * filiais, pelo valor da matriz. Roda uma vez depois da mudanca de tela.
 */
const CartaoConfiguracoesGerais: React.FC = () => {
  const [rodando, setRodando] = useState<ModoDatasFaltantes | null>(null);
  const [resultado, setResultado] = useState<ResultadoConfiguracoesGerais | null>(null);
  const ambienteIdentificado = Boolean(resultado?.projeto);
  const simulacaoComTrabalho = resultado?.modo === 'simular' && resultado.filiaisAlteradas > 0 && ambienteIdentificado;

  const rodar = async (modo: ModoDatasFaltantes) => {
    if (modo !== 'simular') {
      const confirmacao = await NexusSwal.fire({
        title: modo === 'aplicar' ? `Igualar ${resultado?.filiaisAlteradas ?? 0} filiais?` : 'Desfazer a unificação?',
        html: modo === 'aplicar'
          ? `Ambiente: <strong>${rotuloDoProjeto(resultado?.projeto ?? null)}</strong>.<br/>Cada filial listada passa a ter o valor da matriz. O plano de contas junta as categorias de todas. Dá para voltar pelo Desfazer.`
          : 'Cada filial volta ao valor que tinha antes da unificação.',
        icon: modo === 'aplicar' ? 'question' : 'warning',
        showCancelButton: true,
        confirmButtonText: modo === 'aplicar' ? 'Igualar' : 'Desfazer',
        cancelButtonText: 'Cancelar',
        ...(modo === 'desfazer' ? { confirmButtonColor: '#ef4444' } : {}),
      });
      if (!confirmacao.isConfirmed) return;
    }
    setRodando(modo);
    try {
      const novo = await rodarUnificacaoConfiguracoesGerais(modo);
      setResultado(novo);
      if (modo === 'aplicar') showSuccess(`${novo.filiaisAlteradas} ${novo.filiaisAlteradas === 1 ? 'filial igualada' : 'filiais igualadas'} à matriz.`);
      if (modo === 'desfazer') showSuccess(`${novo.filiaisAlteradas} ${novo.filiaisAlteradas === 1 ? 'filial voltou' : 'filiais voltaram'} ao valor anterior.`);
    } catch (erro) {
      showError('Não foi possível rodar a tarefa', erro instanceof Error ? erro.message : undefined);
    } finally {
      setRodando(null);
    }
  };

  return (
    <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <span style={{ width: '42px', height: '42px', borderRadius: '13px', backgroundColor: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Building2 size={21} />
        </span>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 4px' }}>Igualar as configurações gerais das filiais</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
            Plano de contas, validação de produto e de cliente, limite de crédito e transferência valem para o grupo inteiro.
            Em cada empresa com filiais, esta tarefa grava em todas o valor da <strong>matriz</strong>; no plano de contas, junta as categorias de todas (nenhuma se perde).
            <strong> Comece por Simular: nada é gravado.</strong>
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <button type="button" className="btn-secondary" onClick={() => rodar('simular')} disabled={rodando !== null} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {rodando === 'simular' ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
          {rodando === 'simular' ? 'Simulando...' : 'Simular'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => rodar('aplicar')}
          disabled={rodando !== null || !simulacaoComTrabalho}
          title={simulacaoComTrabalho ? undefined : 'Rode Simular primeiro; Aplicar libera quando houver filial diferente da matriz.'}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: rodando !== null || !simulacaoComTrabalho ? 0.6 : 1 }}
        >
          {rodando === 'aplicar' ? <Loader2 size={18} className="spin-icon" /> : <Building2 size={18} />}
          {rodando === 'aplicar' ? 'Gravando...' : `Aplicar${simulacaoComTrabalho ? ` (${resultado?.filiaisAlteradas})` : ''}`}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => rodar('desfazer')}
          disabled={rodando !== null}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: 0 }}
        >
          {rodando === 'desfazer' ? <Loader2 size={14} className="spin-icon" /> : <RotateCcw size={14} />}
          Desfazer o que esta tarefa gravou
        </button>
      </div>

      {resultado && !rodando && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Ambiente: <strong style={{ color: 'var(--text-primary)' }}>{rotuloDoProjeto(resultado.projeto)}</strong>
            {' · '}
            {resultado.modo === 'simular' ? 'Simulação (nada foi gravado)' : resultado.modo === 'aplicar' ? 'Gravado' : 'Desfeito'}
            {' · '}
            {resultado.gruposLidos} {resultado.gruposLidos === 1 ? 'empresa com filiais' : 'empresas com filiais'}
          </div>
          {resultado.grupos.map((grupo) => (
            <div key={grupo.grupo} style={{ padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{grupo.grupo}</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>
                {grupo.filiais.map((f) => <li key={f.filial}><strong>{f.filial}</strong>: {f.campos.join(', ')}</li>)}
              </ul>
            </div>
          ))}
          {!ambienteIdentificado && (
            <p style={{ margin: 0, fontSize: '14px', color: '#ef4444', fontWeight: 600 }}>
              O servidor não informou em qual banco está ligado, então o Aplicar fica bloqueado. Avise o suporte.
            </p>
          )}
          {resultado.filiaisAlteradas === 0 && (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
              {resultado.modo === 'desfazer' ? 'Nada a desfazer.' : 'Nada a igualar: as filiais já estão iguais à matriz.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Segredos fiscais (19/10/2026): CSC da NFC-e e chave antiga da Spedy saem do
 * documento de configuracoes que todo usuario da empresa le. Sem "desfazer".
 */
const CartaoProtegerSegredos: React.FC = () => {
  const [rodando, setRodando] = useState<'simular' | 'aplicar' | null>(null);
  const [resultado, setResultado] = useState<ResultadoProtecaoDeSegredos | null>(null);
  const ambienteIdentificado = Boolean(resultado?.projeto);
  const simulacaoComTrabalho = resultado?.modo === 'simular' && resultado.empresas.length > 0 && ambienteIdentificado;

  const rodar = async (modo: 'simular' | 'aplicar') => {
    if (modo === 'aplicar') {
      const confirmacao = await NexusSwal.fire({
        title: `Proteger ${resultado?.empresas.length ?? 0} empresa(s)?`,
        html: `Ambiente: <strong>${rotuloDoProjeto(resultado?.projeto ?? null)}</strong>.<br/>O CSC e a chave da Spedy passam para a área que só o administrador da empresa e o servidor leem, e saem do documento comum. A emissão de notas não muda.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Proteger',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;
    }
    setRodando(modo);
    try {
      const novo = await rodarProtecaoDeSegredos(modo);
      setResultado(novo);
      if (modo === 'aplicar') showSuccess(`${novo.empresas.length} ${novo.empresas.length === 1 ? 'empresa protegida' : 'empresas protegidas'}.`);
    } catch (erro) {
      showError('Não foi possível rodar a tarefa', erro instanceof Error ? erro.message : undefined);
    } finally {
      setRodando(null);
    }
  };

  return (
    <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <span style={{ width: '42px', height: '42px', borderRadius: '13px', backgroundColor: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <KeyRound size={21} />
        </span>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 4px' }}>Proteger CSC e chave da Spedy</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
            O CSC da NFC-e e, em empresas antigas, a chave da Spedy ficavam no documento de configurações que qualquer usuário da empresa consegue ler.
            Esta tarefa passa os dois para a área protegida (só o administrador da empresa e o servidor) e apaga do documento comum.
            <strong> Comece por Simular: nada é gravado.</strong>
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <button type="button" className="btn-secondary" onClick={() => rodar('simular')} disabled={rodando !== null} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {rodando === 'simular' ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
          {rodando === 'simular' ? 'Simulando...' : 'Simular'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => rodar('aplicar')}
          disabled={rodando !== null || !simulacaoComTrabalho}
          title={simulacaoComTrabalho ? undefined : 'Rode Simular primeiro; Aplicar libera quando houver empresa com segredo no documento comum.'}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: rodando !== null || !simulacaoComTrabalho ? 0.6 : 1 }}
        >
          {rodando === 'aplicar' ? <Loader2 size={18} className="spin-icon" /> : <KeyRound size={18} />}
          {rodando === 'aplicar' ? 'Gravando...' : `Aplicar${simulacaoComTrabalho ? ` (${resultado?.empresas.length})` : ''}`}
        </button>
      </div>

      {resultado && !rodando && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Ambiente: <strong style={{ color: 'var(--text-primary)' }}>{rotuloDoProjeto(resultado.projeto)}</strong>
            {' · '}
            {resultado.modo === 'simular' ? 'Simulação (nada foi gravado)' : 'Gravado'}
            {' · '}
            {resultado.lidas} {resultado.lidas === 1 ? 'empresa lida' : 'empresas lidas'}
          </div>
          {resultado.empresas.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>
              {resultado.empresas.map((e) => (
                <li key={e.tenantId}><strong>{e.nome}</strong>: {[e.csc ? 'CSC da NFC-e' : '', e.chaveSpedy ? 'chave da Spedy' : ''].filter(Boolean).join(' e ')}</li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>Nada a proteger: nenhuma empresa tem segredo no documento comum.</p>
          )}
          {!ambienteIdentificado && (
            <p style={{ margin: 0, fontSize: '14px', color: '#ef4444', fontWeight: 600 }}>
              O servidor não informou em qual banco está ligado, então o Aplicar fica bloqueado. Avise o suporte.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Migracao de cliente (17/11/2026): zera saldo e custos dos produtos de UMA
 * empresa, mantendo o preco de venda (server/services/zerarEstoqueMigracao.js).
 */
const CartaoZerarEstoqueMigracao: React.FC = () => {
  const [tenantId, setTenantId] = useState('');
  const [opcoes, setOpcoes] = useState<OpcoesAjusteMigracao>({ zerar: true, renumerar: false, apagarCodigoAntigo: false });
  const [opcoesSimuladas, setOpcoesSimuladas] = useState<string>('');
  const [rodando, setRodando] = useState<'simular' | 'aplicar' | null>(null);
  const [resultado, setResultado] = useState<ResultadoZerarEstoqueMigracao | null>(null);
  const nenhumaOpcao = !opcoes.zerar && !opcoes.renumerar && !opcoes.apagarCodigoAntigo;
  // Aplicar so' com a mesma empresa e as mesmas opcoes que foram simuladas.
  const simulado = resultado?.modo === 'simular' && resultado.tenantId === tenantId.trim() && opcoesSimuladas === JSON.stringify(opcoes)
    && Boolean(resultado.projeto) && resultado.alterados > 0;
  const mudarOpcao = (chave: keyof OpcoesAjusteMigracao) => { setOpcoes((atual) => ({ ...atual, [chave]: !atual[chave] })); setResultado(null); };
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

  const rodar = async (modo: 'simular' | 'aplicar') => {
    const alvo = tenantId.trim();
    if (!alvo) { showError('Informe a empresa', 'Cole o código da empresa (tenant) que vai ser ajustada.'); return; }
    if (nenhumaOpcao) { showError('Escolha o que fazer', 'Marque pelo menos uma das opções: zerar estoque e custos, renumerar os códigos ou apagar o código do sistema antigo.'); return; }
    if (modo === 'aplicar' && resultado) {
      const confirmacao = await NexusSwal.fire({
        title: `Ajustar os produtos de ${resultado.empresa}?`,
        html: `Ambiente: <strong>${rotuloDoProjeto(resultado.projeto)}</strong>${resultado.cnpj ? ` · CNPJ ${resultado.cnpj}` : ''}.<br/>`
          + `${fmt(resultado.alterados)} produto(s) vão mudar:<br/>`
          + (opcoes.zerar ? `· saldo a zero (soma hoje ${fmt(resultado.somaSaldo)}); preço à vista, custo, custo médio e custo comercial vazios; preço de venda continua<br/>` : '')
          + (opcoes.renumerar ? `· códigos 1, 2, 3... pela ordem alfabética (${fmt(resultado.codigosTrocados)} mudam)<br/>` : '')
          + (opcoes.apagarCodigoAntigo ? `· código do sistema antigo apagado (${fmt(resultado.referenciasApagadas)} referência(s), ${fmt(resultado.barrasApagadas)} código(s) de barras com zeros)<br/>` : '')
          + `${resultado.pedidosDeVenda > 0 ? `<br/><strong style="color:#ef4444">Esta empresa já tem ${resultado.pedidosDeVenda} pedido(s) de venda.</strong>` : ''}`
          + '<br/>Fica um único registro no histórico: "Migração de sistema, importação de dados". Não tem desfazer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Aplicar agora',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;
    }
    setRodando(modo);
    try {
      const novo = await rodarZerarEstoqueMigracao(modo, alvo, opcoes);
      setResultado(novo);
      setOpcoesSimuladas(JSON.stringify(opcoes));
      if (modo === 'aplicar') showSuccess(`${fmt(novo.alterados)} produto(s) de ${novo.empresa} ajustados.`);
    } catch (erro) {
      showError('Não foi possível rodar a tarefa', erro instanceof Error ? erro.message : undefined);
    } finally {
      setRodando(null);
    }
  };

  return (
    <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <span style={{ width: '42px', height: '42px', borderRadius: '13px', backgroundColor: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <PackageX size={21} />
        </span>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 4px' }}>Ajustes de migração nos produtos de uma empresa</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
            Para depois da importação de um cliente novo. Escolha o que fazer em todos os produtos da empresa.
            Grava um único registro no histórico dela (&quot;Migração de sistema, importação de dados&quot;).
            <strong> Comece por Simular: nada é gravado.</strong>
          </p>
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px' }}>
        Código da empresa (tenant)
        <input
          type="text"
          value={tenantId}
          onChange={(e) => { setTenantId(e.target.value); setResultado(null); }}
          title="O código aparece no Painel da Plataforma, na lista de empresas"
          style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
        />
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
        {([
          ['zerar', 'Zerar o estoque e apagar os custos (preço à vista, custo, custo médio e custo comercial). O preço de venda continua.'],
          ['renumerar', 'Renumerar os códigos 1, 2, 3... pela ordem alfabética do nome (o próximo produto novo segue a sequência).'],
          ['apagarCodigoAntigo', 'Apagar o código do sistema antigo: a Referência e o código de barras feito dela com zeros (o código de barras de fábrica continua).'],
        ] as Array<[keyof OpcoesAjusteMigracao, string]>).map(([chave, texto]) => (
          <label key={chave} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={opcoes[chave]} onChange={() => mudarOpcao(chave)} style={{ marginTop: '3px' }} />
            <span>{texto}</span>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <button type="button" className="btn-secondary" onClick={() => rodar('simular')} disabled={rodando !== null || nenhumaOpcao} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {rodando === 'simular' ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
          {rodando === 'simular' ? 'Simulando...' : 'Simular'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => rodar('aplicar')}
          disabled={rodando !== null || !simulado}
          title={simulado ? undefined : 'Rode Simular primeiro, com esta empresa e estas opções; Aplicar libera quando houver produto a mudar.'}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: rodando !== null || !simulado ? 0.6 : 1 }}
        >
          {rodando === 'aplicar' ? <Loader2 size={18} className="spin-icon" /> : <PackageX size={18} />}
          {rodando === 'aplicar' ? 'Gravando...' : `Aplicar${simulado ? ` (${fmt(resultado?.alterados ?? 0)})` : ''}`}
        </button>
      </div>

      {resultado && !rodando && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Ambiente: <strong style={{ color: 'var(--text-primary)' }}>{rotuloDoProjeto(resultado.projeto)}</strong>
            {' · '}
            {resultado.modo === 'simular' ? 'Simulação (nada foi gravado)' : 'Gravado'}
          </div>
          <div><strong style={{ color: 'var(--text-primary)' }}>{resultado.empresa}</strong>{resultado.cnpj ? ` · CNPJ ${resultado.cnpj}` : ''}</div>
          <div>{fmt(resultado.produtos)} produto(s) · {fmt(resultado.comSaldo)} com saldo (soma {fmt(resultado.somaSaldo)}) · {fmt(resultado.comCustos)} com custo ou preço à vista</div>
          {(resultado.codigosTrocados > 0 || resultado.referenciasApagadas > 0 || resultado.barrasApagadas > 0) && (
            <div>{fmt(resultado.codigosTrocados)} código(s) renumerado(s) · {fmt(resultado.referenciasApagadas)} referência(s) e {fmt(resultado.barrasApagadas)} código(s) de barras do sistema antigo</div>
          )}
          <div>{resultado.modo === 'simular' ? 'Vão mudar' : 'Mudaram'}: <strong style={{ color: 'var(--text-primary)' }}>{fmt(resultado.alterados)}</strong> produto(s)</div>
          {resultado.pedidosDeVenda > 0 && (
            <div style={{ color: '#ef4444', fontWeight: 600 }}>Atenção: esta empresa já tem {fmt(resultado.pedidosDeVenda)} pedido(s) de venda.</div>
          )}
          {!resultado.projeto && (
            <div style={{ color: '#ef4444', fontWeight: 600 }}>O servidor não informou em qual banco está ligado, então o Aplicar fica bloqueado. Avise o suporte.</div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Venda fracionada (21/11/2026): produto ativo em unidade fracionada passa a
 * vender fracionado (server/services/vendaFracionadaProdutos.js).
 */
const CartaoVendaFracionada: React.FC = () => {
  const [tenantId, setTenantId] = useState('');
  const [rodando, setRodando] = useState<'simular' | 'aplicar' | null>(null);
  const [resultado, setResultado] = useState<ResultadoVendaFracionada | null>(null);
  const simulado = resultado?.modo === 'simular' && resultado.tenantId === tenantId.trim() && Boolean(resultado.projeto) && resultado.alterados > 0;
  const fmt = (n: number) => n.toLocaleString('pt-BR');

  const rodar = async (modo: 'simular' | 'aplicar') => {
    const alvo = tenantId.trim();
    if (!alvo) { showError('Informe a empresa', 'Cole o código da empresa (tenant) cujos produtos serão conferidos.'); return; }
    if (modo === 'aplicar' && resultado) {
      const confirmacao = await NexusSwal.fire({
        title: `Acertar a venda fracionada de ${resultado.empresa}?`,
        html: `Ambiente: <strong>${rotuloDoProjeto(resultado.projeto)}</strong>${resultado.cnpj ? ` · CNPJ ${resultado.cnpj}` : ''}.<br/>`
          + `${fmt(resultado.alterados)} produto(s) ativo(s) nas unidades ${resultado.unidadesFracionadas.join(', ')} passam a vender fracionado`
          + ` (${fmt(resultado.travados)} hoje recusam quantidade quebrada).<br/>Fica um registro no histórico da empresa.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Aplicar agora',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;
    }
    setRodando(modo);
    try {
      const novo = await rodarVendaFracionada(modo, alvo);
      setResultado(novo);
      if (modo === 'aplicar') showSuccess(`${fmt(novo.alterados)} produto(s) de ${novo.empresa} acertados.`);
    } catch (erro) {
      showError('Não foi possível rodar a tarefa', erro instanceof Error ? erro.message : undefined);
    } finally {
      setRodando(null);
    }
  };

  return (
    <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <span style={{ width: '42px', height: '42px', borderRadius: '13px', backgroundColor: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Ruler size={21} />
        </span>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 4px' }}>Venda fracionada nos produtos de uma empresa</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
            Todo produto ativo numa unidade marcada como &quot;Fracionada&quot; (metro, quilo, metro cúbico...) passa a aceitar
            quantidade quebrada na venda: marca &quot;Produto fracionado&quot; e copia de novo as casas decimais da unidade.
            <strong> Comece por Simular: nada é gravado.</strong>
          </p>
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px' }}>
        Código da empresa (tenant)
        <input
          type="text"
          value={tenantId}
          onChange={(e) => { setTenantId(e.target.value); setResultado(null); }}
          title="O código aparece no Painel da Plataforma, na lista de empresas"
          style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
        />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
        <button type="button" className="btn-secondary" onClick={() => rodar('simular')} disabled={rodando !== null} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {rodando === 'simular' ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
          {rodando === 'simular' ? 'Simulando...' : 'Simular'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => rodar('aplicar')}
          disabled={rodando !== null || !simulado}
          title={simulado ? undefined : 'Rode Simular primeiro, com esta empresa; Aplicar libera quando houver produto a acertar.'}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: rodando !== null || !simulado ? 0.6 : 1 }}
        >
          {rodando === 'aplicar' ? <Loader2 size={18} className="spin-icon" /> : <Ruler size={18} />}
          {rodando === 'aplicar' ? 'Gravando...' : `Aplicar${simulado ? ` (${fmt(resultado?.alterados ?? 0)})` : ''}`}
        </button>
      </div>

      {resultado && !rodando && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Ambiente: <strong style={{ color: 'var(--text-primary)' }}>{rotuloDoProjeto(resultado.projeto)}</strong>
            {' · '}
            {resultado.modo === 'simular' ? 'Simulação (nada foi gravado)' : 'Gravado'}
          </div>
          <div><strong style={{ color: 'var(--text-primary)' }}>{resultado.empresa}</strong>{resultado.cnpj ? ` · CNPJ ${resultado.cnpj}` : ''}</div>
          <div>
            Unidades fracionadas: <strong style={{ color: 'var(--text-primary)' }}>{resultado.unidadesFracionadas.join(', ') || 'nenhuma'}</strong>
            {' · '}{fmt(resultado.naUnidadeFracionada)} produto(s) ativo(s) nelas, de {fmt(resultado.produtos)}
          </div>
          {resultado.porSigla.length > 0 && (
            <table style={{ borderCollapse: 'collapse', fontSize: '13px', maxWidth: '520px' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>Unidade</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Produtos</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Recusando fração</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>{resultado.modo === 'simular' ? 'Vão mudar' : 'Mudaram'}</th>
                </tr>
              </thead>
              <tbody>
                {resultado.porSigla.map((s) => (
                  <tr key={s.sigla} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '4px 8px', fontWeight: 600, color: 'var(--text-primary)' }}>{s.sigla}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt(s.produtos)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: s.travados > 0 ? '#ef4444' : undefined }}>{fmt(s.travados)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmt(s.alterados)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {resultado.exemplos.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer' }}>Produtos que hoje recusam quantidade quebrada ({fmt(resultado.travados)}{resultado.travados > resultado.exemplos.length ? `, mostrando ${resultado.exemplos.length}` : ''})</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: '20px', columns: 2, fontSize: '13px' }}>
                {resultado.exemplos.map((e) => <li key={`${e.codigo}-${e.nome}`}>{e.codigo ? `${e.codigo} · ` : ''}{e.nome} ({e.sigla})</li>)}
              </ul>
            </details>
          )}
          <div>{resultado.modo === 'simular' ? 'Vão mudar' : 'Mudaram'}: <strong style={{ color: 'var(--text-primary)' }}>{fmt(resultado.alterados)}</strong> produto(s)</div>
          {!resultado.projeto && (
            <div style={{ color: '#ef4444', fontWeight: 600 }}>O servidor não informou em qual banco está ligado, então o Aplicar fica bloqueado. Avise o suporte.</div>
          )}
        </div>
      )}
    </div>
  );
};

const SuperAdminManutencao: React.FC = () => {
  const [rodando, setRodando] = useState<ModoDatasFaltantes | null>(null);
  const [resultado, setResultado] = useState<ResultadoDatasFaltantes | null>(null);

  const totalAlterados = resultado ? resultado.colecoes.reduce((soma, c) => soma + c.alterados, 0) : 0;
  // Sem saber em qual banco vai gravar, nao grava: o ambiente e' a confirmacao principal.
  const ambienteIdentificado = Boolean(resultado?.projeto);
  const simulacaoComTrabalho = resultado?.modo === 'simular' && totalAlterados > 0 && ambienteIdentificado;

  const rodar = async (modo: ModoDatasFaltantes) => {
    if (modo === 'aplicar') {
      const confirmacao = await NexusSwal.fire({
        title: `Gravar ${totalAlterados} ${totalAlterados === 1 ? 'data' : 'datas'}?`,
        html: `Ambiente: <strong>${rotuloDoProjeto(resultado?.projeto ?? null)}</strong>.<br/>Cada pedido ou lançamento sem data recebe o dia em que foi criado. Dá para voltar depois pelo botão Desfazer.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Gravar',
        cancelButtonText: 'Cancelar',
      });
      if (!confirmacao.isConfirmed) return;
    }
    if (modo === 'desfazer') {
      const confirmacao = await NexusSwal.fire({
        title: 'Desfazer o preenchimento?',
        text: 'Apaga só as datas que esta tarefa gravou. As datas que os pedidos e lançamentos já tinham não mudam.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Desfazer',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444',
      });
      if (!confirmacao.isConfirmed) return;
    }

    setRodando(modo);
    try {
      const novo = await rodarDatasFaltantes(modo);
      setResultado(novo);
      const alterados = novo.colecoes.reduce((soma, c) => soma + c.alterados, 0);
      if (modo === 'aplicar') showSuccess(`${alterados} ${alterados === 1 ? 'data preenchida' : 'datas preenchidas'}.`);
      if (modo === 'desfazer') showSuccess(`${alterados} ${alterados === 1 ? 'data voltou' : 'datas voltaram'} a ficar em branco.`);
    } catch (erro) {
      showError('Não foi possível rodar a tarefa', erro instanceof Error ? erro.message : undefined);
    } finally {
      setRodando(null);
    }
  };

  const verbo = resultado?.modo === 'simular' ? 'serão preenchidos' : resultado?.modo === 'desfazer' ? 'voltaram' : 'preenchidos';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '920px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Wrench size={24} color="var(--accent-purple)" />
          Manutenção do banco
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Tarefas de uma vez só, rodadas pelo servidor deste ambiente.
        </p>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <span style={{ width: '42px', height: '42px', borderRadius: '13px', backgroundColor: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <CalendarCheck size={21} />
          </span>
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 4px' }}>Preencher datas faltantes</h2>
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
              Pedidos sem data da venda e lançamentos pagos sem data de pagamento não aparecem nas listas e relatórios do mês.
              Esta tarefa grava neles o dia em que foram criados. Lançamento pendente sem vencimento só é listado, nunca recebe data inventada.
              <strong> Comece por Simular: nada é gravado.</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
          <button type="button" className="btn-secondary" onClick={() => rodar('simular')} disabled={rodando !== null} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {rodando === 'simular' ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
            {rodando === 'simular' ? 'Simulando...' : 'Simular'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => rodar('aplicar')}
            disabled={rodando !== null || !simulacaoComTrabalho}
            title={simulacaoComTrabalho ? undefined : 'Rode Simular primeiro; Aplicar libera quando houver algo a preencher.'}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: rodando !== null || !simulacaoComTrabalho ? 0.6 : 1 }}
          >
            {rodando === 'aplicar' ? <Loader2 size={18} className="spin-icon" /> : <CalendarCheck size={18} />}
            {rodando === 'aplicar' ? 'Gravando...' : `Aplicar${simulacaoComTrabalho ? ` (${totalAlterados})` : ''}`}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => rodar('desfazer')}
            disabled={rodando !== null}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: 0 }}
          >
            {rodando === 'desfazer' ? <Loader2 size={14} className="spin-icon" /> : <RotateCcw size={14} />}
            Desfazer o que esta tarefa gravou
          </button>
        </div>

        {rodando && (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            Lendo os pedidos e lançamentos de todas as empresas. Pode levar alguns minutos; não feche a tela.
          </p>
        )}

        {resultado && !rodando && (
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Ambiente: <strong style={{ color: 'var(--text-primary)' }}>{rotuloDoProjeto(resultado.projeto)}</strong>
              {' · '}
              {resultado.modo === 'simular' ? 'Simulação (nada foi gravado)' : resultado.modo === 'aplicar' ? 'Gravado' : 'Desfeito'}
            </div>
            {resultado.colecoes.map((colecao) => (
              <div key={colecao.nome} style={{ padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>{ROTULO_COLECAO[colecao.nome] || colecao.nome}</div>
                <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  Lidos {colecao.lidos}
                  {resultado.modo !== 'desfazer' && <> · já tinham a data {colecao.ok}</>}
                  {' · '}
                  <strong style={{ color: 'var(--text-primary)' }}>{verbo} {colecao.alterados}</strong>
                </div>
                <ListaDetalhe titulo="Sem a data e sem data de criação (corrigir no cadastro)" total={colecao.totalSemData} itens={colecao.semData} />
                <ListaDetalhe titulo="Pendentes sem vencimento (corrigir o vencimento no título)" total={colecao.totalPendentesSemVencimento} itens={colecao.pendentesSemVencimento} />
              </div>
            ))}
            {!ambienteIdentificado && (
              <p style={{ margin: 0, fontSize: '14px', color: '#ef4444', fontWeight: 600 }}>
                O servidor não informou em qual banco está ligado, então o Aplicar fica bloqueado. Avise o suporte.
              </p>
            )}
            {resultado.modo === 'simular' && totalAlterados === 0 && (
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>Nada a preencher: todos já têm a data.</p>
            )}
          </div>
        )}
      </div>

      <CartaoConfiguracoesGerais />
      <CartaoProtegerSegredos />
      <CartaoZerarEstoqueMigracao />
      <CartaoVendaFracionada />
    </div>
  );
};

export default SuperAdminManutencao;

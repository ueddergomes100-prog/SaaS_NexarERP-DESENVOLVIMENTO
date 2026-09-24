import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { ArrowLeft, FileDown, FileSpreadsheet, Loader2, Printer, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { jsPDF } from 'jspdf';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatCompanyAddress } from '../../utils/companyAddress';
import { showError } from '../../utils/alerts';
import {
  normalizarPreferencias,
  preferenciasPadrao,
  secoesVisiveis,
  type PreferenciasRelatorio,
} from '../../utils/relatorioPdfDomain';
import { gerarRelatorioPdf, type DocumentoRelatorio, type EmpresaRelatorio } from '../../utils/relatorioPdf';
import { salvarRelatorioExcel } from '../../utils/relatorioExcel';
import './RelatorioPreview.css';

/*
 * VISUALIZACAO PADRAO DE RELATORIO (decisao do dono, 2026-09-23).
 *
 * O relatorio abre aqui, DENTRO do sistema -- igual minuta e pedido --, com
 * as folhas ja' paginadas do jeito que vao sair. Dali:
 *   - so' olhar e fechar;
 *   - Imprimir (abre a janela de impressao do navegador com esse PDF);
 *   - Salvar PDF (baixa o arquivo);
 *   - Salvar em Excel (botao separado; o padrao e' PDF).
 *
 * As caixas de marcar ao lado escolhem o que sai no papel. Nada e' removido
 * do sistema; a escolha fica guardada neste computador, por relatorio.
 */

export type DocumentoRelatorioSemEmpresa = Omit<DocumentoRelatorio, 'empresa' | 'geradoPor'>;

interface RelatorioPreviewProps {
  /** Chave da escolha de colunas guardada no computador. */
  relatorioId: string;
  documento: DocumentoRelatorioSemEmpresa | null;
  nomeArquivo: string;
  onFechar: () => void;
  carregando?: boolean;
  erro?: string;
  rotuloFechar?: string;
}

const chavePreferencias = (id: string) => `relatorio_colunas_${id}`;

const lerPreferencias = (id: string): unknown => {
  try {
    const bruto = localStorage.getItem(chavePreferencias(id));
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
};

const gravarPreferencias = (id: string, preferencias: PreferenciasRelatorio) => {
  try {
    localStorage.setItem(chavePreferencias(id), JSON.stringify(preferencias));
  } catch {
    // Navegador sem armazenamento (janela anonima): a escolha vale so' agora.
  }
};

const RelatorioPreview: React.FC<RelatorioPreviewProps> = ({
  relatorioId,
  documento,
  nomeArquivo,
  onFechar,
  carregando = false,
  erro = '',
  rotuloFechar = 'Voltar',
}) => {
  const { tenantId, userNome } = useAuth();
  const [empresa, setEmpresa] = useState<EmpresaRelatorio | null>(null);
  const [preferencias, setPreferencias] = useState<PreferenciasRelatorio | null>(null);
  const [paginas, setPaginas] = useState<string[]>([]);
  const [montando, setMontando] = useState(false);
  const [erroMontagem, setErroMontagem] = useState('');
  const pdfAtual = useRef<jsPDF | null>(null);
  const versaoMontagem = useRef(0);

  useEffect(() => {
    let cancelado = false;
    if (!tenantId) return;
    getDoc(firestoreDoc(db, 'configuracoes', tenantId))
      .then((snap) => {
        if (cancelado) return;
        const config = snap.exists() ? snap.data() : {};
        setEmpresa({
          nome: config.nomeOficina || config.razaoSocial || config.nomeFantasia || 'Empresa',
          cnpj: config.cnpj || '',
          telefone: config.telefone || '',
          endereco: formatCompanyAddress(config),
        });
      })
      .catch(() => {
        // Sem a configuracao o relatorio ainda sai; so' sem os dados da empresa.
        if (!cancelado) setEmpresa({ nome: 'Empresa' });
      });
    return () => { cancelado = true; };
  }, [tenantId]);

  const secoes = documento?.secoes;
  useEffect(() => {
    if (!secoes) return;
    setPreferencias((atual) => normalizarPreferencias(atual ?? lerPreferencias(relatorioId), secoes));
  }, [secoes, relatorioId]);

  const alterarPreferencias = useCallback((proximas: PreferenciasRelatorio) => {
    setPreferencias(proximas);
    gravarPreferencias(relatorioId, proximas);
  }, [relatorioId]);

  const documentoCompleto = useMemo<DocumentoRelatorio | null>(() => (
    documento && empresa ? { ...documento, empresa, geradoPor: userNome || undefined } : null
  ), [documento, empresa, userNome]);

  useEffect(() => {
    if (!documentoCompleto || !preferencias) return;
    const versao = ++versaoMontagem.current;
    setMontando(true);
    setErroMontagem('');

    const temporizador = window.setTimeout(async () => {
      try {
        const pdf = gerarRelatorioPdf(documentoCompleto, preferencias);
        pdfAtual.current = pdf;
        const pdfjs = await import('pdfjs-dist');
        // Worker empacotado pelo Vite como .js. NAO usar o .mjs solto (?url): a
        // hospedagem de producao serve .mjs como text/plain e o navegador
        // recusa executar -- o relatorio dava "Nao foi possivel montar".
        if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
        const tarefa = pdfjs.getDocument({ data: pdf.output('arraybuffer') });
        const carregado = await tarefa.promise;
        const imagens: string[] = [];
        for (let numero = 1; numero <= carregado.numPages; numero += 1) {
          const pagina = await carregado.getPage(numero);
          const viewport = pagina.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await pagina.render({ canvas, viewport }).promise;
          imagens.push(canvas.toDataURL('image/png'));
        }
        await tarefa.destroy();
        if (versao === versaoMontagem.current) setPaginas(imagens);
      } catch (falha) {
        console.error('Erro ao montar o relatório em PDF:', falha);
        if (versao === versaoMontagem.current) {
          setErroMontagem('Não foi possível montar o relatório. Feche e abra de novo; se continuar, avise o suporte.');
        }
      } finally {
        if (versao === versaoMontagem.current) setMontando(false);
      }
    }, 180);

    return () => window.clearTimeout(temporizador);
  }, [documentoCompleto, preferencias]);

  const nadaMarcado = Boolean(documento && preferencias && secoesVisiveis(documento.secoes, preferencias).length === 0);
  // As folhas so' existem depois que o PDF foi gerado (pdfAtual preenchido).
  const podeAgir = Boolean(paginas.length && !montando && !nadaMarcado);

  const imprimir = () => {
    const pdf = pdfAtual.current;
    if (!pdf) return;
    const url = URL.createObjectURL(pdf.output('blob'));
    const moldura = document.createElement('iframe');
    Object.assign(moldura.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    moldura.src = url;
    moldura.onload = () => {
      window.setTimeout(() => {
        try {
          moldura.contentWindow?.focus();
          moldura.contentWindow?.print();
        } catch {
          showError('Não foi possível abrir a impressão', 'Use "Salvar PDF" e imprima o arquivo baixado.');
        }
      }, 150);
    };
    document.body.appendChild(moldura);
    window.setTimeout(() => {
      moldura.remove();
      URL.revokeObjectURL(url);
    }, 120000);
  };

  const salvarPdf = () => pdfAtual.current?.save(`${nomeArquivo}.pdf`);

  const salvarExcel = () => {
    if (!documentoCompleto || !preferencias) return;
    try {
      salvarRelatorioExcel(documentoCompleto, preferencias, nomeArquivo);
    } catch (falha) {
      console.error('Erro ao gerar Excel do relatório:', falha);
      showError('Não foi possível gerar o Excel', 'Tente de novo. O PDF continua disponível em "Salvar PDF".');
    }
  };

  const alternarColuna = (secaoId: string, colunaId: string) => {
    if (!preferencias || !documento) return;
    const secao = documento.secoes.find((item) => item.id === secaoId);
    if (!secao) return;
    const atuais = preferencias.secoes[secaoId]?.colunas || [];
    const marcadas = atuais.includes(colunaId) ? atuais.filter((id) => id !== colunaId) : [...atuais, colunaId];
    alterarPreferencias({
      ...preferencias,
      secoes: {
        ...preferencias.secoes,
        [secaoId]: {
          ...preferencias.secoes[secaoId],
          colunas: secao.colunas.map((coluna) => coluna.id).filter((id) => marcadas.includes(id)),
        },
      },
    });
  };

  const marcarTodas = (secaoId: string, todas: boolean) => {
    if (!preferencias || !documento) return;
    const secao = documento.secoes.find((item) => item.id === secaoId);
    if (!secao) return;
    alterarPreferencias({
      ...preferencias,
      secoes: { ...preferencias.secoes, [secaoId]: { ...preferencias.secoes[secaoId], colunas: todas ? secao.colunas.map((coluna) => coluna.id) : [] } },
    });
  };

  const alternarSecao = (secaoId: string) => {
    if (!preferencias) return;
    const atual = preferencias.secoes[secaoId];
    alterarPreferencias({ ...preferencias, secoes: { ...preferencias.secoes, [secaoId]: { ...atual, ativa: !atual.ativa } } });
  };

  const restaurarPadrao = () => {
    if (!documento) return;
    alterarPreferencias(preferenciasPadrao(documento.secoes));
  };

  const mensagemErro = erro || erroMontagem;

  return (
    <div className="relatorio-preview">
      <div className="relatorio-preview__barra">
        <button type="button" className="btn-secondary relatorio-preview__botao" onClick={onFechar}>
          <ArrowLeft size={18} /> {rotuloFechar}
        </button>
        <div className="relatorio-preview__titulo">
          <strong>{documento?.titulo || 'Relatório'}</strong>
          <span>
            {montando || carregando
              ? 'Montando as folhas...'
              : paginas.length
                ? `${paginas.length} ${paginas.length === 1 ? 'folha' : 'folhas'} A4`
                : ''}
          </span>
        </div>
        <div className="relatorio-preview__acoes">
          <button type="button" className="btn-secondary relatorio-preview__botao" onClick={salvarExcel} disabled={!podeAgir} title="Botão separado: o padrão do relatório é o PDF">
            <FileSpreadsheet size={18} /> Salvar em Excel
          </button>
          <button type="button" className="btn-secondary relatorio-preview__botao" onClick={salvarPdf} disabled={!podeAgir}>
            <FileDown size={18} /> Salvar PDF
          </button>
          <button type="button" className="btn-primary relatorio-preview__botao" onClick={imprimir} disabled={!podeAgir}>
            <Printer size={18} /> Imprimir
          </button>
        </div>
      </div>

      <div className="relatorio-preview__corpo">
        <aside className="relatorio-preview__painel">
          <div className="relatorio-preview__painel-titulo">
            <SlidersHorizontal size={17} /> O que sai no relatório
          </div>
          {documento && preferencias && (
            <>
              {documento.indicadores && documento.indicadores.length > 0 && (
                <label className="relatorio-preview__opcao relatorio-preview__opcao--destaque">
                  <input type="checkbox" checked={preferencias.indicadores} onChange={() => alterarPreferencias({ ...preferencias, indicadores: !preferencias.indicadores })} />
                  <span>Quadro de totais no topo</span>
                </label>
              )}
              {documento.secoes.map((secao) => {
                const pref = preferencias.secoes[secao.id];
                if (!pref) return null;
                const desativada = secao.opcional && !pref.ativa;
                return (
                  <div key={secao.id} className="relatorio-preview__grupo">
                    {secao.opcional ? (
                      <label className="relatorio-preview__opcao relatorio-preview__opcao--destaque">
                        <input type="checkbox" checked={pref.ativa} onChange={() => alternarSecao(secao.id)} />
                        <span>{secao.titulo}</span>
                      </label>
                    ) : (
                      <div className="relatorio-preview__grupo-titulo">{secao.titulo}</div>
                    )}
                    {!desativada && (
                      <>
                        <div className="relatorio-preview__atalhos">
                          <button type="button" onClick={() => marcarTodas(secao.id, true)}>Marcar todas</button>
                          <button type="button" onClick={() => marcarTodas(secao.id, false)}>Desmarcar todas</button>
                        </div>
                        {secao.colunas.map((coluna) => (
                          <label key={coluna.id} className="relatorio-preview__opcao">
                            <input type="checkbox" checked={pref.colunas.includes(coluna.id)} onChange={() => alternarColuna(secao.id, coluna.id)} />
                            <span>{coluna.titulo}</span>
                          </label>
                        ))}
                        {pref.colunas.length === 0 && (
                          <p className="relatorio-preview__aviso">Nenhuma coluna marcada: esta parte não sai no relatório.</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <button type="button" className="btn-secondary relatorio-preview__restaurar" onClick={restaurarPadrao}>
                <RotateCcw size={15} /> Restaurar padrão
              </button>
              <p className="relatorio-preview__nota">A escolha fica guardada neste computador para as próximas vezes.</p>
            </>
          )}
        </aside>

        <main className="relatorio-preview__folhas">
          {mensagemErro ? (
            <div className="relatorio-preview__mensagem relatorio-preview__mensagem--erro" role="alert">{mensagemErro}</div>
          ) : nadaMarcado ? (
            <div className="relatorio-preview__mensagem">Marque pelo menos uma coluna ao lado para montar o relatório.</div>
          ) : carregando || (!paginas.length && montando) || !documento ? (
            <div className="relatorio-preview__mensagem"><Loader2 className="spin-icon" size={30} /> Montando o relatório...</div>
          ) : (
            <div className={`relatorio-preview__lista${montando ? ' relatorio-preview__lista--atualizando' : ''}`}>
              {paginas.map((src, indice) => (
                <img key={indice} src={src} alt={`Folha ${indice + 1} de ${paginas.length}`} className="relatorio-preview__folha" />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default RelatorioPreview;

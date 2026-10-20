import type { ColunaRelatorio, IndicadorRelatorio, SecaoRelatorio } from './relatorioPdfDomain';
import { parteDoSaldoVenceu, temDivida, type ResumoCashbackDoCliente } from './cashbackDomain';

/*
 * RELATORIO DO CASHBACK (fase 3, 20/10/2026): "Mais opcoes › Relatorio" da
 * tela Comercial › Cashback. Sai o que a lista mostra (filtro e busca ja'
 * aplicados pela tela), no padrao PDF com colunas por caixa de marcar.
 */

export interface ClienteDoRelatorioCashback {
  id: string;
  nome: string;
  codigo?: string;
  documento?: string;
  telefone?: string;
  resumo: ResumoCashbackDoCliente;
  atualizadoEmMs: number;
}

export interface DocumentoRelatorioCashback {
  titulo: string;
  periodo: string;
  filtros: string[];
  indicadores: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
}

const dataBr = (dia: string | null): string => (dia && /^\d{4}-\d{2}-\d{2}/.test(dia) ? dia.slice(0, 10).split('-').reverse().join('/') : '');
const reais = (centavos: number): string => `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100)}`;
const inteiro = (n: number): string => new Intl.NumberFormat('pt-BR').format(n);

export const montarDocumentoCashback = (
  clientes: ClienteDoRelatorioCashback[],
  opcoes: { hoje: string; filtrosAplicados: string[] },
): DocumentoRelatorioCashback => {
  const emReais = clientes.filter((c) => c.resumo.modelo === 'reais');
  const emPontos = clientes.filter((c) => c.resumo.modelo === 'pontos');
  const saldoReais = emReais.reduce((s, c) => s + Math.max(0, c.resumo.saldoCentavos), 0);
  const saldoPontos = emPontos.reduce((s, c) => s + Math.max(0, c.resumo.saldoPontos), 0);
  const dividaReais = emReais.reduce((s, c) => s + c.resumo.dividaCentavos, 0);
  const dividaPontos = emPontos.reduce((s, c) => s + c.resumo.dividaPontos, 0);

  const colunas: ColunaRelatorio<ClienteDoRelatorioCashback>[] = [
    { id: 'codigo', titulo: 'Código', tipo: 'texto', largura: 14, valor: (c) => c.codigo || '' },
    { id: 'cliente', titulo: 'Cliente', tipo: 'texto', largura: 56, valor: (c) => c.nome },
    { id: 'documento', titulo: 'CPF/CNPJ', tipo: 'texto', largura: 28, padrao: false, valor: (c) => c.documento || '' },
    { id: 'telefone', titulo: 'Telefone', tipo: 'texto', largura: 26, padrao: false, valor: (c) => c.telefone || '' },
    { id: 'saldoReais', titulo: 'Saldo (R$)', tipo: 'moeda', largura: 22, valor: (c) => (c.resumo.modelo === 'reais' ? c.resumo.saldoCentavos : 0) },
    { id: 'saldoPontos', titulo: 'Saldo (pontos)', tipo: 'inteiro', largura: 20, valor: (c) => (c.resumo.modelo === 'pontos' ? c.resumo.saldoPontos : 0) },
    {
      id: 'negativo', titulo: 'Saldo negativo', tipo: 'texto', largura: 24, padrao: false,
      valor: (c) => (!temDivida(c.resumo) ? '' : c.resumo.modelo === 'pontos' ? `${inteiro(c.resumo.dividaPontos)} pontos` : reais(c.resumo.dividaCentavos)),
    },
    {
      id: 'vencimento', titulo: 'Próximo vencimento', tipo: 'texto', largura: 26,
      valor: (c) => (c.resumo.proximoVencimento
        ? `${dataBr(c.resumo.proximoVencimento)}${parteDoSaldoVenceu(c.resumo, opcoes.hoje) ? ' (venceu)' : ''}`
        : 'Não vence'),
    },
    { id: 'atualizado', titulo: 'Atualizado em', tipo: 'dataHora', largura: 26, padrao: false, valor: (c) => (c.atualizadoEmMs ? new Date(c.atualizadoEmMs).toISOString() : '') },
  ];

  const indicadores: IndicadorRelatorio[] = [{ rotulo: 'Clientes', valor: String(clientes.length) }];
  if (emReais.length) indicadores.push({ rotulo: 'Saldo em R$', valor: reais(saldoReais) });
  if (emPontos.length) indicadores.push({ rotulo: 'Saldo em pontos', valor: inteiro(saldoPontos) });
  if (dividaReais > 0) indicadores.push({ rotulo: 'Saldo negativo (R$)', valor: reais(dividaReais) });
  if (dividaPontos > 0) indicadores.push({ rotulo: 'Saldo negativo (pontos)', valor: inteiro(dividaPontos) });

  return {
    titulo: 'Cashback dos clientes',
    periodo: `Posição em ${dataBr(opcoes.hoje)}`,
    filtros: opcoes.filtrosAplicados,
    indicadores,
    secoes: [{
      id: 'cashback',
      titulo: 'Clientes',
      colunas,
      linhas: clientes,
      unidade: ['cliente', 'clientes'],
      mensagemVazia: 'Nenhum cliente com cashback nesta lista.',
    } as SecaoRelatorio],
  };
};

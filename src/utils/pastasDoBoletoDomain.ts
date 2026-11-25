/**
 * Pastas do computador para os boletos (25/11/2026, pedido do dono pela Embala
 * Minas): "configurar o caminho de onde o boleto sera' salvo (remessa) no
 * computador, e configurar a pasta de retorno tambem, que ai' o sistema sozinho
 * ja' iria ver que chegou um arquivo de retorno novo la' na pasta, e exibiria um
 * popup".
 *
 * O navegador (Chrome/Edge, inclusive o sistema instalado como aplicativo) deixa
 * a pessoa escolher uma pasta e lembra dela neste computador. Ele pede de novo a
 * liberacao depois de reiniciar o navegador (um clique). Regra pura aqui; o
 * acesso as pastas fica em pastasDoBoletoStorage.ts.
 */

export type TipoDePasta = 'remessa' | 'retorno';

export interface ArquivoDaPasta {
  name: string;
  size: number;
  lastModified: number;
}

/** Identidade do arquivo para saber se ja' foi importado: nome + tamanho + data. */
export const chaveDoArquivo = (arquivo: ArquivoDaPasta): string => (
  `${arquivo.name}|${arquivo.size}|${arquivo.lastModified}`
);

/** Arquivo de retorno do Sicoob: .RET (CNAB 240/400) ou .TXT, ate' 5 MB. */
export const ehArquivoDeRetorno = (arquivo: ArquivoDaPasta): boolean => (
  /\.(ret|txt)$/i.test(arquivo.name) && arquivo.size > 0 && arquivo.size <= 5 * 1024 * 1024
);

/**
 * Retornos que chegaram e ainda nao foram importados (nem dispensados) neste
 * computador, do mais antigo para o mais novo (importar na ordem do banco).
 */
export const retornosNovos = <T extends ArquivoDaPasta>(arquivos: T[], jaVistos: ReadonlySet<string>): T[] => (
  arquivos
    .filter((a) => ehArquivoDeRetorno(a) && !jaVistos.has(chaveDoArquivo(a)))
    .sort((a, b) => a.lastModified - b.lastModified)
);

/** Texto do que esta' configurado, para a janela das pastas. */
export const textoDaPasta = (nome: string | null, permissao: 'granted' | 'prompt' | 'denied' | null): string => {
  if (!nome) return 'Nenhuma pasta escolhida.';
  if (permissao === 'granted') return `Pasta "${nome}" (liberada).`;
  if (permissao === 'denied') return `Pasta "${nome}" (o navegador recusou o acesso: escolha a pasta de novo).`;
  return `Pasta "${nome}" (clique em "Liberar" para o sistema usar neste computador).`;
};

/** Ate' quantos arquivos ja' vistos ficam lembrados (os mais novos). */
export const LIMITE_DE_ARQUIVOS_LEMBRADOS = 500;

export const lembrarArquivos = (lista: string[], novos: string[]): string[] => {
  const todos = [...lista.filter((k) => !novos.includes(k)), ...novos];
  return todos.slice(-LIMITE_DE_ARQUIVOS_LEMBRADOS);
};

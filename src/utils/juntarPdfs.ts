/**
 * Junta varios PDFs num so', na ordem recebida (2026-10-01, pedido do dono:
 * "imprimir as emitidas" do lote de NF-e em vez de salvar uma por uma).
 *
 * A pdf-lib so' e' carregada quando alguem usa -- nao pesa na abertura do sistema.
 */
export const juntarPdfs = async (arquivos: Blob[]): Promise<Blob> => {
  const { PDFDocument } = await import('pdf-lib');
  const final = await PDFDocument.create();
  for (const arquivo of arquivos) {
    const origem = await PDFDocument.load(await arquivo.arrayBuffer(), { ignoreEncryption: true });
    const paginas = await final.copyPages(origem, origem.getPageIndices());
    paginas.forEach((pagina) => final.addPage(pagina));
  }
  const bytes = await final.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
};

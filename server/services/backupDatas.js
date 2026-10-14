/**
 * DATAS DO BACKUP VOLTAM COMO DATA (2026-10-14).
 *
 * O backup grava os documentos em JSON. Um Timestamp do Firestore vira
 * `{ "_seconds": ..., "_nanoseconds": ... }` no arquivo, e a restauracao
 * gravava isso de volta como um MAPA comum -- a empresa restaurada ficava com
 * `createdAt` (e toda data do tipo Timestamp) que nao e' mais data:
 *  - consulta por periodo (`createdAt >= ...`) nao acha o documento, entao
 *    ele some das listas que abrem no mes atual (Notas Fiscais, OS...);
 *  - tela que chama `.toDate()` nesse campo quebra.
 *
 * Aqui o mapa com exatamente esses dois numeros volta a ser Timestamp antes
 * de gravar. O resto do documento passa igual.
 */

const ehDataDoBackup = (valor) => (
  valor !== null
  && typeof valor === 'object'
  && !Array.isArray(valor)
  && Object.keys(valor).length === 2
  && Number.isInteger(valor._seconds)
  && Number.isInteger(valor._nanoseconds)
);

/**
 * Devolve uma copia de `valor` com as datas do backup convertidas em
 * `Timestamp` (a classe vem de fora: `admin.firestore.Timestamp`).
 */
const restaurarDatasDoBackup = (valor, Timestamp) => {
  if (ehDataDoBackup(valor)) return new Timestamp(valor._seconds, valor._nanoseconds);
  if (Array.isArray(valor)) return valor.map((item) => restaurarDatasDoBackup(item, Timestamp));
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, restaurarDatasDoBackup(item, Timestamp)]));
  }
  return valor;
};

module.exports = { restaurarDatasDoBackup };

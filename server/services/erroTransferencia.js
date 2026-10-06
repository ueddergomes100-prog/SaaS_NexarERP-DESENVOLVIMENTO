/** Erro com status HTTP e mensagem para o usuario (transferencias entre filiais). */
class ErroTransferencia extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { ErroTransferencia };

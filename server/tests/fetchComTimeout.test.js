const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchComTimeout, ErroTimeout, ErroConexao, PERFIS } = require('../utils/fetchComTimeout');

const subirServidor = (handler) => new Promise((resolve) => {
  const servidor = http.createServer(handler);
  servidor.listen(0, '127.0.0.1', () => resolve({
    servidor,
    url: `http://127.0.0.1:${servidor.address().port}`,
    fechar: () => new Promise((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); }),
  }));
});

test('resposta normal passa direto', async () => {
  const { url, fechar } = await subirServidor((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    const resposta = await fetchComTimeout(url, { method: 'GET' }, { timeoutMs: 2000, servico: 'Teste' });
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { ok: true });
  } finally {
    await fechar();
  }
});

test('servidor que nunca responde vira ErroTimeout 504 em portugues', async () => {
  const { url, fechar } = await subirServidor(() => { /* nunca responde */ });
  try {
    await assert.rejects(
      () => fetchComTimeout(url, {}, { timeoutMs: 150, servico: 'A Spedy' }),
      (erro) => {
        assert.ok(erro instanceof ErroTimeout);
        assert.equal(erro.status, 504);
        assert.match(erro.message, /A Spedy não respondeu em 1 segundos?/);
        return true;
      },
    );
  } finally {
    await fechar();
  }
});

test('conexao recusada vira ErroConexao 502 em portugues', async () => {
  await assert.rejects(
    () => fetchComTimeout('http://127.0.0.1:1/', {}, { timeoutMs: 2000, servico: 'A Receita Federal' }),
    (erro) => {
      assert.ok(erro instanceof ErroConexao);
      assert.equal(erro.status, 502);
      assert.match(erro.message, /Não foi possível conectar a A Receita Federal/);
      return true;
    },
  );
});

test('perfis tem tempo limite e nome do servico', () => {
  for (const [nome, perfil] of Object.entries(PERFIS)) {
    assert.ok(perfil.timeoutMs >= 10000 && perfil.timeoutMs <= 120000, `${nome} fora da faixa`);
    assert.ok(perfil.servico.length > 3, `${nome} sem nome de servico`);
  }
  assert.ok(PERFIS.spedyEmissao.timeoutMs > PERFIS.spedyLeitura.timeoutMs, 'emissao espera mais que leitura');
});

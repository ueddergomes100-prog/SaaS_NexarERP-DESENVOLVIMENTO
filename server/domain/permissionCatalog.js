"use strict";
/**
 * Catalogo de permissao GRANULAR do Funcionario (id no formato dominio.acao),
 * gravado em usuarios/{id}.permissoes e checado em firestore.rules +
 * routeAccess.ts (`routePermission`) + .includes() espalhados pelas telas.
 *
 * Deliberadamente um vocabulario DIFERENTE do MODULE_GROUPS de
 * src/utils/moduleCatalog.ts -- aquele controla o bloqueio de modulo por
 * plano SaaS (SuperAdmin, `routeModule`); este controla o que cada
 * funcionario pode fazer dentro da empresa.
 *
 * REGRA PERMANENTE: toda tela/permissao nova precisa entrar AQUI e em
 * MODULE_GROUPS, e ter uma branch correspondente em routeAccess.ts -- senao
 * a tela fica acessivel por URL direta mesmo sem a permissao (auditoria
 * 2026-08-05).
 *
 * Extraido de um literal embutido em Configuracoes.tsx em 2026-08-18, quando
 * a tela de Usuarios passou a definir permissoes tambem. Ter a lista em dois
 * componentes era garantia de divergencia com o tempo.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.estadoDaSelecao = exports.desmarcarPermissoes = exports.marcarPermissoes = exports.PERMISSAO_INCLUIR_VENDEDOR = exports.PERMISSAO_PRODUTO_AVANCADO = exports.PERMISSAO_LIBERAR_DESCONTO = exports.permissionLabelMap = exports.PERMISSION_CATALOG = exports.PERMISSION_GROUPS = void 0;
/**
 * Agrupado por area para caber num popup sem virar uma parede de 41 toggles.
 * A ordem dos grupos segue o fluxo de uso do sistema (operacao -> apoio ->
 * administracao), nao a ordem alfabetica.
 */
exports.PERMISSION_GROUPS = [
    {
        // APLICATIVO MOBILE (26/10/2026, pedido do dono): tudo do app num bloco so', uma
        // chave por tela. Tela nova do app entra AQUI. As chaves `app.*` sao novas
        // (quem nunca teve o app gravado conta com todas -- permissoesAppDomain.ts);
        // OS no app, Entregas e Pedir troca mantem o id de antes, so' mudaram de grupo.
        // A chave do app nunca da' o que a pessoa nao tem no sistema: Contas a Pagar no
        // app tambem precisa de "Financeiro: Contas a Pagar", e assim por diante.
        grupo: 'Aplicativo mobile',
        itens: [
            { id: 'app.pedido', label: 'App: Novo Pedido e Meus Pedidos', color: '#8b5cf6' },
            { id: 'app.orcamento', label: 'App: Novo Orçamento', color: '#8b5cf6' },
            { id: 'app.preco', label: 'App: Consultar Preço', color: '#8b5cf6' },
            // Nao vem marcada para ninguem (permissoesAppDomain.ts): mexe no valor da venda.
            { id: 'app.alterar_preco', label: 'App: Alterar o preço do item (pedido e orçamento)', color: '#ef4444' },
            { id: 'app.clientes', label: 'App: Consultar Cliente', color: '#8b5cf6' },
            // 27/11/2026: o saldo em aberto do cliente na consulta. Vem marcada com a de cima (pacote 'app-1').
            { id: 'app.debito_cliente', label: 'App: Ver o débito do cliente (saldo em aberto na consulta do cliente)', color: '#8b5cf6' },
            // Nao vem marcada para ninguem (25/11/2026): sem ela, quem decide o destino do
            // valor da devolucao e' o escritorio, na confirmacao. Conferida no servidor.
            { id: 'app.devolucao_destino', label: 'App: Devolução — escolher para onde vai o valor (crédito, caixa ou banco)', color: '#ef4444' },
            { id: 'vendas.troca_solicitar', label: 'App: Trocas — pedir troca e Minhas Trocas', color: '#8b5cf6' },
            { id: 'mecanica.os_app', label: 'App: OS (técnico) — ver e atender pelo celular', color: '#8b5cf6' },
            { id: 'mecanica.os_app_abrir', label: 'App: OS — abrir OS nova no campo', color: '#8b5cf6' },
            { id: 'operacoes.entregas_app', label: 'App: Entregas (motorista) — registrar entrega, recebido e canhoto', color: '#8b5cf6' },
            // Troca do administrador (25/11/2026): so' o dono/administrador via todas; nao vem com nada.
            { id: 'operacoes.entregas_app_todas', label: 'App: Entregas — ver as rotas de todos os motoristas', color: '#8b5cf6' },
            { id: 'app.conferencia', label: 'App: Conferência (precisa de Expedição)', color: '#8b5cf6' },
            { id: 'app.balanco', label: 'App: Balanço — contar (precisa de Estoque: Balanço — contar)', color: '#8b5cf6' },
            { id: 'app.liberacoes', label: 'App: Liberações de desconto (precisa de Aprovar Desconto)', color: '#8b5cf6' },
            { id: 'app.emitir_nota', label: 'App: Emitir Nota Fiscal (precisa de Fiscal: emitir)', color: '#8b5cf6' },
            { id: 'app.contas_pagar', label: 'App: Contas a Pagar (precisa de Financeiro: Contas a Pagar)', color: '#8b5cf6' },
            { id: 'app.contas_receber', label: 'App: Contas a Receber (precisa de Financeiro: Contas a Receber)', color: '#8b5cf6' },
        ],
    },
    {
        grupo: 'Visão Geral',
        itens: [
            // Acesso a TELA (bloqueia /dashboard inteiro sem ela -- ver
            // routeAccess.ts). Deliberadamente separada de dashboard.valores,
            // que so controla os numeros financeiros DENTRO da tela: um
            // funcionario pode ter acesso ao dashboard operacional sem ver
            // dinheiro, mas sem esta aqui ele nao abre a tela de jeito nenhum.
            { id: 'dashboard.acesso', label: 'Dashboard: Acesso à Tela', color: '#10b981' },
            { id: 'dashboard.valores', label: 'Dashboard: Visão Financeira', color: '#10b981' },
        ],
    },
    {
        grupo: 'Vendas',
        itens: [
            { id: 'vendas.pedidos', label: 'Vendas: Pedidos de Venda', color: '#f59e0b' },
            // Separadas de vendas.pedidos em 2026-08-27: as 3 telas dividiam o
            // mesmo id (marcar Pedidos de Venda liberava PDV e Minhas Vendas
            // tambem, sem controle independente -- achado pelo usuario).
            { id: 'vendas.minhas_vendas', label: 'Vendas: Minhas Vendas', color: '#f59e0b' },
            { id: 'vendas.pdv', label: 'Vendas: Frente de Caixa (PDV)', color: '#f59e0b' },
            // Funcionario caixa (19/10/2026): entra, no sistema ou no app /caixa, direto
            // na Frente de Caixa e so' nela, com o mesmo usuario e senha. Ver
            // src/utils/frenteDeCaixaDomain.ts.
            { id: 'vendas.so_caixa', label: 'Vendas: Só a Frente de Caixa (entra direto no caixa, sem o sistema)', color: '#f59e0b' },
            { id: 'vendas.alterar', label: 'Vendas: Alterar Pedidos', color: '#f59e0b' },
            { id: 'vendas.excluir', label: 'Vendas: Excluir Pedidos', color: '#ef4444' },
            { id: 'vendas.devolucao', label: 'Vendas: Devolução de Venda', color: '#ef4444' },
            // Devolucao escolhendo cliente e produtos (25/11/2026, Embala Minas): sem pedido
            // (comprou antes do sistema) gera credito pelo preco do cadastro; mudar o preco
            // e abater das parcelas do cliente tem permissao propria. Conferidas no servidor.
            { id: 'vendas.devolucao_sem_pedido', label: 'Vendas: Devolução sem pedido (cliente comprou antes do sistema)', color: '#ef4444' },
            { id: 'vendas.devolucao_alterar_preco', label: 'Vendas: Devolução sem pedido — alterar o preço do cadastro', color: '#ef4444' },
            { id: 'vendas.devolucao_abater_parcelas', label: 'Vendas: Devolução — abater o valor das parcelas em aberto do cliente', color: '#ef4444' },
            { id: 'vendas.promocoes', label: 'Vendas: Promoções (criar e encerrar)', color: '#f59e0b' },
            // Cashback (20/10/2026): so' consulta -- saldo, lotes e movimentos dos clientes.
            { id: 'vendas.cashback', label: 'Vendas: Cashback (ver o saldo dos clientes)', color: '#f59e0b' },
            // Trocas (reposicao sem cobranca de produto estragado). Duas permissoes de
            // proposito: quem PEDE a troca (vendedor no aplicativo, grupo "Aplicativo
            // mobile") nao e' quem APROVA e baixa o estoque (a loja). Ver docs/PLANO_TROCAS_VENDEDOR.md.
            { id: 'vendas.troca_gerenciar', label: 'Vendas: Trocas — Aprovar, entregar e ver relatório', color: '#ef4444' },
            // Condicional (cliente leva para provar). So' aparece no menu com "Trabalha com
            // condicional" ligado em Configuracoes. Ver src/utils/condicionalDomain.ts.
            { id: 'vendas.condicional', label: 'Vendas: Condicional (saída, devolução e fechamento)', color: '#f59e0b' },
            { id: 'vendas.pedidos_pendentes_editar', label: 'Vendas: Editar/Finalizar Pedido Pendente (agente)', color: '#f59e0b' },
            { id: 'vendas.pedidos_pendentes_editar_cliente', label: 'Vendas: Pendente — Editar Cliente', color: '#f59e0b' },
            { id: 'vendas.pedidos_pendentes_alterar_qtd', label: 'Vendas: Pendente — Alterar Quantidade', color: '#f59e0b' },
            { id: 'vendas.pedidos_pendentes_adicionar_item', label: 'Vendas: Pendente — Adicionar Produto', color: '#f59e0b' },
            { id: 'vendas.pedidos_pendentes_excluir_item', label: 'Vendas: Pendente — Excluir Item', color: '#ef4444' },
            // Pre-venda (balcao). Deliberadamente SEPARADO das permissoes de
            // "Pendente" acima, que valem so pro pedido vindo do agente de
            // WhatsApp: quem mexe na pre-venda do balcao nao deve ganhar acesso
            // ao pedido que chegou pelo WhatsApp de brinde, nem o contrario.
            // So valem se "Trabalha com pré-venda" estiver ligado nas
            // Configurações do sistema -- config libera pra empresa, permissao
            // decide quem.
            { id: 'vendas.pre_venda_criar', label: 'Vendas: Pré-venda — Gravar', color: '#f59e0b' },
            { id: 'vendas.pre_venda_editar', label: 'Vendas: Pré-venda — Editar em Aberto', color: '#f59e0b' },
            { id: 'vendas.pre_venda_finalizar', label: 'Vendas: Pré-venda — Transformar em venda (finalizar)', color: '#ef4444' },
            { id: 'vendas.pre_venda_cancelar', label: 'Vendas: Pré-venda — Cancelar', color: '#ef4444' },
            { id: 'vendas.pre_venda_relatorio', label: 'Vendas: Relatório de Pré-vendas em Aberto', color: '#f59e0b' },
            // Forma de pagamento escolhida pelo vendedor no app (25/11/2026, decisao do dono):
            // a pre-venda ja' vem com ela; trocar no faturamento so' com esta permissao.
            { id: 'vendas.trocar_forma_do_vendedor', label: 'Vendas: Pré-venda — Trocar a forma de pagamento escolhida pelo vendedor', color: '#ef4444' },
            // Idem: so vale com "Permitir alterar a forma de pagamento de venda
            // já finalizada" ligado nas Configurações.
            { id: 'vendas.alterar_pagamento_finalizada', label: 'Vendas: Alterar Pagamento de Venda Finalizada', color: '#ef4444' },
            // Gerenciar codigo e senha de vendedor (identificacao na venda). Quem
            // tem isto pode cadastrar a senha de OUTRA pessoa -- e portanto vender
            // no nome dela. Tratada como permissao vermelha por isso.
            { id: 'vendas.gerenciar_pin_vendedor', label: 'Vendas: Gerenciar Código/Senha de Vendedor', color: '#ef4444' },
            { id: 'vendas.orcamentos', label: 'Vendas: Orçamentos', color: '#f59e0b' },
            { id: 'vendas.orcamentos_alterar', label: 'Vendas: Alterar Orçamentos', color: '#f59e0b' },
            { id: 'vendas.orcamentos_excluir', label: 'Vendas: Excluir Orçamentos', color: '#ef4444' },
            { id: 'vendas.relatorios', label: 'Vendas: Relatórios', color: '#f59e0b' },
            { id: 'vendas.liberar_desconto', label: 'Vendas: Aprovar Desconto Acima do Limite', color: '#ef4444' },
            // Bonificacao (30/10/2026): item de brinde dentro do pedido -- ver bonificacaoDomain.ts.
            { id: 'vendas.bonificar', label: 'Vendas: Pode Bonificar (item de brinde no pedido)', color: '#ef4444' },
            // Item 15 (fase Vendas, 25/11/2026): uma permissao por acao. Ja' vem marcada
            // para quem usa a tela (pacote 'vendas-1', permissoesNovasDomain.ts). Sem a de
            // preco/data/vendedor/desconto, o valor fica no padrao, travado e conferido no servidor.
            { id: 'vendas.finalizar', label: 'Vendas: Finalizar venda (faturar)', color: '#ef4444' },
            { id: 'vendas.alterar_data', label: 'Vendas: Lançar venda com data diferente de hoje', color: '#ef4444' },
            { id: 'vendas.alterar_vendedor', label: 'Vendas: Escolher o vendedor da venda', color: '#f59e0b' },
            { id: 'vendas.alterar_preco', label: 'Vendas: Alterar o preço do item (computador)', color: '#ef4444' },
            // 26/11/2026 (decisao do dono): preco abaixo da tabela fica como preco, sem
            // virar desconto nem contar no limite. Nasce desmarcada; precisa tambem da de cima.
            { id: 'vendas.preco_sem_desconto', label: 'Vendas: Preço abaixo da tabela fica como preço (não vira desconto nem conta no limite)', color: '#ef4444' },
            { id: 'vendas.desconto', label: 'Vendas: Dar desconto no pedido (até o limite)', color: '#ef4444' },
            { id: 'vendas.cancelar', label: 'Vendas: Cancelar/Estornar venda finalizada', color: '#ef4444' },
            { id: 'vendas.alterar_transporte', label: 'Vendas: Corrigir transporte de venda finalizada', color: '#f59e0b' },
            { id: 'vendas.alterar_nota_fiscal', label: 'Vendas: Trocar pedido entre com e sem nota fiscal', color: '#ef4444' },
            { id: 'vendas.devolucao_estornar', label: 'Vendas: Estornar devolução de venda', color: '#ef4444' },
            { id: 'vendas.pedidos_pendentes_recusar', label: 'Vendas: Pendente — Recusar pedido', color: '#ef4444' },
            { id: 'vendas.imprimir', label: 'Vendas: Imprimir pedido, recibo e minuta', color: '#f59e0b' },
            { id: 'vendas.documentos_cobranca', label: 'Vendas: Emitir promissória, carnê e duplicata', color: '#f59e0b' },
            { id: 'vendas.pre_venda_relatorio_valores', label: 'Vendas: Pré-vendas em aberto — ver totais em valor', color: '#f59e0b' },
            // 26/11/2026 (pedido do dono): relatorio do caixa aberto, sem fechar. Vem marcada para quem usa o PDV (pacote 'pdv-1').
            { id: 'vendas.pdv_relatorio_caixa', label: 'Vendas: Frente de Caixa — relatório parcial do caixa (vendas, dinheiro e sangrias)', color: '#f59e0b' },
            // 28/11/2026 (pedido do dono): receber notinha (Contas a Receber) no caixa. Nasce desmarcada (decisao do dono).
            { id: 'vendas.pdv_receber_contas', label: 'Vendas: Frente de Caixa — receber contas do cliente (notinhas do Contas a Receber)', color: '#ef4444' },
            { id: 'vendas.importar', label: 'Vendas: Importar pedidos do sistema anterior', color: '#ef4444' },
            { id: 'vendas.orcamentos_recusar', label: 'Vendas: Recusar orçamento', color: '#ef4444' },
            { id: 'vendas.orcamentos_converter', label: 'Vendas: Converter orçamento em OS ou venda', color: '#f59e0b' },
            { id: 'vendas.orcamentos_preco', label: 'Vendas: Alterar preço e desconto no orçamento', color: '#ef4444' },
            { id: 'vendas.orcamentos_enviar', label: 'Vendas: Enviar orçamento ao cliente', color: '#f59e0b' },
            { id: 'vendas.condicional_saida', label: 'Vendas: Condicional — registrar saída', color: '#f59e0b' },
            { id: 'vendas.condicional_devolucao', label: 'Vendas: Condicional — registrar devolução', color: '#f59e0b' },
            { id: 'vendas.condicional_fechar', label: 'Vendas: Condicional — fechar e gerar a pré-venda', color: '#f59e0b' },
            { id: 'vendas.condicional_cancelar', label: 'Vendas: Condicional — cancelar', color: '#ef4444' },
            { id: 'vendas.troca_aprovar', label: 'Vendas: Trocas — aprovar ou recusar', color: '#ef4444' },
            { id: 'vendas.troca_entregar', label: 'Vendas: Trocas — entregar (baixa estoque)', color: '#ef4444' },
            { id: 'vendas.troca_cancelar', label: 'Vendas: Trocas — cancelar', color: '#ef4444' },
            { id: 'vendas.promocoes_encerrar', label: 'Vendas: Promoções — encerrar e reativar', color: '#f59e0b' },
            { id: 'vendas.cashback_relatorio', label: 'Vendas: Cashback — relatório de saldos', color: '#f59e0b' },
            // Item 15 (fase Administracao, 25/11/2026): blocos de venda das Configuracoes. So' o
            // dono/administrador mexia; nao vem com nada (pacote 'administracao-1'), menos a meta (vem
            // com "Admin: Configurações") e o cashback (vem com ela so' em empresa sem filiais).
            { id: 'vendas.limites_desconto', label: 'Vendas: Configurar limites de desconto e o modo de liberação', color: '#ef4444' },
            { id: 'vendas.parametros', label: 'Vendas: Parâmetros de venda (prazo de devolução e bloqueio do cliente por atraso)', color: '#ef4444' },
            { id: 'vendas.recursos', label: 'Vendas: Ligar e desligar recursos de venda (pré-venda, condicional, identificação do vendedor, venda sem estoque)', color: '#ef4444' },
            { id: 'vendas.bonificacao_configurar', label: 'Vendas: Configurar a bonificação (limite e tributação)', color: '#ef4444' },
            { id: 'vendas.cashback_configurar', label: 'Vendas: Cashback — configurar as regras', color: '#ef4444' },
            { id: 'vendas.metas', label: 'Vendas: Metas mensais dos vendedores', color: '#f59e0b' },
            { id: 'vendas.caixa_computadores', label: 'Vendas: Computadores do caixa — ativar e desativar', color: '#ef4444' },
        ],
    },
    {
        grupo: 'Serviços',
        itens: [
            { id: 'mecanica.os', label: 'Serviços: Ordens de Serviço', color: '#3b82f6' },
            { id: 'mecanica.os_alterar', label: 'Serviços: Alterar OS', color: '#3b82f6' },
            // OS no app (tecnico): no grupo "Aplicativo mobile".
            { id: 'mecanica.os_excluir', label: 'Serviços: Excluir OS', color: '#ef4444' },
            { id: 'mecanica.relatorios', label: 'Serviços: Relatórios', color: '#3b82f6' },
            // Item 15 (fase Estoque e cadastros, 25/11/2026): pacote 'estoque-1'. Trocar o tecnico
            // nao vem com nada (hoje so' o administrador troca).
            { id: 'mecanica.os_finalizar', label: 'Serviços: Finalizar OS (baixa estoque e gera financeiro)', color: '#3b82f6' },
            { id: 'mecanica.os_reabrir', label: 'Serviços: Reabrir OS finalizada', color: '#ef4444' },
            { id: 'mecanica.os_cancelar', label: 'Serviços: Cancelar OS', color: '#ef4444' },
            { id: 'mecanica.os_alterar_preco', label: 'Serviços: Alterar o preço do item na OS', color: '#3b82f6' },
            { id: 'mecanica.os_responsavel', label: 'Serviços: Trocar o técnico responsável da OS', color: '#3b82f6' },
            { id: 'mecanica.os_fotos', label: 'Serviços: Anexar e apagar fotos da OS', color: '#3b82f6' },
        ],
    },
    {
        grupo: 'Cadastros',
        itens: [
            { id: 'cadastros.clientes', label: 'Cadastros: Clientes', color: '#8b5cf6' },
            // Separada de cadastros.clientes em 2026-08-27: marcar Clientes
            // liberava Veiculos junto, sem controle independente.
            { id: 'cadastros.veiculos', label: 'Cadastros: Veículos', color: '#8b5cf6' },
            { id: 'cadastros.servicos', label: 'Cadastros: Serviços', color: '#8b5cf6' },
            { id: 'cadastros.categorias', label: 'Cadastros: Categorias', color: '#8b5cf6' },
            { id: 'cadastros.marcas', label: 'Cadastros: Marcas', color: '#8b5cf6' },
            { id: 'cadastros.unidades_medida', label: 'Cadastros: Unidades de Medida', color: '#8b5cf6' },
            { id: 'cadastros.grades', label: 'Cadastros: Grades de produto (tamanho, cor)', color: '#8b5cf6' },
            { id: 'cadastros.bandeiras_cartao', label: 'Cadastros: Bandeiras de Cartão', color: '#8b5cf6' },
            { id: 'cadastros.bancos', label: 'Cadastros: Bancos', color: '#8b5cf6' },
            { id: 'cadastros.fornecedores', label: 'Cadastros: Fornecedores', color: '#8b5cf6' },
            { id: 'cadastros.materia_prima', label: 'Cadastros: Matéria-Prima', color: '#8b5cf6' },
            { id: 'cadastros.vendedores', label: 'Cadastros: Vendedores (balcão)', color: '#8b5cf6' },
            // 21/10/2026 (pedido do dono): incluir e alterar vendedor sem ser o dono. Liberar
            // desconto e o app continuam so' com o dono/administrador (ver VendedoresList.tsx).
            { id: 'cadastros.vendedores_incluir', label: 'Cadastros: Vendedores — incluir e alterar', color: '#8b5cf6' },
            // Troca do administrador (25/11/2026): so' o papel fazia; nao vem com nada (o administrador que
            // o dono ainda nao salvou tem todas -- permissoesNovasDomain.ts, pacote 'administrador-1').
            { id: 'cadastros.vendedores_liberadores', label: 'Cadastros: Vendedores — liberar desconto e aplicativo no cadastro do vendedor', color: '#ef4444' },
            // Item 15 (fase Estoque e cadastros, 25/11/2026): pacote 'estoque-1' -- ja' vem marcadas
            // para quem tem a permissao da tela do cadastro.
            { id: 'cadastros.clientes_alterar', label: 'Cadastros: Clientes — incluir e alterar (alerta e padronizar nomes)', color: '#8b5cf6' },
            { id: 'cadastros.clientes_inativar', label: 'Cadastros: Clientes — inativar e excluir', color: '#ef4444' },
            { id: 'cadastros.clientes_importar', label: 'Cadastros: Clientes — importar planilha e histórico do sistema anterior', color: '#8b5cf6' },
            { id: 'cadastros.clientes_limite_credito', label: 'Cadastros: Clientes — alterar limite de crédito', color: '#ef4444' },
            { id: 'cadastros.fornecedores_alterar', label: 'Cadastros: Fornecedores — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.fornecedores_inativar', label: 'Cadastros: Fornecedores — inativar e excluir', color: '#ef4444' },
            { id: 'cadastros.fornecedores_importar', label: 'Cadastros: Fornecedores — importar planilha', color: '#8b5cf6' },
            { id: 'cadastros.servicos_alterar', label: 'Cadastros: Serviços — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.servicos_inativar', label: 'Cadastros: Serviços — inativar', color: '#ef4444' },
            { id: 'cadastros.servicos_preco', label: 'Cadastros: Serviços — alterar preço', color: '#8b5cf6' },
            { id: 'cadastros.servicos_comissao', label: 'Cadastros: Serviços — definir comissão', color: '#8b5cf6' },
            { id: 'cadastros.categorias_alterar', label: 'Cadastros: Categorias — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.categorias_inativar', label: 'Cadastros: Categorias — inativar', color: '#ef4444' },
            { id: 'cadastros.categorias_importar', label: 'Cadastros: Categorias — importar planilha', color: '#8b5cf6' },
            { id: 'cadastros.marcas_alterar', label: 'Cadastros: Marcas — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.marcas_inativar', label: 'Cadastros: Marcas — inativar', color: '#ef4444' },
            { id: 'cadastros.unidades_medida_alterar', label: 'Cadastros: Unidades de Medida — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.unidades_medida_inativar', label: 'Cadastros: Unidades de Medida — inativar', color: '#ef4444' },
            { id: 'cadastros.grades_alterar', label: 'Cadastros: Grades — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.grades_inativar', label: 'Cadastros: Grades — inativar', color: '#ef4444' },
            { id: 'cadastros.veiculos_alterar', label: 'Cadastros: Veículos — incluir e alterar', color: '#8b5cf6' },
            { id: 'cadastros.veiculos_inativar', label: 'Cadastros: Veículos — inativar', color: '#ef4444' },
            { id: 'cadastros.materia_prima_inativar', label: 'Cadastros: Matéria-Prima — inativar e excluir (zera o saldo)', color: '#ef4444' },
            { id: 'cadastros.materia_prima_custo', label: 'Cadastros: Matéria-Prima — alterar custo', color: '#8b5cf6' },
            { id: 'cadastros.materia_prima_importar', label: 'Cadastros: Matéria-Prima — importar planilha', color: '#8b5cf6' },
            { id: 'cadastros.relatorios', label: 'Cadastros: Relatórios dos cadastros (PDF e Excel)', color: '#8b5cf6' },
        ],
    },
    {
        grupo: 'Estoque',
        itens: [
            { id: 'cadastros.estoque', label: 'Estoque: Ver Lista de Produtos', color: '#0ea5e9' },
            // Separada de cadastros.estoque em 2026-08-28: marcar "Ver Lista"
            // liberava abrir/criar/excluir o cadastro inteiro do produto (custo,
            // margem, fornecedor) sem controle independente -- achado pelo usuario.
            { id: 'cadastros.estoque_alterar', label: 'Estoque: Abrir Cadastro de Produto', color: '#0ea5e9' },
            // Modo Avancado do cadastro (03/11/2026): compras, embalagens, composicao, atacado,
            // e-commerce e configuracoes avancadas. Dono, administrador e gerente ja' tinham.
            { id: 'estoque.produto_avancado', label: 'Estoque: Cadastro Avançado de Produto', color: '#0ea5e9' },
            { id: 'estoque.ajusteManual', label: 'Estoque: Ajuste Manual', color: '#0ea5e9' },
            // Balanco / inventario (21/10/2026): quem abre/confere/fecha e quem so' conta (app e computador).
            { id: 'estoque.balanco_gerenciar', label: 'Estoque: Balanço — abrir, conferir e fechar', color: '#0ea5e9' },
            { id: 'estoque.balanco_contar', label: 'Estoque: Balanço — contar', color: '#0ea5e9' },
            { id: 'estoque.relatorio', label: 'Estoque: Relatório de Estoque', color: '#0ea5e9' },
            { id: 'estoque.relatorioAjustes', label: 'Estoque: Relatório de Ajustes', color: '#0ea5e9' },
            // Movimentacao de produtos (26/10/2026): extrato de entradas e saidas de produtos, materias-primas e insumos.
            { id: 'estoque.movimentacao', label: 'Estoque: Movimentação de Produtos', color: '#0ea5e9' },
            { id: 'estoque.nota_avulsa', label: 'Estoque: Nota Avulsa (Compra Manual)', color: '#0ea5e9' },
            // 25/11/2026 (Embala Minas): o cheque do cliente sai da carteira e paga o fornecedor.
            // Conferida no servidor (server/services/repasseCheques.js).
            { id: 'estoque.nota_avulsa_cheque_cliente', label: 'Estoque: Nota Avulsa — pagar com cheque de cliente (repasse)', color: '#ef4444' },
            { id: 'estoque.precificacao', label: 'Estoque: Precificação (preços em lote)', color: '#0ea5e9' },
            { id: 'estoque.etiquetas', label: 'Estoque: Etiquetas (gerar e imprimir)', color: '#0ea5e9' },
            // Item 15 (fase Estoque e cadastros, 25/11/2026): pacote 'estoque-1'. Preco e custo de
            // produto ja' gravado; quem inclui o produto define os de partida.
            { id: 'estoque.produto_incluir', label: 'Estoque: Incluir produto', color: '#0ea5e9' },
            { id: 'estoque.estoque_inicial', label: 'Estoque: Informar estoque inicial ao incluir produto ou matéria-prima', color: '#ef4444' },
            { id: 'estoque.alterar_preco', label: 'Estoque: Alterar o preço de venda do produto', color: '#0ea5e9' },
            { id: 'estoque.alterar_custo', label: 'Estoque: Alterar o custo do produto', color: '#0ea5e9' },
            { id: 'estoque.ver_custo', label: 'Estoque: Ver custo e margem dos produtos', color: '#0ea5e9' },
            { id: 'estoque.produto_inativar', label: 'Estoque: Inativar e reativar produto (zera o saldo)', color: '#ef4444' },
            { id: 'estoque.produto_excluir', label: 'Estoque: Excluir produto sem movimentação', color: '#ef4444' },
            { id: 'estoque.padronizar_nomes', label: 'Estoque: Padronizar os nomes de todos os produtos', color: '#0ea5e9' },
            { id: 'estoque.importar', label: 'Estoque: Importar produtos, composição e dados fiscais (planilha)', color: '#0ea5e9' },
            { id: 'estoque.configurar_lista', label: 'Estoque: Escolher colunas e cartões da lista (vale para a filial)', color: '#0ea5e9' },
            { id: 'estoque.composicao', label: 'Estoque: Alterar a composição (receita) do produto', color: '#0ea5e9' },
            { id: 'estoque.comissao_desconto', label: 'Estoque: Definir comissão e desconto máximo do produto', color: '#0ea5e9' },
            { id: 'estoque.balanco_fechar', label: 'Estoque: Balanço — fechar e aplicar as diferenças', color: '#ef4444' },
            { id: 'estoque.balanco_cancelar', label: 'Estoque: Balanço — cancelar', color: '#0ea5e9' },
            { id: 'estoque.etiquetas_modelo', label: 'Estoque: Etiquetas — salvar o modelo padrão da filial', color: '#0ea5e9' },
            { id: 'estoque.nota_avulsa_cancelar', label: 'Estoque: Nota Avulsa — cancelar', color: '#ef4444' },
            { id: 'estoque.nota_avulsa_pagamento', label: 'Estoque: Nota Avulsa — lançar pagamento (banco e Contas a Pagar)', color: '#ef4444' },
        ],
    },
    {
        grupo: 'Produção e Expedição',
        itens: [
            { id: 'operacoes.producao', label: 'Produção: Ordens de Produção', color: '#f97316' },
            // Separada de operacoes.producao em 2026-08-27: marcar Ordens de
            // Producao liberava o Relatorio junto, sem controle independente.
            { id: 'operacoes.producao_relatorios', label: 'Produção: Relatório de Produção', color: '#f97316' },
            // Item 15 (fase Estoque e cadastros, 25/11/2026): pacote 'estoque-1'.
            { id: 'operacoes.producao_finalizar', label: 'Produção: Finalizar ordem (baixa componentes e dá entrada no acabado)', color: '#f97316' },
            { id: 'operacoes.producao_estornar', label: 'Produção: Estornar ordem finalizada', color: '#ef4444' },
            { id: 'operacoes.producao_cancelar', label: 'Produção: Cancelar ordem', color: '#ef4444' },
            { id: 'operacoes.expedicao', label: 'Expedição: Conferência de Mercadoria', color: '#14b8a6' },
            // Venda com entrega futura (23/10/2026): registrar entregas, nota de remessa e rota.
            { id: 'operacoes.entregas_futuras', label: 'Expedição: Entregas futuras (registrar entrega, nota de remessa e rota)', color: '#14b8a6' },
            // Controle de rota: motoristas e as despesas da viagem. Uma permissao
            // so' para as duas telas -- quem lanca a despesa e' quem cadastra o
            // motorista (a loja), nao faz sentido separar.
            { id: 'operacoes.rotas', label: 'Rotas: Motoristas e Despesas de Viagem', color: '#14b8a6' },
            { id: 'operacoes.romaneios', label: 'Romaneio de Entrega: montar rota, registrar entregas e acerto', color: '#14b8a6' },
            // 15/10/2026: rota ja' fechada volta a "Em rota" ou e' cancelada desfazendo tudo
            // (pedidos livres, despesas lancadas canceladas). Mesmo texto de
            // ROTULO_PERMISSAO_ROMANEIO_ENCERRADO (romaneioDomain.ts).
            { id: 'operacoes.romaneios_reabrir', label: 'Romaneio de Entrega: reabrir e cancelar depois de fechado', color: '#14b8a6' },
            // Troca do administrador (25/11/2026): era so' dono e administrador pelo papel.
            { id: 'operacoes.romaneios_configurar', label: 'Romaneio de Entrega: configurar motivos, tipos e formas', color: '#14b8a6' },
            // Item 15 (fase Vendas, 25/11/2026): pacote 'vendas-1'.
            { id: 'operacoes.expedicao_divergencia', label: 'Expedição: Fechar conferência com divergência', color: '#ef4444' },
            { id: 'operacoes.entregas_futuras_registrar', label: 'Expedição: Registrar entrega futura (a nota de remessa pede também Fiscal: Emitir)', color: '#14b8a6' },
            { id: 'operacoes.rotas_despesas', label: 'Rotas: Lançar despesas da viagem no financeiro', color: '#ef4444' },
            { id: 'operacoes.rotas_configurar', label: 'Rotas: Configurar tipos de despesa', color: '#14b8a6' },
            { id: 'operacoes.motoristas', label: 'Rotas: Cadastrar motoristas', color: '#14b8a6' },
            { id: 'operacoes.frota', label: 'Rotas: Cadastrar veículos da frota', color: '#14b8a6' },
            { id: 'operacoes.rotas_relatorio', label: 'Rotas: Relatório de custo por veículo', color: '#14b8a6' },
            // Entregas no app (motorista): no grupo "Aplicativo mobile".
        ],
    },
    {
        grupo: 'Financeiro',
        itens: [
            { id: 'financeiro.caixa', label: 'Financeiro: Fluxo de Caixa', color: '#10b981' },
            { id: 'financeiro.caixa_registros', label: 'Financeiro: Caixa (Sessões PDV)', color: '#10b981' },
            // Troca do administrador (25/11/2026): era so' dono e administrador pelo papel.
            { id: 'financeiro.caixa_fechar', label: 'Financeiro: Caixa (Sessões PDV) — fechar o caixa de outro operador e acertar a gaveta de dia anterior', color: '#ef4444' },
            { id: 'financeiro.banco', label: 'Financeiro: Banco (Conciliação de Cartão)', color: '#10b981' },
            // 26/11/2026: corrigir a taxa de uma parcela de cartao ainda a conciliar (as vezes a maquininha cobra diferente).
            { id: 'financeiro.cartao_taxa', label: 'Financeiro: Banco — alterar a taxa do cartão a conciliar', color: '#ef4444' },
            { id: 'financeiro.cheques', label: 'Financeiro: Cheques (Compensação)', color: '#10b981' },
            // 21/10/2026: caixas da loja (CAIXA, COFRE...) e transferencias caixa <-> banco.
            { id: 'financeiro.caixas', label: 'Financeiro: Caixas e Transferências (caixa, cofre e bancos)', color: '#10b981' },
            // 23/10/2026: despesas fixas, bens, rateio e preco pelo Sebrae (so' consulta e simula; nao muda preco).
            { id: 'financeiro.custos', label: 'Financeiro: Custos e Formação de Preço (despesas fixas, depreciação, preço pelo Sebrae)', color: '#10b981' },
            { id: 'financeiro.boletos', label: 'Financeiro: Boletos (Emissão, Remessa e Retorno)', color: '#10b981' },
            { id: 'financeiro.receber', label: 'Financeiro: Contas a Receber', color: '#10b981' },
            { id: 'financeiro.pagar', label: 'Financeiro: Contas a Pagar', color: '#10b981' },
            { id: 'financeiro.faturamento', label: 'Financeiro: Faturamento', color: '#10b981' },
            { id: 'financeiro.comissoes', label: 'Financeiro: Comissões', color: '#10b981' },
            { id: 'financeiro.estornar', label: 'Financeiro: Estornar Pagamento/Recebimento', color: '#10b981' },
            // 2026-10-15: parcela a receber com valor diferente da venda (nota cheia,
            // boleto com desconto). Conferida no servidor (rota /financeiro/alterar-valor).
            { id: 'financeiro.alterar_valor_documento', label: 'Financeiro: Alterar Valor de Documentos (parcelas a receber)', color: '#10b981' },
            // 2026-10-15: juntar parcelas em aberto de um cliente num documento novo (e desfazer).
            // Conferida no servidor (rotas /financeiro/renegociar e /renegociacao/desfazer).
            { id: 'financeiro.renegociar', label: 'Financeiro: Renegociar Documentos (juntar parcelas a receber)', color: '#10b981' },
            // 2026-10-15: desconto no "Dar Baixa" e na baixa em lote (Receber e Pagar). Conferida
            // no servidor; mesmo texto de ROTULO_PERMISSAO_DESCONTO_NA_BAIXA (ajustesDaBaixaDomain.ts).
            { id: 'financeiro.desconto_baixa', label: 'Financeiro: dar desconto na baixa (Contas a Receber e a Pagar)', color: '#10b981' },
            // Item 15 da Embala Minas, fase 1 (25/11/2026): uma permissao por acao, conferida
            // no servidor. Ja' vem marcada para quem tem Contas a Receber/Pagar e ainda nao
            // teve as permissoes salvas de novo (pacote 'financeiro-1', permissoesNovasDomain.ts).
            { id: 'financeiro.receber_baixar', label: 'Financeiro: Contas a Receber — dar baixa (receber)', color: '#10b981' },
            { id: 'financeiro.pagar_baixar', label: 'Financeiro: Contas a Pagar — dar baixa (pagar)', color: '#10b981' },
            { id: 'financeiro.baixa_juros_multa', label: 'Financeiro: alterar juros e multa na baixa (sem ela, ficam no padrão da filial)', color: '#10b981' },
            { id: 'financeiro.baixa_data_anterior', label: 'Financeiro: dar baixa com data anterior a hoje (Contas a Receber e a Pagar)', color: '#10b981' },
            { id: 'financeiro.baixa_lote', label: 'Financeiro: baixa em lote (Contas a Receber e a Pagar)', color: '#10b981' },
            { id: 'financeiro.receber_lancar', label: 'Financeiro: Contas a Receber — lançar conta à mão', color: '#10b981' },
            { id: 'financeiro.receber_editar', label: 'Financeiro: Contas a Receber — alterar vencimento e dados da conta', color: '#10b981' },
            { id: 'financeiro.receber_cancelar', label: 'Financeiro: Contas a Receber — cancelar conta', color: '#10b981' },
            { id: 'financeiro.categorias', label: 'Financeiro: criar categoria no plano de contas', color: '#10b981' },
            { id: 'financeiro.acerto_fornecedor', label: 'Financeiro: Acerto com fornecedor (baixa no Receber e no Pagar sem caixa)', color: '#10b981' },
            // Item 15, fase 2 (25/11/2026): ja' vem marcadas para quem usa a tela (pacote
            // 'financeiro-2'). Lancar/alterar/cancelar despesa e abater com credito gravam
            // pelo servidor; recibo, WhatsApp, relatorios e importar sao conferidos na tela.
            { id: 'financeiro.pagar_lancar', label: 'Financeiro: Contas a Pagar — lançar despesa', color: '#10b981' },
            { id: 'financeiro.pagar_editar', label: 'Financeiro: Contas a Pagar — alterar despesa (valor, vencimento e dados)', color: '#10b981' },
            { id: 'financeiro.pagar_cancelar', label: 'Financeiro: Contas a Pagar — cancelar despesa', color: '#10b981' },
            { id: 'financeiro.baixa_credito_cliente', label: 'Financeiro: Contas a Receber — abater conta com crédito do cliente', color: '#10b981' },
            { id: 'financeiro.recibo', label: 'Financeiro: Contas a Receber — emitir recibo de pagamento', color: '#10b981' },
            { id: 'financeiro.cobrar_whatsapp', label: 'Financeiro: Contas a Receber — cobrar cliente pelo WhatsApp', color: '#10b981' },
            { id: 'financeiro.creditos_ver', label: 'Financeiro: ver os créditos dos clientes (e o que o fornecedor deve) e de onde vem cada um', color: '#10b981' },
            { id: 'financeiro.relatorios', label: 'Financeiro: relatórios (PDF e Excel) das telas do Financeiro', color: '#10b981' },
            { id: 'financeiro.importar_titulos', label: 'Financeiro: importar títulos de planilha (Contas a Receber e a Pagar)', color: '#10b981' },
            // Item 15 (fase Administracao, 25/11/2026): blocos financeiros das Configuracoes. O plano
            // de contas vem com "Admin: Configurações" em empresa sem filiais; os da filial nao vem com nada.
            { id: 'financeiro.plano_contas', label: 'Financeiro: Plano de contas (categorias de receita e despesa)', color: '#10b981' },
            { id: 'financeiro.pix_pedido', label: 'Financeiro: Chave Pix impressa no pedido', color: '#ef4444' },
            { id: 'financeiro.comissao_padrao', label: 'Financeiro: Comissão padrão do sistema e meta de faturamento', color: '#ef4444' },
            { id: 'financeiro.formas_pagamento', label: 'Financeiro: Formas de pagamento aceitas (ordem, ocultas e consumidor final)', color: '#ef4444' },
        ],
    },
    {
        grupo: 'Fiscal e Utilitários',
        itens: [
            { id: 'fiscal.emitir', label: 'Fiscal: Emitir Nota Fiscal', color: '#f59e0b' },
            { id: 'fiscal.entrada', label: 'Fiscal: Entrada de XML', color: '#f59e0b' },
            // Separada de fiscal.entrada em 2026-08-27: marcar Entrada de XML
            // liberava o Historico de Entradas junto, sem controle independente.
            { id: 'fiscal.entrada_historico', label: 'Fiscal: Histórico de Entradas', color: '#f59e0b' },
            { id: 'fiscal.excluir', label: 'Fiscal: Excluir/Cancelar Nota Fiscal', color: '#ef4444' },
            // Relatorio do contador (20/10/2026): notas de saida e entrada por CFOP, operacao e situacao.
            { id: 'fiscal.relatorio_contador', label: 'Fiscal: Relatório do Contador', color: '#f59e0b' },
            // Tabelas fiscais (20/10/2026): CFOP com a funcao de cada um, base de NCM e CEST.
            { id: 'fiscal.tabelas', label: 'Fiscal: Tabelas Fiscais (CFOP, NCM, CEST)', color: '#f59e0b' },
            // Item 15, fase 2 (25/11/2026): ja' vem marcadas para quem emite nota (pacote 'financeiro-2').
            { id: 'fiscal.cce', label: 'Fiscal: Carta de Correção (CC-e)', color: '#f59e0b' },
            { id: 'fiscal.inutilizar', label: 'Fiscal: Inutilizar numeração', color: '#f59e0b' },
            { id: 'fiscal.devolucao', label: 'Fiscal: emitir NF-e de devolução (de venda e ao fornecedor)', color: '#f59e0b' },
            { id: 'fiscal.emitir_lote', label: 'Fiscal: emitir notas em lote', color: '#f59e0b' },
            // Item 15 (fase Estoque e cadastros, 25/11/2026): ja' vem marcada para quem da' entrada (pacote 'estoque-1').
            { id: 'fiscal.entrada_excluir', label: 'Fiscal: Excluir nota de entrada (reverte estoque e títulos)', color: '#ef4444' },
            // Item 15 (fase Administracao, 25/11/2026): Nota Fiscal das Configuracoes da filial. So' o
            // dono/administrador mexia; nao vem com nada.
            { id: 'fiscal.configurar', label: 'Fiscal: Configurar a nota fiscal (chave da Spedy e e-mail das notas)', color: '#ef4444' },
            { id: 'fiscal.numeracao', label: 'Fiscal: Série, próximo número, ambiente e CSC das notas', color: '#ef4444' },
            // Troca do administrador (25/11/2026): com filiais, so' o dono/administrador ativava CFOP.
            { id: 'fiscal.tabelas_ativar', label: 'Fiscal: Tabelas Fiscais — ativar e desativar CFOP (vale para a empresa inteira)', color: '#ef4444' },
            { id: 'utilitarios.sintegra', label: 'Utilitários: SINTEGRA', color: '#94a3b8' },
        ],
    },
    {
        grupo: 'Relacionamento',
        itens: [
            { id: 'crm.agenda', label: 'CRM: Agendamentos', color: '#ec4899' },
            { id: 'crm.alertas', label: 'CRM: Alertas de Retorno', color: '#ec4899' },
            { id: 'crm.agenda_cancelar', label: 'CRM: Cancelar agendamento', color: '#ec4899' },
            { id: 'crm.alertas_cancelar', label: 'CRM: Cancelar lembrete', color: '#ec4899' },
            // Item 15 (fase Administracao, 25/11/2026): bloco das Configuracoes da filial; nao vem com nada.
            { id: 'crm.configurar', label: 'CRM: Configurar as notificações', color: '#ec4899' },
        ],
    },
    {
        grupo: 'Administrativo',
        itens: [
            { id: 'administrativo.config', label: 'Admin: Configurações', color: '#6b7280' },
            { id: 'administrativo.equipe', label: 'Admin: Equipe e Acessos', color: '#6b7280' },
            { id: 'administrativo.logs', label: 'Admin: Histórico de alterações', color: '#6b7280' },
            { id: 'administrativo.relatorios', label: 'Admin: Relatórios Diversos', color: '#6b7280' },
            // Item 15 (fase Administracao, 25/11/2026): uma permissao por acao (pacote
            // 'administracao-1', permissoesNovasDomain.ts). O que o nivel gerente ja' fazia vem
            // marcado para ele; o que so' o dono/administrador fazia nao vem com nada.
            { id: 'administrativo.config_gerais', label: 'Admin: Configurações gerais (valem para todas as filiais)', color: '#6b7280' },
            { id: 'administrativo.config_filial', label: 'Admin: Configurações da filial — abrir a tela (cada bloco pede a sua)', color: '#6b7280' },
            { id: 'administrativo.dados_empresa', label: 'Admin: Dados da empresa (razão social, CNPJ, endereço e logo)', color: '#ef4444' },
            { id: 'administrativo.textos_documentos', label: 'Admin: Textos e mensagens padrão dos documentos', color: '#6b7280' },
            { id: 'administrativo.documentos_impressao', label: 'Admin: Documentos e impressões (modelo do orçamento, vias e o que sai ao vender)', color: '#6b7280' },
            { id: 'administrativo.numeracao', label: 'Admin: Numeração dos documentos (adiantar o próximo número)', color: '#ef4444' },
            { id: 'administrativo.equipe_criar', label: 'Admin: Equipe — criar login de funcionário', color: '#ef4444' },
            { id: 'administrativo.equipe_editar', label: 'Admin: Equipe — alterar a ficha do funcionário', color: '#6b7280' },
            { id: 'administrativo.equipe_senha', label: 'Admin: Equipe — trocar a senha de acesso e a senha de vendedor', color: '#ef4444' },
            { id: 'administrativo.equipe_inativar', label: 'Admin: Equipe — inativar e reativar usuário', color: '#ef4444' },
            { id: 'administrativo.equipe_permissoes', label: 'Admin: Equipe — liberar e retirar permissões (só as que você tem)', color: '#ef4444' },
            { id: 'administrativo.equipe_nivel', label: 'Admin: Equipe — mudar o nível de acesso (o que cada um vê de vendas)', color: '#ef4444' },
            { id: 'administrativo.equipe_app', label: 'Admin: Equipe — liberar o aplicativo mobile (ocupa vaga do plano)', color: '#ef4444' },
            { id: 'administrativo.equipe_filial_padrao', label: 'Admin: Equipe — filial padrão de cada usuário', color: '#6b7280' },
            { id: 'administrativo.logs_exportar', label: 'Admin: Histórico de alterações — exportar PDF/Excel', color: '#6b7280' },
            { id: 'administrativo.relatorios_financeiros', label: 'Admin: Relatórios Diversos — financeiros (recebimentos, pagamentos e taxas de cartão)', color: '#6b7280' },
            { id: 'administrativo.relatorios_vendas', label: 'Admin: Relatórios Diversos — vendas, por vendedor e descontos', color: '#6b7280' },
            { id: 'administrativo.backup_gerar', label: 'Admin: Backup — gerar e ver o agendamento', color: '#ef4444' },
            { id: 'administrativo.backup_baixar', label: 'Admin: Backup — baixar a cópia da empresa inteira', color: '#ef4444' },
            { id: 'administrativo.liberar_trava', label: 'Admin: Liberar documento aberto por outra pessoa', color: '#6b7280' },
            // Troca do administrador (25/11/2026): so' o papel fazia; nao vem com nada.
            { id: 'administrativo.comissao_usuario', label: 'Admin: Equipe — regras de comissão de cada usuário', color: '#ef4444' },
        ],
    },
    {
        // Filiais (2026-10-06): a permissao-chave para trabalhar em outras filiais
        // do grupo -- trocar de filial no topo, ver e alterar os itens das outras,
        // transferir estoque. Dono e administrador ja' tem. Ver filialDomain.ts.
        grupo: 'Filiais',
        itens: [
            { id: 'filiais.utilizar', label: 'Filiais: Utiliza outras filiais (trocar de filial, ver itens e transferir)', color: '#8b5cf6' },
            // Item 15 (fase Estoque e cadastros, 25/11/2026): pacote 'estoque-1'. Sem nota vem
            // para quem e' gerente hoje (o nivel liberava sozinho).
            { id: 'filiais.transferir_sem_nota', label: 'Filiais: Transferir estoque sem nota fiscal', color: '#ef4444' },
            { id: 'filiais.transferencia_receber', label: 'Filiais: Receber transferência', color: '#8b5cf6' },
            { id: 'filiais.transferencia_cancelar', label: 'Filiais: Recusar e cancelar transferência (tudo volta)', color: '#ef4444' },
            // Item 15 (fase Administracao, 25/11/2026): so' o dono/administrador do grupo fazia; nao vem com nada.
            { id: 'filiais.gerenciar', label: 'Filiais: Ver todas as filiais do grupo (inclusive as inativas)', color: '#8b5cf6' },
            { id: 'filiais.cadastrar', label: 'Filiais: Cadastrar filial', color: '#ef4444' },
            { id: 'filiais.alterar', label: 'Filiais: Alterar e inativar filial', color: '#ef4444' },
            { id: 'filiais.resumo', label: 'Filiais: Resumo do grupo (vendas, a receber e estoque por filial)', color: '#8b5cf6' },
        ],
    },
    {
        // Modulos ainda em roadmap: as telas sao o mockup "Em breve"
        // (RoadmapModule). Antes de 2026-08-18 nao tinham permissao NEM branch em
        // routeAccess.ts -- ou seja, todo funcionario via esses itens no menu e
        // ninguem conseguia esconde-los. Agora a permissao existe e o gate e'
        // real: desmarcada, o item some do menu e a rota redireciona.
        // Compras (22/10/2026): cotacao com link por fornecedor e pedido de compra.
        grupo: 'Compras',
        itens: [
            { id: 'compras.cotacoes', label: 'Compras: Cotações de Compra (link para o fornecedor e comparativo)', color: '#0ea5e9' },
            { id: 'compras.pedidos', label: 'Compras: Pedidos de Compra', color: '#0ea5e9' },
            // Item 15, fase 2 (25/11/2026): ja' vem marcada para quem faz cotacao (pacote 'financeiro-2').
            { id: 'compras.gerar_pedido', label: 'Compras: gerar pedido de compra da cotação', color: '#0ea5e9' },
        ],
    },
    {
        grupo: 'Módulos em Breve',
        itens: [
            { id: 'integracoes.nuvemshop', label: 'E-commerce: Nuvemshop (em breve)', color: '#64748b' },
            { id: 'integracoes.marketplaces', label: 'E-commerce: Marketplaces (em breve)', color: '#64748b' },
            { id: 'integracoes.sincronizacoes', label: 'E-commerce: Sincronizações (em breve)', color: '#64748b' },
            { id: 'operacoes.lotes', label: 'Operações: Lotes e Validades (em breve)', color: '#64748b' },
        ],
    },
];
/** Lista plana, na ordem dos grupos. */
exports.PERMISSION_CATALOG = exports.PERMISSION_GROUPS.flatMap(g => g.itens);
exports.permissionLabelMap = exports.PERMISSION_CATALOG.reduce((acc, item) => {
    acc[item.id] = item.label;
    return acc;
}, {});
/**
 * Id da permissao de liberar desconto acima do limite.
 *
 * Vale pros DOIS tipos de aprovador: usuario com login (confirma com a senha)
 * e vendedor de balcao sem login (confirma com o proprio PIN). E' de proposito
 * a mesma permissao -- o que muda e como a pessoa prova quem e', nao o que ela
 * pode fazer.
 */
exports.PERMISSAO_LIBERAR_DESCONTO = 'vendas.liberar_desconto';
/** Modo Avancado do cadastro de produto para funcionario (03/11/2026). */
exports.PERMISSAO_PRODUTO_AVANCADO = 'estoque.produto_avancado';
/** Incluir e alterar vendedor de balcao comum sem ser o dono (21/10/2026). Ver VendedoresList.tsx. */
exports.PERMISSAO_INCLUIR_VENDEDOR = 'cadastros.vendedores_incluir';
/**
 * MARCAR/DESMARCAR TODAS AS PERMISSOES DE UMA VEZ.
 *
 * Pedido do dono (2026-09-21): "so botou um seletor que ativa todas as
 * permissoes, ai faz o inverso, ai vem desmarcando qual nao quer". Ligar 40+
 * toggles na mao pra depois tirar 3 e' trabalho a toa.
 *
 * As funcoes recebem a lista de ids VISIVEIS na tela, nao o catalogo inteiro:
 * com a busca preenchida ("estoque"), marcar todas tem que marcar so o que a
 * pessoa esta vendo. Mexer no que esta filtrado FORA da tela seria alterar o
 * que ninguem viu -- o jeito mais facil de tirar um acesso sem querer.
 *
 * "Marcar todas" NAO e' o mesmo que dar acesso total: e' uma foto do catalogo
 * de hoje. Permissao criada depois nao entra sozinha em quem foi marcado
 * assim. Quem precisa de "tudo, sempre" usa o nivel de acesso total, que ja
 * existe e nao depende desta lista.
 */
/** Acrescenta os ids visiveis ao que ja estava marcado, sem duplicar e sem
 *  mexer no que esta fora da tela. */
const marcarPermissoes = (atuais, idsVisiveis) => {
    const juntas = new Set(atuais);
    idsVisiveis.forEach((id) => juntas.add(id));
    return Array.from(juntas);
};
exports.marcarPermissoes = marcarPermissoes;
/** Tira os ids visiveis, preservando o que esta fora da tela (filtrado pela
 *  busca) exatamente como estava. */
const desmarcarPermissoes = (atuais, idsVisiveis) => {
    const remover = new Set(idsVisiveis);
    return atuais.filter((id) => !remover.has(id));
};
exports.desmarcarPermissoes = desmarcarPermissoes;
/**
 * Estado do seletor "todas": `todas`, `nenhuma` ou `parcial`.
 *
 * Lista vazia (busca sem resultado) devolve 'nenhuma' -- nao existe "todas as
 * zero permissoes marcadas", e um seletor ligado sobre uma lista vazia so
 * confundiria.
 */
const estadoDaSelecao = (atuais, idsVisiveis) => {
    if (idsVisiveis.length === 0)
        return 'nenhuma';
    const marcadas = new Set(atuais);
    const quantas = idsVisiveis.filter((id) => marcadas.has(id)).length;
    if (quantas === 0)
        return 'nenhuma';
    return quantas === idsVisiveis.length ? 'todas' : 'parcial';
};
exports.estadoDaSelecao = estadoDaSelecao;

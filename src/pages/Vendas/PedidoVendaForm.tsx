import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, User, Package, Trash2, XCircle, Printer, Eye, Receipt, RefreshCw, X } from 'lucide-react';
import { collection, addDoc, doc, getDoc, getDocs, updateDoc, getCountFromServer, serverTimestamp, query, where, orderBy, limit, runTransaction } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { spedyService } from '../../services/spedyService';
import { applyStockAdjustments, formatSequenceValue, getCurrentMaxSequence, getNextTenantSequenceValue, writeTenantSequenceValue } from '../../utils/firestoreAtomic';
import { isPlatformAdminRole } from '../../utils/roles';
import Swal from 'sweetalert2';
import '../OS/OS.css'; // Reusing OS styles for layout consistency

interface ClienteBasico { id: string; nome: string; telefone: string; }
interface ProdutoEstoque {
  id: string;
  nome: string;
  precoVenda: number;
  quantidade: number;
  codigo: string;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
  unidadeMedidaFracionado?: boolean;
}
interface ItemVenda {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  subtotal: number;
  quantidadeJaDevolvida?: number;
  unidadeMedidaSigla?: string;
  unidadeMedidaCasasDecimais?: number;
}

interface LinkedNfe {
  id: string;
  spedyId: string;
  status: string;
  number: number | null;
  accessKey?: string;
}

const PedidoVendaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // Para modo Visualização
  const isViewing = !!id;

  const [nfeDoc, setNfeDoc] = useState<LinkedNfe | null>(null);
  const [clienteNome, setClienteNome] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [status, setStatus] = useState('Aberta');
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [orcamentoId, setOrcamentoId] = useState('');

  const [clientesDisponiveis, setClientesDisponiveis] = useState<ClienteBasico[]>([]);
  const [produtosCatalogo, setProdutosCatalogo] = useState<ProdutoEstoque[]>([]);

  const [produtoBusca, setProdutoBusca] = useState('');
  const [produtoQtd, setProdutoQtd] = useState<number | string>(1);
  const [produtoDesconto, setProdutoDesconto] = useState<number>(0);
  const [produtoPreco, setProdutoPreco] = useState<number>(0);
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoEstoque | null>(null);

  const [frete, setFrete] = useState<number>(0);
  const [encargos, setEncargos] = useState<number>(0);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(true);
  const [permitirVendaSemEstoque, setPermitirVendaSemEstoque] = useState(false);

  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const canEditVenda = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.alterar'));

  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [isProdutoDropdownOpen, setIsProdutoDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const produtoDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isConsumidorFinal = clienteNome.toLowerCase().includes('consumidor final');
    if (isConsumidorFinal && formaPagamento !== 'Dinheiro' && formaPagamento !== 'Pix') {
      const timer = setTimeout(() => {
        setFormaPagamento('Dinheiro');
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [clienteNome, formaPagamento]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
      if (produtoDropdownRef.current && !produtoDropdownRef.current.contains(event.target as Node)) {
        setIsProdutoDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!currentUser || !tenantId) return;

      // Fetch Clientes
      const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
      const snapC = await getDocs(qC);
      const dataC: ClienteBasico[] = [];
      snapC.forEach((doc) => dataC.push({ id: doc.id, nome: doc.data().nome, telefone: doc.data().telefone }));
      setClientesDisponiveis(dataC);

      // Fetch Estoque
      const qE = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapE = await getDocs(qE);
      const dataE: ProdutoEstoque[] = [];
      snapE.forEach((doc) => dataE.push({
        id: doc.id,
        nome: doc.data().nome,
        precoVenda: doc.data().precoVenda,
        quantidade: doc.data().quantidade || 0,
        codigo: doc.data().codigo || '',
        unidadeMedidaSigla: doc.data().unidadeMedidaSigla,
        unidadeMedidaCasasDecimais: doc.data().unidadeMedidaCasasDecimais,
        unidadeMedidaFracionado: doc.data().unidadeMedidaFracionado
      }));
      setProdutosCatalogo(dataE);

      // Fetch Configurações
      try {
        const configRef = doc(db, 'configuracoes', tenantId);
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          setPermitirVendaSemEstoque(configSnap.data().venderSemEstoque === true);
        }
      } catch (err) { console.error(err); }

      // Fetch Pedido se for Visualização
      if (isViewing && id) {
        try {
          const docRef = doc(db, 'pedidos_venda', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const p = docSnap.data();
            setClienteNome(p.clienteNome || '');
            setFormaPagamento(p.formaPagamento || 'Dinheiro');
            setNumeroPedido(p.numeroPedido || '');
            setStatus(p.status || 'Finalizada');
            setItens(p.itens || []);
            setOrcamentoId(p.orcamentoId || '');
            setFrete(p.frete || 0);
            setEncargos(p.encargos || 0);

            // Busca nota fiscal vinculada a esta venda
            try {
              const qNota = query(
                collection(db, 'notas_fiscais'),
                where('pedidoId', '==', id),
                where('tipo', '==', 'NFC-e')
              );
              const snapNota = await getDocs(qNota);
              if (!snapNota.empty) {
                const docNota = snapNota.docs[0];
                setNfeDoc({
                  id: docNota.id,
                  spedyId: docNota.data().spedyId,
                  status: docNota.data().status,
                  number: docNota.data().number,
                  accessKey: docNota.data().accessKey
                });
              }
            } catch (err) {
              console.error("Erro ao buscar nota fiscal vinculada:", err);
            }
          } else {
            showError('Erro', 'Pedido não encontrado.');
            navigate('/pedidos-venda');
          }
        } catch (error) {
          console.error("Erro ao carregar pedido:", error);
        } finally {
          setIsFetchingData(false);
        }
      } else {
        // Novo Pedido - Buscar Próximo Número
        try {
          const qLast = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), orderBy('numeroPedido', 'desc'), limit(1));
          const snapP = await getDocs(qLast);
          let nextNum = '0001';
          if (!snapP.empty) {
            const lastNum = parseInt(snapP.docs[0].data().numeroPedido) || 0;
            nextNum = String(lastNum + 1).padStart(4, '0');
          }
          setNumeroPedido(nextNum);
        } catch (err) {
          console.error("Erro ao buscar sequencia", err);
          const snapP = await getCountFromServer(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId)));
          setNumeroPedido(String(snapP.data().count + 1).padStart(4, '0'));
        }
        setIsFetchingData(false);
      }
    };
    fetchInitialData();
  }, [id, isViewing, navigate, currentUser, tenantId]);

  const handleAddItem = () => {
    if (!produtoBusca) {
      showError('Atenção', 'Selecione ou digite o nome de um produto.');
      return;
    }
    const qtdNum = Number(produtoQtd) || 0;
    if (qtdNum <= 0) {
      showError('Atenção', 'A quantidade deve ser maior que zero.');
      return;
    }

    // Tenta achar o produto no catálogo para pegar o ID real
    const produtoEncontrado = produtoSelecionado || produtosCatalogo.find(p => p.nome.toLowerCase() === produtoBusca.toLowerCase() || p.codigo === produtoBusca);

    if (produtoEncontrado) {
      if (!permitirVendaSemEstoque && qtdNum > (produtoEncontrado.quantidade || 0)) {
        showError('Estoque Insuficiente', `Você tem apenas ${produtoEncontrado.quantidade || 0} de ${produtoEncontrado.nome} em estoque. Venda sem estoque desativada.`);
        return;
      }

      // Validação de Venda Fracionada
      if (produtoEncontrado.unidadeMedidaFracionado === false && !Number.isInteger(qtdNum)) {
        showError('Operação Bloqueada', `O produto ${produtoEncontrado.nome} está configurado na unidade ${produtoEncontrado.unidadeMedidaSigla || 'UN'}, que NÃO permite venda fracionada. Utilize uma quantidade inteira.`);
        return;
      }
    }

    const precoFinal = produtoPreco > 0 ? produtoPreco : (produtoEncontrado?.precoVenda || 0);
    const subtotal = (precoFinal * qtdNum) - produtoDesconto;

    const novoItem: ItemVenda = {
      id: produtoEncontrado?.id || 'avulso',
      nome: produtoEncontrado?.nome || produtoBusca,
      precoUnitario: precoFinal,
      quantidade: qtdNum,
      desconto: produtoDesconto,
      subtotal: Math.max(0, subtotal),
      unidadeMedidaSigla: produtoEncontrado?.unidadeMedidaSigla || 'UN',
      unidadeMedidaCasasDecimais: produtoEncontrado?.unidadeMedidaCasasDecimais ?? 0
    };

    setItens([...itens, novoItem]);
    setProdutoBusca('');
    setProdutoQtd(1);
    setProdutoDesconto(0);
    setProdutoPreco(0);
    setProdutoSelecionado(null);
  };

  const handleClearProdutoSelecionado = () => {
    setProdutoBusca('');
    setProdutoPreco(0);
    setProdutoSelecionado(null);
    setIsProdutoDropdownOpen(false);
  };

  const handleRemoveItem = (index: number) => {
    setItens(itens.filter((_, i) => i !== index));
  };

  const valorTotalItens = itens.reduce((acc, curr) => acc + (curr.precoUnitario * curr.quantidade), 0);
  const valorTotalDescontos = itens.reduce((acc, curr) => acc + curr.desconto, 0);
  const valorTotalPedido = Math.max(0, valorTotalItens - valorTotalDescontos + Number(frete || 0) + Number(encargos || 0));

  const handleFinalizarVenda = async () => {
    if (!currentUser || !tenantId) return;
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item à venda.');
      return;
    }

    let finalClienteNome = clienteNome.trim().toUpperCase();
    if (!finalClienteNome) {
      finalClienteNome = 'CONSUMIDOR FINAL';
      setClienteNome('CONSUMIDOR FINAL');
    }

    setIsLoading(true);

    try {
      // 1. Cadastrar Cliente (se não existir)
      const clienteExiste = clientesDisponiveis.some(c => c.nome.toUpperCase() === finalClienteNome);
      if (!clienteExiste) {
        const qC = query(collection(db, 'clientes'), where('tenantId', '==', tenantId));
        const snapC = await getCountFromServer(qC);
        await addDoc(collection(db, 'clientes'), {
          codigo: String(snapC.data().count + 1),
          nome: finalClienteNome,
          isPadrao: finalClienteNome === 'CONSUMIDOR FINAL',
          tenantId: tenantId || '',
          createdAt: serverTimestamp()
        });
      }

      const currentMaxPedido = await getCurrentMaxSequence(db, 'pedidos_venda', tenantId, 'numeroPedido').catch(() => 0);
      let newPedidoId = '';
      let finalNumeroPedido = numeroPedido;

      await runTransaction(db, async (transaction) => {
        const nextPedido = await getNextTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', currentMaxPedido);
        finalNumeroPedido = formatSequenceValue(nextPedido, 4);
        const newPedidoRef = doc(collection(db, 'pedidos_venda'));
        newPedidoId = newPedidoRef.id;

        await applyStockAdjustments(
          transaction,
          db,
          itens.map(item => ({ id: item.id, nome: item.nome, quantidade: item.quantidade })),
          'decrement',
          permitirVendaSemEstoque
        );

        writeTenantSequenceValue(transaction, db, tenantId, 'pedidos_venda', nextPedido);

        const pedidoData = {
          numeroPedido: finalNumeroPedido,
          clienteNome: finalClienteNome,
          itens,
          valorTotalItens,
          valorTotalDescontos,
          frete: Number(frete || 0),
          encargos: Number(encargos || 0),
          valorTotal: valorTotalPedido,
          formaPagamento,
          status: 'Finalizada',
          tenantId,
          usuarioResponsavelId: currentUser.uid,
          createdAt: serverTimestamp()
        };

        transaction.set(newPedidoRef, pedidoData);

        let statusTransacao = 'Pendente';
        if (formaPagamento === 'Dinheiro' || formaPagamento === 'Pix') statusTransacao = 'Paga';

        transaction.set(doc(db, 'transacoes', newPedidoRef.id), {
          descricao: `Venda Direta #${finalNumeroPedido}`,
          categoria: 'Venda de Peças',
          valor: valorTotalPedido,
          tipo: 'entrada',
          formaPagamento,
          status: statusTransacao,
          pedidoId: newPedidoRef.id,
          clienteNome: finalClienteNome,
          tenantId,
          createdAt: serverTimestamp()
        });
      });

      setNumeroPedido(finalNumeroPedido);

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'criacao',
          descricao: `Venda Direta #${finalNumeroPedido} finalizada no valor de R$ ${valorTotalPedido.toFixed(2)}. Cliente: ${finalClienteNome || 'Geral'}`,
          registroRelacionadoId: newPedidoId,
          status: 'sucesso'
        });
      } catch (err) {
        console.error('Erro ao registrar log de criacao de venda:', err);
      }

      setIsLoading(false);

      // 5. Perguntar o que fazer
      const result = await NexusSwal.fire({
        title: 'Venda Finalizada com Sucesso!',
        text: 'O estoque foi atualizado e o financeiro lançado. O que deseja fazer agora?',
        icon: 'success',
        showDenyButton: true,
        confirmButtonText: 'Emitir Cupom Fiscal (NFC-e)',
        denyButtonText: 'Imprimir Recibo',
        cancelButtonText: 'Apenas Concluir',
        confirmButtonColor: '#10b981',
        denyButtonColor: '#3b82f6'
      });

      if (result.isConfirmed) {
        NexusSwal.fire({
          title: 'Emitindo Cupom Fiscal...',
          text: 'Enviando dados para a Spedy API / SEFAZ...',
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading()
        });

        try {
          const runtimeConfig = await spedyService.getRuntimeConfig();
          if (!runtimeConfig.spedyEnabled || !runtimeConfig.spedyApiKeyConfigured) {
            throw new Error('A integração com a Spedy não está ativa ou configurada. Acesse as Configurações do sistema.');
          }

          const apiKey = '__backend_proxy__';
          const env = runtimeConfig.spedyEnvironment;

          // Prepara itens da NFC-e
          const payloadItems = [];
          for (const item of itens) {
            let ncm = '87082999'; // Default fallback para autopeças
            let cfop = 5102;      // Venda interna de mercadoria adquirida
            let csosn = 400;      // Isento Simples Nacional
            let origem = 0;       // Nacional

            if (item.id !== 'avulso') {
              const pRef = doc(db, 'estoque', item.id);
              const pSnap = await getDoc(pRef);
              if (pSnap.exists()) {
                const pData = pSnap.data();
                ncm = pData.ncm || ncm;
                cfop = Number(pData.cfop) || cfop;
                csosn = Number(pData.csosn) || csosn;
                origem = Number(pData.origem) || origem;
              }
            }

            payloadItems.push({
              code: item.id === 'avulso' ? 'AVULSO' : item.id,
              description: item.nome,
              ncm,
              cfop,
              unit: item.unidadeMedidaSigla || 'UN',
              quantity: item.quantidade,
              unitAmount: item.precoUnitario,
              totalAmount: item.precoUnitario * item.quantidade,
              unitTax: item.unidadeMedidaSigla || 'UN',
              quantityTax: item.quantidade,
              unitTaxAmount: item.precoUnitario,
              makeupTotal: true,
              taxes: {
                icms: {
                  origin: origem,
                  csosn
                },
                pis: { cst: 7 },
                cofins: { cst: 7 }
              }
            });
          }

          // Prepara dados do destinatário (opcional para NFC-e se for Consumidor Final)
          let receiver = undefined;
          const isConsumidorFinal = finalClienteNome === 'CONSUMIDOR FINAL';

          if (!isConsumidorFinal) {
            const qClient = query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', finalClienteNome));
            const snapClient = await getDocs(qClient);
            if (!snapClient.empty) {
              const cData = snapClient.docs[0].data();
              const cDoc = (cData.documento || '').replace(/\D/g, '');
              const cCep = (cData.cep || '01001-000').replace(/\D/g, '');
              if (cDoc) {
                receiver = {
                  name: finalClienteNome,
                  federalTaxNumber: cDoc,
                  email: cData.email || undefined,
                  address: {
                    street: cData.endereco || 'Rua Principal',
                    number: cData.numero || '123',
                    district: cData.bairro || 'Centro',
                    postalCode: cCep,
                    city: {
                      code: cData.codigoIbge || '3550308',
                      name: cData.cidade || 'São Paulo',
                      state: cData.estado || 'SP'
                    }
                  }
                };
              }
            }
          }

          if (!receiver) {
            receiver = {
              name: 'Consumidor Final',
              federalTaxNumber: '12345678901', // CPF dummy para emissão anônima/teste
              address: {
                street: 'Rua Principal',
                number: '123',
                district: 'Centro',
                postalCode: '01001000',
                city: {
                  code: '3550308',
                  name: 'São Paulo',
                  state: 'SP'
                }
              }
            };
          }

          let spedyPayment = 'cash';
          if (formaPagamento === 'Pix') spedyPayment = 'pix';
          else if (formaPagamento.includes('Crédito')) spedyPayment = 'creditCard';
          else if (formaPagamento.includes('Débito')) spedyPayment = 'debitCard';
          else if (formaPagamento.includes('Prazo')) spedyPayment = 'other';

          const spedyPayload = {
            isFinalCustomer: true,
            operationType: 'outgoing',
            destination: 'internal',
            presenceType: 'presence',
            operationNature: 'Venda de Mercadoria',
            sendEmailToCustomer: false,
            integrationId: newPedidoId,
            receiver,
            items: payloadItems,
            payments: [
              {
                method: spedyPayment,
                amount: valorTotalPedido
              }
            ],
            total: {
              invoiceAmount: valorTotalPedido,
              productAmount: valorTotalItens
            }
          };

          const spedyNote = await spedyService.emitConsumerInvoice(apiKey, env, spedyPayload);

          // Polling para aguardar autorização (SEFAZ processa de forma assíncrona)
          NexusSwal.fire({
            title: 'Autorizando Cupom na SEFAZ...',
            text: 'Aguardando aprovação da nota fiscal eletrônica...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
          });

          let currentStatus = spedyNote.status;
          let finalNote = spedyNote;
          let attempts = 0;

          while (['enqueued', 'processing', 'created'].includes(currentStatus) && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
              finalNote = await spedyService.getConsumerInvoice(apiKey, env, spedyNote.id);
              currentStatus = finalNote.status;
            } catch (pollErr) {
              console.warn("Erro ao consultar status do cupom fiscal:", pollErr);
            }
            attempts++;
          }

          // Salva referência local no Firestore (com o status e número mais recente do polling)
          await addDoc(collection(db, 'notas_fiscais'), {
            spedyId: finalNote.id,
            number: finalNote.number,
            accessKey: finalNote.accessKey || null,
            tipo: 'NFC-e',
            clienteNome: finalClienteNome,
            valor: valorTotalPedido,
            status: finalNote.status,
            processingMessage: finalNote.processingDetail?.message || null,
            processingCode: finalNote.processingDetail?.code || null,
            tenantId,
            createdAt: serverTimestamp(),
            data: new Date().toISOString(),
            pedidoId: newPedidoId
          });

          Swal.close();

          if (finalNote.status === 'authorized') {
            const printResult = await NexusSwal.fire({
              title: 'Cupom Fiscal Autorizado!',
              text: 'Deseja abrir o DANFE (Cupom) para impressão?',
              icon: 'success',
              showCancelButton: true,
              confirmButtonText: 'Sim, Abrir PDF',
              cancelButtonText: 'Fechar e Voltar'
            });

            if (printResult.isConfirmed) {
              await spedyService.openFiscalFile(finalNote.id, 'consumer', 'pdf');
            }
          } else if (['enqueued', 'processing', 'created'].includes(finalNote.status)) {
            await NexusSwal.fire({
              title: 'Cupom em Processamento',
              text: 'O cupom fiscal foi enviado com sucesso, mas o retorno da SEFAZ está demorando. Você poderá consultá-lo e imprimir o PDF mais tarde no menu Fiscal.',
              icon: 'info',
              confirmButtonText: 'Entendido'
            });
          } else {
            // Rejeitada / negada
            await NexusSwal.fire({
              title: 'Cupom Fiscal Rejeitado',
              text: `O cupom foi rejeitado pela SEFAZ: ${finalNote.processingDetail?.message || 'Motivo desconhecido.'} (Código: ${finalNote.processingDetail?.code || 'N/A'})`,
              icon: 'error',
              confirmButtonText: 'Entendido'
            });
          }

          navigate('/pedidos-venda');

        } catch (err) {
          Swal.close();
          showError('Falha ao emitir NFC-e', (err as Error).message || 'Não foi possível transmitir o cupom fiscal.');

          const fallbackResult = await NexusSwal.fire({
            title: 'NFC-e não emitida',
            text: 'Ocorreu um erro ao emitir o cupom. Deseja imprimir o Recibo comum do pedido?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, Imprimir Recibo',
            cancelButtonText: 'Não, Apenas Sair'
          });
          if (fallbackResult.isConfirmed) {
            navigate(`/pedidos-venda/print/${newPedidoId}`);
          } else {
            navigate('/pedidos-venda');
          }
        }
      } else if (result.isDenied) {
        navigate(`/pedidos-venda/print/${newPedidoId}`);
      } else {
        navigate('/pedidos-venda');
      }

    } catch (error) {
      console.error('Erro ao finalizar venda:', error);
      const errorMessage = error instanceof Error ? error.message : '';
      showError('Erro', errorMessage ? `Não foi possível finalizar a venda. ${errorMessage}` : 'Não foi possível finalizar a venda.');
      setIsLoading(false);
    }
  };

  const handleEmitirCupomVendaExistente = async () => {
    if (!currentUser || !tenantId || !id) return;

    setIsLoading(true);

    try {
      // 1. Verificar Integração Spedy
      const runtimeConfig = await spedyService.getRuntimeConfig();
      const spedyConfigured = runtimeConfig.spedyEnabled && runtimeConfig.spedyApiKeyConfigured;
      const apiKey = '__backend_proxy__';
      const env = runtimeConfig.spedyEnvironment;

      if (!spedyConfigured) {
        showError('Integração Inativa', 'O módulo da Spedy não está configurado ou ativado.');
        setIsLoading(false);
        return;
      }

      // 2. Montar os itens com a tributação do estoque
      const payloadItems = [];
      for (const item of itens) {
        let ncm = '87082999';
        let cfop = 5102;
        let csosn = 400;
        let origem = 0;

        if (item.id && item.id !== 'avulso') {
          try {
            const docRef = doc(db, 'estoque', item.id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const pData = docSnap.data();
              ncm = pData.ncm || '87082999';
              cfop = Number(pData.cfop) || cfop;
              csosn = Number(pData.csosn) || csosn;
              origem = Number(pData.origem) || origem;
            }
          } catch (err) {
            console.error("Erro ao buscar dados fiscais do produto no estoque:", err);
          }
        }

        payloadItems.push({
          code: item.id === 'avulso' ? 'AVULSO' : item.id,
          description: item.nome,
          ncm,
          cfop,
          unit: item.unidadeMedidaSigla || 'UN',
          quantity: item.quantidade,
          unitAmount: item.precoUnitario,
          totalAmount: item.precoUnitario * item.quantidade,
          unitTax: item.unidadeMedidaSigla || 'UN',
          quantityTax: item.quantidade,
          unitTaxAmount: item.precoUnitario,
          makeupTotal: true,
          taxes: {
            icms: {
              origin: origem,
              csosn
            },
            pis: { cst: 7 },
            cofins: { cst: 7 }
          }
        });
      }

      // 3. Destinatário
      let receiver = undefined;
      const isConsumidorFinal = clienteNome.toUpperCase() === 'CONSUMIDOR FINAL';

      if (!isConsumidorFinal) {
        const qClient = query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where('nome', '==', clienteNome));
        const snapClient = await getDocs(qClient);
        if (!snapClient.empty) {
          const cData = snapClient.docs[0].data();
          const cDoc = (cData.documento || '').replace(/\D/g, '');
          const cCep = (cData.cep || '01001-000').replace(/\D/g, '');
          if (cDoc) {
            receiver = {
              name: clienteNome,
              federalTaxNumber: cDoc,
              email: cData.email || undefined,
              address: {
                street: cData.endereco || 'Rua Principal',
                number: cData.numero || '123',
                district: cData.bairro || 'Centro',
                postalCode: cCep,
                city: {
                  code: cData.codigoIbge || '3550308',
                  name: cData.cidade || 'São Paulo',
                  state: cData.estado || 'SP'
                }
              }
            };
          }
        }
      }

      if (!receiver) {
        receiver = {
          name: 'Consumidor Final',
          federalTaxNumber: '12345678901',
          address: {
            street: 'Rua Principal',
            number: '123',
            district: 'Centro',
            postalCode: '01001000',
            city: {
              code: '3550308',
              name: 'São Paulo',
              state: 'SP'
            }
          }
        };
      }

      let spedyPayment = 'cash';
      if (formaPagamento === 'Pix') spedyPayment = 'pix';
      else if (formaPagamento.includes('Crédito')) spedyPayment = 'creditCard';
      else if (formaPagamento.includes('Débito')) spedyPayment = 'debitCard';
      else if (formaPagamento.includes('Prazo')) spedyPayment = 'other';

      const spedyPayload = {
        isFinalCustomer: true,
        operationType: 'outgoing',
        destination: 'internal',
        presenceType: 'presence',
        operationNature: 'Venda de Mercadoria',
        sendEmailToCustomer: false,
        integrationId: id,
        receiver,
        items: payloadItems,
        payments: [
          {
            method: spedyPayment,
            amount: valorTotalPedido
          }
        ],
        total: {
          invoiceAmount: valorTotalPedido,
          productAmount: valorTotalItens
        }
      };

      const spedyNote = await spedyService.emitConsumerInvoice(apiKey, env, spedyPayload);

      // Polling para aguardar autorização
      NexusSwal.fire({
        title: 'Autorizando Cupom na SEFAZ...',
        text: 'Aguardando aprovação da nota fiscal eletrônica...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      let currentStatus = spedyNote.status;
      let finalNote = spedyNote;
      let attempts = 0;

      while (['enqueued', 'processing', 'created'].includes(currentStatus) && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          finalNote = await spedyService.getConsumerInvoice(apiKey, env, spedyNote.id);
          currentStatus = finalNote.status;
        } catch (pollErr) {
          console.warn("Erro ao consultar status do cupom fiscal:", pollErr);
        }
        attempts++;
      }

      // Salva referência local no Firestore
      const newDocRef = await addDoc(collection(db, 'notas_fiscais'), {
        spedyId: finalNote.id,
        number: finalNote.number,
        accessKey: finalNote.accessKey || null,
        tipo: 'NFC-e',
        clienteNome: clienteNome,
        valor: valorTotalPedido,
        status: finalNote.status,
        processingMessage: finalNote.processingDetail?.message || null,
        processingCode: finalNote.processingDetail?.code || null,
        tenantId,
        createdAt: serverTimestamp(),
        data: new Date().toISOString(),
        pedidoId: id
      });

      // Atualiza o estado local
      setNfeDoc({
        id: newDocRef.id,
        spedyId: finalNote.id,
        status: finalNote.status,
        number: finalNote.number,
        accessKey: finalNote.accessKey
      });

      Swal.close();

      if (finalNote.status === 'authorized') {
        const printResult = await NexusSwal.fire({
          title: 'Cupom Fiscal Autorizado!',
          text: 'Deseja abrir o DANFE (Cupom) para impressão?',
          icon: 'success',
          showCancelButton: true,
          confirmButtonText: 'Sim, Abrir PDF',
          cancelButtonText: 'Fechar e Voltar'
        });

        if (printResult.isConfirmed) {
          await spedyService.openFiscalFile(finalNote.id, 'consumer', 'pdf');
        }
      } else if (['enqueued', 'processing', 'created'].includes(finalNote.status)) {
        await NexusSwal.fire({
          title: 'Cupom em Processamento',
          text: 'O cupom fiscal foi enviado com sucesso, mas o retorno da SEFAZ está demorando. Você poderá consultá-lo e imprimir o PDF mais tarde no menu Fiscal.',
          icon: 'info',
          confirmButtonText: 'Entendido'
        });
      } else {
        await NexusSwal.fire({
          title: 'Cupom Fiscal Rejeitado',
          text: `O cupom foi rejeitado pela SEFAZ: ${finalNote.processingDetail?.message || 'Motivo desconhecido.'} (Código: ${finalNote.processingDetail?.code || 'N/A'})`,
          icon: 'error',
          confirmButtonText: 'Entendido'
        });
      }

    } catch (err) {
      console.error(err);
      showError('Falha ao emitir NFC-e', (err as Error).message || 'Não foi possível transmitir o cupom fiscal.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenPdfCupom = async () => {
    if (!nfeDoc) return;
    try {
      await spedyService.openFiscalFile(nfeDoc.spedyId, 'consumer', 'pdf');
    } catch (err) {
      showError('Erro ao abrir PDF', (err as Error).message);
    }
  };

  const handleConsultarCupomExistente = async () => {
    if (!currentUser || !tenantId || !nfeDoc) return;
    setIsLoading(true);
    try {
      const runtimeConfig = await spedyService.getRuntimeConfig();
      if (!runtimeConfig.spedyEnabled || !runtimeConfig.spedyApiKeyConfigured) {
        showError('Integração Inativa', 'O módulo da Spedy não está configurado.');
        setIsLoading(false);
        return;
      }
      const apiKey = '__backend_proxy__';
      const env = runtimeConfig.spedyEnvironment;

      const spedyNote = await spedyService.getConsumerInvoice(apiKey, env, nfeDoc.spedyId);

      await updateDoc(doc(db, 'notas_fiscais', nfeDoc.id), {
        status: spedyNote.status,
        number: spedyNote.number,
        accessKey: spedyNote.accessKey || null,
        processingMessage: spedyNote.processingDetail?.message || null,
        processingCode: spedyNote.processingDetail?.code || null
      });

      setNfeDoc({
        ...nfeDoc,
        status: spedyNote.status,
        number: spedyNote.number,
        accessKey: spedyNote.accessKey
      });

      showSuccess(`Status atualizado: ${spedyNote.status}`);
    } catch (err) {
      showError('Erro ao consultar', (err as Error).message || 'Erro ao atualizar nota.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelarVenda = async () => {
    if (!currentUser || !tenantId || !id) return;

    const temDevolucao = itens.some(item => (item.quantidadeJaDevolvida || 0) > 0);
    if (temDevolucao) {
      showError('Operação Bloqueada', 'Não é possível cancelar uma venda que já possui itens devolvidos. O cancelamento só é permitido caso nenhuma devolução tenha sido feita.');
      return;
    }

    const confirm = await NexusSwal.fire({
      title: 'Cancelar Venda?',
      text: 'O estoque será devolvido e a transação financeira será estornada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Cancelar Venda',
      cancelButtonText: 'Manter Venda',
      confirmButtonColor: '#ef4444'
    });

    if (!confirm.isConfirmed) return;

    setIsLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        await applyStockAdjustments(
          transaction,
          db,
          itens.map(item => ({ id: item.id, nome: item.nome, quantidade: item.quantidade })),
          'increment',
          true
        );

        transaction.update(doc(db, 'pedidos_venda', id), {
          status: 'Cancelada',
          updatedAt: serverTimestamp()
        });

        transaction.set(doc(db, 'transacoes', id), { status: 'Cancelada' }, { merge: true });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: tenantId || '',
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'vendas',
          acao: 'cancelamento',
          descricao: `Venda Direta #${numeroPedido} CANCELADA e estoque estornado.`,
          registroRelacionadoId: id,
          status: 'sucesso',
          critical: true
        });
      } catch (err) {
        console.error('Erro ao registrar log de cancelamento de venda:', err);
      }

      // 4. Reabrir Orçamento se houver orcamentoId
      if (orcamentoId) {
        try {
          await updateDoc(doc(db, 'orcamentos', orcamentoId), { status: 'Pendente' });
        } catch (err) {
          console.error("Erro ao reabrir orçamento:", err);
        }
      }

      showSuccess('Venda cancelada com sucesso!');
      setStatus('Cancelada');
    } catch (err) {
      console.error('Erro ao cancelar:', err);
      showError('Erro', 'Não foi possível cancelar a venda.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetchingData) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando dados da Venda...</div>;
  }

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/pedidos-venda')}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title">{isViewing ? `Pedido de Venda #${numeroPedido}` : 'Frente de Caixa (PDV)'}</h1>
            <p className="page-subtitle">
              {isViewing
                ? (status === 'Cancelada' ? 'Esta venda foi CANCELADA' : 'Detalhes do Pedido e Impressão')
                : 'Ponto de venda rápido para itens e produtos'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {isViewing && status === 'Finalizada' && (
            <>
              {/* Botão de NFC-e (Cupom Fiscal) */}
              {!nfeDoc ? (
                <button
                  className="btn-primary"
                  onClick={handleEmitirCupomVendaExistente}
                  disabled={isLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' }}
                >
                  <Receipt size={18} /> Emitir Cupom Fiscal (NFC-e)
                </button>
              ) : nfeDoc.status === 'authorized' ? (
                <button
                  className="btn-primary"
                  onClick={handleOpenPdfCupom}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981', borderColor: '#10b981' }}
                >
                  <Eye size={18} /> Imprimir Cupom (NFC-e)
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={handleConsultarCupomExistente}
                  disabled={isLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
                >
                  <RefreshCw size={18} /> Consultar Cupom (NFC-e)
                </button>
              )}

              <button className="btn-secondary" onClick={() => navigate(`/pedidos-venda/print/${id}`)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Printer size={18} /> Imprimir Recibo
              </button>
              {canEditVenda && (
                <button
                  className="btn-secondary"
                  onClick={handleCancelarVenda}
                  disabled={isLoading || itens.some(item => (item.quantidadeJaDevolvida || 0) > 0)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    color: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'var(--text-muted)' : '#ef4444',
                    borderColor: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'var(--border-color)' : 'rgba(239,68,68,0.3)',
                    cursor: itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'not-allowed' : 'pointer'
                  }}
                  title={itens.some(item => (item.quantidadeJaDevolvida || 0) > 0) ? 'Não é possível cancelar: há itens devolvidos' : 'Cancelar Venda'}
                >
                  <XCircle size={18} /> Estornar/Cancelar
                </button>
              )}
            </>
          )}
          {!isViewing && (
            <button className="btn-primary" onClick={handleFinalizarVenda} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981' }}>
              <ShoppingCart size={18} />
              {isLoading ? 'Finalizando...' : 'Finalizar Venda'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px', alignItems: 'start' }}>

        {/* Lado Esquerdo: Carrinho e Busca */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Seção Cliente */}
          <div className="card form-section" style={{ padding: '24px' }}>
            <div className="section-header" style={{ marginBottom: '16px' }}>
              <User size={20} className="section-icon" />
              <h3>Dados do Cliente</h3>
            </div>
            <div className="input-group" style={{ position: 'relative' }} ref={clientDropdownRef}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome do Cliente ou Consumidor Final *</label>
              <input
                type="text"
                placeholder="Busque ou digite o nome do cliente..."
                value={clienteNome}
                onChange={(e) => { setClienteNome(e.target.value); setIsClientDropdownOpen(true); }}
                onFocus={() => setIsClientDropdownOpen(true)}
                disabled={isViewing}
                autoComplete="off"
                style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', width: '100%' }}
              />
              {!isViewing && isClientDropdownOpen && clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(clienteNome.toLowerCase())).length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflowY: 'auto', zIndex: 50, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                  {clientesDisponiveis.filter(c => c.nome.toLowerCase().includes(clienteNome.toLowerCase())).map(c => (
                    <div
                      key={c.id}
                      onClick={() => { setClienteNome(c.nome); setIsClientDropdownOpen(false); }}
                      style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span>{c.nome}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{c.telefone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Seção Adicionar Produto */}
          {!isViewing && (
            <div className="card form-section" style={{ padding: '24px' }}>
              <div className="section-header" style={{ marginBottom: '16px' }}>
                <Package size={20} className="section-icon" />
                <h3>Adicionar Produto</h3>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '2', position: 'relative', minWidth: '200px' }} ref={produtoDropdownRef}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Buscar Produto</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Nome ou Código..."
                      value={produtoBusca}
                      onChange={(e) => {
                        setProdutoBusca(e.target.value);
                        setIsProdutoDropdownOpen(true);
                        const exists = produtosCatalogo.find(p => p.nome.toLowerCase() === e.target.value.toLowerCase() || p.codigo === e.target.value);
                        if (exists) {
                          setProdutoPreco(exists.precoVenda);
                          setProdutoSelecionado(exists);
                        } else {
                          setProdutoSelecionado(null);
                        }
                      }}
                      onFocus={() => setIsProdutoDropdownOpen(true)}
                      autoComplete="off"
                      style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 42px 12px 16px', color: 'var(--text-primary)' }}
                    />
                    {produtoBusca && (
                      <button
                        type="button"
                        onClick={handleClearProdutoSelecionado}
                        className="clear-selection-btn"
                        title="Limpar seleção"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {isProdutoDropdownOpen && produtosCatalogo.filter(p => p.nome.toLowerCase().includes(produtoBusca.toLowerCase()) || p.codigo.includes(produtoBusca)).length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '250px', overflowY: 'auto', zIndex: 50, boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }}>
                      {produtosCatalogo.filter(p => p.nome.toLowerCase().includes(produtoBusca.toLowerCase()) || p.codigo.includes(produtoBusca)).map(p => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setProdutoBusca(p.nome);
                            setProdutoPreco(p.precoVenda);
                            setProdutoSelecionado(p);
                            setIsProdutoDropdownOpen(false);
                          }}
                          style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '13px', alignItems: 'center', gap: '12px' }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome} {p.codigo && <span style={{color: 'var(--text-muted)'}}>[{p.codigo}]</span>}</span>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
                            <span style={{ color: p.quantidade > 0 ? '#10b981' : '#ef4444' }}>
                              Est: {p.quantidade.toFixed(p.unidadeMedidaCasasDecimais ?? 0)} {p.unidadeMedidaSigla || 'UN'}
                            </span>
                            <span style={{ color: '#10b981', fontWeight: 600 }}>R$ {p.precoVenda.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ flex: '0.5', minWidth: '85px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Qtd {produtoSelecionado?.unidadeMedidaSigla ? `(${produtoSelecionado.unidadeMedidaSigla})` : ''}
                  </label>
                  <input
                    type="number"
                    min="0.001"
                    step={produtoSelecionado?.unidadeMedidaFracionado ? "any" : "1"}
                    value={produtoQtd}
                    onChange={(e) => setProdutoQtd(e.target.value)}
                    style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                  />
                </div>

                <div style={{ flex: '0.8', minWidth: '100px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Preço Unt.</label>
                  <input type="number" step="0.01" value={produtoPreco} onChange={(e) => setProdutoPreco(Number(e.target.value))} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                </div>

                <div style={{ flex: '0.8', minWidth: '100px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Desc. (R$)</label>
                  <input type="number" step="0.01" value={produtoDesconto} onChange={(e) => setProdutoDesconto(Number(e.target.value))} style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
                </div>

                <button type="button" onClick={handleAddItem} className="btn-primary" style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}>
                  Adicionar
                </button>
              </div>
            </div>
          )}

          {/* Carrinho de Compras */}
          <div className="card form-section" style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>Itens da Venda</h3>

            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 8px' }}>Produto</th>
                    <th style={{ padding: '12px 8px', textAlign: 'center' }}>Qtd</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>V. Unit</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Desc.</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Subtotal</th>
                    {!isViewing && <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 ? (
                    <tr>
                      <td colSpan={isViewing ? 5 : 6} style={{ padding: '32px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Nenhum produto adicionado à venda.
                      </td>
                    </tr>
                  ) : (
                    itens.map((item, index) => (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px 8px' }}>{item.nome}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          {item.quantidade.toFixed(item.unidadeMedidaCasasDecimais ?? 0)} {item.unidadeMedidaSigla || 'UN'}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>R$ {item.precoUnitario.toFixed(2)}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', color: '#ef4444' }}>{item.desconto > 0 ? `-R$ ${item.desconto.toFixed(2)}` : '-'}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600 }}>R$ {item.subtotal.toFixed(2)}</td>
                        {!isViewing && (
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <button onClick={() => handleRemoveItem(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Lado Direito: Resumo e Pagamento */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>Resumo da Venda</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Total Itens:</span>
              <span>R$ {valorTotalItens.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: '#ef4444', alignItems: 'center' }}>
              <span>Descontos:</span>
              <span>- R$ {valorTotalDescontos.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Frete (+):</span>
              {isViewing ? (
                <span>R$ {frete.toFixed(2)}</span>
              ) : (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={frete || ''}
                  onChange={(e) => setFrete(Math.max(0, Number(e.target.value)))}
                  style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', textAlign: 'right' }}
                />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: 'var(--text-secondary)', alignItems: 'center' }}>
              <span>Encargos (+):</span>
              {isViewing ? (
                <span>R$ {encargos.toFixed(2)}</span>
              ) : (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={encargos || ''}
                  onChange={(e) => setEncargos(Math.max(0, Number(e.target.value)))}
                  style={{ width: '100px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-primary)', textAlign: 'right' }}
                />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed var(--border-color)', fontSize: '24px', fontWeight: 800, color: '#10b981' }}>
              <span>TOTAL:</span>
              <span>R$ {valorTotalPedido.toFixed(2)}</span>
            </div>
          </div>

          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase', color: 'var(--accent-purple)' }}>Forma de Pagamento</h3>

            {isViewing ? (
               <div style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '16px', fontWeight: 600, textAlign: 'center' }}>
                 {formaPagamento}
               </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                {[
                  { value: 'Dinheiro', icon: '💵' },
                  { value: 'Pix', icon: '💠' },
                  { value: 'Cartão de Crédito', icon: '💳' },
                  { value: 'Cartão de Débito', icon: '💳' },
                  { value: 'Pagamento a Prazo', icon: '🤝' }
                ].filter(metodo => {
                  const isConsumidorFinal = clienteNome.toLowerCase().includes('consumidor final');
                  if (isConsumidorFinal) {
                    return metodo.value === 'Dinheiro' || metodo.value === 'Pix';
                  }
                  return true;
                }).map(metodo => (
                  <div
                    key={metodo.value}
                    onClick={() => setFormaPagamento(metodo.value)}
                    style={{
                      backgroundColor: formaPagamento === metodo.value ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-tertiary)',
                      border: `1px solid ${formaPagamento === metodo.value ? '#10b981' : 'var(--border-color)'}`,
                      padding: '12px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: '20px' }}>{metodo.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: formaPagamento === metodo.value ? 600 : 400, color: formaPagamento === metodo.value ? '#10b981' : 'var(--text-primary)' }}>{metodo.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '16px', textAlign: 'center' }}>
              {(formaPagamento === 'Dinheiro' || formaPagamento === 'Pix')
                ? <span style={{ color: '#10b981' }}>✓ Irá somar no Caixa Principal.</span>
                : <span style={{ color: '#f59e0b' }}>ℹ️ Irá para o Contas a Receber.</span>}
            </div>
          </div>

          {!isViewing && (
            <button className="btn-primary" onClick={handleFinalizarVenda} disabled={isLoading} style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 700, backgroundColor: '#10b981', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
              <ShoppingCart size={24} />
              FINALIZAR VENDA
            </button>
          )}

        </div>

      </div>
    </div>
  );
};

export default PedidoVendaForm;

import React, { useState, useEffect } from 'react';
import { Upload, FileText, Package, CheckCircle, Save, ArrowLeft, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import Swal from 'sweetalert2';

interface ParsedItem {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

interface ParsedXML {
  fornecedorNome: string;
  fornecedorCnpj: string;
  numeroNF: string;
  dataEmissao: string;
  valorTotal: number;
  items: ParsedItem[];
}

interface EstoqueItem {
  id: string;
  codigo: string;
  nome: string;
  quantidade: number;
}

const EntradaNFE: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Estado com dados parseados
  const [parsedData, setParsedData] = useState<ParsedXML | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Estoque atual para busca rápida local
  const [estoqueAtual, setEstoqueAtual] = useState<EstoqueItem[]>([]);

  // Carrega produtos em estoque no carregamento para acelerar a reconciliação
  useEffect(() => {
    const fetchEstoque = async () => {
      if (!tenantId) return;
      try {
        const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
        const snap = await getDocs(q);
        const list: EstoqueItem[] = [];
        snap.forEach(d => {
          const data = d.data();
          list.push({
            id: d.id,
            codigo: data.codigo || '',
            nome: data.nome || '',
            quantidade: Number(data.quantidade || 0)
          });
        });
        setEstoqueAtual(list);
      } catch (err) {
        console.error("Erro ao carregar estoque para reconciliação:", err);
      }
    };
    fetchEstoque();
  }, [tenantId]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.xml')) {
        processFile(file);
      } else {
        showError('Arquivo Inválido', 'Por favor, envie apenas arquivos no formato XML.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.xml')) {
        processFile(file);
      } else {
        showError('Arquivo Inválido', 'Por favor, envie apenas arquivos no formato XML.');
      }
    }
  };

  // Executa o parser do XML
  const processFile = (file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        // Verifica se houve erro de parse no navegador
        const parseError = xmlDoc.getElementsByTagName("parsererror");
        if (parseError.length > 0) {
          throw new Error("Formato do arquivo XML corrompido ou inválido.");
        }

        const getValue = (tagName: string, parentNode: Element | Document = xmlDoc) => {
          const elements = parentNode.getElementsByTagName(tagName);
          return elements.length > 0 ? elements[0].textContent || '' : '';
        };

        // Dados do Emitente (Fornecedor)
        const emitNode = xmlDoc.getElementsByTagName("emit")[0];
        const fornecedorNome = emitNode ? getValue("xNome", emitNode) : 'FORNECEDOR DESCONHECIDO';
        const fornecedorCnpj = emitNode ? getValue("CNPJ", emitNode) : '';

        // Dados da Nota
        const ideNode = xmlDoc.getElementsByTagName("ide")[0];
        const numeroNF = ideNode ? getValue("nNF", ideNode) : '000000';
        const dataEmissaoRaw = ideNode ? (getValue("dhEmi", ideNode) || getValue("dEmi", ideNode)) : '';
        const dataEmissao = dataEmissaoRaw ? dataEmissaoRaw.split('T')[0] : new Date().toISOString().split('T')[0];

        // Totais
        const totalNode = xmlDoc.getElementsByTagName("ICMSTot")[0];
        const valorTotal = totalNode ? Number(getValue("vNF", totalNode) || 0) : 0;

        // Itens da Nota
        const detNodes = xmlDoc.getElementsByTagName("det");
        const items: ParsedItem[] = [];

        for (let i = 0; i < detNodes.length; i++) {
          const detNode = detNodes[i];
          const prodNode = detNode.getElementsByTagName("prod")[0];
          if (prodNode) {
            items.push({
              codigo: getValue("cProd", prodNode),
              descricao: getValue("xProd", prodNode),
              ncm: getValue("NCM", prodNode),
              cfop: getValue("CFOP", prodNode),
              unidade: getValue("uCom", prodNode) || 'UN',
              quantidade: Number(getValue("qCom", prodNode) || 0),
              valorUnitario: Number(getValue("vUnCom", prodNode) || 0),
              valorTotal: Number(getValue("vProd", prodNode) || 0)
            });
          }
        }

        if (items.length === 0) {
          throw new Error("Nenhum produto identificado no corpo da nota XML.");
        }

        setParsedData({
          fornecedorNome,
          fornecedorCnpj,
          numeroNF,
          dataEmissao,
          valorTotal,
          items
        });

      } catch (err) {
        console.error(err);
        showError('Erro no Processamento', (err as Error).message || 'Não foi possível ler os nós fiscais do arquivo XML.');
        setSelectedFile(null);
        setParsedData(null);
      }
    };

    reader.readAsText(file);
  };

  // Salva dados no Firestore
  const handleConfirmarEntrada = async () => {
    if (!parsedData || !tenantId) return;

    setIsProcessing(true);

    NexusSwal.fire({
      title: 'Importando NF-e...',
      text: 'Buscando produtos em estoque e lançando contas a pagar...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      let pecasAtualizadas = 0;
      let pecasCriadas = 0;

      for (const item of parsedData.items) {
        // Tenta encontrar peça correspondente no estoque do tenant
        const pecaExistente = estoqueAtual.find(
          p => p.codigo.toLowerCase() === item.codigo.toLowerCase() ||
               p.nome.toLowerCase() === item.descricao.toLowerCase()
        );

        if (pecaExistente) {
          // Incrementa quantidade
          const novaQuantidade = pecaExistente.quantidade + item.quantidade;
          await updateDoc(doc(db, 'estoque', pecaExistente.id), {
            quantidade: novaQuantidade,
            precoCusto: item.valorUnitario,
            fornecedor: parsedData.fornecedorNome.toUpperCase(),
            updatedAt: serverTimestamp()
          });
          pecasAtualizadas++;
        } else {
          // Cria novo produto com markup padrao de 50%
          await addDoc(collection(db, 'estoque'), {
            codigo: item.codigo,
            nome: item.descricao.toUpperCase(),
            quantidade: item.quantidade,
            estoqueMinimo: 0,
            precoCusto: item.valorUnitario,
            precoVenda: item.valorUnitario * 1.5, // 50% Margem padrão
            fornecedor: parsedData.fornecedorNome.toUpperCase(),
            categoria: 'DIVERSOS',
            unidadeMedidaId: 'un',
            unidadeMedidaSigla: item.unidade.toUpperCase() || 'UN',
            unidadeMedidaCasasDecimais: 0,
            tenantId,
            createdAt: serverTimestamp()
          });
          pecasCriadas++;
        }
      }

      // Lança a conta a pagar
      await addDoc(collection(db, 'transacoes'), {
        descricao: `COMPRA NF ${parsedData.numeroNF} - ${parsedData.fornecedorNome.toUpperCase()}`,
        data: parsedData.dataEmissao,
        valor: parsedData.valorTotal,
        categoria: 'FORNEDORES DE PEÇAS',
        status: 'Pendente',
        tipo: 'saida',
        tenantId,
        createdAt: serverTimestamp()
      });

      // Cria log de auditoria
      try {
        const { createAuditLog } = await import('../../services/logService');
        await createAuditLog({
          tenantId,
          usuarioId: currentUser?.uid || '',
          usuarioEmail: currentUser?.email || '',
          modulo: 'estoque',
          acao: 'criacao',
          descricao: `Importação de XML NF ${parsedData.numeroNF} realizada. ${pecasAtualizadas} itens atualizados, ${pecasCriadas} novos itens cadastrados. Contas a pagar lançada de R$ ${parsedData.valorTotal.toFixed(2)}.`,
          status: 'sucesso'
        });
      } catch {
        // Ignora erros ao registrar auditoria
      }

      Swal.close();
      showSuccess(`Sucesso! ${pecasAtualizadas} produtos incrementados e ${pecasCriadas} novos itens criados no estoque.`);

      // Reseta tela
      setSelectedFile(null);
      setParsedData(null);
      navigate('/estoque');

    } catch (err) {
      console.error(err);
      Swal.close();
      showError('Erro na Importação', (err as Error).message || 'Falha ao salvar itens no banco de dados.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoverFile = () => {
    setSelectedFile(null);
    setParsedData(null);
  };

  return (
    <div className="os-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar para Estoque">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', margin: 0 }}>
              <FileText size={28} color="var(--accent-purple)" />
              Entrada de Nota Fiscal (XML)
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              Importe notas fiscais (.xml) para dar entrada automática de produtos no estoque e registrar a despesa no contas a pagar.
            </p>
          </div>
        </div>
      </div>

      {!selectedFile ? (
        // Dropzone
        <div className="form-grid">
          <div className="card" style={{ gridColumn: 'span 12', padding: '48px 32px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
            <div
              style={{
                border: `2px dashed ${dragActive ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: '64px 24px',
                backgroundColor: dragActive ? 'rgba(139, 92, 246, 0.05)' : 'var(--bg-tertiary)',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px'
              }}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById('xml-upload')?.click()}
            >
              <input
                type="file"
                id="xml-upload"
                accept=".xml"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <Upload size={54} color={dragActive ? 'var(--accent-purple)' : 'var(--text-muted)'} style={{ opacity: 0.8 }} />
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>Arraste o arquivo XML da nota aqui</h3>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>ou clique para selecionar o arquivo no seu computador</p>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', padding: '4px 12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                Somente arquivos XML da SEFAZ
              </span>
            </div>
          </div>
        </div>
      ) : (
        // Preview dos dados lidos
        <div className="form-grid" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {parsedData && (
            <>
              {/* Card Cabeçalho */}
              <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CheckCircle size={22} color="#10b981" />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '16px' }}>Arquivo XML lido com sucesso!</span>
                  </div>
                  <button className="btn-secondary" onClick={handleRemoverFile} style={{ color: '#ef4444', borderColor: '#ef444450', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px' }}>
                    <Trash2 size={15} /> Remover Arquivo
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Fornecedor</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{parsedData.fornecedorNome}</strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>CNPJ do Fornecedor</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
                      {parsedData.fornecedorCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}
                    </strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Número da NF-e</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{parsedData.numeroNF}</strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Data de Emissão</label>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
                      {parsedData.dataEmissao.split('-').reverse().join('/')}
                    </strong>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Valor Total da Nota</label>
                    <strong style={{ fontSize: '18px', color: '#10b981', fontWeight: 'bold' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parsedData.valorTotal)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Tabela de Produtos */}
              <div className="card" style={{ padding: '0', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package size={20} color="var(--accent-purple)" />
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Itens Encontrados no XML ({parsedData.items.length})</h3>
                </div>

                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '13px' }}>
                        <th style={{ padding: '16px' }}>Código XML</th>
                        <th style={{ padding: '16px' }}>Descrição da Peça</th>
                        <th style={{ padding: '16px' }}>NCM</th>
                        <th style={{ padding: '16px', textAlign: 'center' }}>Qtd.</th>
                        <th style={{ padding: '16px', textAlign: 'right' }}>Custo Unitário</th>
                        <th style={{ padding: '16px', textAlign: 'right' }}>Custo Total</th>
                        <th style={{ padding: '16px', textAlign: 'center' }}>Reconciliação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedData.items.map((item, idx) => {
                        const correspondente = estoqueAtual.find(
                          p => p.codigo.toLowerCase() === item.codigo.toLowerCase() ||
                               p.nome.toLowerCase() === item.descricao.toLowerCase()
                        );

                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '14px' }}>
                            <td style={{ padding: '16px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{item.codigo}</td>
                            <td style={{ padding: '16px', fontWeight: 500 }}>{item.descricao}</td>
                            <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{item.ncm}</td>
                            <td style={{ padding: '16px', textAlign: 'center', fontWeight: 600 }}>
                              {item.quantidade} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.unidade}</span>
                            </td>
                            <td style={{ padding: '16px', textAlign: 'right', fontWeight: 500 }}>
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valorUnitario)}
                            </td>
                            <td style={{ padding: '16px', textAlign: 'right', fontWeight: 600 }}>
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valorTotal)}
                            </td>
                            <td style={{ padding: '16px', textAlign: 'center' }}>
                              {correspondente ? (
                                <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                                  Mesclar Estoque (+{correspondente.quantidade} cadastrados)
                                </span>
                              ) : (
                                <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                                  Criar Nova Peça no Estoque
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Ações */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '16px' }}>
                <button
                  className="btn-secondary"
                  onClick={handleRemoverFile}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  Cancelar
                </button>
                <button
                  className="btn-primary"
                  onClick={handleConfirmarEntrada}
                  disabled={isProcessing}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', backgroundColor: '#10b981', borderColor: '#10b981', boxShadow: '0 0 15px rgba(16, 185, 129, 0.3)', opacity: isProcessing ? 0.7 : 1 }}
                >
                  <Save size={18} />
                  {isProcessing ? 'Gravando dados...' : 'Confirmar Importação no Estoque'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default EntradaNFE;

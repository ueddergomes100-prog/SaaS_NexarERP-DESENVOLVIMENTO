import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import EtiquetaLabel, { type ProdutoEtiquetaDados } from '../../components/estoque/EtiquetaLabel';
import { usePrintAndClose } from '../../hooks/usePrintAndClose';
import { resolveUnidadeMedidaProduto } from '../../utils/unidadeMedidaDomain';
import {
  MODELO_ETIQUETA_PADRAO,
  montarCopiasEtiqueta,
  parseItensDaQuery,
  sanearModeloEtiqueta,
  type ModeloEtiqueta,
} from '../../utils/etiquetaDomain';
import '../OS/OsPrint.css'; // Reusing OS print styles (wrapper/actions/hide-nav)
import './EtiquetasPrint.css';

const EtiquetasPrint: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [produtosPorId, setProdutosPorId] = useState<Record<string, ProdutoEtiquetaDados>>({});
  const [modelo, setModelo] = useState<ModeloEtiqueta>(MODELO_ETIQUETA_PADRAO);
  const [loading, setLoading] = useState(true);

  const queryParams = new URLSearchParams(location.search);
  const itens = parseItensDaQuery(queryParams.get('itens'));
  const { copias, truncado } = montarCopiasEtiqueta(itens);

  useEffect(() => {
    const carregar = async () => {
      if (!tenantId || itens.length === 0) {
        setLoading(false);
        return;
      }
      try {
        const idsUnicos = Array.from(new Set(itens.map((item) => item.produtoId)));
        const produtoDocs = await Promise.all(idsUnicos.map((id) => getDoc(doc(db, 'estoque', id))));
        const mapa: Record<string, ProdutoEtiquetaDados> = {};
        produtoDocs.forEach((snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          const unidade = resolveUnidadeMedidaProduto(data);
          mapa[snap.id] = {
            nome: data.nome || '',
            codigo: data.codigo,
            codigoBarras: data.codigoBarras,
            precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
            precoAVista: data.precoAVista ?? data.precos?.aVista ?? null,
            precoAPrazo: data.precoAPrazo ?? data.precos?.aPrazo ?? null,
            unidadeMedidaSigla: unidade.unidadeMedidaSigla,
          };
        });
        setProdutosPorId(mapa);

        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        setModelo(sanearModeloEtiqueta(configSnap.exists() ? configSnap.data()?.etiquetaModelo : null));
      } catch (error) {
        console.error('Erro ao buscar produtos para impressão de etiquetas', error);
      } finally {
        setLoading(false);
      }
    };
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, location.search]);

  const handlePrint = usePrintAndClose('/estoque/etiquetas');

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Carregando etiquetas...</div>;
  }

  if (copias.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>
        <p>Nenhuma etiqueta para imprimir.</p>
        <button className="btn-secondary" onClick={() => navigate('/estoque/etiquetas')} style={{ marginTop: '16px' }}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="print-layout-wrapper">
      {/* Tamanho fisico da pagina vem do modelo salvo pelo tenant -- sem
          isso a impressora termica imprimiria em A4 e cortaria a etiqueta. */}
      <style>{`@page { size: ${modelo.larguraMm}mm ${modelo.alturaMm}mm; margin: 0; }`}</style>
      <div className="print-actions no-print">
        <button className="btn-secondary" onClick={() => navigate('/estoque/etiquetas')}>
          <ArrowLeft size={18} style={{ marginRight: 8 }} />
          Voltar
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          {copias.length} {copias.length === 1 ? 'etiqueta' : 'etiquetas'}
          {truncado ? ' (limite por impressão aplicado)' : ''}
        </span>
        <button className="btn-primary" onClick={handlePrint}>
          <Printer size={18} style={{ marginRight: 8 }} />
          Imprimir
        </button>
      </div>

      {copias.map((copiaItem) => {
        const produto = produtosPorId[copiaItem.produtoId];
        if (!produto) return null;
        return (
          <div className="etiqueta-print-page" key={`${copiaItem.produtoId}-${copiaItem.copia}`}>
            <EtiquetaLabel produto={produto} modelo={modelo} />
          </div>
        );
      })}
    </div>
  );
};

export default EtiquetasPrint;

import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { montarComprovanteDaDevolucao, type DevolucaoDoRelatorio } from '../../utils/relatorioMovimentosDomain';
import { getDateInputInTimeZone } from '../../utils/dateTime';

/**
 * Comprovante de uma devolucao em PDF (25/11/2026, Jomarly). Cobre a tela
 * inteira por cima do pedido; "Voltar ao pedido" fecha.
 */
const ComprovanteDevolucao: React.FC<{ devolucaoId: string; onFechar: () => void }> = ({ devolucaoId, onFechar }) => {
  const [devolucao, setDevolucao] = useState<DevolucaoDoRelatorio | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    getDoc(doc(db, 'devolucoes_venda', devolucaoId))
      .then((snap) => {
        if (!ativo) return;
        if (!snap.exists()) {
          setErro('Esta devolução não foi encontrada. Atualize a tela do pedido e tente de novo.');
          return;
        }
        setDevolucao({ id: snap.id, ...snap.data() } as DevolucaoDoRelatorio);
      })
      .catch((e) => {
        console.error('Erro ao abrir o comprovante da devolução:', e);
        if (ativo) setErro('Não foi possível abrir o comprovante. Confira a internet e tente de novo.');
      });
    return () => { ativo = false; };
  }, [devolucaoId]);

  const dia = getDateInputInTimeZone();
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, overflow: 'auto', background: 'var(--bg-primary)', padding: '24px' }}>
      <RelatorioPreview
        relatorioId="comprovante-devolucao"
        documento={devolucao ? montarComprovanteDaDevolucao(devolucao) : null}
        nomeArquivo={nomeArquivoRelatorio(`Devolucao ${devolucao?.numeroPedidoOriginal ? `pedido ${devolucao.numeroPedidoOriginal}` : ''}`.trim(), dia, dia)}
        onFechar={onFechar}
        rotuloFechar="Voltar ao pedido"
        carregando={!devolucao && !erro}
        erro={erro || undefined}
      />
    </div>
  );
};

export default ComprovanteDevolucao;

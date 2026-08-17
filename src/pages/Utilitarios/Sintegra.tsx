import React, { useState } from 'react';
import { FileDown, AlertTriangle, Loader2, FileText } from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess } from '../../utils/alerts';
import {
  buildSintegraFile,
  type SintegraEmpresa, type SintegraNota, type SintegraNotaItem, type SintegraProduto,
} from '../../utils/sintegraDomain';

const MESES = [
  '01 - Janeiro', '02 - Fevereiro', '03 - Março', '04 - Abril', '05 - Maio', '06 - Junho',
  '07 - Julho', '08 - Agosto', '09 - Setembro', '10 - Outubro', '11 - Novembro', '12 - Dezembro',
];

interface Resumo {
  notasIncluidas: number;
  notasSemSnapshot: number;
}

const Sintegra: React.FC = () => {
  const { tenantId } = useAuth();
  const agora = new Date();
  const [mes, setMes] = useState(String(agora.getMonth() + 1).padStart(2, '0'));
  const [ano, setAno] = useState(String(agora.getFullYear()));
  const [isGenerating, setIsGenerating] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const handleGerar = async () => {
    if (!tenantId) return;
    setIsGenerating(true);
    setResumo(null);

    try {
      const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
      const config = configSnap.data();

      if (!config?.cnpj || !config?.inscricaoEstadual) {
        showError('Dados da empresa incompletos', 'Preencha CNPJ e Inscrição Estadual em Configurações > Dados da Empresa antes de gerar o SINTEGRA.');
        return;
      }
      if (!config?.nfseCidadeNome) {
        showError('Cidade da empresa não configurada', 'Preencha "Cidade da Empresa" em Configurações > Dados da Empresa antes de gerar o SINTEGRA.');
        return;
      }

      const empresa: SintegraEmpresa = {
        cnpj: config.cnpj,
        inscricaoEstadual: config.inscricaoEstadual,
        nome: config.nomeOficina || '',
        municipio: config.nfseCidadeNome,
        uf: config.nfseCidadeEstado || '',
        rua: config.rua || '',
        numero: config.numero || '',
        bairro: config.bairro || '',
        cep: config.cep || '',
        nomeContato: config.nomeUsuario || '',
        telefone: config.telefone || '',
      };

      const dataInicial = `${ano}-${mes}-01`;
      const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
      const dataFinal = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;
      const inicioMs = new Date(`${dataInicial}T00:00:00`).getTime();
      const fimMs = new Date(`${dataFinal}T23:59:59`).getTime();

      const notasSnap = await getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId)));
      const notasDoMes = notasSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, any>))
        .filter((nota) => {
          if (nota.tipo !== 'NF-e' && nota.tipo !== 'NFC-e') return false;
          const dataNota = nota.createdAt?.toDate ? nota.createdAt.toDate() : (nota.data ? new Date(nota.data) : null);
          if (!dataNota) return false;
          const t = dataNota.getTime();
          return t >= inicioMs && t <= fimMs;
        });

      const notasSemSnapshot = notasDoMes.filter((nota) => !nota.itensFiscais || nota.itensFiscais.length === 0);
      const notasValidas = notasDoMes.filter((nota) => nota.itensFiscais && nota.itensFiscais.length > 0);

      if (notasValidas.length === 0) {
        showError(
          'Nenhuma nota elegível',
          notasSemSnapshot.length > 0
            ? `${notasSemSnapshot.length} nota(s) do período foram emitidas antes deste recurso existir e não têm os dados de item necessários. Nenhuma nota elegível encontrada.`
            : 'Nenhuma NF-e/NFC-e emitida nesse período.',
        );
        return;
      }

      const notasSintegra: SintegraNota[] = notasValidas.map((nota) => ({
        modelo: nota.tipo === 'NFC-e' ? 65 : 55,
        serie: '1',
        numero: nota.number || 0,
        dataEmissao: (nota.createdAt?.toDate ? nota.createdAt.toDate() : new Date(nota.data)).toISOString().slice(0, 10),
        situacao: nota.status === 'canceled' || nota.status === 'cancelada' ? 'cancelada' : 'normal',
        itens: (nota.itensFiscais || []).map((item: Record<string, any>): SintegraNotaItem => ({
          codigo: item.code,
          ncm: item.ncm,
          cfop: Number(item.cfop),
          cst: item.taxes?.icms?.csosn !== undefined
            ? String(item.taxes.icms.csosn)
            : `${item.taxes?.icms?.origin ?? 0}${String(item.taxes?.icms?.cst ?? 0).padStart(2, '0')}`,
          quantidade: item.quantity,
          valorTotal: item.totalAmount,
          baseIcms: item.taxes?.icms?.baseTax,
          valorIcms: item.taxes?.icms?.amount,
          aliquotaIcms: item.taxes?.icms?.rate,
          valorIpi: item.taxes?.ipi?.amount,
        })),
      }));

      const codigosProdutos = new Set(notasSintegra.flatMap((nota) => nota.itens.map((item) => item.codigo)));
      const estoqueSnap = await getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)));
      const produtosSintegra: SintegraProduto[] = estoqueSnap.docs
        .filter((d) => codigosProdutos.has(d.id))
        .map((d) => {
          const p = d.data();
          return {
            codigo: d.id,
            ncm: p.ncm || '',
            descricao: p.nome || '',
            unidade: p.unidadeMedidaSigla || 'UN',
            aliquotaIcms: Number(p.aliquotaIcms || 0),
            aliquotaIpi: Number(p.aliquotaIpi || 0),
            reducaoBaseIcms: Number(p.reducaoBaseIcms || 0),
          };
        });

      const arquivo = buildSintegraFile(empresa, notasSintegra, produtosSintegra, { dataInicial, dataFinal });

      const url = URL.createObjectURL(new Blob([arquivo], { type: 'text/plain;charset=iso-8859-1' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `sintegra-${ano}${mes}.txt`;
      link.click();
      URL.revokeObjectURL(url);

      setResumo({ notasIncluidas: notasValidas.length, notasSemSnapshot: notasSemSnapshot.length });
      showSuccess(`SINTEGRA de ${mes}/${ano} baixado com ${notasValidas.length} nota(s).`);
    } catch (err) {
      console.error('Erro ao gerar SINTEGRA:', err);
      showError('Erro ao gerar', 'Não foi possível gerar o arquivo SINTEGRA.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '760px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <FileText size={24} color="var(--accent-purple)" />
        <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>SINTEGRA</h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '14px 16px', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-md)' }}>
        <AlertTriangle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
        <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
          Este gerador cobre só <strong>notas de saída (vendas)</strong> — entrada/compra ainda não é suportada.
          Revise o arquivo com seu contador antes de qualquer entrega oficial: os campos foram implementados a partir
          de fontes técnicas secundárias, não validados ainda contra o Programa Validador SINTEGRA oficial.
        </p>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Mês</label>
            <select
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
            >
              {MESES.map((label, index) => (
                <option key={label} value={String(index + 1).padStart(2, '0')}>{label}</option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Ano</label>
            <input
              type="number"
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleGerar}
          disabled={isGenerating}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '12px 20px', borderRadius: 'var(--radius-md)', border: 'none',
            backgroundColor: 'var(--accent-purple)', color: '#fff', fontWeight: 600, cursor: isGenerating ? 'default' : 'pointer',
            opacity: isGenerating ? 0.7 : 1,
          }}
        >
          {isGenerating ? <Loader2 size={18} className="spin-icon" /> : <FileDown size={18} />}
          {isGenerating ? 'Gerando...' : 'Gerar e Baixar SINTEGRA'}
        </button>

        {resumo && (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            {resumo.notasIncluidas} nota(s) incluída(s) no arquivo.
            {resumo.notasSemSnapshot > 0 && ` ${resumo.notasSemSnapshot} nota(s) do período ficaram de fora por terem sido emitidas antes deste recurso existir.`}
          </p>
        )}
      </div>
    </div>
  );
};

export default Sintegra;

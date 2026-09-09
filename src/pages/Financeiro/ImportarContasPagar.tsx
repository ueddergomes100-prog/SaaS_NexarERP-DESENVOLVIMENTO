import React from 'react';
import { ArrowDownCircle } from 'lucide-react';
import ImportarContasBase from '../../components/financeiro/ImportarContasBase';

const ImportarContasPagar: React.FC = () => (
  <ImportarContasBase
    tipo="saida"
    titulo="Importar Contas a Pagar"
    subtitulo="Importação em massa de títulos pendentes a partir do sistema antigo (CSV ou XLSX)"
    rotaVoltar="/financeiro/contas-pagar"
    colecaoParte="fornecedores"
    rotuloParte="Fornecedor"
    Icone={ArrowDownCircle}
  />
);

export default ImportarContasPagar;

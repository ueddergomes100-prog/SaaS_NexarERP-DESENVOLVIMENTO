import React from 'react';
import { Wallet } from 'lucide-react';
import ImportarContasBase from '../../components/financeiro/ImportarContasBase';

const ImportarContasReceber: React.FC = () => (
  <ImportarContasBase
    tipo="entrada"
    titulo="Importar Contas a Receber"
    subtitulo="Importação em massa de títulos pendentes a partir do sistema antigo (CSV ou XLSX)"
    rotaVoltar="/financeiro/contas-receber"
    colecaoParte="clientes"
    rotuloParte="Cliente"
    Icone={Wallet}
  />
);

export default ImportarContasReceber;

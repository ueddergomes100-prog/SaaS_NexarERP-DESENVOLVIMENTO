import React from 'react';
import { modeloDeImpressaoDoOrcamento } from '../../utils/orcamentoPrintModels';
import OrcamentoPrintDocument from './OrcamentoPrintDocument';
import OrcamentoPrintMeiaFolha from './OrcamentoPrintMeiaFolha';
import OrcamentoPrintSimples from './OrcamentoPrintSimples';

interface Props {
  data: any;
  clientData: any;
  configData: any;
}

/**
 * Escolhe a folha do orcamento pelo modelo de Configuracoes (23/11/2026). Um
 * lugar so': a impressao e o PDF enviado ao cliente passam por aqui.
 */
const OrcamentoPrintModelo: React.FC<Props> = ({ data, clientData, configData }) => {
  const modelo = modeloDeImpressaoDoOrcamento(configData);
  if (modelo === 'meia-folha') return <OrcamentoPrintMeiaFolha data={data} clientData={clientData} configData={configData} />;
  if (modelo === 'simples') return <OrcamentoPrintSimples data={data} clientData={clientData} configData={configData} />;
  return <OrcamentoPrintDocument data={data} clientData={clientData} configData={configData} />;
};

export default OrcamentoPrintModelo;

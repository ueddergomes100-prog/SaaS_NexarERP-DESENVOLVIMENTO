interface ServicePricingData {
  preco?: number;
  quantidade?: number;
  tempoHoras?: number | string | null;
}

export const getServiceHours = (service: ServicePricingData): number => {
  if (service.tempoHoras === undefined || service.tempoHoras === null || service.tempoHoras === '') {
    return Math.max(0, Number(service.quantidade || 1));
  }

  return Math.max(0, Number(service.tempoHoras || 0));
};

export const getServiceTotal = (service: ServicePricingData): number =>
  Number(service.preco || 0) * getServiceHours(service);

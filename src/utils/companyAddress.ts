export const getCompanyAddressParts = (config: any) => ({
  rua: String(config?.rua || config?.enderecoRua || '').trim(),
  numero: String(config?.numero || config?.enderecoNumero || '').trim(),
  bairro: String(config?.bairro || config?.enderecoBairro || '').trim(),
});

export const formatCompanyAddress = (config: any, fallback = '') => {
  const { rua, numero, bairro } = getCompanyAddressParts(config);
  const parts = [
    rua,
    numero ? `Nº ${numero}` : '',
    bairro,
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(' - ');
  return String(config?.endereco || fallback || '').trim();
};

export const getCompanyAddressRows = (config: any, fallback = '') => {
  const { rua, numero, bairro } = getCompanyAddressParts(config);
  const rows = [
    rua ? { label: 'Rua', value: rua } : null,
    numero ? { label: 'Número', value: numero } : null,
    bairro ? { label: 'Bairro', value: bairro } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (rows.length > 0) return rows;

  const endereco = formatCompanyAddress(config, fallback);
  return endereco ? [{ label: 'Endereço', value: endereco }] : [];
};

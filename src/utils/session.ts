export const createSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const randomValues = new Uint32Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomValues);
  }

  const randomPart = Array.from(randomValues)
    .map(value => value.toString(36).padStart(7, '0'))
    .join('');

  return `${Date.now().toString(36)}-${randomPart || Math.random().toString(36).slice(2)}`;
};

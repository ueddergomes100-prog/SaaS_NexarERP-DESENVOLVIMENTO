const SESSION_STORAGE_KEY = 'nexus_session_id';

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

export const getStoredSessionId = () => {
  const sessionValue = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (sessionValue) {
    return sessionValue;
  }

  return localStorage.getItem(SESSION_STORAGE_KEY);
};

export const setStoredSessionId = (sessionId: string) => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

export const clearStoredSessionId = () => {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

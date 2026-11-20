import type { AuthSession } from '../api/types';

const SESSION_KEY = 'gyami.customer.session';
export const AUTH_EXPIRED_EVENT = 'gyami:auth-expired';

function isCustomerSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AuthSession>;
  return (
    typeof session.accessToken === 'string' &&
    session.accessToken.length > 0 &&
    (!session.refreshToken || typeof session.refreshToken === 'string') &&
    Boolean(session.customer) &&
    session.customer?.role === 'CUSTOMER' &&
    typeof session.customer.id === 'string'
  );
}

export const sessionStorage = {
  get(): AuthSession | null {
    const current = window.sessionStorage.getItem(SESSION_KEY);
    const legacy = current ? null : window.localStorage.getItem(SESSION_KEY);
    if (legacy) {
      window.sessionStorage.setItem(SESSION_KEY, legacy);
      window.localStorage.removeItem(SESSION_KEY);
    }
    const raw = current ?? legacy;
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isCustomerSession(parsed)) return parsed;
      window.sessionStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    } catch {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },
  set(session: AuthSession): void {
    if (!isCustomerSession(session)) throw new Error('Invalid customer session');
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.localStorage.removeItem(SESSION_KEY);
  },
  clear(): void {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(SESSION_KEY);
  },
  expire(): void {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  },
};

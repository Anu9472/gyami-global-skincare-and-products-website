import { HttpMarketplaceApi } from './httpMarketplaceApi';
import { createMockMarketplaceApi } from './mockMarketplaceApi';
import type { MarketplaceApi } from './types';

const configuredApiMode: unknown = import.meta.env.VITE_API_MODE;
const configuredApiUrl: unknown = import.meta.env.VITE_API_URL;
const configuredGoogleClientId: unknown = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const apiMode = configuredApiMode === 'mock' ? 'mock' : 'http';
const apiBaseUrl =
  typeof configuredApiUrl === 'string' && configuredApiUrl.trim()
    ? configuredApiUrl
    : '/api/v1';

if (import.meta.env.PROD && configuredApiMode === 'mock') {
  throw new Error(
    'Production storefront requires VITE_API_MODE=http; mock marketplace data is disabled.',
  );
}
if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error(
    'Production storefront requires VITE_API_URL to point to the marketplace API.',
  );
}

export const runtimeConfig = {
  apiMode,
  apiBaseUrl,
  isMock: apiMode === 'mock',
  googleClientId:
    typeof configuredGoogleClientId === 'string' && configuredGoogleClientId.trim()
      ? configuredGoogleClientId.trim()
      : undefined,
} as const;

export const marketplaceApi: MarketplaceApi = runtimeConfig.isMock
  ? createMockMarketplaceApi()
  : new HttpMarketplaceApi(apiBaseUrl);

# GYAMI Global customer web

Customer-facing React application for the GYAMI Global multi-vendor marketplace.
The app uses a typed API boundary and can optionally run against a clearly
labelled development-only local adapter for isolated UI work.

## Run locally

From the repository root:

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` when you need to override the defaults.

```dotenv
VITE_API_MODE=http
VITE_API_URL=/api/v1
```

- `VITE_API_MODE=http` is the default and uses the centralized HTTP adapter and `VITE_API_URL`. Do not place secrets in Vite environment variables.
- `VITE_API_MODE=mock` is an explicit, isolated UI-demo mode using local catalogue, account, cart, address, quote, COD-order, order-history, tracking, return, review, and complaint responses. The UI always identifies this mode. It intentionally does not simulate a successful Razorpay payment.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Backend integration

The frontend contract is in `src/api/types.ts`; live endpoint mapping is in `src/api/httpMarketplaceApi.ts`. The cross-team endpoint checklist is in `../../docs/CUSTOMER_API_REQUIREMENTS.md`. Backend-calculated checkout quotes remain authoritative for product totals, GST-inclusive prices, vendor shipping, stock, final payable amount, refund eligibility, and refund values. Prepaid checkout stays disabled in mock mode until payment creation, verification, and status APIs are available.

## Google customer sign-in

Set `VITE_GOOGLE_CLIENT_ID` to a Google OAuth **web client ID** to show the
Google Identity Services button in the production login screen. Set the exact
same value as `GOOGLE_OAUTH_CLIENT_ID` on the API. The API verifies each Google
ID token's signature, issuer, expiry, audience, and verified email before it
creates or signs in a customer. Never put an OAuth client secret in a Vite
environment variable.

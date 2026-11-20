# GYAMI Global Marketplace

Multi-vendor marketplace containing a customer storefront, vendor workspace,
administrator control centre, and a NestJS/PostgreSQL API.

## Local development on macOS

Requirements: Node.js 22.12+ (or Node.js 24), npm 10+, and Homebrew. The
repository pins Node 22.12.0 for local development and continuous integration.

```bash
npm install
brew install postgresql@16
npm run db:setup:mac
```

Start the API and the three frontends together:

```bash
npm run dev:local
```

This command keeps the complete local stack together. Leave that terminal open
while using the site; press `Ctrl+C` once to stop every local service.

Alternatively, start them in separate terminals:

```bash
npm run dev:api:mac
npm run dev
npm run dev:vendor
npm run dev:admin
```

Open:

- Customer storefront: http://127.0.0.1:5173
- Vendor panel: http://127.0.0.1:5174
- Admin panel: http://127.0.0.1:5175

## Development accounts

These seeded credentials are for local testing only:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@gyami_global.test` | `Demo@12345Secure` |
| Vendor | `vendor@gyami_global.test` | `Demo@12345Secure` |

The two roles share the same password but require separate email addresses
because the authorization model assigns exactly one role to each account.

The customer storefront's development adapter supports Google test sign-in and
mobile `9876543210` with OTP `123456`. No real Google account or SMS is used.

## Verification

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present -- --run
npm run build --workspaces --if-present
```

For a guarded local workflow smoke test, first start PostgreSQL and the API,
then run the following. It only accepts a localhost API and creates a COD test
order using the seeded test accounts, so never use it against a shared database.

```bash
npm run test:smoke:local
```

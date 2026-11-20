# Production readiness

This checklist records the operational controls required before the marketplace
accepts real customer orders. A local demonstration, test credentials, or a
successful build is not a production launch approval.

## Controls already implemented

- CI verifies dependency installation, generated Prisma types and schema,
  applies the full migration history to a fresh PostgreSQL service, then runs
  TypeScript, automated tests, production builds, an isolated seeded API role
  workflow (customer order, vendor product submission, admin approval and
  notification), and the responsive customer/vendor/admin layout audit on every pull
  request and `main` push.
- The API workflow smoke test always owns a dedicated port (`4010` by default)
  and isolated upload directory, so a developer or runner's existing API
  process cannot make a failed smoke build appear healthy.
- Dependabot checks npm and GitHub Action updates weekly.
- API requests receive a safe correlation ID in `X-Request-Id` and response
  metadata; unexpected server errors log that ID for support investigation.
- The protected `/api/v1/metrics` endpoint exposes Prometheus-compatible
  process uptime, in-flight request, request-volume, and latency metrics. In
  production it requires a 32+ character `METRICS_AUTH_TOKEN` supplied through
  the `X-Metrics-Token` header, so operational data is not public.
- A prepaid checkout reserves its local payment session before creating a
  Razorpay order. Concurrent customer requests therefore cannot create two
  provider orders; a transient provider failure releases the local reservation
  for a safe retry.
- Authentication responses carrying session tokens and authorized KYC document
  downloads, plus all bearer-authorized API responses, are explicitly marked
  `Cache-Control: no-store`, preventing browsers and intermediary caches from
  retaining sensitive material.
- Customer, vendor, and administrator access/refresh tokens are held in
  browser session storage instead of persistent local storage. The first visit
  after this release migrates a valid legacy session into the current tab and
  removes the persistent copy.
- Readiness checks verify database connectivity, private document storage, and
  the configured distributed rate-limit store. When a graceful shutdown starts,
  readiness immediately returns unavailable so a load balancer can drain the
  instance before it exits; the application then drains Prisma connections.
- Production rejects wildcard CORS, requires strong JWT secrets and a valid
  256-bit bank-data encryption key, and leaves API documentation disabled unless
  explicitly enabled for time-limited support work.
- Dependency audit reports no known production dependency vulnerabilities at the
  time this document was updated.
- The customer, vendor, and admin Vercel configurations set a baseline content
  security policy, deny framing and MIME sniffing, enforce HTTPS after the
  first secure visit, limit browser permissions, and use a privacy-preserving
  referrer policy. Immutable JavaScript, CSS,
  category, product, and homepage media responses are also cacheable at the
  edge. The customer policy explicitly permits only the required Google
  Identity, Razorpay checkout, and MSG91 OTP-widget origins; its deployment
  validation fails if those required provider origins are removed.

## Launch blockers requiring account or business owner action

These controls cannot be completed from source code alone because they need
vendor accounts, credentials, contracts, or billing approval.

- **Durable object storage:** vendor KYC, complaint, return, and review-photo
  files use the S3-compatible storage integration in production. Configure
  the bucket, region, credentials (or workload identity), explicit
  server-side encryption (`AES256`, `aws:kms`, or `aws:kms:dsse`), a
  retention policy, access logging, malware scanning, and lifecycle rules before
  deploying; ephemeral web-service storage must not hold regulated documents.
  KYC, complaint, return-evidence, and review-image upload paths delete newly written
  objects if their database records cannot be saved; KYC replacement also
  removes safely superseded document objects. Bucket lifecycle rules remain
  necessary for disaster recovery and retention policy.
- **Managed production database:** replace any free-tier database with a managed
  plan that has point-in-time recovery, automated backups, tested restoration,
  encryption, regional availability, and alerting.
- **Distributed rate-limit store:** configure `THROTTLE_REDIS_URL` for a managed
  Redis or Valkey service. Production startup rejects the per-process in-memory
  limiter because it cannot protect multiple API instances consistently.
- **Real integrations:** create and configure production credentials/webhooks
  for Razorpay, Shiprocket, MSG91, and Interakt. Use separate test and live
  credentials and rotate secrets through the hosting provider, never Git. The
  API refuses to start with simulated shipping or WhatsApp providers, or an
  unconfigured mobile-OTP provider, in production; it also never silently
  falls back to simulated shipping if a Shiprocket credential is missing.
- **Google customer sign-in (optional):** create an OAuth web client with the
  exact customer-domain origins and set its public client ID in both
  `VITE_GOOGLE_CLIENT_ID` (storefront) and `GOOGLE_OAUTH_CLIENT_ID` (API).
  Do not add a Google client secret to the frontend or repository. If enabled,
  permit `https://accounts.google.com` in the storefront's content-security
  policy for the Google Identity Services script.
- **Monitoring and incident response:** configure an error tracker, uptime and
  synthetic checkout monitoring, central log retention, on-call contacts, and
  alert thresholds for checkout failures, webhook failures, database health,
  elevated 5xx traffic, and sustained request latency. Configure the metrics
  scraper with `X-Metrics-Token`, never by putting the token in its URL.
- **Legal and privacy review:** approve privacy notice, terms, vendor agreement,
  data-retention schedule, grievance contact, consent wording, and support
  escalation policy for the launch region.
- **Domain and transport:** attach the production domain, enforce HTTPS, verify
  DNS ownership, configure a transactional-email domain, and test the security
  headers in the deployed environment.

## Release procedure

1. Deploy from a reviewed `main` commit only after CI is green.
2. Apply Prisma migrations before serving traffic and verify `/api/v1/health/ready`
   and `/api/v1/health/launch`. `/api/v1/health/live` confirms the process is
   running without requiring a database query; use readiness for load balancers
   and the stricter launch endpoint for the final production cutover gate.
3. Confirm the database backup and restore test is current.
4. Run a real end-to-end smoke test: customer checkout, payment webhook,
   vendor fulfilment, shipment event, refund, and notifications.
5. Review monitoring dashboards and rollback instructions before announcing the
   release.

The concrete deploy, rollback, incident, data-recovery, and weekly-review steps
are in [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).

## Evidence to retain for each release

- Commit SHA and CI run URL.
- Migration output and health-check result.
- E2E smoke-test order IDs and payment/shipping webhook IDs.
- Backup/restore test date.
- Security review, change approval, and rollback owner.

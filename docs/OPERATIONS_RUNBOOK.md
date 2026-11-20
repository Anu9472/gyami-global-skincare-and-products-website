# Operations runbook

This runbook is for the service owner operating a production Vishwaneed
release. It complements, but does not replace, the external account and legal
controls in [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

## Release gate

Before deploying, record the Git commit SHA and confirm all of these are true:

1. GitHub Actions quality gate is green: dependency installation, Prisma
   generation, typechecks, tests, production builds, and responsive-panel audit.
2. Production environment validation succeeds with managed PostgreSQL, Redis,
   private S3-compatible object storage, HTTPS-only CORS origins, and unique
   JWT/encryption secrets.
3. A current database backup and restore test is recorded by the database owner.
4. Razorpay, Shiprocket, MSG91, and Interakt production credentials and webhook
   secrets have been configured through the protected integration settings.
5. `/api/v1/health/ready` and `/api/v1/health/launch` both return HTTP 200
   from the deployed origin. The launch gate additionally confirms the required
   payment, shipping, SMS, and WhatsApp integration settings are present.

Keep the release evidence: commit SHA, CI URL, migration output, readiness
response request ID, backup/restore date, and rollback owner.

## Deploy

1. Apply Prisma migrations before routing production traffic to the new API.
   The operational-timeline and public-catalogue index migrations are additive,
   but schedule them in the normal low-traffic deployment window and observe
   database lock/CPU metrics while they run on a large production dataset.
2. Deploy the API, then the customer, vendor, and admin bundles.
3. Wait for the load balancer's readiness check at `/api/v1/health/ready`, then
   confirm `/api/v1/health/launch` before sending live traffic.
   During a graceful shutdown this endpoint deliberately returns unavailable
   before the process exits; keep the load balancer's deregistration delay long
   enough to finish in-flight requests.
   The release operator can verify all three public operational gates without
   mutating business data by running:

   ```sh
   VISHWANEED_PRODUCTION_API_URL=https://api.example.com/api/v1 \
   METRICS_AUTH_TOKEN='<secret held by the monitoring service>' \
   npm run verify:production-readiness
   ```

   This checks readiness, the stricter integration launch gate, and the
   protected Prometheus metrics endpoint. Do not put the token in a URL,
   commit it, or copy it into a ticket.
4. Run a controlled smoke test with a non-production payment/shipping account:
   sign in, open the catalogue, add to cart, validate checkout, create an order,
   confirm vendor visibility, and confirm administrator visibility.
5. Verify an `X-Request-Id` header is returned; use it to correlate the access
   log entry if the test needs investigation. Access logs mark 5xx responses
   as errors and 4xx/slow (one second or more) responses as warnings, enabling
   a managed log service to alert on the operational signals without parsing
   human-readable text.
6. Configure the monitoring scraper to collect `/api/v1/metrics` with the
   `X-Metrics-Token` header. The token must not be placed in a URL, dashboard
   query, or source repository. Alert on nonzero/sustained 5xx request volume,
   abnormal request latency, and readiness failures.

Do not use a real payment, shipment purchase, or WhatsApp send as an automated
smoke test.

## Rollback

1. Stop the rollout and route traffic back to the last known-good API and
   frontend release.
2. Do **not** roll back a database migration by deleting production data.
   Assess the migration first; use a forward-only corrective migration unless a
   database owner has an approved, tested rollback procedure.
3. Re-run `/api/v1/health/ready` and the controlled smoke test on the restored
   release.
4. Record the triggering request ID, deployment SHA, time window, operator, and
   customer/vendor impact. Open a follow-up issue before retrying the release.

## Incident triage

| Signal | Immediate action | Escalation evidence |
| --- | --- | --- |
| Readiness fails | Remove the instance from traffic; inspect database, private document-storage, distributed rate-limit store, and migration status. | Deployment SHA, request ID, database/storage/Redis health. |
| Checkout/payment errors | Pause promotional traffic if needed; verify Razorpay webhook signature and payment reconciliation records. Payment-session creation is locally reserved before Razorpay is contacted, so a short-lived duplicate-request conflict should be retried rather than creating another provider order. A failed, previously verified event may be retried from **Provider events** after the root cause is fixed. | Order number, payment ID, webhook event ID, request ID, audit-log ID. |
| Shipping webhook errors | Keep the order in its existing fulfilment state. A failed, previously verified event may be retried from **Provider events** after the root cause is fixed; do not replay an event still being processed. | Vendor order number, provider shipment ID, event ID, request ID, audit-log ID. |
| OTP/WhatsApp failure | Do not expose a test OTP in production; inspect provider configuration and queued/failed notification records. An administrator may retry only a failed business WhatsApp event from **Notifications** after correcting the recipient or provider configuration. Never retry an SMS/OTP notification; start a fresh authentication flow instead. | Notification ID, provider reference, request ID, audit-log ID. |
| Suspected account compromise | Suspend the affected account, preserve audit logs, rotate exposed credentials, and notify the security owner. | User ID, audit-log IDs, request IDs, affected sessions. |

## Data and media recovery

- KYC, return, complaint, review, category, product, and hero media must remain
  private or database-backed according to their integration; do not recover data
  from an ephemeral service disk.
- The private object-storage identity must retain permission to perform the
  bucket readiness check (`s3:ListBucket` or the provider equivalent), in
  addition to the least-privilege object operations required by the service.
- Restore objects only through the configured object-storage recovery process,
  and document the object key, requester, approver, and reason.
- Verify restored media with its application route, not by making the storage
  bucket public.

## Weekly operational review

Review failed notifications and failed or long-running payment/shipping provider
events, database backup status,
dependency alerts, rate-limit pressure, error trends, and the oldest unresolved
customer/vendor complaint. Confirm the assigned on-call owner and the next
backup-restore test date.

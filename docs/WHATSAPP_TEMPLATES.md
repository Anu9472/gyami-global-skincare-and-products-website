# WhatsApp notification templates

The backend sends WhatsApp messages through the provider-neutral
`NotificationsService`. In production, set `WHATSAPP_PROVIDER=INTERAKT` and map
the `WHATSAPP_TEMPLATE_*` environment variables to templates that are approved
and synchronised in Interakt.

Interakt body variables are sent in the following order:

Customer registration and password-reset OTPs are intentionally excluded from
WhatsApp. Authentication OTP delivery uses the SMS provider boundary.
Customer authentication uses the default MSG91 OTP Widget configured with
`MSG91_AUTH_KEY`, `MSG91_WIDGET_ID`, and `MSG91_WIDGET_TOKEN` through the
encrypted Admin System configuration page (or backend-only environment
fallback). The browser receives only the widget ID and client token; the server
uses the auth key to verify MSG91's one-time access token and ensure it belongs
to the expected mobile number. The separate server-generated SMS provider and
its `MSG91_OTP_TEMPLATE_ID` are not used by customer authentication.

| Logical template | Body values, in order |
| --- | --- |
| `order_confirmation` | order number, amount, payment method, vendor count |
| `vendor_new_order` | vendor order number, master order number, amount, item count, payment method |
| `order_<status>` | master order number, vendor order number, vendor name, status |
| `vendor_order_status_update` | vendor order number, master order number, status |
| `payment_confirmation` / `payment_failed` | order number, amount, status |
| `vendor_payment_status` | order number, amount, status |
| `order_item_cancelled` / `vendor_item_cancelled` | order number, vendor order number, product name, quantity, changed-by role |
| `shipment_<status>` / `vendor_shipment_status` | order number, vendor order number, vendor name, status, AWB, tracking URL |
| `return_status_update` / `vendor_return_requested` / `vendor_return_status` | order number, product name, resolution, status |

Supported order status template suffixes are `confirmed`, `processing`,
`packed`, `shipped`, and `delivered`. Supported shipment status suffixes are
`pending`, `ready_to_ship`, `picked_up`, `in_transit`, `out_for_delivery`,
`delivered`, `failed`, `cancelled`, and `returned`.

Notification records use a unique lifecycle deduplication key. In the admin
**Notifications** screen, a failed business WhatsApp delivery can be retried
after its recipient mobile or provider configuration is fixed. The retry is
atomically claimed to prevent two administrators from sending it twice and an
audit event is retained. SMS/OTP notifications are intentionally not retryable:
the authentication flow must generate a new code instead. An already sent
lifecycle event is not sent twice.

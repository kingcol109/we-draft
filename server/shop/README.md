# We-Draft.com Store — setup and testing

Merchandise (`/shop`) and voluntary contributions (`/support`). Stripe Checkout takes payment; Printify makes and ships the merchandise. Both pages are public but `noindex`. They are linked only from signed-in profiles (Profile → Store), never from the nav or footer.

## How an order flows

1. **Cart → quote** (`api/shop.js` `quote`). The server reprices every line from a fresh Printify product read. It then gets the shipping price for that cart and address from Printify (`POST /shops/{id}/orders/shipping.json`, `standard` rate). Browser prices are compared but never used.
2. **Checkout** (`checkout`). The server reruns the same checks and refuses if the total differs from the quote the customer saw. It then writes `shopOrders/{random id}` with status `pending_payment` and a snapshot of every line. Finally it creates a Stripe Checkout Session priced entirely from server data: one line per item plus a fixed shipping rate equal to Printify's quote.
3. **Payment.** Only the signed `checkout.session.completed` webhook (`api/stripe-webhook.js`, `stripe.webhooks.constructEvent`) moves the order to `paid`. The success page only reads status.
4. **Printify order.** The same webhook creates the Printify order with `external_id` set to our order id. A Firestore lock, Printify's unique `external_id` (409 on a duplicate) and a lookup on 409 or a lost response mean the order is created only once.
5. **Approval.** The order waits at Printify as **on-hold**. An admin presses **Send to production** (Admin → Shop → Orders), and Printify charges the store at that point. Set `SHOP_AUTO_SUBMIT=true` to skip this step. Even then, an order is sent only when Printify's cost is no more than what the customer paid; otherwise it is held and flagged.
6. **Fulfillment.** Printify webhooks (`api/printify-webhook.js`, HMAC `X-Pfy-Signature`) trigger a re-read of the order from Printify's API, which updates its status and tracking. An order is marked `fulfilled` only when Printify says so.

### Status lifecycle

`status` (money): `pending_payment → paid → refunded | partially_refunded`. It can also end at `expired`, `payment_failed` or `checkout_failed`.

`fulfillment.status` (goods): `not_started → creating → on_hold → submitting → submitted → in_production → partially_shipped → fulfilled`. It can also become `error`, `needs_attention` or `canceled`.

`needsAttention` and `issues[]` list everything an admin must look at. Admin → Shop → Orders highlights these orders.

### Failure handling

| Situation | What happens |
|---|---|
| Printify is down when payment lands | The order stays `paid` and fulfillment is `error`. The webhook returns 500, so Stripe redelivers it with backoff for up to 3 days. Admins can also press **Create Printify order**. |
| Printify rejects the order (4xx) | Fulfillment becomes `error` with `printify_rejected`. An admin fixes it and retries, or refunds. |
| Duplicate Stripe webhooks | `stripeEvents/{id}` plus idempotent transitions plus the create lock. Tested. |
| Variant unavailable or price changed | 409 with details. The cart updates itself. |
| Full refund | If the order hasn't gone to production, its Printify order is canceled. If it has, the order is flagged `refunded_after_production` and must be canceled in Printify by hand. |
| Partial refund | Recorded and flagged. Fulfillment is unchanged. |
| Printify `payment-not-received` / `has-issues` | Fulfillment becomes `needs_attention` with an explanation. |
| Dispute | Flagged on the order. |
| Amounts disagree with Stripe | The order is `paid` but held (`amount_mismatch`). Nothing is sent to Printify. |

## Firestore

All of these collections are server-only. `firestore.rules` denies all client access, and the API serves them.

- `shopProducts/{productId}` holds our stable product id (a slug fixed at import) with `printifyProductId`, `hidden`, `featured`, `sortOrder` and `title` (an admin label only). No product data is copied.
- `shopOrders/{orderId}` holds the order, its line snapshots (each with `fulfillment: {provider, productId, variantId}`), the shipping address, and the `stripe.*`, `printify.*`, `fulfillment.*` and `issues[]` fields.
- `shopContributions/{id}` holds a contribution. Its `/payments/{invoiceId|paymentIntentId}` subcollection has one doc per successful charge.
- `stripeEvents/{eventId}` stores processed webhook events. It has an `expireAt` field.
- `shopRateLimits/{…}` stores per-IP counters. It has an `expireAt` field.

Optional: add Firestore TTL policies on `expireAt` for `stripeEvents` and `shopRateLimits`.

### Moving the catalog off Printify later

Only `catalog.js` knows that products come from Printify. A future admin-managed catalog replaces `loadCatalog` and `fetchProductFresh` (a new `source` on `shopProducts`) and keeps each variant's `fulfillment` mapping to Printify. Orders already store their own snapshot, so their history is unaffected.

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` while testing |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the Stripe endpoint below |
| `PRINTIFY_API_TOKEN` | Printify → Account → Connections → API token (expires after 1 year) |
| `PRINTIFY_SHOP_ID` | Numeric shop id. Admin → Shop → Setup lists the shops your token can see. |
| `PRINTIFY_WEBHOOK_SECRET` | Any long random string, for example `openssl rand -hex 20` |
| `SHOP_SITE_URL` | Optional. Defaults to `https://we-draft.com`. Use your preview URL when testing on a preview deploy. |
| `SHOP_AUTO_SUBMIT` | Optional. `true` sends paid orders to production automatically. Default: admin approval. |
| `STRIPE_AUTOMATIC_TAX` | Optional. `true` enables Stripe Tax, which you must set up in Stripe first. |
| `STRIPE_PORTAL_LOGIN_URL` | Optional. The Stripe Customer Portal's no-code login link, shown to guests on /support. |

No Stripe key is needed in React. Checkout is a redirect to the URL the server returns.

## One-time setup

1. **Printify:** set the store's **Order approval** to **Manual** (Printify Help Center → order approval settings). New stores auto-approve after 24 hours, which would send held orders to production without anyone pressing the button.
2. **Printify:** make sure the store's billing method is set. Printify charges it at send-to-production.
3. **Vercel:** add the environment variables above and redeploy.
4. **Stripe** (test mode) → Developers → Webhooks → Add endpoint `https://we-draft.com/api/stripe-webhook`. Subscribe to these events:
   `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Stripe** → Settings → Billing → Customer portal: save the configuration in test mode (and again in live mode later), and allow canceling subscriptions. Optionally copy the portal login link into `STRIPE_PORTAL_LOGIN_URL`.
6. **Admin → Shop → Setup:** confirm the checks are green, then press **Register Printify webhooks**.
7. **Admin → Shop → Products:** add the Printify products to the store, and set hide, feature and order as you like.

## Testing checklist (Stripe test mode)

Cards: `4242 4242 4242 4242` succeeds. `4000 0000 0000 0002` is declined. `4000 0025 0000 3155` requires 3-D Secure.

- [ ] **Catalog:** /shop shows the imported products. Hiding one in Admin removes it from the store within about a minute. A featured product sorts first.
- [ ] **Variant picker:** a sold-out combination is struck through. Images follow the selected color.
- [ ] **Quote:** enter an address, then Calculate shipping. Compare the shipping amount with what Printify shows for the same product and state.
- [ ] **Bad address:** a 4-digit ZIP or no state is rejected with that field highlighted.
- [ ] **Successful payment (4242):** you land on /shop/success, which shows "Order confirmed". Admin → Shop → Orders shows the order as Paid and Awaiting approval, with a Printify order id. Printify shows the order **on hold** and no charge.
- [ ] **Signed-in purchase:** Profile → Store lists the order. A different account sees nothing.
- [ ] **Guest purchase:** the order appears in Admin with "guest" and no profile link.
- [ ] **Declined card (0002):** Stripe shows the error. No order is marked paid. The session expires later and the order becomes `expired`.
- [ ] **Abandoned checkout:** close the Stripe tab. The order stays `pending_payment` and then becomes `expired`.
- [ ] **Duplicate webhook:** in Stripe → Webhooks → the event → Resend. Only one Printify order exists.
- [ ] **Refund before production:** Admin → Full refund. The order becomes Refunded and the Printify order is canceled.
- [ ] **Refund after production:** only with a real test order you're willing to pay for. The order is flagged "refunded_after_production".
- [ ] **Send to production (approve explicitly; Printify charges real money):** the order becomes Submitted. When Printify webhooks arrive it moves to In production, and later Shipped with tracking in Profile → Store.
- [ ] **Printify outage:** temporarily set a wrong `PRINTIFY_API_TOKEN`, pay, and see fulfillment `error` with the issue logged. Restore the token, then use Stripe "Resend" or Admin "Create Printify order". It is created once.
- [ ] **Contribution, one-time:** $10 on /support leads to /support/thanks. Admin → Contributions shows it as paid.
- [ ] **Contribution, monthly:** pay, and the contribution is Active. Profile → Store → Manage opens the Stripe portal. Cancel there, and the status becomes "Ends this period" and later Canceled. In Stripe test mode, advance time with a test clock to see a renewal counted.
- [ ] **Rate limit:** more than 10 checkouts in 10 minutes from one IP returns "Too many requests".
- [ ] **Admin API without an admin token:** `curl -X POST https://we-draft.com/api/shop-admin` returns 401.

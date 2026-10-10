# Stripe TEST Checkout Session binding — source-only, no execution

This source-only step bridges a reserved `Order V2` from the carrier-bound checkout model into a specific Stripe **TEST** Checkout Session. It does not deploy anything, create a Stripe Session, call AWS, capture a payment, settle stock or buy labels.

## New non-executable transition

`backend/stripe-test-session-binding-plan.mjs` exports `planBindStripeTestCheckoutSession({order,retrievedSession,orderTable,now})`.

Only a **future trusted backend with a server-owned Stripe SDK** may supply the provider's independently retrieved `checkout.session`. A customer-supplied URL, JSON object, boolean or redirect is not evidence.

The offline planner validates:
- An unchanged reserved, unpaid, unfulfilled order in the **isolated Orders V2 sandbox** table, using a physical `orderId`, optimistic `version` and no existing Stripe session fields.
- Verified U.S. shipping and no pickup, a full-destination server-generated `hmac-v1` digest, real `shippingState`, selected unique live carrier rates for **every packed unit**, exact shipping sum and quote expiry **after** the reservation hold.
- A server-retrieved Stripe Session whose ID is `cs_test_...`, `livemode:false`, payment mode, `status:'open'`, `payment_status:'unpaid'`, matching order ID in client reference and metadata, USD currency, automatic tax enabled, and unchanged product subtotal and carrier shipping amount.
- A trusted timestamp strictly before the held reservation and carrier quote expiration.

The result is **one conditional, versioned DynamoDB UpdateItem shape** binding the immutable `stripeSessionId`, `paymentSessionId`, `paymentMode:'test'` and new order version. Conditions include no prior session binding, unchanged order version/RESERVED/PENDING states, immutable address digest, approved carrier quote expiry, unchanged original subtotal and shipping amount. A conflicting second session or concurrent mutation fails closed.

It deliberately **does not** set `PAID`, finalize `taxCents` or `totalCents`, or add a shipping/fulfillment authorization. All output flags stay `executable:false`, `paymentWriteAuthorized:false`, `stockWriteAuthorized:false` and `fulfillmentAuthorized:false`. Orders V2 does not yet exist in AWS; this is only the offline shape of a future conditional update.

## Critical remaining step: tax and total finalization

Stripe Checkout's automatic tax may not have finished when an unpaid Session is first created. Therefore the original order retains `taxCents:null` and `totalCents:null` after this binding, and no payment can settle on this data alone.

A separate authenticated TEST webhook + server-side retrieved Session must verify final automatic tax, shipping address HMAC, positive payment, payment intent, immutable subtotal/shipping and actual charge. Before the existing atomic `Stock V2/Order V2/EventLedger` settlement plan could be used, the order must be **version-conditionally finalized** to the exact tax/total charged without permitting arbitrary browser updates. A future plan for this tax reconciliation is required and must be reviewed before integrating any live payments or offering stock for sale.

The `shippingState` value is now explicitly preserved as a safe U.S. state code in the carrier HMAC quote and server-owned Order V2 snapshot so that the later signed-webhook totals audit can verify the customer's state. No street/city/ZIP or secret is newly stored on the order.

Run `node --test tests/stripe-test-session-binding-plan.test.mjs`; all checks are offline fixtures. No source file in this PR is an AWS Lambda or public endpoint.

**Owner's cost approval rule:** No AWS/Stripe/carrier production execution or usage-billed service deployment until costs and resources are disclosed and approved immediately before execution. Promotional credits are not a guaranteed $0 bill.

# Checkout V2 offline lifecycle integration test

**Tests only — no AWS deployment, credentials, Stripe requests, carrier API requests, inventory modifications, real labels or payments.**

`tests/checkout-v2-inert-full-lifecycle.integration.test.mjs` connects the source-only modules already merged on main in one deterministic fake-provider execution, proving the shape and safety of the handoff from product pricing all the way to signed event replay:

1. Verify merchant-approved active/published `productId` records and consistently reserved Stock V2, with actual measured per-unit packed dimensions and independent carrier rates
2. Bind the full domestic destination with a server-only address HMAC and build a versioned `RESERVED/PENDING` Order V2 proposal plus unique checkout-request ledger
3. Attach the original `cs_test_` **open/unpaid** Stripe test Checkout Session using a one-time conditional order update
4. Verify a raw HMAC-signed `checkout.session.completed` event with the official SDK interface, retrieve the exact completed/paid TEST provider Session through a mock server SDK, and model optimistic final Stripe Tax/charge total binding
5. Record only a PII-free `PENDING_REVIEW` webhook receipt in a fake isolated DynamoDB `eventId`-keyed ledger, with conditional duplicate protection
6. Revalidate the signed paid event and construct a single non-executable `TransactWriteItems` proposal for physical Stock V2 capture + versioned paid Order V2 + matching `SETTLED` event receipt
7. **Simulate, in memory only,** the all-or-nothing transaction success and verify a duplicate signed webhook after paid order settlement causes **NO second ledger write or stock capture**

Negative integration case: a changed street on the signed completed Session with the same shipping price is rejected by the original carrier address HMAC.

The test does not prove DynamoDB's live transaction semantics, actual Stripe SDK network behavior, real shipping/packing eligibility or API cost. These still require independent staging infrastructure/credentials and merchant approval. Tax/total binding, webhook receipt, stock capture and replay must be orchestrated by trusted backend code—not by a browser or success redirect.

**Owner instruction:** Continue no-cost source development and testing; ask **before executing any potentially chargeable operation**, including AWS staging resources, paid APIs, labels or real payment transactions. AWS promotional credit balances are not billing caps.

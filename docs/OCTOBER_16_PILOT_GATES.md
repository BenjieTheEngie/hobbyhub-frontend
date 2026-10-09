# Hobby Hub — October 16, 2026 limited-sales pilot decision gates

**Planning baseline:** October 9, 2026. This is a proposed target, **not** a launch approval or a commitment to turn on payments. Real customer orders must not be accepted until each applicable go/no-go gate is evidenced.

## Hard distinction: pilot vs automated website launch

- **Full self-service checkout on Hobby Hub is NOT ready.** Checkout V2, shipping rating, webhook reconciliation, reservation settlement and order operations are source/offline foundations. The old SKU-keyed checkout path was explicitly quarantined by PR #49.
- **Possible conditional pilot:** small, invite-only group; manually approved list of physical items; customer expresses purchase interest; staff verifies availability from authoritative legacy Inventory, prepares a real carrier quote using measured parcels and destination, prepares compliant tax and final invoice, and uses a separately approved, established **hosted invoicing/payment provider** rather than taking card details or activating legacy Hobby Hub checkout. Stock allocation and paid-order fulfillment require a human-controlled documented ledger and double-checks. This is **not** an automated cart or instant-sale promise.
- **No implied permission:** an external invoice, account/merchant onboarding, charging, refund, seller publication, or stock mutation must be separately authorized by the owner. No credit card information should be captured by Hobby Hub or sent through chat.
- If the hosted payment provider, true carrier quotes, sales tax handling, reconciliation, seller policies or stock controls cannot be verified by October 16, treat the week as a **preview-only soft launch** and accept **no paid orders**.

## Verified read-only baseline (October 9)

- AWS account `349744180170`, region `us-east-2`; AWS Core currently resolves to **root** principal, unsuitable for subsequent infrastructure deployment.
- Original Products / Inventory partition keys are immutable `productId`. Current strongly consistent full scans showed **7 product records / 7 matched Inventory records / 301 known units**, no duplicate SKU labels in these seven, **zero explicit published approvals**. Source stock remains the original Inventory table. Never infer a public listing from ACTIVE alone.
- Both original tables remain ACTIVE, with one AVAILABLE independent backup each and PITR enabled. These resources are not staging tables.
- Original CloudFormation `hobbyhub` stack, four legacy Node.js 20 Lambda functions, 13 JWT-authorized API routes and a Cognito JWT authorizer are present. No deployed Stock V2, customer checkout, carrier preview or shipping-profile Lambda routes were discovered. Cognito administrative groups list was empty.
- GitHub main merged PR #49 (permanent quarantine of unsafe legacy Stripe checkout), then PR #50 (explicit ACTIVE status required in offline Checkout V2). Both had passing GitHub automated CI at merge. These are source changes, not an AWS deployment.
- Vercel GitHub status/checks pass but Vercel team-scoped API access to `benjietheengies-projects` returns 403. Cannot independently bind `hobbyhub.company` production alias to a specific commit or inspect deployment environment flags until proper team access is repaired.

## Pilot critical-path gates (all required for paid sales)

1. **Security and permissions:** Owner-approved least-privilege AWS deployment identity for future deployment; identify verified Cognito admin group or owner subject (no wildcard). Do not use root to deploy Stock V2 or checkout. Restore Vercel team access for production deploy and environment verification.
2. **Sellable inventory:** Pick a bounded subset of physical products, manually verify condition, images, pricing, uniqueness of SKU and exact `productId`, identity of actual quantity, and non-conflicting availability. Explicitly approve each item. Do not mass-publish the seven legacy records.
3. **Order intake and oversell prevention:** Establish a documented single human order queue and reservation ledger with `productId`, unique order reference, timestamp, verified stock units, confirmation, fulfillment status, and separate cancellation/release procedures. Treat original Inventory as sole authority; ensure staff cannot sell stock simultaneously through another channel. Do not change AWS data or invent reservations during preparation.
4. **Shipping and delivery:** Owner provides verified U.S. ship-from origin and packaging measurements for every pilot SKU, and approved carrier/service restrictions. Calculate per-destination shipping from **actual** packed weight/dimensions; never substitute test EasyPost quotes or invented flat rates. Ship only to 50 states and DC, no territories, APO/FPO, international or pickup.
5. **Money and tax:** Owner chooses and authorizes a compliant hosted invoicing/payment service, completes merchant verification, payment fees, tax nexus/sales tax treatment, refund operation, and receipt delivery; staff confirms final full total **before** a hosted payment request. Test the invoice, success, failure, duplication, cancel/refund and settlement reconciliation on permitted test accounts and transactions. No active Stripe webhook from the retired backend.
6. **Customer policies:** Publish/review privacy, returns/refunds, contact/support, shipping handling times and condition/disclosure policies. Ensure compliance with applicable laws and payment platform requirements.
7. **Go/no-go dry run:** Owner and tester run an end-to-end **non-charge** test for purchase request → authoritative stock check → real carrier quote → tax/final total → hosted invoice draft → simulated confirmation → pick/pack → tracking/cancel/refund. Confirm public pages do not mislead visitors about working checkout or available stock. Authorize the limited pilot explicitly after all gates pass.

## Suggested checkpoint schedule (not a promise)

| Date | Checkpoint |
| --- | --- |
| Oct 9–10 | Inventory security read-only audit, isolate unsafe checkout, Vercel admin reauthorization, owner chooses pilot path |
| Oct 11–12 | Approve small pilot SKU set, photos, quantities, packed weight/dimensions, shipping origin, support/policy drafts |
| Oct 13–14 | Configure and test approved external hosted invoicing, carrier quotes, tax, unique order/manual reservation ledger |
| Oct 15 | Invite-only dry-run, cancellations/returns/late payment and duplicate-order simulation, manual reconciliation |
| Oct 16 | **Conditional GO** for tightly controlled paid pilot only if every gate is satisfied; otherwise preview-only, no paid sales |

## Post-pilot: automated Hobby Hub checkout

Use a separate least-privilege **staging** AWS deployment; Stock V2 should start empty, writable/init flags OFF and independently validated. Then build a verified legacy-stock-to-Stock-V2 source-of-truth cutover with rollback, exclusive inventory authority, secure publish approvals, authoritative shipping profile and carrier service, tax, signed Stripe webhook/idempotency ledger, order reservation/capture/release/refund, tracking and customer support. Prove failure and concurrency cases with production-like tests before owner authorizes live payment processing.

**Security conclusion:** a one-week **fully automated** sales launch is not responsible with the presently verified cloud state. A supervised, externally hosted payment pilot may be feasible, but is conditional on the gates above.

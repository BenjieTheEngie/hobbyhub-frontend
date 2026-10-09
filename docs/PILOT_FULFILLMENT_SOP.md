# Hobby Hub — supervised pilot fulfillment operating procedure

**DRAFT — not approved for accepting money or buying shipping labels.** Last prepared 2026-10-09. Applies only if the owner authorizes a narrow U.S.-only pilot after all gates in `OCTOBER_16_PILOT_GATES.md` are satisfied.

## Source-of-truth boundaries

- **Physical stock:** the original DynamoDB Inventory table keyed by immutable `productId`, plus a fresh on-site physical count and any other-channel commitments. Do not rely on Products.quantityOnHand, unpublished catalog flags, local packaging CSV, or uninitialized Stock V2.
- **Customer and charge:** an approved hosted invoice/payment provider. Only its authenticated merchant dashboard may establish paid/refunded/chargeback status. Screenshots, email links, success redirects, and the offline CSV auditor are not proof.
- **Shipping:** the real carrier account and verified actual rate for destination and measured packaged parcel. EasyPost TEST previews are non-chargeable and must never determine what a customer pays.
- **Order tracking:** one merchant-controlled, access-restricted master ledger with opaque order refs, unique productIds, quantities, timestamps, invoice/payment evidence, carrier reference, state and operator initials. The Hobby Hub pilot CSV audit is **only a copy-based completeness check**, not a ledger.
- Never place customer PII or payment credentials in the Pilot Order Audit CSV, GitHub, source, logs or chat. Keep address/contact details in an approved restricted service.

## Sequential operations for one operator (no automation)

1. **Review inquiry.** Confirm requested product printing/condition, price and U.S. destination eligibility (50 states and DC only). Do not promise stock, delivery date or payment acceptance before verification.
2. **Recheck stock.** Match exact `productId` across Products and Inventory, count physical units, review existing pending transactions and other sales channels, and ensure SKU is unambiguous. A product marked `ACTIVE` is not automatically approved for publication.
3. **Prevent oversell manually.** One designated operator must control the sales queue. Allocate approved physical units into a clearly labeled pending-order area before sending an invoice, with a uniquely recorded hold/release plan and expiry. If other channels cannot be paused/reconciled, do **not** confirm a sale. **Do not mutate AWS inventory or create Stock V2 reservations** without a separate authorized, tested workflow.
4. **Pack for quote.** Weigh and measure the packed shipping unit including sleeve, box/mailer and padding. Use owner-approved ship-from location and real U.S. destination with an approved carrier portal. Confirm service limitations/insurance, record timestamp and rate reference. No local pickup or international, territories or APO/FPO.
5. **Calculate final invoice.** Check actual carrier shipping and applicable sales tax in the approved service, then confirm correct product, quantity, condition, shipping, tax and final total. Have the merchant inspect the customer-facing final hosted invoice before sending it. Never collect card details on Hobby Hub or over chat.
6. **Await provider settlement evidence.** Check the authenticated provider portal for the exact invoice/order, amount, currency, state and duplicate charges. Treat `pending`, `failed`, `refunded`, `disputed`, and `unknown` as NOT cleared for shipment. If payment is late or a hold has expired, escalate and resolve stock and refund first; do not automatically sell or ship.
7. **Pick, inspect and pack.** Verify immutable productId, exact condition/edition, quantity, customer-facing product photo/description and protective packaging. Record two checkpoints: operator who performed count, operator who approved packed shipment (second reviewer when feasible).
8. **Purchase postage only after approval.** Merchant manually buys the correct label within the approved carrier system after confirming paid status and destination. Reconcile label cost, carrier/service, order ref and tracking against the master ledger. Shipping labels are **not** bought by Hobby Hub.
9. **Notify customer.** Provide tracking through the approved merchant communication service, not by exposing customer contact data in GitHub. Retain provider transaction and shipment receipts in restricted storage under the approved retention policy.
10. **Close daily.** Reconcile: confirmed-paid invoices; original Inventory counts; held/fulfilled/cancelled quantities; exceptions; refunds/chargebacks; carrier costs and tracking. **Freeze further intake** whenever stock or payment reconciliations disagree.

## Exception handling

| Situation | Safe response |
| --- | --- |
| Duplicate invoice/payment evidence or changed cart | Halt both affected orders; reconcile with provider and stock before invoice or shipment |
| Stock short or already committed elsewhere | Do not charge or promise shipment; obtain owner decision; cancel/void draft invoice if appropriate |
| Payment succeeded after reservation was released | Stop fulfillment; inspect stock and choose authorized refund/replacement policy before action |
| Customer says paid, provider says pending | Do not ship; verify inside authenticated merchant portal |
| Destination unsupported, quote expired, carrier mismatch | Do not request payment at a guessed rate; requote and reapprove final total |
| Return/refund/damaged shipment | Follow owner-approved return/claims policy and confirm with payment/carrier provider, with no automatic stock re-add |
| Stock, refund, tracking or other record uncertainty | Mark master ledger `REVIEW_REQUIRED`, freeze affected SKU/order until manually resolved |

## Non-charge dry run (must pass before pilot)

Use fictional test references and no real customer data. Rehearse an approved single-item purchase and a multi-line purchase, plus: last-unit double-order attempt, duplicate invoice, unpaid completion, quote expiry, Alaska/Hawaii, unsupported ZIP/territory/APO, damaged packaging, cancellation, refund, late payment, and a missing or mismatched tracking record.

## Pilot stop conditions

Any suspected double charge, lost/ambiguous inventory, missing provider payment evidence, unsupported shipping address, unexpected AWS write, account privilege issue, unreviewed legal/tax requirement or exposure of customer data means **stop taking new paid orders** until corrected and retested. No one-week deadline overrides these stop conditions.

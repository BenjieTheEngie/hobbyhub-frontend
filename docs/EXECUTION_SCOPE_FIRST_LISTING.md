# Hobby Hub execution scope — first real listing to marketplace

## Objective
Launch a trustworthy US-only, shipping-only collectibles marketplace, beginning with the owner's one physical Deadpool Party Foil Lightning Bolt at $7.50. Carrier-calculated shipping must use parcel weight, dimensions, and destination. Payment collection stays disabled until a separate test-and-approval gate.

## Verified first listing (read-only AWS lookup, 2026-10-10 local)
- AWS account: `349744180170`; region: `us-east-2`.
- Original Products table: `hobbyhub-ProductsTable-KC31XDEOENBG`.
- Product ID: `prd_9bfd1285-899c-45cb-869c-6058aff5b424`.
- SKU: `MTG-SLD-IFIYW-7-F`; name: `Lightning Bolt`; category: `Magic: The Gathering`; salePrice: 7.50; status: ACTIVE.
- The original record does **not** itself establish edition/finish, ownership, physical stock, photograph, shipping measurements, or approval. Seller reported one Deadpool Party Foil copy; verify metadata against the physical item before publication.
- The Stock V2 sandbox table exists and reports zero approximate items; do not assume inventory is initialized.

## Autonomous development authority
Implement, test, commit, open PRs, merge when checks pass, and prepare nonproduction infrastructure using least privilege and existing deployment controls. Keep changes reversible, audited, and scoped. The user's authorization to develop is not authorization to enable live charges, bulk-publish listings, migrate legacy stock, or overwrite original records. Request a targeted confirmation before each such production activation.

## Delivery phases
1. **Source and data verification:** compare original product, Stock V2, approvals and displayed UI; identify duplicate SKU versus immutable listing identity. No SKU-based stock writes.
2. **Fail-closed readiness:** read-only exact-product gate for seller-confirmed price/quantity, valid metadata, verified stock and fingerprint-matched approval; include negative tests. Do not represent offline test fixtures as live inventory.
3. **Nonproduction infrastructure:** provision and verify separately keyed Stock V2 audit and publication approval tables through reviewed IaC; PITR, encryption, narrow IAM, rollback. No mutations to legacy Products/Inventory.
4. **Authenticated admin workflow:** show the original listing, missing metadata, approval state and stock balance. Allow audited, idempotent initialization of exactly one copy only after confirming product identity and permissions. Approval must be explicit and scoped to fingerprint.
5. **Public listing:** join approved records by unique listing/product ID, never by SKU alone. Prevent overselling with atomic reservation, expiry and settlement. Keep unpaid checkout disabled until end-to-end tested.
6. **Marketplace seller expansion:** explicit seller ownership and listing IDs; independently priced and stocked offers for the same printing. Seller isolation and authorization, moderation, payout onboarding and disputes before third-party selling.
7. **Shipping/fulfillment:** US destination validation; real carrier rate provider, dimensional weight, parcel metadata, labels, tracking and cancellation/return flows. Never invent a carrier quote.
8. **Release gates:** CI, staging integration tests, security/permissions review, backup/recovery check, inventory reconciliation, one-listing smoke test and explicit authorization before public publication and separately before live payments.

## Stop conditions
Stop and request user intervention for missing credentials/permissions, ambiguous physical metadata, destructive migrations, unexpected production resources, payment activation, or inability to prove stock/approval invariants. Report verified progress separately from proposed work.

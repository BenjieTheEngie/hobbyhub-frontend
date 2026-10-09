# Hobby Hub publication and checkout readiness (no write actions)

The admin Inventory 2.0 workspace shows an additional **Publication & checkout readiness** report.

This is deliberately **a review, not a publisher or a checkout switch**. The existing legacy Products DynamoDB records have `status: ACTIVE` and no `published` attribute. Active status alone does not authorize listing an item for sale. The public catalog must require an explicit `published: true` flag plus a unique SKU, valid positive price, and verified Stock V2 available quantity.

The per-product audit checks:
- Immutable unique `productId` and case-insensitive unique SKU across the authenticated product list
- Product name, `status: ACTIVE`, and non-archived state
- Explicitly approved `published: true`, never inferred from status
- Positive, valid, integer-cent sale price
- Authenticated Stock V2 source and internally consistent `onHand`, `reserved`, `available`, `version`; original Inventory physical counts do **not** count
- For **carrier checkout** preparation, measured packed inches/ounces stored in a verified server shipping profile; data kept only in browser CSV/localStorage does **not** count

Even if every product passes its data checks, payments stay disabled until paid-order handling, tax, production carrier quotes, idempotent reservation and release, authenticated fulfillment, shipping policies and Stripe webhook signatures are tested. The UI cannot publish, initiate a checkout, reserve stock, charge a card, or modify an AWS record.

Before enabling public catalog publication, add an explicitly authorized administrative publication workflow with audited approval by immutable `productId`, a server-side default `false`, and verification that the existing product update Lambda truly preserves publication fields; **do not mass-publish current records**.

No existing product values, DynamoDB tables, IAM settings, checkout flags, or AWS deployments are modified by this report.

# Hobby Hub customer-facing catalog: explicit launch readiness

**No storefront publication or AWS writes are performed by this audit.**

The existing Hobby Hub Products table currently reports seven `ACTIVE` products but does not have an explicitly approved `published:true` value on those rows. Their counts live separately in the legacy Inventory table. Publishing them just because they are active would be unsafe.

The new admin-only `CatalogReadinessPanel` uses local, loaded authenticated records to label each item as ready for final review or blocked. Eligibility requires:
- immutable, unique productId and SKU with no duplicate SKU group;
- non-empty product name, active status and a valid positive USD sale price;
- explicit `published:true` from the backend, never inferred from `status:ACTIVE`;
- valid versioned **Stock V2** availability with explicit onHand/reserved and positive available-to-sell;
- server-stored package dimensions/weight, not a browser-local measurement draft.

Product images are recommended but shown separately as an advisory, not automatically required for sale. Missing values remain blocking, never filled with placeholders.

**This is a review tool, not a publication editor.** It does not add publish/unpublish routes, payment sessions, stock reservations, carrier labels or migrations. Do not mark a legacy record `published:true` until the product ownership, price, condition, packaging, verified stock cutover and seller approvals are all explicitly reviewed.

Run `node --test tests/catalog-readiness.test.mjs` for the offline regression checks. The dashboard appears below the Inventory workspace for authenticated administrators and has no save button.

# Limited pilot order paperwork audit — OFFLINE ONLY

## What is new

The signed-in Hobby Hub admin page includes a **Manual sales paperwork audit** panel next to the read-only customer orders dashboard. It downloads a **blank CSV** and validates an operator-prepared CSV in browser memory. It does not send file data to AWS, Stripe, Vercel, EasyPost or any other service, persist data in browser storage, or produce an order/stock write. Clearing or leaving the admin panel discards the imported view. Source: `src/lib/pilotLedger.js`, UI: `src/components/PilotOrderAudit.jsx`.

This is **not** the authoritative order ledger. The manually maintained original worksheet and payment/shipping provider accounts remain the independent sources of record. The UI is a document-completeness check only. It cannot validate the truth of an invoice, payment confirmation, inventory check, tax assessment or tracking number.

## How to use the worksheet

1. Sign in to admin, go to **Manual sales paperwork audit**, and download the **blank** CSV template. Do not include customer names, addresses, emails, phone numbers, account credentials or card data.
2. For each pending or completed line item enter the following columns (one row per unique orderRef/productId):
   - `orderRef` is your own opaque unique reference, never the customer name.
   - `productId` is the immutable physical identifier from the original Products/Inventory records. Never use SKU as an AWS key.
   - `sku` is a human label, checked for ambiguous SKU mapping.
   - `quantity` is 1–20 whole units for the line. The CSV does **not** reserve them.
   - `stockCheckedAt` is an operator-attested date (`YYYY-MM-DD`). It must be freshly reverified against original Inventory and any other channel just before confirming the sale. It is **not** a verified count returned by the app.
   - `parcelMeasured` and `usDestinationReviewed` are literal `YES` or `NO` attesting manual packing measurement and first-launch delivery eligibility (50 states plus DC; no international, territories, APO/FPO or pickup).
   - `carrierQuoteRef` identifies a **real** production carrier rate quote; test-mode EasyPost rate IDs do not qualify for payment authorization.
   - `taxReviewRef` identifies the reviewed tax treatment / final total work.
   - `hostedInvoiceRef` is the reference in a permitted external hosted invoice platform.
   - `providerStatus` must be one of `NOT_REQUESTED`, `INVOICE_SENT`, `PAID_CONFIRMED`, `FAILED`, `REFUNDED`, `DISPUTED`. These are user-entered claims, **not** evidence.
   - `paymentEvidenceRef` identifies the matching confirmation visible directly in the verified payment-provider account; required for the paperwork to be considered complete when providerStatus is `PAID_CONFIRMED`.
   - `trackingRef` is optional and should refer only to the external shipping provider.
3. Import the edited file. The browser shows missing evidence and refuses malformed headers, duplicate order/product pairs, ambiguous SKU mappings, unsupported statuses, malformed dates, spreadsheet-formula-like reference payloads and conflicting payment claims on separate lines of the same order.
4. Manually verify all information with physical stock, the hosted payment service and carrier before any packing or shipment. A fully completed worksheet **does not** authorize shipping or charging, and does not change website checkout readiness.
5. Keep the original worksheet in a secure merchant-controlled location. No customer PII should be stored in it. Protect access and retention; an exported CSV should not be treated as a secure personal-data store.

## Remaining required systems

This helper supplies **no** customer checkout, no secure customer address/identity vault, no order creation endpoint, no payment verification, no tax computation, no stock reservation, no carrier pricing and no shipping label purchase. Payments stay OFF. Original Inventory stays untouched. An approved hosted invoicing provider, manual order tracking with staff procedures and documented owner go/no-go confirmation are required before a paid limited pilot. See `docs/OCTOBER_16_PILOT_GATES.md` and `docs/LEGACY_CHECKOUT_QUARANTINE.md`.

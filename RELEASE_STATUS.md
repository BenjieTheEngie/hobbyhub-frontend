# Hobby Hub — Storefront release status (October 8, 2026)

## Deployed-capable frontend
- Modern responsive storefront with categories, search, sorting, product details, and an inventory-aware cart.
- No fabricated sample products and no fake order success. Checkout is **disabled** pending real order/payment backend and fulfillment.
- Cognito sign-in and email-code password reset remain in the current App.jsx.
- Admin: product entry, existing SKU editing, server-side stock updates and delete operations (the last two require PUT and DELETE product routes).
- Magic Scryfall name and exact-printing lookup, Yu-Gi-Oh! text lookup.
- Batch SKU-matched images, a single image uploader, image scanner, barcode camera on supported browsers, manual barcode entry and CSV bulk intake.
- The admin upload/scanner controls call secured AWS endpoints; if these endpoints are not deployed, they return errors without pretending to succeed.

## Infrastructure required before commercial launch
1. **Back-end source and table verification:** Need the actual AWS SAM/CloudFormation backend and the DynamoDB product table name and partition-key schema. A standalone add-on implementation exists in the implementation package; do not deploy against an unknown table.
2. **Public product catalog:** Deploy GET /catalog (published products only, public fields only) and set the HTTPS `VITE_PUBLIC_CATALOG_URL` in Vercel. Until then, the public store shows a coming-soon message and does not leak secured products.
3. **Product editing:** Verify PUT /products/{sku} and DELETE /products/{sku}; currently existing API is known to have POST /products and GET /products but other methods aren't verified. Enforce Cognito admin permissions.
4. **Photo uploads:** Provision private S3 signed staging uploads, file checks and public CloudFront image URLs; set VITE_MEDIA_API_BASE_URL. Optional AWS OCR and paid visual-recognition providers require account approval.
5. **Checkout:** Connect AWS orders, stock reservation and verified Stripe test webhooks, test concurrency, shipping/tax and refunds. Only then consider real payment handling. NEVER store Stripe secrets in React/Vercel VITE_* config.

## Acceptance checklist
- Vercel preview Vite build passes.
- Admin sign-in + forgot password still works on iPhone and desktop.
- Public page shows no unpublished or fabricated products.
- Product create/write response is verified on real AWS data; new edits and deletes are tested against a staging table first.
- File/photo/scan APIs have been deployed and tested before telling customers they work.
- No real payments until order lifecycle tested end to end.

The code includes frontend hooks for pending AWS endpoints; it does NOT itself provision AWS or enable live transactions.

# Shipping Profiles V2 — versioned AWS DRAFT storage (not deployed)

**Owner-approved direction:** U.S.-only, shipping-only checkout with carrier-calculated rates from measured packed weight/dimensions and U.S. destination. **Payment collection remains disabled.**

This new source-ready module prepares durable, server-side package measurements while preserving the legacy Products and Inventory tables **without modification**. The current measured packaging CSV and local editor remain usable without AWS.

## New backend foundation

- `backend/shipping-profiles-v2-logic.mjs`: validates actual merchant measurements (inches/ounces), stores DRAFT profiles by immutable `productId`, checks exact `version` before updates, writes independent idempotency audit plans, and refuses promotion into public checkout.
- `backend/shipping-profiles-v2.mjs`: authenticated/admin-only `GET /ops/shipping/profiles`, `GET /ops/shipping/profiles/{productId}`, and `PUT /ops/shipping/profiles/{productId}`. PUT checks the original Products record via GetItem; it is disabled by default and uses a conditional DynamoDB transaction with a unique request ID. All read results remain draft-only.
- `aws/shipping-profiles/template.yaml`: isolated API/Lambda plus **two new** DynamoDB tables with PITR, encryption and `Retain` deletion protections. Access to the existing Products table is **GetItem only**; there is **no permission** to mutate Products, Inventory, Stock V2, customer orders or payment records.
- `attachMeasuredDraftProfilesForSandbox` can join verified profiles into a server-owned test packing map, without mutating Products or enabling live checkout. This helper is not an API route.

## Write mode and security

By default `EnableProfileWrites=false`, which sets `HOBBYHUB_SHIPPING_PROFILE_WRITES_ENABLED=false`. This remains off until a separately authorized, reviewed staging deployment. The new API requires the verified existing Cognito pool/app client **and** a configured admin group or explicitly approved admin subject. At the 2026-10-09 review, Cognito had **no admin groups configured**, so role/bootstrap work remains before the service will accept admin calls.

Never connect the AWS Core **root** account principal to production write workflows. Use an audited least-privilege IAM role.

## Required staging checks before an AWS deployment

1. Obtain explicit owner approval for **new billable AWS infrastructure** and review the proposed CloudFormation change set. Keep Stock V2 writes, inventory cutover, Stripe checkout and shipment label purchasing disabled.
2. Validate `sam validate --lint --template-file aws/shipping-profiles/template.yaml`.
3. Deploy only in an isolated staging setup, with `EnableProfileWrites=false`.
4. Test unauthorized/unauthenticated access is rejected, and that original DynamoDB Products and Inventory remain unchanged. Verify `GET` returns an empty list before any draft import.
5. After separate write authorization, test inserting one disposable DRAFT package and updating it by exact version. Verify stale versions and duplicate request IDs fail safely.
6. Only then design a secure, audited admin CSV import using immutable `productId` and explicit review. Do not upload the browser-local CSV directly to an unverified API.
7. Enabling live checkout **also requires** signed Stripe webhooks, a validated payment/tax total, stock reservations and releases, and verified carrier production rates. `DRAFT` packaging is **never proof of payment readiness**.

## Current non-goals

No live AWS resource has been created by this PR. No package measurements were copied to AWS. No automatic public product publication, postal label creation, live tax calculation, shipping charges, or inventory adjustments. A customer cannot order from this module.

Run offline unit tests with `node --test tests/shipping-profiles-v2.test.mjs`.

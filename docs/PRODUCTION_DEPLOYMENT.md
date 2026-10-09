# Production deployment and release verification

Hobby Hub uses GitHub `main` as the source of frontend deployments on Vercel. The
production domain is `https://hobbyhub.company`. A successful GitHub build
does **not** automatically establish that the latest commit is serving on the
custom domain: separately verify Vercel's **production** deployment is READY
and its Git commit matches GitHub main.

## Safe release routine

1. Confirm all GitHub Actions checks pass for the release commit.
2. In Vercel, select team `benjietheengies-projects` and project
   `hobbyhub-frontend`. Check **Deployments** for the latest `main` commit.
3. If the production deployment is older, select the latest `main` deployment
   and deploy to **Production** using the Vercel dashboard, or choose
   **Redeploy** on an appropriate production deployment with latest-source
   build semantics. Do not accidentally redeploy the **old** commit.
4. Wait for **Ready** and verify `hobbyhub.company` points to that deployment.
5. Smoke-test public storefront, cart, saved items, and administrator login,
   existing product edit/delete safeguards, and CSV exports.
6. Confirm opt-in AWS integrations stay OFF until separately deployed, backed
   up and staged. In particular: no live Stripe checkout, no unverified stock
   mutations, no carrier-label buying. Vite `VITE_*` settings are public
   browser build values; never put API or Stripe secrets there.

## Common obstacles

- **Build-rate limit:** the Free/Hobby deployment quota may block new builds.
  A Pro upgrade changes plan entitlements, but it does not automatically
  reauthorize external API clients or release an already-failed deployment.
- **403 / scope forbidden:** review the Vercel team selected in the client or
  dashboard. Refresh/reconnect the Vercel integration with permission to
  access `benjietheengies-projects`. A plan upgrade by itself will not repair
  an expired or insufficient connection token.
- **Preview ready, production old:** a preview build does not move the
  `hobbyhub.company` alias. Verify the production target and domain alias.
- **Frontend live but shipping/stock unavailable:** AWS Stock V2, carrier
  sandbox and order APIs are separate, intentionally disabled services.
  Browser build success does not deploy them.

## Recovery

If the new frontend misbehaves, Vercel can roll back the production alias to a
previously verified good deployment. Do not use frontend rollback as a
replacement for DynamoDB backups or payment reconciliation.

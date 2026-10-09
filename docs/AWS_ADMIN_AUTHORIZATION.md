# Hobby Hub Cognito admin authorization and AWS access checklist

**No admin group or account permissions are changed by this file.**

Verified read-only from AWS on 2026-10-09:

- Region: `us-east-2`; account: `349744180170`.
- User pool: `us-east-2_5QRb2tWcT`.
- Public app client: `9qrtgdn5dtoqhc3brmr03mgn0`, no client secret, user-password auth enabled.
- API Gateway Cognito JWT authorizer issuer/audience match this pool/client.
- The pool currently had **zero user groups**.
- AWS Core's AWS caller appeared as the **root identity**. AWS operations should ultimately use a dedicated, scoped IAM role.
- Products and Inventory have verified backups and PITR. They still must not be overwritten or migrated automatically.

## Required owner review before enabling new admin APIs

1. In the AWS Console, open Cognito → User pools → **hobby-hub-users**, then Groups.
2. After confirming the correct account/region, create an administrator group with the exact name `hobbyhub-admin`, **only if approved**. Group names are case-sensitive for AWS; the application checks a normalized exact match.
3. Identify the existing owner account in the user pool and add only that account to the group. Do not add all users, or use an email/password as an administrator allowlist.
4. Sign out and back into Hobby Hub to obtain a refreshed JWT with `cognito:groups`; verify that only the intended administrative account can load `/stock` and `/ops/legacy-stock`. A correctly configured read-only Lambda must reject anonymous and ordinary users.
5. Alternatively, the optional `AllowedAdminSubs` parameter can list explicitly approved immutable Cognito `sub` values, but avoid setting this unless ownership has been verified. Never put credentials or JWTs in GitHub or chat.
6. Grant a future deployment operator a narrow IAM role limited to CloudFormation staging stacks, protected log inspection, and appropriately scoped Lambda/API actions. Avoid linking ChatGPT through permanent root account keys.
7. Roll out only isolated stacks in staging, with Stock V2 `EnableStockWrites=false` and `EnableStockInitialization=false`, and do not set checkout/Stripe payment credentials.

## Automated assurance

`tests/admin-authorization.test.mjs` now verifies:
- No claim/no group means no admin privileges.
- Exact group membership or an explicitly allowed `sub` is required.
- HTTP request headers or JSON bodies cannot impersonate signed Cognito groups.
- API responses are non-cacheable and restricted to the expected frontend origin.

**This is not a substitute for staging JWT, group membership, CloudFormation and IAM role verification.**

No AWS resources or users were changed during this code update.

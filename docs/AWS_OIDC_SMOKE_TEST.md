# GitHub Actions → AWS IAM OIDC: safe first smoke test

**Verified on 2026-10-09 by read-only AWS calls:**

- AWS account `349744180170`; deployment region `us-east-2`.
- GitHub OIDC provider `arn:aws:iam::349744180170:oidc-provider/token.actions.githubusercontent.com`; audience `sts.amazonaws.com`.
- Role `arn:aws:iam::349744180170:role/HobbyHubStagingDeploy` exists.
- Role trust requires `sts:AssumeRoleWithWebIdentity`, audience `sts.amazonaws.com`, and exactly `repo:BenjieTheEngie/hobbyhub-frontend:ref:refs/heads/main` (duplicated exact condition in current policy; duplicate has no additional privilege).
- Role has **zero attached managed policies and zero inline policies**. It cannot deploy infrastructure yet.
- AWS Core app connection still reports `arn:aws:iam::349744180170:root`: **it does not automatically inherit GitHub OIDC role credentials**.

## Smoke test

`.github/workflows/aws-oidc-identity-check.yml` runs when merged into `main` or manually launched through Actions → AWS OIDC identity smoke test → Run workflow → `main`.

The workflow:
1. Runs only in the trusted default-branch context. It does not run in pull requests; the role's trust policy disallows PR refs.
2. Requests short-lived AWS STS credentials via `aws-actions/configure-aws-credentials@v4`, with `id-token:write`, an explicit role ARN, 15-minute session, `us-east-2`, and a pinned expected account ID.
3. Runs **only** `aws sts get-caller-identity` and checks the account and `HobbyHubStagingDeploy` assumed-role ARN. This operation requires no IAM permission policy.
4. Contains **no** CloudFormation/SAM, DynamoDB, Stripe, Secrets Manager, Lambda or API Gateway calls, and no persistent AWS access keys.

A passing run proves GitHub Actions can temporarily assume the role. It does **not** prove the role can build/deploy SAM stacks, nor that the AWS Core ChatGPT connector uses it.

## After successful smoke test

**Do not attach AdministratorAccess, PowerUserAccess, AWSCloudFormationFullAccess, IAMFullAccess or wildcards to the role.** We should next construct narrowly scoped staging policies, including a *separate CloudFormation execution role* and explicit resource naming. Plan for staging stack naming (`hobbyhub-staging-*`), restrictions for IAM PassRole, Lambda, API Gateway, DynamoDB, S3 deployment artifacts and Secrets Manager test-only references, with no original Products or Inventory access. IAM and CloudFormation permission boundaries must be validated before any billable AWS create/modify call. Preserve `HOBBYHUB_STRIPE_LIVE` disabled and all Stock V2 writes/init disabled by default.

The role is intended **for GitHub Actions deployment automation only**, not for direct ChatGPT AWS Core authentication. Switching AWS Core off root is a separate authorization setup step and should be handled without sharing keys or secrets in chat.

Reference: `docs/STRIPE_STAGE_DEPLOY_AND_TEST_PLAN.md`.

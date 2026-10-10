# Checkout V2 sandbox: preview-only IAM policy review (NOT APPLIED)

**Status: proposed GitHub source files only. No IAM roles were created or modified; no Checkout V2 tables, stacks or change sets have been created by this task. The already deployed Stripe TEST ledger stack is a separate, unchanged resource.**

The new `aws/checkout-v2-sandbox-foundation/template.yaml` is a standalone `sandbox` CloudFormation source defining exactly two initially empty DynamoDB tables, Orders V2 keyed by `orderId` and Stock V2 keyed by `productId`. Checkout and stock migration are immutable `false`. See `docs/CHECKOUT_V2_SANDBOX_FOUNDATION.md`.

## Three proposed source policies/workflows

- `aws/iam/hobbyhub-checkout-v2-preview-policy.json`: to be applied **only after separate owner authorization** to existing GitHub OIDC role `HobbyHubStagingDeploy`. CloudFormation actions include `CreateChangeSet`/inspection/cleanup on the **one new** stack `hobbyhub-checkout-v2-sandbox-foundation`. Explicitly **no** `CreateStack`, `ExecuteChangeSet`, `UpdateStack` or `DeleteStack`. `iam:PassRole` is limited to one new named service execution role `HobbyHubCheckoutV2SandboxCfnExec` and only when passed to CloudFormation.
- `aws/iam/hobbyhub-checkout-v2-exec-trust.json` and `aws/iam/hobbyhub-checkout-v2-exec-policy.json`: source for a **new, not-yet-created** service execution role. It trusts only `cloudformation.amazonaws.com` and allows only table **control-plane** creation/configuration for table names beginning with `hobbyhub-checkout-v2-sandbox-foundation-OrdersV2-` and `hobbyhub-checkout-v2-sandbox-foundation-StockV2-`. No data reads/writes, no original Products or Inventory, no stripe-test-event ledger, no API, Lambda, Secrets Manager, IAM management or table deletion. AWS CloudFormation generated physical names can be discovered only **after a separately authorized actual deployment**.
- `.github/workflows/aws-checkout-v2-foundation-preview.yml`: manual opt-in GitHub Actions job restricted to `main` and the exact confirmation `PREVIEW_NO_DEPLOY`. It validates the inert template, assumes temporary OIDC credentials from the expected account, refuses to modify an existing stack, and creates one **unexecuted** CloudFormation change set. Its postcondition checks that the change set proposes exactly two DynamoDB table additions and nothing else. This workflow never deploys resources and cannot execute the change set under the draft policy. **Do not trigger it before owner approval.**

## Actual AWS IAM policy simulator checks (read-only)

Using `iam:SimulateCustomPolicy` on October 10, 2026, the draft JSON returned:

| Action | Expected and simulated result |
| --- | --- |
| GitHub create a change set on sandbox Checkout V2 stack | allowed |
| GitHub directly create the sandbox stack | implicitDeny |
| GitHub execute the sandbox change set | implicitDeny |
| GitHub create a change set on original `hobbyhub` stack | implicitDeny |
| GitHub pass only the named Checkout V2 sandbox CloudFormation role | allowed |
| GitHub pass the earlier Stripe ledger execution role | implicitDeny |
| CloudFormation create a new prefixed Orders V2 table | allowed |
| CloudFormation create a new prefixed Stock V2 table | allowed |
| CloudFormation create or modify old Inventory | implicitDeny |
| CloudFormation create a Stripe event ledger table | implicitDeny |
| CloudFormation PutItem to proposed Stock V2 | implicitDeny |
| CloudFormation Scan proposed Orders V2 | implicitDeny |

Simulations **do not** create AWS principals or prove a future CloudFormation deployment will succeed. All tests operated only against policy JSON and simulated ARNs; no data-plane calls were made.

## Approval gate: ask before every potentially billable execution

The owner explicitly requested: **ask before execution for any operation that can incur AWS, Stripe, shipping, API, or other usage charges.** Having promotional credits does not automatically make actions free or imply approval to spend them.

Before any IAM policy attachment, role creation, change-set preparation or table execution:
1. Re-check the actual AWS account, region, active roles, effective IAM permissions and whether the proposed stack already exists; do not assume this source review matches the account.
2. Provide the owner with the operation, affected named resources, credible cost estimate/uncertainty, relevant storage/PITR retention obligations, and whether it can continue accruing charges. Secure explicit approval for the specific execution.
3. Perform the action **only through a non-root, least-privilege identity**. The connected ChatGPT AWS Core account has historically authenticated as root; do not use that connection for creating IAM roles, resources or data writes.
4. Validate the preview's proposed changes exactly; executing a change set to create these two sandbox tables must require a **separate, explicit approval**. Do not attach AdministratorAccess or broad CloudFormation permissions.
5. Keep Checkout V2 test-only and fail-closed until server-side Stripe signatures, published SKU decisions, complete stock migration, tax, real carrier quotes, and atomic Order/Stock/event settlement are verified.

Unit tests: `node --test tests/checkout-v2-staging-iam-policy.test.mjs tests/aws-checkout-v2-foundation-preview.test.mjs`. This workflow is for security review and not a shortcut to enabling payments.

**Existing two Stripe ledger DynamoDB tables remain separate and must not be deleted, replaced or written as part of this task.**

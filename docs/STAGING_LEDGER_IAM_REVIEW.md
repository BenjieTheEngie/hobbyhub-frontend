# Proposed staging-only AWS IAM policy set — NOT APPLIED

**REVIEW DRAFT ONLY. No policy has been attached, no IAM role has been created by these files, and no AWS ledger table has been deployed. Seven representative read-only AWS IAM policy simulations succeeded on October 10, 2026. End-to-end CloudFormation deployment is still unverified.**

The GitHub OIDC connection was tested successfully with `HobbyHubStagingDeploy`, but that role currently has **ZERO** AWS resource permissions. Do not attach `AdministratorAccess`, `PowerUserAccess`, `AWSCloudFormationFullAccess` or broad DynamoDB grants to unblock deployment.

These JSON documents describe the **smallest useful first staging step**: potentially creating **only two empty, retained Stripe TEST ledgers** in account `349744180170`, region `us-east-2`, stack `hobbyhub-stripe-sandbox-ledgers`. They are NOT permissions for future Lambda, API Gateway, Secrets Manager, stock migration, orders or production Stripe.

## Two-role separation

1. **GitHub OIDC entry role:** already verified existing `HobbyHubStagingDeploy`. Proposed inline policy `aws/iam/hobbyhub-ledger-github-deploy-policy.json` permits **preview-only** CloudFormation change-set/stack API operations (explicitly excluding `CreateStack`, `ExecuteChangeSet` and `UpdateStack`) **only** on the named sandbox ledger stack and `iam:PassRole` **only** for a separately restricted execution role when passed specifically to `cloudformation.amazonaws.com`.
2. **CloudFormation execution role:** **does NOT exist** yet. Proposed name `HobbyHubStagingLedgerCfnExec`, trust document `aws/iam/hobbyhub-ledger-cfn-exec-trust.json`, permission document `aws/iam/hobbyhub-ledger-cfn-exec-policy.json`. Permissions are exclusively non-data DynamoDB table control-plane operations for table name prefixes belonging to the two new sandbox ledgers. Explicitly no `dynamodb:PutItem`, `GetItem`, `Query`, `Scan`, `DeleteItem`, `TransactWriteItems`, IAM principals or old inventory table permissions. No `DeleteTable` provisioned; tables also use CloudFormation Retain/PITR.
3. The execution role is restricted **by what it can do**, even if someone with separate authority could cause CloudFormation to use it. Its service trust alone does not restrict which CloudFormation stack may invoke it; attaching the exact policy and limiting `iam:PassRole` is essential. Confirm any confused-deputy conditions with AWS IAM before creation.

## Verified read-only policy simulation — October 10, 2026

AWS IAM `SimulateCustomPolicy` was executed against the exact proposed policy JSON, **without attaching either policy or changing an IAM role**.

| Sample operation | Simulation decision | Intended result |
| --- | --- | --- |
| GitHub role create named sandbox CloudFormation stack | allowed | Expected allow |
| GitHub role create original `hobbyhub` stack | implicitDeny | Expected deny |
| GitHub role pass only `HobbyHubStagingLedgerCfnExec` to CloudFormation | allowed | Expected allow |
| GitHub role pass an unrelated admin role | implicitDeny | Expected deny |
| CloudFormation role create named Stripe sandbox ledger table | allowed | Expected allow |
| CloudFormation role create original Inventory table | implicitDeny | Expected deny |
| CloudFormation role write an item into new sandbox ledger | implicitDeny | Expected deny |

**These are policy simulations, not actual deployment tests.** They cannot guarantee success for all CloudFormation/PITR/tagging operations, template change sets, IAM permission boundaries or organization-level restrictions. Continue independent review before applying.

## Approval and deployment sequence

The merchant has indicated that the account's $120 promotional credits may be used for necessary staging development. **This does not remove the need to bootstrap IAM through a non-root operational principal and review any CloudFormation execution separately.** Before any write:

1. Provision a non-root administrative/bootstrap identity or have the account owner securely perform the one-time IAM bootstrap; do not use the root-connected AWS Core session to create infrastructure. Review creation of the new IAM execution role and narrowly scoped policy attachment. The existing GitHub OIDC role will otherwise remain an authentication-only smoke-test identity.
2. Run AWS IAM Policy Simulator or an equivalent reviewer-verified test for **both** roles and the exact CloudFormation change-set actions and DynamoDB PITR/Retain behavior. A tool-based positive test is not a substitute for independent policy review. Resolve missing least-privilege permissions *without using wildcard admin grants*.
3. Confirm available credits, credit eligibility and expiration and establish a budget alert; then separately review potentially **billable** creation of the **two empty sandbox DynamoDB tables** and their PITR configuration, with expected retention and a small cost budget. Review a concrete CloudFormation change set before execution; no deployment of the original `hobbyhub` stack.
4. After explicit approval, create the narrow CloudFormation execution role, attach reviewed policies, and run first staging changes with GitHub OIDC on the trusted main branch. Validate account ID, new table prefix, region, key schema, encryption, PITR and empty records. Do not configure Stripe payment collection.
5. For a future Stripe webhook Lambda, new CUSTOMER Orders and Stock V2, **start a separate least-privilege permission review**. This first draft does not authorize them.

## Security invariants

- No policy lists the original `hobbyhub-ProductsTable-KC31XDEOENBG` or `hobbyhub-InventoryTable-X2IRQDAGW7WB` ARNs. No bulk data access or stock write permissions granted.
- GitHub entry role's OIDC trust is restricted to `repo:BenjieTheEngie/hobbyhub-frontend:ref:refs/heads/main` and audience `sts.amazonaws.com`.
- The ChatGPT AWS Core connector is **separate** from GitHub Actions' OIDC identity and currently still reports AWS root. These policy files do not fix that connection or change account credentials.
- One-week launch timing does not supersede IAM approval, physical inventory review, product conditions, shipping/returns policies, production taxes or authenticated payment settlement tests.

Unit test: `node --test tests/aws-staging-ledger-policies.test.mjs`. See `docs/STRIPE_V2_LEDGER_FOUNDATION.md`.

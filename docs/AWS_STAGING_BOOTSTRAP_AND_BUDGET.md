# Hobby Hub AWS sandbox: merchant IAM bootstrap + cost controls

**Operator instructions.** Prepared October 9, 2026. The repository includes the exact JSON files, but **no IAM policy is attached, no CloudFormation service role is created, no sandbox table is deployed, and no AWS Budget has been configured as of the latest read-only verification**.

## Verified credits and cost policy

AWS Billing `GetCredits` returned **two ENABLED promotional credits, $100 and $20 remaining ($120 combined), both ending April 20, 2027** (UTC). The eligible product list includes **Amazon DynamoDB, AWS Lambda, Amazon API Gateway, AWS CloudFormation, AWS Secrets Manager, and AWS Budgets**. Credits apply automatically to eligible usage but **do not cap charges**; AWS may bill for ineligible services, expired credits, or overruns. The AWS Budgets API showed **zero budgets**. Cost Explorer is not enabled for this account, so this review did **not** verify total unbilled usage or forecast.

**Recommended merchant action, before staging spend:** Open [AWS Billing and Cost Management — Budgets](https://console.aws.amazon.com/costmanagement/home#/budgets) and create a monthly **COST** budget for **$25**, with alert emails to the account owner's monitored address at **$10 and $20 actual spend** (e.g. 40% and 80%). Optionally add 100% threshold. The budget is an **alert, not an automatic shutoff**. Revisit it when the merchant sets an acceptable lifetime and monthly spend cap. Do not share billing email or account credentials in GitHub or chat.

## Bootstrap from AWS console (one-time privileged IAM administrative step)

Because the connected ChatGPT AWS Core identity is currently **root**, ChatGPT has **not** used it to mutate IAM or resources. The repository's `HobbyHubStagingDeploy` role has proven GitHub OIDC authentication but **no AWS resource permissions**, so GitHub cannot create or preview a change set until a merchant-operated privileged console identity configures two narrowly scoped roles.

1. AWS account `349744180170` → **IAM → Roles → Create role**. Choose **Custom trust policy**, using only the JSON at [`aws/iam/hobbyhub-ledger-cfn-exec-trust.json`](https://github.com/BenjieTheEngie/hobbyhub-frontend/blob/main/aws/iam/hobbyhub-ledger-cfn-exec-trust.json). Create role named **`HobbyHubStagingLedgerCfnExec`** with no managed policies, and review the resulting trust (CloudFormation service only).
2. Open `HobbyHubStagingLedgerCfnExec` → Permissions → **Add permissions → Create inline policy → JSON**. Paste exactly the reviewed [`aws/iam/hobbyhub-ledger-cfn-exec-policy.json`](https://github.com/BenjieTheEngie/hobbyhub-frontend/blob/main/aws/iam/hobbyhub-ledger-cfn-exec-policy.json). Name it `HobbyHubLedgerTableControlOnly`. Verify there are **no DynamoDB item reads/writes, no DeleteTable, no IAM actions**, and no legacy inventory table ARNs. The policy restricts CloudFormation's new tables to the two sandbox naming patterns in us-east-2.
3. Open existing role **`HobbyHubStagingDeploy`** → Permissions → **Add permissions → Create inline policy → JSON**. Paste the *latest* [`aws/iam/hobbyhub-ledger-github-deploy-policy.json`](https://github.com/BenjieTheEngie/hobbyhub-frontend/blob/main/aws/iam/hobbyhub-ledger-github-deploy-policy.json). Name it `HobbyHubLedgerPreviewOnly`. **IMPORTANT:** This initial policy must *not* contain `cloudformation:ExecuteChangeSet`, `cloudformation:UpdateStack`, or wildcard administrators. Its `iam:PassRole` must reference **only** `HobbyHubStagingLedgerCfnExec` passed to CloudFormation. Leave the existing GitHub OIDC trust restricted to `repo:BenjieTheEngie/hobbyhub-frontend:ref:refs/heads/main`.
4. Once the above are in place, have the assistant **read back and verify** both roles and attached/inline policies through AWS, then rerun the offline policy simulation. Do not assume the console configuration matches merely because IAM reported success.

**Avoid root access keys, AWS long-lived access keys, `AdministratorAccess`, `PowerUserAccess` or `AWSCloudFormationFullAccess`.** Use a dedicated non-root privileged/bootstrap user/session where available, and secure root with MFA.

## Preview only, no database creation

After GitHub's policy and execution role are verified:

1. Open [GitHub Actions — Hobby Hub](https://github.com/BenjieTheEngie/hobbyhub-frontend/actions).
2. Open **Preview Stripe sandbox ledgers in AWS (NO DEPLOY)**.
3. Select **Run workflow**, branch `main`, and type `PREVIEW_NO_DEPLOY`.
4. The workflow uses 15-minute GitHub OIDC credentials and creates an **unexecuted** CloudFormation change set in region `us-east-2`, account `349744180170`, stack `hobbyhub-stripe-sandbox-ledgers`.
5. It asserts **exactly two DynamoDB table additions**, then stops. It cannot execute the change set because the IAM policy excludes `ExecuteChangeSet`. A review-only placeholder stack/change set may appear in CloudFormation; no table is created by merely preparing a change set.

**Final real deployment remains a separate action:** review the exact change set, cost/retention, and billable two-table creation; then explicitly authorize narrowly adding execution permission and executing **only that reviewed change set** using the GitHub OIDC role. No root-based deployment. The merchant's general permission to use available AWS credits does not bypass test-only safety gates or authorize live Stripe charges.

See `docs/STAGING_LEDGER_IAM_REVIEW.md`, `docs/AWS_OIDC_SMOKE_TEST.md`, and `docs/STRIPE_V2_LEDGER_FOUNDATION.md`.

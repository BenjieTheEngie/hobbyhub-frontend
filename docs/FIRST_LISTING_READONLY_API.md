# First-listing read-only staging API

This is a **proposed, undeployed** standalone AWS SAM stack. It references the three existing Hobby Hub DynamoDB tables by name, does not create tables, and grants its Lambda only `dynamodb:GetItem` on exact table ARNs. The HTTP API requires Cognito JWT and the Lambda additionally enforces admin-group membership.

The only route is `GET /ops/first-listing-readiness`, which retrieves the exact Lightning Bolt product, Stock V2 record, and approval record and returns a conservative readiness report. It cannot publish, initialize stock, migrate data, or accept payments.

## Next deployment gates

1. Verify account `349744180170`, region `us-east-2`, actual Cognito group membership and all three table schemas.
2. Build and validate `aws/first-listing-readonly/template.yaml` with SAM. Package AWS SDK dependencies in the Lambda artifact (frontend npm dependencies do not include the AWS SDK).
3. Review CloudFormation change set and its API Gateway, Lambda, IAM and CloudWatch resources. This **will incur AWS charges** and needs targeted owner approval before deployment.
4. After approved deployment, test unauthenticated 401, non-admin 403, admin GET response and CORS, then configure the admin UI to use the new HTTPS API root. No publication or payment switches should be enabled.

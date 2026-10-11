import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('../infra/first-listing-ledgers-sandbox.yaml',import.meta.url),'utf8');
test('listing ledgers are isolated DynamoDB-only infrastructure',()=>{
 assert.equal((template.match(/Type: AWS::DynamoDB::Table/g)||[]).length,2);
 assert.doesNotMatch(template,/AWS::(Lambda|IAM|ApiGateway|SQS|SNS|SecretsManager)::/);
 assert.doesNotMatch(template,/AWS::Serverless::/);
 assert.match(template,/AttributeName: requestId/);
 assert.match(template,/AttributeName: productId/);
});
test('both ledgers have PITR, encryption, retain policies and on-demand billing',()=>{
 for(const pattern of [/PointInTimeRecoveryEnabled: true/g,/SSEEnabled: true/g,
 /DeletionPolicy: Retain/g,/UpdateReplacePolicy: Retain/g,/BillingMode: PAY_PER_REQUEST/g])
 assert.equal([...template.matchAll(pattern)].length,2);
});

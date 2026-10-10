import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>JSON.parse(readFileSync(new URL('../aws/iam/'+path,import.meta.url),'utf8'));
const github=read('hobbyhub-ledger-github-deploy-policy.json');
const service=read('hobbyhub-ledger-cfn-exec-trust.json');
const execution=read('hobbyhub-ledger-cfn-exec-policy.json');
const statements=github.Statement;
const allowedActions=statements.flatMap(s=>Array.isArray(s.Action)?s.Action:[s.Action]);
const execActions=execution.Statement.flatMap(s=>Array.isArray(s.Action)?s.Action:[s.Action]);

test('GitHub deployment role can alter only its one known sandbox CloudFormation stack',()=>{
  assert.equal(github.Version,'2012-10-17');
  assert.equal(statements.length,2);
  const cfn=statements.find(x=>x.Sid==='PreviewOnlySandboxStripeLedgerCloudFormationChangeSet');
  assert.equal(cfn.Resource,'arn:aws:cloudformation:us-east-2:349744180170:stack/hobbyhub-stripe-sandbox-ledgers/*');
  assert.equal(cfn.Effect,'Allow');
  for(const action of cfn.Action)assert.match(action,/^cloudformation:/);
  assert.ok(cfn.Action.includes('cloudformation:CreateChangeSet'));
  assert.ok(!cfn.Action.includes('cloudformation:ExecuteChangeSet'));
  assert.ok(!cfn.Action.includes('cloudformation:CreateStack'));
  assert.ok(!cfn.Action.includes('cloudformation:UpdateStack'));
  assert.ok(!cfn.Action.includes('cloudformation:DeleteStack'));
  assert.ok(!cfn.Action.includes('cloudformation:CreateStackSet'));
});
test('GitHub role can pass only named limited CloudFormation execution role',()=>{
  const pass=statements.find(x=>x.Action==='iam:PassRole');
  assert.ok(pass);
  assert.equal(pass.Effect,'Allow');
  assert.equal(pass.Resource,'arn:aws:iam::349744180170:role/HobbyHubStagingLedgerCfnExec');
  assert.deepEqual(pass.Condition,{StringEquals:{'iam:PassedToService':'cloudformation.amazonaws.com'}});
  for(const a of allowedActions)assert.ok(a==='iam:PassRole'||a.startsWith('cloudformation:'));
});
test('CloudFormation service may assume ledger role but receives NO broad privileges',()=>{
  assert.deepEqual(service,{
    Version:'2012-10-17',
    Statement:[{Sid:'TrustOnlyAWSCloudFormationService',Effect:'Allow',
      Principal:{Service:'cloudformation.amazonaws.com'},Action:'sts:AssumeRole'}]
  });
  assert.equal(execution.Version,'2012-10-17');
  assert.equal(execution.Statement.length,1);
  const p=execution.Statement[0];
  assert.equal(p.Effect,'Allow');
  assert.deepEqual(p.Resource,[
    'arn:aws:dynamodb:us-east-2:349744180170:table/hobbyhub-stripe-sandbox-ledgers-StripeTestEventLedger-*',
    'arn:aws:dynamodb:us-east-2:349744180170:table/hobbyhub-stripe-sandbox-ledgers-StripeTestCheckoutRequestLedger-*'
  ]);
  for(const action of execActions)assert.match(action,/^dynamodb:/);
  for(const disallowed of ['dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem',
    'dynamodb:TransactWriteItems','dynamodb:Scan','dynamodb:Query','dynamodb:DeleteTable'])
    assert.ok(!execActions.includes(disallowed),'Unexpected DDB permission '+disallowed);
  assert.ok(execActions.includes('dynamodb:CreateTable'));
  assert.ok(execActions.includes('dynamodb:UpdateContinuousBackups'));
});
test('reviewable policies have no administrator access, blanket wildcards or production inventory ARNs',()=>{
  for(const [name,p] of [['github',github],['execution',execution]]){
    for(const stmt of p.Statement){
      assert.notEqual(stmt.Resource,'*',name);
      assert.equal(stmt.Effect,'Allow');
      for(const a of Array.isArray(stmt.Action)?stmt.Action:[stmt.Action]){
        assert.ok(!a.includes('*'),name+' has a wildcard action');
        assert.ok(!a.startsWith('iam:Create'),name+' can create IAM principals');
      }
    }
  }
  const raw=JSON.stringify([github,execution]);
  assert.doesNotMatch(raw,/hobbyhub-ProductsTable|hobbyhub-InventoryTable|AdministratorAccess|PowerUserAccess|cloudformation:DeleteStack/);
});

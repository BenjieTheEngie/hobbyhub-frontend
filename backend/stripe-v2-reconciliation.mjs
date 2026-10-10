import {verifyStripeSandboxEnvelope} from './stripe-sandbox-webhook-boundary.mjs';
import {auditStripeSandboxSessionTotals} from './stripe-test-session-total-audit.mjs';
import {reviewSignedTestPaymentEvent} from './payment-webhook-review.mjs';

/**
 * Stripe V2 source-only payment reconciliation entry point.
 *
 * A future webhook Lambda MUST retrieve the Stripe Checkout Session using
 * trusted server credentials, strongly-consistently read the immutable order
 * and durable event history, and supply a server-only shipping HMAC key.
 * Do NOT let browser JSON or Lambda request fields supply these dependencies.
 *
 * This composes the three fail-closed gates in a mandatory sequence:
 *   raw Stripe HMAC -> retrieved Stripe session+carrier/tax totals
 *   -> durable event replay/atomic-settlement review.
 * It is NOT a Lambda handler and grants NO payment or stock writes.
 */
export function reviewStripeTestCheckoutReconciliation({
  request,stripeSdk,webhookSigningSecret,retrievedSession,
  order,checkedAt,destinationSigningKey,previousEvents
}={}){
  const signed=verifyStripeSandboxEnvelope({request,stripeSdk,webhookSigningSecret});
  const event=signed.event;
  if(!retrievedSession||event.sessionId!==retrievedSession.id||
     event.orderId!==retrievedSession.metadata?.orderId||
     event.orderId!==retrievedSession.client_reference_id||
     event.amountTotalCents!==retrievedSession.amount_total||
     event.paymentStatus!==retrievedSession.payment_status)
    throw Error('Stripe signed event and server-retrieved Checkout Session disagree.');
  const totals=auditStripeSandboxSessionTotals({
    session:retrievedSession,order,checkedAt,destinationSigningKey
  });
  const review=reviewSignedTestPaymentEvent({
    event,order,trust:signed.trust,previousEvents,receivedAt:checkedAt
  });
  // A paid invoice may be refunded, canceled, fail asynchronously, or arrive
  // after its reserved expiry. No boolean is enough to settle it; require a
  // future signed event + unique atomic write across exact order/stock rows.
  const pendingAtomicSettlement=
    totals.disposition==='MATCHED_TEST_PAYMENT_REQUIRES_ATOMIC_RECONCILIATION' &&
    review.disposition==='RECONCILE_PAID_AND_STOCK_ATOMICALLY';
  const requiresHumanReview=
    totals.disposition==='LATE_PAYMENT_REQUIRES_REVIEW'||
    review.disposition==='REVIEW_LATE_PAYMENT_AND_REFUND_POLICY'||
    review.disposition==='REVIEW_RELEASE_WITH_LATE_PAYMENT_SAFEGUARDS'||
    totals.disposition==='REVIEW_EXPIRED_SESSION_BEFORE_STOCK_RELEASE'||
    totals.disposition==='REVIEW_PROVIDER_STATE_MISMATCH';
  return Object.freeze({
    kind:'stripe-test-v2-inert-reconciliation',
    eventId:event.eventId,orderId:event.orderId,sessionId:event.sessionId,
    disposition:review.disposition,totalAuditDisposition:totals.disposition,
    pendingAtomicSettlement,
    requiresHumanReview,
    duplicateEvent:review.disposition==='ALREADY_REVIEWED',
    // All flags are ALWAYS false; positive planning is not execution.
    executable:false,paymentWriteAuthorized:false,
    stockWriteAuthorized:false,fulfillmentAuthorized:false,
    paymentCollectionEnabled:false
  });
}

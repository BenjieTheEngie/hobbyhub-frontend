# Stripe TEST event-ledger race: avoid stale Order V2 settlement acknowledgment

**Offline source and regression tests only. No AWS writes, Lambda deployment, payments, labels or inventory actions.**

While recording a Stripe TEST webhook into the event inbox, two backend workers can simultaneously receive the same signed provider event. They begin with independent, strongly consistent reads of the event ledger and the current `Order V2` snapshot. One worker may win the atomic conditional `PutItem`, and another worker may then **atomically settle** event + order + stock before the losing worker's `PutItem` returns `ConditionalCheckFailedException`.

Before this change, the losing worker re-read only the event row, accepted a valid `SETTLED` state and returned `requiresDurableSettlement:false`, even though its **order snapshot was read before settlement**. This did not itself permit a charge or stock write, but it could falsely acknowledge that the durable order/stock transition had been cross-checked.

The losing worker now:
1. Validates the exact signed webhook identity and fingerprint against the newly read event row (including settlement metadata).
2. If the row is still `PENDING_REVIEW`, returns the normal **no-write** duplicate receipt, requiring durable settlement.
3. If it is already `SETTLED`, **fails closed** and requires a new attempt with a freshly, strongly consistently read Order V2 snapshot, so the existing separate settled-replay branch can verify `PAID`, event/session IDs, amount and order version.

Tests simulate the actual race in an in-memory mock, keeping the original pending-duplicate and settled-replay regression tests intact.

**Future runtime requirement:** The future Lambda should distinguish a retryable fresh-order-read conflict from a permanent invalid provider event, issue a bounded retry with the new strongly consistent Order V2 snapshot and server-retrieved Stripe TEST Session, and never treat an event row by itself as successful stock capture. No retry worker is deployed today.

The owner requires a cost estimate and explicit approval **before any potentially billable execution**, even when AWS promotional credits might apply.

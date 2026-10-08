import 'package:flutter_test/flutter_test.dart';

// §40.5 assigns the push/pull transport, the server idempotency ledger, and
// pull resume to later slices of M1b. These placeholders keep the deferred
// tests visible in every run so the deferral is mechanical, not folklore.
// The slice record for M1b-S3 carries the full DEFERRED_BY_PLAN list.

void main() {
  test(
    'DEFERRED_BY_PLAN: push transport batches mutations to the server',
    () {},
    skip: 'DEFERRED_BY_PLAN: M1b-S5 owns the push HTTP transport (§40.5)',
  );

  test(
    'DEFERRED_BY_PLAN: T-O3 the server ledger deduplicates by device_idempotency_key',
    () {},
    skip: 'DEFERRED_BY_PLAN: M1b-S4 owns the server idempotency ledger (§38.8.6)',
  );

  test(
    'DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps',
    () {},
    skip: 'DEFERRED_BY_PLAN: M1b-S6 owns pull/resume (§40.5, §38.15)',
  );
}

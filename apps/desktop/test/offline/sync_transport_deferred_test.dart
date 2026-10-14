import 'package:flutter_test/flutter_test.dart';

// §40.5: M1b-S4 delivered the server mutation ledger, M1b-S5 the push
// boundary, M1b-S6 the server pull endpoint (`GET /api/v1/sync/pull`,
// cursor-based across the §38.11.1 change feed), and M1b-S7 the client-side
// apply boundary — `applyRemoteWithoutOutbox`, its structural outbox
// suppression, and the `server_sequence` guard (§38.12.1, T-O7). The server
// half of T-O6 — a pull from the same cursor is lossless, and a read never
// advances a stored cursor — is proven against real PostgreSQL in the backend
// database suite. The concrete authenticated HTTP transport and the client-side
// resume orchestration remain a seam for the connectivity slice that owns them;
// §40.5 assigns M1b-S8 to offline auth grace (not transport), so S7 applies a
// change it is given and does not fetch one.

void main() {
  test(
    'DEFERRED_BY_PLAN: T-O6 pull resumes after reconnect without gaps',
    () {},
    skip: 'DEFERRED_BY_PLAN: the connectivity slice owns client transport and resume (§40.5)',
  );
}

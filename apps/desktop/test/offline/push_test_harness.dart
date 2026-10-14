import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';

/// A push transport whose whole-request results are scripted by call index.
///
/// Each script entry is either a [PushBatchResponse] (a per-mutation outcome
/// pass) or a [SyncPushTransportException] (a whole-request failure). Running
/// past the end of the script is a network failure, which is exactly what a
/// test that forgot to script enough responses should observe.
class ScriptedPushTransport implements SyncPushTransport {
  ScriptedPushTransport(this._script);

  final List<Object> _script;
  int calls = 0;
  final List<PushBatchRequest> requests = <PushBatchRequest>[];

  @override
  Future<PushBatchResponse> push(PushBatchRequest request) async {
    requests.add(request);
    final int index = calls;
    calls++;
    if (index >= _script.length) {
      throw const SyncPushTransportException(kind: PushFailureKind.network);
    }
    final Object step = _script[index];
    if (step is SyncPushTransportException) throw step;
    if (step is PushBatchResponse) return step;
    throw const SyncPushTransportException(kind: PushFailureKind.network);
  }
}

/// A per-mutation `APPLIED` acknowledgement for a single [mutationId].
PushBatchResponse appliedFor(String mutationId, {String? resultRef}) {
  return PushBatchResponse(
    syncBatchId: 'batch',
    outcomes: <PushMutationOutcome>[
      PushMutationOutcome(
        mutationId: mutationId,
        status: PushMutationStatus.applied,
        resultRef: resultRef,
        receivedAt: DateTime.utc(2026, 1, 1),
      ),
    ],
  );
}

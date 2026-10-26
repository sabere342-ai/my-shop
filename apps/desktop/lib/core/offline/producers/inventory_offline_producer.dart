/// The Tier-2 offline producers for the inventory aggregates (Master Plan
/// §38.22, §40.8 M4-S4; §38.8, §38.8.1, §30.1, §15.5, §15.8).
///
/// These classes are the *only* sanctioned way the desktop device produces an
/// offline inventory mutation: each builds the complete, immutable §38.24
/// payload and commits it through [`OutboxRepository.enqueue`] — the one §38.8
/// write door — so the push ledger's own rules (transactional enqueue, the
/// `device_local_sequence` allocation, the offline-auth admission gate, the
/// remote-apply echo suppression) apply without this module having to know
/// about them. There is deliberately no direct drift write here — §37.2 stage
/// 24 holds every write outside `outbox/**` to the apply door.
///
/// The payload shapes are the exact wire the server's Tier-2 applier
/// canonicalizes (`INVENTORY_ADJUSTMENT:CREATE` through the movement engine,
/// `INVENTORY_COUNT:CREATE` through the count lifecycle). Quantities and
/// costs ride exact decimal **strings** (§22.1, §30.1 — never a float, never
/// a native number), and identity ids ride canonical UUID strings the caller
/// generates locally (§38.8.1 `aggregate_id`; the server's ledger idempotency
/// keys on the mutation id, and the count's own lifecycle guard answers a
/// replay from storage).
///
/// A payload the server refuses is never retried with edits — §38.8.2: the
/// payload is append-only after commit; a changed intent is a new mutation.
library;

import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/operation_type.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';

/// `payload_version` of the inventory payloads this module emits — the
/// server-side inventory contract's v1 face (§38.8.1 `payload_version`).
const int kInventoryPayloadVersion = 1;

/// `payload_version` of the stock-count payload — the count contract's v1
/// face, kept its own constant so the two vocabularies may version apart.
const int kStockCountPayloadVersion = 1;

/// Builds and enqueues `INVENTORY_ADJUSTMENT:CREATE` — one offline movement
/// offer the server folds through the same §15.4 movement engine its own
/// routes use (§38.22; no parallel engine client- or server-side).
///
/// The `cause` is the §15.5 submittable vocabulary (`OPENING_BALANCE`,
/// `MANUAL_ADJUSTMENT`, `PURCHASE_RECEIPT`, `REVALUATION`) — the count
/// adjustment cause is the **server's** producer; a device cannot produce
/// `STOCK_COUNT_ADJUSTMENT` because a count's variance can only be computed
/// against the authoritative quantity the ledger holds (§15.8).
class InventoryAdjustmentProducer {
  /// Builds the producer over the outbox store it commits through.
  InventoryAdjustmentProducer(this._outbox);

  static const String aggregateType = 'INVENTORY_ADJUSTMENT';

  final OutboxRepository _outbox;

  /// Commits the adjustment mutation and answers its outbox row.
  ///
  /// `quantityDelta` and `unitCostMinor` MUST already be exact decimal
  /// strings (§22.1, §30.1): the producer carries them verbatim — it is not
  /// the place where a `double` could enter the story.
  ///
  /// `actorUserId` and `actorRoleSnapshot` are the §38.8.1/§38.17 attribution
  /// recorded at mutation time; the server records them for the audit story
  /// but trusts only its own re-validated authorization at ingress (§38.16).
  Future<OutboxData> enqueueAdjustment({
    required String movementId,
    required String cause,
    required String variantId,
    required String quantityDelta,
    required String actorUserId,
    required Map<String, Object?> actorRoleSnapshot,
    String? locationId,
    String? reasonCode,
    String? reasonNote,
    String? unitCostMinor,
  }) {
    final Map<String, Object?> payload = <String, Object?>{
      'movementId': movementId,
      'cause': cause,
      'variantId': variantId,
      'quantityDelta': quantityDelta,
      'locationId': ?locationId,
      'reasonCode': ?reasonCode,
      'reasonNote': ?reasonNote,
      'unitCostMinor': ?unitCostMinor,
    };

    return _outbox.enqueue(
      OutboxEnqueueCommand(
        aggregateType: aggregateType,
        aggregateId: movementId,
        operationType: OperationType.create,
        payload: payload,
        payloadVersion: kInventoryPayloadVersion,
        actorUserId: actorUserId,
        actorRoleSnapshot: actorRoleSnapshot,
      ),
    );
  }
}

/// One recorded observation of an offline stock count (§15.8 — a line is the
/// operator's `counted` statement about one variant, with its reason when the
/// operator has already chosen one, and its cost offer in exact minor units
/// when the posting will need one).
///
/// `lineId` is the line's own deterministic identity: the server derives each
/// posting movement's id from it (one line, at most one movement, ever —
/// §38.14.1), so a device-generated UUID is a stable name across replays.
class StockCountLinePayload {
  /// Builds an immutable line observation.
  const StockCountLinePayload({
    required this.lineId,
    required this.variantId,
    required this.countedQuantity,
    this.reasonCode,
    this.unitCostMinor,
  });

  final String lineId;
  final String variantId;

  /// The physically observed quantity as an exact non-negative decimal string
  /// (§15.8, §22.1). Zero is a real observation — the shelf is empty.
  final String countedQuantity;

  /// The §38.5 closed reason code, when already chosen (O-14: the posting of a
  /// variance line without one is refused — refuse early on-device).
  final String? reasonCode;

  /// The §30.1 cost offer in exact minor units as a decimal string, when the
  /// line carries one. A decrease never carries a cost.
  final String? unitCostMinor;

  /// The wire members the server's applier canonicalizes from.
  Map<String, Object?> toJson() {
    final Map<String, Object?> json = <String, Object?>{
      'lineId': lineId,
      'variantId': variantId,
      'countedQuantity': countedQuantity,
    };
    final String? code = reasonCode;
    if (code != null) {
      json['reasonCode'] = code;
    }
    final String? cost = unitCostMinor;
    if (cost != null) {
      json['unitCostMinor'] = cost;
    }
    return json;
  }
}

/// Builds and enqueues `INVENTORY_COUNT:CREATE` — a whole count document
/// (its identity, its observations, and the posting that closes it) applied
/// **atomically inside the ledger's own acceptance transaction** (§38.22,
/// §15.8). The device cannot half-post a count: creation, every recorded
/// line, and the posting commit together or not at all.
class StockCountProducer {
  /// Builds the producer over the outbox store it commits through.
  StockCountProducer(this._outbox);

  static const String aggregateType = 'INVENTORY_COUNT';

  final OutboxRepository _outbox;

  /// Commits the count-document mutation and answers its outbox row.
  ///
  /// `countId` is the device-generated document identity (a canonical UUID);
  /// the ledger's mutation id is the push-level idempotency identity, while
  /// the count row's own lifecycle guard answers a re-derived replay from
  /// storage (`POSTED → REPLAY`, §38.9.1). The mutation payload bounds the
  /// document's note and every line's text the same way the server's
  /// canonicalizer does — but the server re-proves every claim at the ledger
  /// edge (§38.16: a device payload is a replayable claim, never a trusted
  /// offer), so this module is never the last word on honesty.
  Future<OutboxData> enqueueCount({
    required String countId,
    required List<StockCountLinePayload> lines,
    required String actorUserId,
    required Map<String, Object?> actorRoleSnapshot,
    String? locationId,
    String? note,
  }) {
    final Map<String, Object?> payload = <String, Object?>{
      'countId': countId,
      'locationId': ?locationId,
      'note': ?note,
      'lines': <Object?>[for (final StockCountLinePayload line in lines) line.toJson()],
    };

    return _outbox.enqueue(
      OutboxEnqueueCommand(
        aggregateType: aggregateType,
        aggregateId: countId,
        operationType: OperationType.create,
        payload: payload,
        payloadVersion: kStockCountPayloadVersion,
        actorUserId: actorUserId,
        actorRoleSnapshot: actorRoleSnapshot,
      ),
    );
  }
}

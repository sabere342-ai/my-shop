import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/db/app_database.dart';
import 'package:my_shop_desktop/core/offline/outbox/outbox_repository.dart';
import 'package:my_shop_desktop/core/offline/producers/inventory_offline_producer.dart';

import 'outbox_test_harness.dart';

// Master Plan §38.22 (Tier 2, §40.8 M4-S4), §38.8, §38.24, §30.1, §15.8.
//
// The offline inventory producers commit through the real outbox writer, and
// these shape tests pin what they emit: the aggregate vocabulary, the payload
// members the server's Tier-2 applier canonicalizes (exact decimal-string
// quantities and costs, the device's own line identities), the payload
// version, and the §38.8.1 attribution facts the push rides with — encoded
// once at enqueue, read back from the stored row.

void main() {
  late AppDatabase db;

  setUp(() async {
    db = openMemoryDatabase();
    await seedDeviceBinding(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('InventoryAdjustmentProducer (§38.22 INVENTORY_ADJUSTMENT:CREATE)', () {
    test('commits one outbox row whose payload the applier canonicalizes', () async {
      final OutboxRepository outbox = OutboxRepository(db);
      final InventoryAdjustmentProducer producer = InventoryAdjustmentProducer(outbox);

      final OutboxData row = await producer.enqueueAdjustment(
        movementId: testAggregateId,
        cause: 'MANUAL_ADJUSTMENT',
        variantId: 'd4000000-0000-4000-8000-000000000004',
        quantityDelta: '-3',
        actorUserId: testActorUserId,
        actorRoleSnapshot: const <String, Object?>{'permissions': <Object?>['inventory.adjust']},
        reasonCode: 'DAMAGED',
        unitCostMinor: '18500',
      );

      expect(row.aggregateType, 'INVENTORY_ADJUSTMENT');
      expect(row.aggregateId, testAggregateId);
      expect(row.operationType, 'CREATE');
      expect(row.payloadVersion, kInventoryPayloadVersion);
      expect(row.actorUserId, testActorUserId);

      final Map<String, Object?> payload =
          jsonDecode(row.payload) as Map<String, Object?>;
      expect(payload.keys.toSet(), <String>{'movementId', 'cause', 'variantId', 'quantityDelta', 'reasonCode', 'unitCostMinor'});
      expect(payload['movementId'], testAggregateId);
      expect(payload['cause'], 'MANUAL_ADJUSTMENT');
      expect(payload['quantityDelta'], '-3');
      expect(payload['reasonCode'], 'DAMAGED');
      // §30.1: the cost rides the exact string it was offered — never a
      // float, never a native number, never reformatted.
      expect(payload['unitCostMinor'], '18500');
    });

    test('omits absent optional members so the server canonicalizes the same facts', () async {
      final OutboxRepository outbox = OutboxRepository(db);
      final InventoryAdjustmentProducer producer = InventoryAdjustmentProducer(outbox);

      final OutboxData row = await producer.enqueueAdjustment(
        movementId: testAggregateId,
        cause: 'OPENING_BALANCE',
        variantId: 'd4000000-0000-4000-8000-000000000004',
        quantityDelta: '24',
        actorUserId: testActorUserId,
        actorRoleSnapshot: const <String, Object?>{},
      );

      final Map<String, Object?> payload =
          jsonDecode(row.payload) as Map<String, Object?>;
      expect(payload.keys.toSet(), <String>{'movementId', 'cause', 'variantId', 'quantityDelta'});
    });
  });

  group('StockCountProducer (§38.22 INVENTORY_COUNT:CREATE)', () {
    test('commits the whole document: identity, note, lines with device line ids', () async {
      final OutboxRepository outbox = OutboxRepository(db);
      final StockCountProducer producer = StockCountProducer(outbox);

      final OutboxData row = await producer.enqueueCount(
        countId: testAggregateId,
        actorUserId: testActorUserId,
        actorRoleSnapshot: const <String, Object?>{'permissions': <Object?>['inventory.count']},
        note: 'جرد فصلي',
        lines: const <StockCountLinePayload>[
          StockCountLinePayload(
            lineId: '77000000-0000-4000-8000-000000000007',
            variantId: 'd4000000-0000-4000-8000-000000000004',
            countedQuantity: '4',
            reasonCode: 'MISCOUNT',
            unitCostMinor: '18500',
          ),
          StockCountLinePayload(
            lineId: '88000000-0000-4000-8000-000000000008',
            variantId: 'd4000000-0000-4000-8000-000000000005',
            countedQuantity: '0',
          ),
        ],
      );

      expect(row.aggregateType, 'INVENTORY_COUNT');
      expect(row.aggregateId, testAggregateId);
      expect(row.operationType, 'CREATE');
      expect(row.payloadVersion, kStockCountPayloadVersion);

      final Map<String, Object?> payload =
          jsonDecode(row.payload) as Map<String, Object?>;
      expect(payload['countId'], testAggregateId);
      expect(payload['note'], 'جرد فصلي');
      final List<Object?> lines = payload['lines']! as List<Object?>;
      expect(lines, hasLength(2));
      final Map<String, Object?> first = lines.first! as Map<String, Object?>;
      expect(first['lineId'], '77000000-0000-4000-8000-000000000007');
      expect(first['countedQuantity'], '4');
      expect(first['reasonCode'], 'MISCOUNT');
      expect(first['unitCostMinor'], '18500');
      // Zero is a real observation (§15.8): an empty shelf still records its
      // line, with nothing but its own facts.
      final Map<String, Object?> second = lines.last! as Map<String, Object?>;
      expect(second['countedQuantity'], '0');
      expect(second.containsKey('reasonCode'), isFalse);
      expect(second.containsKey('unitCostMinor'), isFalse);
    });

    test('a document without a note or lines still encodes its shell honestly', () async {
      final OutboxRepository outbox = OutboxRepository(db);
      final StockCountProducer producer = StockCountProducer(outbox);

      final OutboxData row = await producer.enqueueCount(
        countId: testAggregateId,
        actorUserId: testActorUserId,
        actorRoleSnapshot: const <String, Object?>{},
        lines: const <StockCountLinePayload>[],
      );

      final Map<String, Object?> payload =
          jsonDecode(row.payload) as Map<String, Object?>;
      expect(payload.keys.toSet(), <String>{'countId', 'lines'});
      expect(payload['lines'], isEmpty);
    });
  });
}

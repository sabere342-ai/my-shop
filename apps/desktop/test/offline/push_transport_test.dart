import 'package:flutter_test/flutter_test.dart';
import 'package:my_shop_desktop/core/offline/sync/push_transport.dart';

void main() {
  group('PushBatchRequest JSON', () {
    test('serializes the required fields and mutations', () {
      const PushBatchRequest request = PushBatchRequest(
        deviceId: 'd001',
        syncBatchId: 's001',
        localSchemaVersion: 2,
        mutations: <PushMutationWire>[
          PushMutationWire(
            mutationId: 'm001',
            organizationId: 'o001',
            deviceId: 'd001',
            actorUserId: 'a001',
            actorRoleSnapshot: <String, Object?>{'r': 'v'},
            aggregateType: 'SALE',
            aggregateId: 'ag001',
            operationType: 'CREATE',
            payload: <String, Object?>{'k': 'v'},
            payloadVersion: 1,
            deviceLocalSequence: 1,
            localCreatedAt: '2026-10-11T12:00:00.000Z',
            deviceIdempotencyKey: 'm001',
          ),
        ],
      );

      final Map<String, Object?> json = request.toJson();
      expect(json['deviceId'], 'd001');
      expect(json['syncBatchId'], 's001');
      expect(json['localSchemaVersion'], 2);
      final List<Object?> mutations = json['mutations'] as List<Object?>;
      expect(mutations.length, 1);
      final Map<String, Object?> m = mutations[0] as Map<String, Object?>;
      expect(m['mutationId'], 'm001');
      expect(m['organizationId'], 'o001');
      expect(m['deviceId'], 'd001');
      expect(m['actorUserId'], 'a001');
      expect(m['aggregateType'], 'SALE');
      expect(m['aggregateId'], 'ag001');
      expect(m['operationType'], 'CREATE');
      expect(m['payloadVersion'], 1);
      expect(m['deviceLocalSequence'], 1);
      expect(m['localCreatedAt'], '2026-10-11T12:00:00.000Z');
      expect(m['deviceIdempotencyKey'], 'm001');
      expect(m['actorRoleSnapshot'], isA<Map<String, Object?>>());
      expect(m['payload'], isA<Map<String, Object?>>());
    });
  });

  group('PushMutationStatus', () {
    test('parses known values and rejects unknown', () {
      expect(PushMutationStatus.fromWire('APPLIED'), PushMutationStatus.applied);
      expect(PushMutationStatus.fromWire('REPLAY'), PushMutationStatus.replay);
      expect(PushMutationStatus.fromWire('REJECTED'), PushMutationStatus.rejected);
      expect(PushMutationStatus.fromWire('CONTRADICTION'), PushMutationStatus.contradiction);
      expect(() => PushMutationStatus.fromWire('UNKNOWN'), throwsFormatException);
    });
  });

  group('PushBatchResponse.fromJson', () {
    test('parses a minimal response with all statuses', () {
      final Map<String, Object?> json = <String, Object?>{
        'syncBatchId': 's001',
        'outcomes': <Object?>[
          <String, Object?>{
            'mutationId': 'm001',
            'status': 'APPLIED',
            'resultRef': 'r001',
            'resultHash': 'hash',
            'serverSequence': '1',
            'receivedAt': '2026-10-11T12:00:00.000Z',
          },
          <String, Object?>{
            'mutationId': 'm002',
            'status': 'REPLAY',
            'receivedAt': '2026-10-11T12:00:00.100Z',
          },
          <String, Object?>{
            'mutationId': 'm003',
            'status': 'REJECTED',
            'rejectionCode': 'REJECTED',
            'receivedAt': '2026-10-11T12:00:00.200Z',
          },
          <String, Object?>{
            'mutationId': 'm004',
            'status': 'CONTRADICTION',
            'rejectionCode': 'MUTATION_CONTRADICTION',
            'receivedAt': '2026-10-11T12:00:00.300Z',
          },
        ],
      };

      final PushBatchResponse response = PushBatchResponse.fromJson(json);
      expect(response.syncBatchId, 's001');
      expect(response.outcomes.length, 4);
      expect(response.outcomes[0].status, PushMutationStatus.applied);
      expect(response.outcomes[0].serverSequence, '1');
      expect(response.outcomes[0].receivedAt.toIso8601String(), '2026-10-11T12:00:00.000Z');
      expect(response.outcomes[1].status, PushMutationStatus.replay);
      expect(response.outcomes[2].status, PushMutationStatus.rejected);
      expect(response.outcomes[3].status, PushMutationStatus.contradiction);
    });

    test('rejects malformed response', () {
      expect(() => PushBatchResponse.fromJson(<String, Object?>{}), throwsFormatException);
      expect(
        () => PushBatchResponse.fromJson(<String, Object?>{
          'syncBatchId': 'x',
          'outcomes': <Object?>[<String, Object?>{}],
        }),
        throwsFormatException,
      );
    });
  });
}

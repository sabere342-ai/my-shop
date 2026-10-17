/**
 * Sync contract tests (Master Plan §40.5, M1b-S2).
 *
 * The contract's load-bearing assertions are the vocabularies: a value added to
 * `SYNC_STATES`, a field added to `MutationPayload`, or a description losing its
 * §38.8.1 anchor changes what clients compile against, so each is pinned here as
 * a literal rather than asserted structurally.
 *
 * These tests read the decorator metadata directly; the full document (with the
 * `$ref` resolved and the components registered) is asserted in
 * `openapi/openapi.spec.ts`.
 */

import {
  MUTATION_ID_DESCRIPTION,
  OPERATION_TYPES,
  SYNC_STATES,
  SYNC_STATE_DESCRIPTION,
  MutationPayload,
  syncContractSchemas,
} from './sync.contract';

/** Keys under which @nestjs/swagger stores property metadata (its public decorators). */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';

/** The §38.8.1 wire fields, in declaration order (the four local columns omitted). */
const WIRE_FIELDS = [
  'mutationId',
  'organizationId',
  'deviceId',
  'actorUserId',
  'actorRoleSnapshot',
  'aggregateType',
  'aggregateId',
  'operationType',
  'payload',
  'payloadVersion',
  'deviceLocalSequence',
  'localCreatedAt',
  'deviceIdempotencyKey',
];

function declaredFields(): string[] {
  const keys = Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, MutationPayload.prototype) as string[];
  return keys.map((key) => key.replace(/^:/, ''));
}

function metadataOf(field: string): Record<string, unknown> {
  return Reflect.getMetadata(API_MODEL_PROPERTIES, MutationPayload.prototype, field) as Record<string, unknown>;
}

describe('sync contract', () => {
  it('declares exactly the wire fields of the outbox row', () => {
    // §38.8.1 lists 16 columns; §38.10.1 pushes the mutation, never the queue's
    // local accounting — sync_state, attempt_count, last_error_code and
    // last_attempt_at must not appear on the wire.
    expect(declaredFields()).toEqual(WIRE_FIELDS);
  });

  it('pins every field to its §38.8.1 column', () => {
    // The mapping back to the durable outbox table is part of the contract, not
    // a review convention; a description without the citation loses it.
    for (const field of WIRE_FIELDS) {
      const description = metadataOf(field)['description'];
      expect(typeof description).toBe('string');
      expect(description).toContain('38.8.1');
    }
  });

  it('links mutation_id to the named MutationId component', () => {
    // §38.9.1: mutation_id is the ledger's identity — a $ref keeps every use of
    // it in the document pointing at one uuid definition.
    expect(metadataOf('mutationId')).toMatchObject({
      type: 'string',
      format: 'uuid',
      $ref: '#/components/schemas/MutationId',
      description: MUTATION_ID_DESCRIPTION,
    });
  });

  it('closes operation_type to the four ledger operations', () => {
    // §38.8.1: CREATE, VOID, RETURN, REVERSE — a fifth operation is a contract
    // change, so the vocabulary is a literal list, not a description.
    expect([...OPERATION_TYPES]).toEqual(['CREATE', 'VOID', 'RETURN', 'REVERSE']);
    expect(metadataOf('operationType')).toMatchObject({
      type: 'string',
      enum: [...OPERATION_TYPES],
    });
  });

  it('keeps aggregate_type open, as the §38.8.1 ellipsis requires', () => {
    // §38.8.1 ends the column's list with an ellipsis: a closed enum here would
    // turn every new aggregate type into a breaking contract change.
    const metadata = metadataOf('aggregateType');
    expect(metadata['enum']).toBeUndefined();
    expect(metadata['description']).toContain('INVENTORY_ADJUSTMENT');
  });

  it('publishes the §38.13 state machine as the SyncState vocabulary', () => {
    // §38.13: no isSynced boolean; the seven states are the contract the client
    // compiles its queue UI against.
    expect([...SYNC_STATES]).toEqual([
      'LOCAL_ONLY',
      'PENDING',
      'SYNCING',
      'SYNCED',
      'RETRYABLE_ERROR',
      'CONFLICT',
      'PERMANENT_REJECTED',
    ]);
    expect(SYNC_STATE_DESCRIPTION).toContain('isSynced');
    expect(syncContractSchemas()['SyncState']).toEqual({
      type: 'string',
      enum: [...SYNC_STATES],
      description: SYNC_STATE_DESCRIPTION,
    });
  });

  it('publishes MutationId as a uuid string with the shared description', () => {
    // The component exists so a $ref resolves and the generated client package
    // receives one named type for the identity.
    expect(syncContractSchemas()['MutationId']).toEqual({
      type: 'string',
      format: 'uuid',
      description: MUTATION_ID_DESCRIPTION,
    });
  });

  it('composes fresh schema objects on every call', () => {
    // openapiDocument() merges these into a shared document; a caller mutating
    // its result must not be able to poison the next build.
    const first = syncContractSchemas();
    const second = syncContractSchemas();
    expect(first).not.toBe(second);
    expect(first['SyncState']).not.toBe(second['SyncState']);
  });
});

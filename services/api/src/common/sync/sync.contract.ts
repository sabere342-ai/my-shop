/**
 * The sync contract (Master Plan §40.5, M1b-S2).
 *
 * This is the vocabulary §40.5 requires before any transport exists: the mutation
 * payload schema, the `mutation_id` identity, the sync state enum, and the error
 * codes already published by `common/errors/problem.ts`. Push and pull transport
 * are explicitly non-scope (§40.5, M1b-S3); nothing here declares a path.
 *
 * The payload carries the 13 wire fields of §38.8.1's 16 outbox columns. The four
 * omitted columns — `sync_state`, `attempt_count`, `last_error_code`,
 * `last_attempt_at` — are local bookkeeping: §38.13's state machine and retry
 * diagnostics live on the device, and §38.10.1's content rule ("complete
 * immutable payloads. The server never partially trusts a delta") describes the
 * business event, not the queue's internal accounting. `sync_state` is still part
 * of the contract: §40.5 lists it, so it is published below as a standalone
 * component for M1b-S3's response shapes and the client's state machine.
 *
 * Wire names are camelCase, matching the JSON the API already speaks
 * (`traceId` on every problem document, §13.1); each description carries the
 * §38.8.1 column name it corresponds to, so the mapping back to the durable
 * outbox table is explicit rather than conventional.
 */

import { ApiProperty, type SchemaObject } from '@nestjs/swagger';

/**
 * §38.8.1 `operation_type`: the four operations the mutation ledger admits.
 * A closed set — a fifth operation would be a contract change, not a new value.
 */
export const OPERATION_TYPES = ['CREATE', 'VOID', 'RETURN', 'REVERSE'] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

/**
 * §38.13: the sync lifecycle of a local mutation. There is no `isSynced`
 * boolean — the state is explicit, every transition is timestamped, and a
 * permanent rejection is never silently dropped.
 */
export const SYNC_STATES = [
  'LOCAL_ONLY',
  'PENDING',
  'SYNCING',
  'SYNCED',
  'RETRYABLE_ERROR',
  'CONFLICT',
  'PERMANENT_REJECTED',
] as const;

export type SyncState = (typeof SYNC_STATES)[number];

/** Shared so the property and the component cannot drift apart inside this file. */
export const MUTATION_ID_DESCRIPTION =
  'Client-generated UUIDv7 mutation identity (§38.8.1 `mutation_id`): time-ordered and ' +
  'collision-resistant. Unique with `organizationId` in the server ledger (§38.9.1), which ' +
  'makes every push safely repeatable (§38.9.3).';

export const SYNC_STATE_DESCRIPTION =
  'Sync lifecycle of a local mutation (§38.13): LOCAL_ONLY (committed locally, not yet ' +
  'eligible to push), PENDING (eligible; the normal resting state of an offline sale), ' +
  'SYNCING (in flight), SYNCED (server acknowledged, terminal), RETRYABLE_ERROR (transient ' +
  'failure, scheduled retry with backoff), CONFLICT (server state differs, awaiting owner ' +
  'review), PERMANENT_REJECTED (server refused permanently, owner-visible, never silently ' +
  'dropped). There is no `isSynced` boolean (§38.13).';

/**
 * One queued mutation — §38.10.1's "complete immutable payloads".
 *
 * A decorated class rather than an interface so the OpenAPI document, the generated
 * TypeScript types, and the durable outbox schema are pinned to one declaration
 * (Master Plan §7.1, ADR-001). `payload` is append-only after commit: a changed
 * business intent is a new mutation (§38.8.2).
 */
export class MutationPayload {
  /**
   * §38.8.1 `mutation_id` — primary identity of the mutation, not of any aggregate.
   *
   * The `$ref` keeps one uuid definition behind every use of the identity.
   * `@nestjs/swagger`'s option types omit `$ref` although its schema factory
   * preserves it on model properties; the document test proves the reference
   * survives generation, and the directive below turns a future type change
   * into a build error in the right direction.
   */
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    // @ts-expect-error -- `$ref` works at runtime; ApiPropertyOptions omits it.
    $ref: '#/components/schemas/MutationId',
    description: MUTATION_ID_DESCRIPTION,
  })
  readonly mutationId!: string;

  /** §38.8.1 `organization_id` — tenant scope, from the device binding, never user input. */
  @ApiProperty({
    format: 'uuid',
    description:
      'Tenant scope, taken from the device binding (§38.16), never from user input ' + '(§38.8.1 `organization_id`).',
  })
  readonly organizationId!: string;

  /** §38.8.1 `device_id` — which installation produced the mutation. */
  @ApiProperty({
    format: 'uuid',
    description: 'The installation that produced the mutation (§38.8.1 `device_id`).',
  })
  readonly deviceId!: string;

  /** §38.8.1 `actor_user_id` — attribution (§23). */
  @ApiProperty({
    format: 'uuid',
    description: 'Who performed it — attribution (§38.8.1 `actor_user_id`, §23).',
  })
  readonly actorUserId!: string;

  /** §38.8.1 `actor_role_snapshot` — effective permissions at the time (§38.17). */
  @ApiProperty({
    description:
      'Effective permissions at the time of the mutation, for offline authorization audit ' +
      '(§38.8.1 `actor_role_snapshot`, §38.17).',
  })
  readonly actorRoleSnapshot!: Record<string, unknown>;

  /**
   * §38.8.1 `aggregate_type` — deliberately a string, not a closed enum: §38.8.1
   * ends its list with an ellipsis, so new aggregate types extend the vocabulary
   * without breaking producers already in the field.
   */
  @ApiProperty({
    description:
      'The kind of business object the mutation addresses (§38.8.1 `aggregate_type`). ' +
      'Known values: SALE, SALE_PAYMENT, RETURN, CUSTOMER_COLLECTION, INVENTORY_ADJUSTMENT — ' +
      'an open list (§38.8.1 ends with an ellipsis), so a new aggregate type is additive.',
  })
  readonly aggregateType!: string;

  /** §38.8.1 `aggregate_id` — the local identity of the business object. */
  @ApiProperty({
    format: 'uuid',
    description: 'The local identity of the business object (§38.8.1 `aggregate_id`).',
  })
  readonly aggregateId!: string;

  /** §38.8.1 `operation_type` — the closed set the ledger admits. */
  @ApiProperty({
    description: 'The operation performed: CREATE, VOID, RETURN, REVERSE (§38.8.1 `operation_type`).',
    enum: [...OPERATION_TYPES],
  })
  readonly operationType!: OperationType;

  /** §38.8.1 `payload` — the complete immutable business event (§38.24). */
  @ApiProperty({
    description:
      'The complete immutable business event (§38.8.1 `payload`, §38.24). Append-only after ' +
      'commit: a changed intent is a new mutation (§38.8.2), and the server never partially ' +
      'trusts a delta (§38.10.1).',
  })
  readonly payload!: Record<string, unknown>;

  /** §38.8.1 `payload_version` — contract version of the payload. */
  @ApiProperty({
    type: 'integer',
    description: 'Contract version of the payload (§38.8.1 `payload_version`).',
  })
  readonly payloadVersion!: number;

  /** §38.8.1 `device_local_sequence` — the per-device total order (§38.10.2). */
  @ApiProperty({
    type: 'integer',
    description:
      'Gap-free monotonic integer allocated inside the local transaction: the total order ' +
      'within the device, independent of clock (§38.8.1 `device_local_sequence`, §38.10.2).',
  })
  readonly deviceLocalSequence!: number;

  /** §38.8.1 `local_created_at` — device clock with a monotonic tiebreak. */
  @ApiProperty({
    format: 'date-time',
    description:
      'Device wall clock plus a monotonic tiebreak (§38.8.1 `local_created_at`); distinct ' +
      'from the server’s `received_at` clock (§38.9.1).',
  })
  readonly localCreatedAt!: string;

  /** §38.8.1 `device_idempotency_key` — `mutation_id` duplicated for offline derivation. */
  @ApiProperty({
    format: 'uuid',
    description:
      'The `mutation_id` duplicated into the server payload so the server idempotency key ' +
      'is derivable offline (§38.8.1 `device_idempotency_key`).',
  })
  readonly deviceIdempotencyKey!: string;
}

/**
 * The standalone (non-class) components of the sync contract (§40.5).
 *
 * `SwaggerModule.createDocument` only renders decorated classes; these two are
 * schema objects composed into `components.schemas` by `openapiDocument()` so a
 * `$ref` to them resolves and the client package receives them as named types.
 */
export function syncContractSchemas(): Record<string, SchemaObject> {
  return {
    MutationId: {
      type: 'string',
      format: 'uuid',
      description: MUTATION_ID_DESCRIPTION,
    },
    SyncState: {
      type: 'string',
      enum: [...SYNC_STATES],
      description: SYNC_STATE_DESCRIPTION,
    },
  };
}

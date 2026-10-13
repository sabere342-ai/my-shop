/**
 * The push wire contract (Master Plan §40.5, M1b-S5; §38.10).
 *
 * `POST /api/v1/sync/push` carries 1–50 mutations (oldest `device_local_sequence`
 * first, §38.10.1) and answers **per mutation**, never as all-or-nothing: §38.10.3
 * is explicit that one permanently rejected row must not hold the sales queued
 * behind it hostage.
 *
 * The response status vocabulary is the §38.9.2 acknowledgement set projected onto
 * one field:
 *
 * - `APPLIED`      — first sight: applied in one transaction with its ledger row.
 * - `REPLAY`       — same `mutation_id`, identical `payload_hash`: the stored
 *                    response is returned and nothing is applied (§38.9.2). There
 *                    is deliberately no separate `isReplay` boolean on the wire;
 *                    the status *is* the acknowledgement.
 * - `REJECTED`     — a permanent business refusal, recorded in the ledger with its
 *                    code and never silently dropped (§38.13).
 * - `CONTRADICTION`— same `mutation_id`, different `payload_hash`: the
 *                    idempotency-bypass alarm (§38.9.2, F-14). Per §38.9.2 it is a
 *                    `409 MUTATION_CONTRADICTION`; inside a batch it is reported as
 *                    this per-mutation outcome so it does not fail the batch
 *                    (§38.10.3), and the durable security event is M2-S6's (§38.28).
 *
 * The request reuses the M1b-S2 `MutationPayload` (§38.8.1) as the per-mutation
 * body so the durable outbox row, the generated client types, and the push body are
 * one declaration (§7.1, ADR-001).
 */

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
import { MutationPayload } from '../sync.contract';

/**
 * §38.10.1: "Batch size 1–50 mutations per request, oldest `device_local_sequence`
 * first". The bound is a contract constant, not a coincidental validation copy.
 */
export const MIN_PUSH_BATCH_SIZE = 1;
export const MAX_PUSH_BATCH_SIZE = 50;

/**
 * §38.7.2: the client publishes its `local_schema_version` on every push and the
 * server refuses a client below the minimum. There is exactly one published local
 * schema today (value 1); the constant is the single place a future minimum moves.
 */
export const MIN_SUPPORTED_LOCAL_SCHEMA_VERSION = 1;

/**
 * §38.9.2 / §38.10.1: the per-mutation acknowledgement vocabulary. A closed set —
 * a fifth status is a contract change, not a new value.
 */
export const PUSH_MUTATION_STATUSES = ['APPLIED', 'REPLAY', 'REJECTED', 'CONTRADICTION'] as const;

export type PushMutationStatus = (typeof PUSH_MUTATION_STATUSES)[number];

const PUSH_STATUS_DESCRIPTION =
  'Per-mutation acknowledgement (§38.9.2): APPLIED (first sight, applied once), REPLAY ' +
  '(identical payload already stored, nothing applied), REJECTED (permanent business ' +
  'refusal, recorded with its code), CONTRADICTION (same mutation_id, different ' +
  'payload_hash — 409 MUTATION_CONTRADICTION, security event). One bad mutation never ' +
  'fails the batch (§38.10.3).';

/**
 * One per-mutation outcome (§38.10.1). Optional fields are present exactly when the
 * status carries them: `resultRef`/`resultHash`/`serverSequence` for `APPLIED` and
 * `REPLAY`, `rejectionCode` for `REJECTED` and `CONTRADICTION`.
 */
export class PushMutationOutcome {
  @ApiProperty({
    format: 'uuid',
    description: 'The mutation this outcome answers (§38.8.1 `mutation_id`).',
  })
  readonly mutationId!: string;

  @ApiProperty({ enum: [...PUSH_MUTATION_STATUSES], description: PUSH_STATUS_DESCRIPTION })
  readonly status!: PushMutationStatus;

  @ApiProperty({
    required: false,
    description: 'The business object the mutation produced (§38.9.1 `result_ref`); APPLIED/REPLAY only.',
  })
  readonly resultRef?: string;

  @ApiProperty({
    required: false,
    description: 'Hash of the resulting state (§38.9.1 `result_hash`); APPLIED/REPLAY only.',
  })
  readonly resultHash?: string;

  @ApiProperty({
    type: 'string',
    required: false,
    description:
      'The per-organization acceptance order (§38.11.1 `server_sequence`), as a decimal string ' +
      'so a 64-bit value survives JSON without floating-point loss; APPLIED/REPLAY only.',
  })
  readonly serverSequence?: string;

  @ApiProperty({
    required: false,
    description:
      'The stable §34.3 code when the mutation was refused: a REJECTED business code, or ' +
      'MUTATION_CONTRADICTION. Absent on APPLIED/REPLAY.',
  })
  readonly rejectionCode?: string;

  @ApiProperty({
    format: 'date-time',
    description: 'The server receipt clock (§38.9.1 `received_at`), distinct from the client clock (§23.1).',
  })
  readonly receivedAt!: string;
}

/**
 * The push request body (§38.10.1): a batch from one device.
 *
 * `deviceId` is an **assertion**, not authority (§38.16): the trusted context
 * established by authentication is the only source of tenant and device identity,
 * and this value is verified against it before any mutation is applied.
 */
export class PushBatchRequest {
  @ApiProperty({
    format: 'uuid',
    description:
      'The producing installation (§38.8.1 `device_id`), asserted by the client. The server ' +
      'verifies it against the authenticated device binding (§38.16) and refuses the request on ' +
      'a mismatch; it is never trusted as authority.',
  })
  @IsUUID()
  readonly deviceId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Client-generated identity of this batch (§38.28.1 correlation): one id links the request, ' +
      'its per-mutation outcomes, and the server log line.',
  })
  @IsUUID()
  readonly syncBatchId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description:
      'The local schema version this client speaks (§38.7.2). Below the server minimum the whole ' +
      'request is refused CLIENT_TOO_OLD and the device goes read-only with an upgrade prompt (F-15). ' +
      'The field accepts any non-negative integer so that an outdated client reaches that domain ' +
      'refusal rather than a generic shape error; the minimum that decides it is the server constant.',
  })
  @IsInt()
  @Min(0)
  readonly localSchemaVersion!: number;

  @ApiProperty({
    type: () => [MutationPayload],
    description:
      '1–50 mutations, strictly ascending by `device_local_sequence` (§38.10.1/§38.10.2). The ' +
      'batch is not atomic: each mutation is applied or rejected independently (§38.10.3).',
  })
  @IsArray()
  @ArrayMinSize(MIN_PUSH_BATCH_SIZE)
  @ArrayMaxSize(MAX_PUSH_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => MutationPayload)
  readonly mutations!: MutationPayload[];
}

/** The push response body (§38.10.1): one outcome per request mutation, same order. */
export class PushBatchResponse {
  @ApiProperty({
    format: 'uuid',
    description: 'Echoes the request `syncBatchId` so a client can reconcile a batch (§38.28.1).',
  })
  readonly syncBatchId!: string;

  @ApiProperty({
    type: () => [PushMutationOutcome],
    description:
      'One outcome per request mutation, in request order (§38.10.1). Length always equals the ' +
      'number of mutations sent, including for a partial batch (§38.10.3).',
  })
  readonly outcomes!: PushMutationOutcome[];
}

/** The wire path shared by the controller and the ACL declaration (§38.10.1). */
export const SYNC_PUSH_PATH = 'api/v1/sync/push';

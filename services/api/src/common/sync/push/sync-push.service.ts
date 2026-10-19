/**
 * The push service (Master Plan §40.5, M1b-S5; §38.10).
 *
 * It turns one authenticated batch into one per-mutation outcome list, and it is
 * deliberately thin: the §38.9 idempotency contract, the effect, the change feed,
 * and the cursor all belong to the M1b-S4 ledger, which this service calls once per
 * mutation. What lives here is everything the ledger deliberately does not do:
 *
 * - **Schema gate** (§38.7.2): a client below the minimum `local_schema_version`
 *   is refused `CLIENT_TOO_OLD` for the whole request. A batch from a producer the
 *   server cannot trust is not partially trustworthy.
 * - **Identity verification** (§38.16, §9.3): the batch `deviceId` and every
 *   mutation's `organizationId`/`deviceId` are *assertions*, checked against the
 *   authenticated context; any mismatch is a whole-request 403 plus a structured
 *   security log. The context — never the body — is the scope handed to the ledger.
 * - **Ordering** (§38.10.2): mutations must be strictly ascending by
 *   `device_local_sequence` and unique by `mutation_id`. Re-ordering or collapsing
 *   a device's history is a client defect, refused as a malformed batch.
 * - **Partial batch** (§38.10.3): each mutation is applied or rejected
 *   independently, so one permanent rejection never blocks the sales behind it.
 *   Only an unexpected *server* fault aborts the batch (§38.10.4: 5xx means
 *   back off and retry, and idempotency makes that retry safe).
 */

import type { Logger as PinoLogger } from 'pino';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import type { SecurityEventSink } from '../../identity/security-event.sink';
import { MutationContradictionError } from '../ledger/mutation-ledger.errors';
import type { MutationLedgerService } from '../ledger/mutation-ledger.service';
import { type MutationOutcome } from '../ledger/mutation-ledger.service';
import type { MutationPayload } from '../sync.contract';
import {
  MIN_SUPPORTED_LOCAL_SCHEMA_VERSION,
  type PushBatchRequest,
  type PushBatchResponse,
  type PushMutationOutcome,
} from './push.contract';
import type { SyncMutationApplier } from './sync-mutation-applier';
import type { SyncIngressRevalidator } from './ingress-revalidation';
import type { DeviceService } from '../../devices/device.service';
import type { SyncTrustedContext } from './sync-auth';

export class SyncPushService {
  constructor(
    private readonly ledger: MutationLedgerService,
    private readonly applier: SyncMutationApplier,
    /** §9.4 (M2-S4): the acceptance re-validator. Bound in the module wiring; test-overridable. */
    private readonly ingressRevalidator: SyncIngressRevalidator,
    private readonly logger?: PinoLogger,
    /**
     * §12.5 (M2-S5): the device service that records the push metadata once per
     * completed batch. Optional only so a narrowly-scoped unit construction does
     * not have to depend on the devices module — the production wiring always
     * supplies it.
     */
    private readonly devices?: DeviceService,
    /**
     * M2-S6 (§32.3): the durable security-event sink for the §38.16 identity
     * refusals — the cross-organization and cross-device assertions this
     * service refuses whole. Optional only for narrow unit wiring; production
     * always supplies it (and its `record` is non-throwing either way).
     */
    private readonly securitySink?: SecurityEventSink,
  ) {}

  /**
   * Applies one batch and answers per mutation (§38.10.1).
   *
   * @throws `DomainError` for a whole-request refusal (too-old client, identity
   *   mismatch, malformed ordering). Each mutation's own outcome is returned, not
   *   thrown — including a `CONTRADICTION`, which is the §38.9.2 alarm but is still
   *   a per-mutation result (§38.10.3).
   */
  async pushBatch(request: PushBatchRequest, context: SyncTrustedContext): Promise<PushBatchResponse> {
    if (request.localSchemaVersion < MIN_SUPPORTED_LOCAL_SCHEMA_VERSION) {
      throw new DomainError(
        ERROR_CODES.CLIENT_TOO_OLD,
        `local_schema_version ${String(request.localSchemaVersion)} is below the supported minimum ` +
          `${String(MIN_SUPPORTED_LOCAL_SCHEMA_VERSION)} (§38.7.2)`,
      );
    }

    this.assertIdentity(request, context);
    this.assertOrdering(request.mutations);

    const outcomes: PushMutationOutcome[] = [];
    // Sequential on purpose: §38.10.2 order within a device is meaningful, and a
    // serial pass keeps the per-mutation series deterministic in the log.
    for (const mutation of request.mutations) {
      outcomes.push(await this.applyOne(mutation, context));
    }

    // §12.5 (M2-S5): once per completed batch — never per mutation — the device's
    // sync metadata moves. The recording is best-effort and diagnostic; it can
    // neither fail the batch the server just accepted nor authorize anything.
    await this.devices?.recordPushMetadata({
      organizationId: context.organizationId,
      deviceId: context.deviceId,
      clientSchemaVersion: request.localSchemaVersion,
    });

    return { syncBatchId: request.syncBatchId, outcomes };
  }

  /**
   * §38.16 / §9.3: the authenticated context is authority; the body only asserts.
   * A body that names a different device or organization is refused whole — no
   * mutation from that batch is applied — and logged as a security event.
   */
  private assertIdentity(request: PushBatchRequest, context: SyncTrustedContext): void {
    if (request.deviceId !== context.deviceId) {
      this.logger?.warn(
        {
          component: 'sync-push',
          securityEvent: 'sync-push-device-mismatch',
          assertedDeviceId: request.deviceId,
          trustedDeviceId: context.deviceId,
          organizationId: context.organizationId,
          syncBatchId: request.syncBatchId,
        },
        'push batch asserted a device other than the authenticated one — 403 PERMISSION_DENIED',
      );
      // M2-S6 (§32.3, §38.16): the refusal becomes a durable row too — the
      // class-B sink persists it after this decision without ever throwing
      // into it. The organization and device ids are the *verified* context's
      // facts; only the mismatching assertion is labelled a claim.
      this.securitySink?.record({
        type: 'SYNC_IDENTITY_MISMATCH',
        organizationId: context.organizationId,
        deviceId: context.deviceId,
        ...(context.actorUserId === undefined ? {} : { userId: context.actorUserId }),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
        syncBatchId: request.syncBatchId,
        assertedDeviceId: request.deviceId,
      });
      throw new DomainError(
        ERROR_CODES.PERMISSION_DENIED,
        'the batch deviceId does not match the authenticated device (§38.16)',
      );
    }

    for (const mutation of request.mutations) {
      if (mutation.organizationId !== context.organizationId) {
        this.logger?.warn(
          {
            component: 'sync-push',
            securityEvent: 'sync-push-organization-mismatch',
            mutationId: mutation.mutationId,
            assertedOrganizationId: mutation.organizationId,
            trustedOrganizationId: context.organizationId,
            syncBatchId: request.syncBatchId,
          },
          'push mutation asserted another organization — 403 ORGANIZATION_FORBIDDEN',
        );
        this.securitySink?.record({
          type: 'SYNC_IDENTITY_MISMATCH',
          organizationId: context.organizationId,
          deviceId: context.deviceId,
          ...(context.actorUserId === undefined ? {} : { userId: context.actorUserId }),
          errorCode: ERROR_CODES.ORGANIZATION_FORBIDDEN,
          mutationId: mutation.mutationId,
          syncBatchId: request.syncBatchId,
          assertedOrganizationId: mutation.organizationId,
        });
        throw new DomainError(
          ERROR_CODES.ORGANIZATION_FORBIDDEN,
          'a mutation organizationId does not match the authenticated tenant (§38.16)',
        );
      }
      if (mutation.deviceId !== context.deviceId) {
        this.logger?.warn(
          {
            component: 'sync-push',
            securityEvent: 'sync-push-device-mismatch',
            mutationId: mutation.mutationId,
            assertedDeviceId: mutation.deviceId,
            trustedDeviceId: context.deviceId,
            syncBatchId: request.syncBatchId,
          },
          'push mutation asserted another device — 403 PERMISSION_DENIED',
        );
        this.securitySink?.record({
          type: 'SYNC_IDENTITY_MISMATCH',
          organizationId: context.organizationId,
          deviceId: context.deviceId,
          ...(context.actorUserId === undefined ? {} : { userId: context.actorUserId }),
          errorCode: ERROR_CODES.PERMISSION_DENIED,
          mutationId: mutation.mutationId,
          syncBatchId: request.syncBatchId,
          assertedDeviceId: mutation.deviceId,
        });
        throw new DomainError(
          ERROR_CODES.PERMISSION_DENIED,
          'a mutation deviceId does not match the authenticated device (§38.16)',
        );
      }
    }
  }

  /**
   * §38.10.2: strictly ascending `device_local_sequence`, unique `mutation_id`.
   * A re-ordered or duplicated batch is refused whole rather than silently
   * re-sorted, because re-sorting would hide the producing device's own bug.
   */
  private assertOrdering(mutations: readonly MutationPayload[]): void {
    const seenMutationIds = new Set<string>();
    let previousSequence: number | undefined;

    for (const mutation of mutations) {
      if (seenMutationIds.has(mutation.mutationId)) {
        throw new DomainError(
          ERROR_CODES.VALIDATION_FAILED,
          `duplicate mutation_id within the batch (§38.10.2): ${mutation.mutationId}`,
        );
      }
      seenMutationIds.add(mutation.mutationId);

      if (previousSequence !== undefined && mutation.deviceLocalSequence <= previousSequence) {
        throw new DomainError(
          ERROR_CODES.VALIDATION_FAILED,
          'device_local_sequence must be strictly ascending within a batch (§38.10.2)',
        );
      }
      previousSequence = mutation.deviceLocalSequence;
    }
  }

  /** Applies one mutation through the ledger and maps its outcome onto the wire. */
  private async applyOne(mutation: MutationPayload, context: SyncTrustedContext): Promise<PushMutationOutcome> {
    let outcome: MutationOutcome;
    try {
      outcome = await this.ledger.applyMutation({
        organizationId: context.organizationId,
        mutationId: mutation.mutationId,
        deviceId: context.deviceId,
        // The hashed payload is the *complete* immutable mutation, so a reused
        // mutation_id with any differing field is a §38.9.2 contradiction rather
        // than a misread replay.
        payload: mutationFingerprint(mutation),
        // M2-S6 (§32.6): the verified actor the trusted context carries — the
        // audit rows attribute this to, never the mutation's asserted one.
        ...(context.actorUserId === undefined ? {} : { verifiedActorUserId: context.actorUserId }),
        apply: this.applier.effectFor(mutation, context),
        // §9.4 T-8/T-9 (M2-S4): current re-validation runs inside the ledger's
        // transaction — after its idempotency lookup (a stored replay is
        // answered from the record) and before the effect. The ledger turns a
        // refusal here into the durable per-mutation REJECTED row of §38.13.
        validateIngress: (tx) => this.ingressRevalidator.revalidate(tx, context, mutation),
      });
    } catch (error) {
      if (error instanceof MutationContradictionError) {
        return this.contradictionOutcome(mutation, error);
      }
      // §38.10.4: anything else is an unexpected server fault. It propagates to
      // the global filter as 5xx so the whole batch is retried; it is never
      // mislabelled a permanent rejection.
      throw error;
    }

    if (outcome.status === 'APPLIED') {
      return {
        mutationId: outcome.mutationId,
        status: outcome.isReplay ? 'REPLAY' : 'APPLIED',
        resultRef: outcome.resultRef,
        resultHash: outcome.resultHash,
        serverSequence: outcome.serverSequence.toString(),
        receivedAt: outcome.receivedAt.toISOString(),
      };
    }

    return {
      mutationId: outcome.mutationId,
      status: 'REJECTED',
      rejectionCode: outcome.rejectionCode,
      receivedAt: outcome.receivedAt.toISOString(),
    };
  }

  /**
   * §38.9.2 / F-14: the same `mutation_id` under a different payload is the
   * idempotency-bypass alarm. It is answered as a per-mutation `CONTRADICTION`
   * (the batch continues, §38.10.3). The ledger owns the durable history of
   * the contradiction (M2-S6: the §32.2A audit row and the `SECURITY` stream
   * event, both class B — this frame's transaction dies with the alarm); the
   * structured warn line always accompanies it.
   */
  private contradictionOutcome(mutation: MutationPayload, error: MutationContradictionError): PushMutationOutcome {
    this.logger?.warn(
      {
        component: 'sync-push',
        securityEvent: 'sync-push-mutation-contradiction',
        mutationId: mutation.mutationId,
        storedPayloadHash: error.storedPayloadHash,
        replayedPayloadHash: error.replayedPayloadHash,
      },
      'push mutation reused a mutation_id with a different payload_hash — CONTRADICTION, owner review required',
    );
    return {
      mutationId: mutation.mutationId,
      status: 'CONTRADICTION',
      rejectionCode: ERROR_CODES.MUTATION_CONTRADICTION,
      receivedAt: new Date().toISOString(),
    };
  }
}

/**
 * The §38.8.1 wire fields of one mutation, as a plain record for canonical
 * hashing. Built explicitly so the hash covers the whole immutable mutation and
 * cannot drift with a class-instance detail.
 */
export function mutationFingerprint(mutation: MutationPayload): Record<string, unknown> {
  return {
    mutationId: mutation.mutationId,
    organizationId: mutation.organizationId,
    deviceId: mutation.deviceId,
    actorUserId: mutation.actorUserId,
    actorRoleSnapshot: mutation.actorRoleSnapshot,
    aggregateType: mutation.aggregateType,
    aggregateId: mutation.aggregateId,
    operationType: mutation.operationType,
    payload: mutation.payload,
    payloadVersion: mutation.payloadVersion,
    deviceLocalSequence: mutation.deviceLocalSequence,
    localCreatedAt: mutation.localCreatedAt,
    deviceIdempotencyKey: mutation.deviceIdempotencyKey,
  };
}

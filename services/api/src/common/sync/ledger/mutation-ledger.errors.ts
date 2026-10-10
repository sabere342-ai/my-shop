/**
 * The ledger's own error vocabulary (§38.9.2, §38.13).
 *
 * Two signals cross the boundary between the mutation ledger and whoever called
 * it (a future push endpoint, or a business acceptance path):
 *
 * - `MutationContradictionError` — the same `mutation_id` was already accepted
 *   under a **different** `payload_hash`. This is the idempotency-bypass alarm:
 *   `409 MUTATION_CONTRADICTION`, flagged for owner review, and logged as a
 *   security event (§38.9.2, §38.28, F-14). The durable `security_events` table
 *   is deferred to M2-S6 (§40.6), so this slice records the event in the
 *   structured log and documents the deferral.
 * - `MutationRejectedError` — the caller's effect refused the mutation for a
 *   business reason (for example `INSUFFICIENT_STOCK`, §38.13). The ledger
 *   persists a `REJECTED` row with the code so a replay is answered from the
 *   stored record and the rejection is never silently dropped (§38.13).
 */

import { ERROR_CODES } from '../../errors/problem';

/**
 * §38.9.2 CONTRADICTION. Carries both hashes so the security log can record
 * exactly what differed — the stored payload against the replay attempt.
 */
export class MutationContradictionError extends Error {
  readonly code: typeof ERROR_CODES.MUTATION_CONTRADICTION = ERROR_CODES.MUTATION_CONTRADICTION;

  constructor(
    readonly organizationId: string,
    readonly mutationId: string,
    readonly storedPayloadHash: string,
    readonly replayedPayloadHash: string,
  ) {
    super(
      `mutation_id ${mutationId} for organization ${organizationId} was already accepted ` +
        `with a different payload_hash (${storedPayloadHash} vs ${replayedPayloadHash})`,
    );
    this.name = 'MutationContradictionError';
  }
}

/**
 * A permanent, business refusal raised by the caller's effect. The code is the
 * stable §34.3 error code (for example `INSUFFICIENT_STOCK`); the ledger row is
 * written `REJECTED` with that code and no sequence is consumed.
 */
export class MutationRejectedError extends Error {
  constructor(readonly code: string) {
    super(`the mutation was rejected by the business effect: ${code}`);
    this.name = 'MutationRejectedError';
  }
}

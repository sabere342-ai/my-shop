/**
 * The server-side mutation apply port (Master Plan §40.5, M1b-S5; §8.4, D-8).
 *
 * The M1b-S4 ledger deliberately owns no business rule: it guarantees the
 * idempotency contract around a caller-supplied effect (§38.9). Push is the
 * caller. But at M1b-S5 **no business module exists yet** (§40.5 defers them), so
 * there is no aggregate type the server can genuinely apply.
 *
 * The honest, fail-closed answer is the default below: every mutation is refused
 * `UNSUPPORTED_MUTATION` and recorded `REJECTED` in the ledger — never silently
 * accepted, never dropped, and never allowed to fail its batch-mates (§38.10.3,
 * §38.13). Business modules replace this port with a real dispatcher when they
 * land; the transport, the ordering, the auth boundary, and the per-mutation
 * outcome stream built here are what they will plug into.
 *
 * A test supplies a supporting applier by overriding the `SYNC_MUTATION_APPLIER`
 * provider; that implementation lives under `test/`, so it is structurally absent
 * from a production build.
 */

import type { Prisma } from '@prisma/client';
import { ERROR_CODES } from '../../errors/problem';
import { MutationRejectedError } from '../ledger/mutation-ledger.errors';
import type { MutationEffectResult } from '../ledger/mutation-ledger.service';
import type { MutationPayload } from '../sync.contract';
import type { SyncTrustedContext } from './sync-auth';

/** Injection token for the mutation applier, overridable in tests only. */
export const SYNC_MUTATION_APPLIER = Symbol('SYNC_MUTATION_APPLIER');

/**
 * The effect the ledger runs inside its transaction. It may throw
 * `MutationRejectedError(code)` to record a permanent business rejection
 * (§38.13); any other throw rolls the whole transaction back and propagates.
 */
export type SyncMutationEffect = (tx: Prisma.TransactionClient) => Promise<MutationEffectResult>;

/**
 * Maps one authenticated mutation onto its business effect. The trusted context
 * (not the body) is the tenant scope.
 */
export interface SyncMutationApplier {
  effectFor(mutation: MutationPayload, context: SyncTrustedContext): SyncMutationEffect;
}

/**
 * The documented fail-closed default: every mutation is a permanent
 * `UNSUPPORTED_MUTATION` rejection. The refusal is raised from inside
 * the effect on purpose, so the S4 ledger persists a `REJECTED` row and a replay is
 * answered from the store rather than re-attempted (§38.13).
 *
 * M4-S4 (Tier 2, §38.22) binds the production token to the inventory applier
 * instead — which keeps this class as the narrow-wiring default and as the last
 * line of the same contract: an aggregate without an apply path is recorded,
 * never silently applied.
 */
export class FailClosedMutationApplier implements SyncMutationApplier {
  effectFor(): SyncMutationEffect {
    return () => Promise.reject(new MutationRejectedError(ERROR_CODES.UNSUPPORTED_MUTATION));
  }
}

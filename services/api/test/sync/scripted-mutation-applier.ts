/**
 * The test-only mutation applier (Master Plan §40.5, M1b-S5; §38.9, §38.10.3).
 *
 * Production binds `SYNC_MUTATION_APPLIER` to `FailClosedMutationApplier`, which
 * rejects every aggregate type `UNSUPPORTED_MUTATION` because no business module
 * exists yet. A test that needs a real per-mutation effect — to prove APPLIED,
 * REPLAY, REJECTED, CONTRADICTION, or partial-batch behaviour end to end — overrides
 * that token with this scripted applier, whose trusting effect lives under `test/`
 * and is therefore absent from a production build.
 */

import type { Prisma } from '@prisma/client';
import type { MutationEffectResult } from '../../src/common/sync/ledger/mutation-ledger.service';
import type { MutationPayload } from '../../src/common/sync/sync.contract';
import type { SyncTrustedContext } from '../../src/common/sync/push/sync-auth';
import type { SyncMutationApplier, SyncMutationEffect } from '../../src/common/sync/push/sync-mutation-applier';

/** The caller-supplied effect, given the mutation, its trusted scope, and the transaction. */
export type ScriptedEffect = (
  mutation: MutationPayload,
  context: SyncTrustedContext,
  tx: Prisma.TransactionClient,
) => Promise<MutationEffectResult>;

/** Maps every mutation onto one scripted effect. */
export class ScriptedMutationApplier implements SyncMutationApplier {
  constructor(private readonly script: ScriptedEffect) {}

  effectFor(mutation: MutationPayload, context: SyncTrustedContext): SyncMutationEffect {
    return (tx: Prisma.TransactionClient): Promise<MutationEffectResult> => this.script(mutation, context, tx);
  }
}

/**
 * Reads a `probe` object from the §38.24 payload. The acceptance harness shapes its
 * test mutations with this field; a mutation without it is a straightforward apply.
 */
export interface ProbeDirective {
  readonly outcome?: 'apply' | 'reject' | 'explode';
  readonly note?: string;
}

export function probeDirective(mutation: MutationPayload): ProbeDirective {
  const payload = mutation.payload;
  const probe = payload['probe'];
  if (typeof probe !== 'object' || probe === null) return {};
  const record = probe as Record<string, unknown>;
  const outcome = record['outcome'];
  return {
    ...(outcome === 'apply' || outcome === 'reject' || outcome === 'explode' ? { outcome } : {}),
    ...(typeof record['note'] === 'string' ? { note: record['note'] } : {}),
  };
}

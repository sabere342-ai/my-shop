/**
 * The test-only sync authenticator (Master Plan §38.16).
 *
 * Production binds `SYNC_AUTHENTICATOR` to `FailClosedSyncAuthenticator`, which
 * refuses everything until M2 supplies real token and device verification. A test
 * that needs to exercise the *authorized* push path overrides that token with an
 * implementation from this file, so the trusting code is structurally absent from
 * a production build — it lives under `test/`, which is never emitted.
 *
 * The authenticator deliberately ignores the `Authorization` header: it models a
 * verified credential by construction, not by parsing. A test that needs a refusal
 * simply does not override the production default.
 */

import { DomainError } from '../../src/common/errors/domain.error';
import { ERROR_CODES } from '../../src/common/errors/problem';
import type { SyncAuthenticator, SyncTrustedContext } from '../../src/common/sync/push/sync-auth';

/** Answers every request with one fixed trusted context. */
export class FixedSyncAuthenticator implements SyncAuthenticator {
  constructor(private readonly context: SyncTrustedContext) {}

  authenticate(): Promise<SyncTrustedContext> {
    return Promise.resolve(this.context);
  }
}

/**
 * Answers every request with the context currently held by the shared cell, so
 * one harness can drive several identity scenarios without a rebuild. The cell
 * is test-owned state: `undefined` context values are caller errors and the
 * authenticator still never reads anything from the request.
 */
export class MutableSyncAuthenticator implements SyncAuthenticator {
  constructor(private readonly cell: { context: SyncTrustedContext }) {}

  authenticate(): Promise<SyncTrustedContext> {
    const { context } = this.cell;
    if (context === undefined) {
      return Promise.reject(new Error('the mutable test authenticator has no context installed'));
    }
    return Promise.resolve(context);
  }
}

/** Refuses every request with the production `UNAUTHENTICATED` code. */
export class RefusingSyncAuthenticator implements SyncAuthenticator {
  authenticate(): Promise<SyncTrustedContext> {
    return Promise.reject(new DomainError(ERROR_CODES.UNAUTHENTICATED, 'test authenticator refuses'));
  }
}

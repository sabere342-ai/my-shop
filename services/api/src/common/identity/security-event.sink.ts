/**
 * §10.2 / §32 / §40.6 M2-S2, completed by M2-S6 — the security-event port.
 *
 * §10.2 requires that a failed login, a lockout, and a detected token reuse raise a
 * **security audit event**. M2-S6 now provides the durable `security_events`
 * persistence (`common/audit`): the production `SECURITY_EVENT_SINK` binding is
 * the `DurableSecurityEventSink`, and **this port is the contract the emitting
 * call sites were already written to**, which is why the durable switch touched
 * one binding and no emitter.
 *
 * The port is deliberately narrow. An event is a closed-vocabulary type plus the
 * few identifiers a log or a durable row needs — never a password, never a token,
 * never a raw driver error. That is what lets the same call site satisfy both the
 * logging implementation here and the durable one now.
 *
 * Failure policies (M2-S6, the slice record's matrix): the durable sink is
 * non-throwing for the rejected-decision events (class B — the row is attempted
 * after the refusal, in its own short transaction), and services that emit
 * inside a protected transaction use the audit domain's transactional writer
 * (class A). The logging implementation below remains exactly as it was — a
 * redaction reference and a unit-test stand-in; production binds the durable
 * sink.
 */

import type { Logger as PinoLogger } from 'pino';
import type { ErrorCode } from '../errors/problem';
import { logPayload } from '../logging/logger';

/** The closed vocabulary of security events this application records. */
export type SecurityEventType =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'LOGIN_THROTTLED'
  | 'REFRESH_ROTATED'
  | 'REFRESH_REUSE_DETECTED'
  | 'LOGOUT'
  | 'ACCESS_TOKEN_REJECTED'
  | 'ACCESS_TOKEN_STALE'
  | 'DEVICE_REGISTERED'
  | 'DEVICE_REGISTRATION_REFUSED'
  | 'DEVICE_REVOKED'
  // M2-S6 (§32.3 cross-organization access refused / §38.27 idempotency
  // contradiction): the two sync-boundary classes whose execution paths the
  // existing structured security logs already cover.
  | 'SYNC_IDENTITY_MISMATCH'
  | 'SYNC_MUTATION_CONTRADICTION';

/** One security event. Every field is either a closed vocabulary value or an id. */
export interface SecurityEvent {
  readonly type: SecurityEventType;
  /**
   * The identity the event concerns. For *verified* events this is the
   * verified principal; for unverified attempts it is the account the attempt
   * was aimed at, and `actorKind` says so (§32.6 accountability).
   */
  readonly userId?: string;
  /**
   * M2-S6: the §32.6 attribution class. `USER` is a verified principal,
   * `UNVERIFIED` is a labelled attempt whose identity was never proven.
   * Defaults to `USER` when a `userId` is given; the durable sink maps
   * `UNVERIFIED` onto the claimed attribution columns, never onto verified
   * identity.
   */
  readonly actorKind?: 'USER' | 'UNVERIFIED';
  /**
   * M2-S6: the e-mail an unverified attempt claimed, as typed subject to the
   * same canonicalization the login uses — a labelled claim, never a verified
   * identity, and never a credential.
   */
  readonly claimedEmail?: string;
  /**
   * The device the event concerns (M2-S5). Only a server-resolved device id —
   * never an installation handle, never a client assertion — is ever recorded.
   */
  readonly deviceId?: string;
  /** The tenant the event concerns (M2-S5 devices), when it is a server fact. */
  readonly organizationId?: string;
  /** The raising error code, when the event is a refusal. */
  readonly errorCode?: ErrorCode;
  /** The client address, when available; a §13.5 rate-limit scope, never authority. */
  readonly clientAddress?: string;
  // The sync-boundary diagnostics below are the closed, safe fields of the
  // M2-S6 vocabulary: identifiers and payload hashes only — never a request
  // body, never token or credential material (§32.4, §38.28.3).
  /** The mutation a sync security event concerns. */
  readonly mutationId?: string;
  /** The batch an identity mismatch concerns. */
  readonly syncBatchId?: string;
  /** The device identifier the body *asserted*, when mismatched (a claim). */
  readonly assertedDeviceId?: string;
  /** The organization the body *asserted*, when mismatched (a claim). */
  readonly assertedOrganizationId?: string;
  /** The stored payload hash, for a contradiction (§38.9.2). */
  readonly storedPayloadHash?: string;
  /** The replayed payload hash, for a contradiction (§38.9.2). */
  readonly replayedPayloadHash?: string;
}

/** Records security events. See §32: a durable implementation is M2-S6's. */
export interface SecurityEventSink {
  record(event: SecurityEvent): void;
}

/**
 * The M2-S2 implementation: a structured, redacted log line.
 *
 * The line is built with `logPayload`, so only allow-listed fields can appear and
 * a future field cannot leak by being named here by accident (§13.1, §38.28.3).
 */
export class LoggingSecurityEventSink implements SecurityEventSink {
  constructor(private readonly logger: PinoLogger) {}

  record(event: SecurityEvent): void {
    try {
      this.logger.info(
        logPayload({
          component: 'identity',
          reason: event.type,
          ...(event.userId === undefined ? {} : { userId: event.userId }),
          ...(event.deviceId === undefined ? {} : { deviceId: event.deviceId }),
          ...(event.organizationId === undefined ? {} : { organizationId: event.organizationId }),
          ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
          ...(event.clientAddress === undefined ? {} : { ip: event.clientAddress }),
        }),
        'identity security event',
      );
    } catch {
      // A logging failure must never change the outcome of an authentication
      // operation. The durable sink M2-S6 adds will own a real failure policy.
    }
  }
}

/** A sink that records nothing. Used only where no logger is available (unit tests). */
export class NullSecurityEventSink implements SecurityEventSink {
  record(): void {
    // intentionally empty
  }
}

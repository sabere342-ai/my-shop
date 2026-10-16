/**
 * §10.2 / §32 / §40.6 M2-S2 — the security-event port.
 *
 * §10.2 requires that a failed login, a lockout, and a detected token reuse raise a
 * **security audit event**. §32 places the durable `security_events` and
 * `audit_events` tables in M2-S6, which is after this slice. Those two facts
 * together define this file: a **port** the authentication code writes to, and a
 * logging implementation for now, so M2-S6 can replace one provider without
 * touching the code that emits events.
 *
 * The port is deliberately narrow. An event is a closed-vocabulary type plus the
 * few identifiers a log or a durable row needs — never a password, never a token,
 * never a raw driver error. That is what lets the same call site satisfy both the
 * logging implementation here and the durable one later.
 *
 * The logging sink never throws. A failure to record an event must not turn a
 * successful login into a refused one; M2-S6's durable sink will own its own
 * failure policy (a transactional write where the operation can share the
 * transaction, or an explicit outbox where it cannot).
 */

import type { Logger as PinoLogger } from 'pino';
import type { ErrorCode } from '../errors/problem';
import { logPayload } from '../logging/logger';

/** The closed vocabulary of security events this slice emits. */
export type SecurityEventType =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'LOGIN_THROTTLED'
  | 'REFRESH_ROTATED'
  | 'REFRESH_REUSE_DETECTED'
  | 'LOGOUT'
  | 'ACCESS_TOKEN_REJECTED'
  | 'ACCESS_TOKEN_STALE';

/** One security event. Every field is either a closed vocabulary value or an id. */
export interface SecurityEvent {
  readonly type: SecurityEventType;
  /** The identity the event concerns, when it is known and verified. */
  readonly userId?: string;
  /** The raising error code, when the event is a refusal. */
  readonly errorCode?: ErrorCode;
  /** The client address, when available; a §13.5 rate-limit scope, never authority. */
  readonly clientAddress?: string;
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

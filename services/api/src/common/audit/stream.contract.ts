/**
 * The audit-stream contracts (Master Plan §32, §32.1–§32.6, §32.2A, §40.6 M2-S6).
 *
 * Two purpose-built streams, never one (§32.1):
 *
 - `AUDIT`  — the business history (`audit_events`). "Why does this number look
 *   like this, and who did it?" Indefinite retention, part of the financial
 *   record, readable under `audit.view`.
 * - `SECURITY` — the security history (`security_events`). "Who tried to get
 *   in, and did we stop them?" Owner-only at the application layer; a minimum
 *   400-day retention obligation; never posted to any ledger.
 *
 * The stream is append-only by **privilege** (§32.5): migrations `0010`/`0011`
 * leave the application role INSERT + SELECT and no UPDATE and no DELETE
 * against the event tables — the allocation anchor (`audit_stream_heads`)
 * keeps exactly the head UPDATE the append needs (its rationale is spelled out
 * in migration 0011). Every event carries a gapless-committed per-scope
 * `sequence` and a SHA-256 chain (`prev_event_hash` → `event_hash`) computed
 * by the canonical serializer, so the *committed* series is verifiable: a gap
 * means a deletion (rollback cannot produce one), a linkage break means
 * rewriting, and a recomputed-row mismatch means mutation.
 *
 * Scopes (see the M2-S6 slice record, points 9–13): AUDIT is tenant-owned
 * only. SECURITY has two verified partitions — tenant rows whose organization
 * is a server fact, and the deliberate GLOBAL partition of pre-authentication,
 * per-identity events that must never fabricate a tenant id from an
 * unverified e-mail.
 *
 * Attribution (§32.6): no event is ever "nobody". `actor_kind` distinguishes
 * USER (verified), DEVICE (device-anchored, no verified user), SYSTEM
 * (documented principal), and UNVERIFIED (a labelled attempt whose only
 * attribution is the claimed e-mail/account columns — never verified
 * identity).
 */

import type { Prisma } from '@prisma/client';

/** The two §32.1 streams. Extension is a storage decision, never a constant. */
export type AuditStream = 'AUDIT' | 'SECURITY';

/** All streams this contract knows, in one list for exhaustive verification. */
export const AUDIT_STREAMS: readonly AuditStream[] = ['AUDIT', 'SECURITY'];

/**
 * The scope of the SECURITY stream's GLOBAL partition — the all-zero UUID.
 * The global stream is one chain (`00000000-…-00000000`): pre-authentication
 * and per-identity security telemetry with no tenant fact.
 */
export const GLOBAL_SECURITY_SCOPE = '00000000-0000-0000-0000-000000000000';

/** The genesis chain hash: no row exists yet in the scope. */
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/** §32.6 actor accountability. No value means "nobody". */
export type AuditActorKind = 'USER' | 'DEVICE' | 'SYSTEM' | 'UNVERIFIED';

/** One actor attribution. Fields are consistent per kind (CHECK-enforced). */
export interface AuditActor {
  readonly kind: AuditActorKind;
  /** The verified user, when the actor is one. */
  readonly userId?: string;
  /** A server-resolved device when the event is device-anchored. */
  readonly deviceId?: string;
  /** SYSTEM only: the documented principal name (e.g. `system:identity`). */
  readonly principal?: string;
  /** UNVERIFIED only: the account the attempt was aimed at (a claim, labelled). */
  readonly claimedUserId?: string;
  /** UNVERIFIED only: the e-mail the attempt claimed (a claim, labelled). */
  readonly claimedEmail?: string;
}

/**
 * The closed `security_events` vocabulary (§32.3, plus the two §38.27/§32.3
 * sync-boundary classes whose execution paths exist). Grammar is
 * CHECK-enforced by migration `0010`; the authoritative list is versioned
 * here, in code (§11.2 discipline). Adding an event type is a schema-light
 * contract change; the type must map to a real execution path.
 */
export const SECURITY_EVENT_TYPES = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGIN_THROTTLED',
  'REFRESH_ROTATED',
  'REFRESH_REUSE_DETECTED',
  'LOGOUT',
  'ACCESS_TOKEN_REJECTED',
  'ACCESS_TOKEN_STALE',
  'DEVICE_REGISTERED',
  'DEVICE_REGISTRATION_REFUSED',
  'DEVICE_REVOKED',
  'SYNC_IDENTITY_MISMATCH',
  'SYNC_MUTATION_CONTRADICTION',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/**
 * The closed `audit_events` vocabulary **this code implements end to end**:
 * the §32.2A server-side sync classes, the §32.2 row for device revocation
 * whose producing paths exist, and the §32.2/§22.2 row for the M3-S1 typed
 * settings whose producing path exists. Business actions that other slices
 * own, and locally generated offline events, are reserved contracts — the
 * transactional writer below accepts exactly these, and new types arrive with
 * the slices that own their producing paths.
 */
export const AUDIT_EVENT_TYPES = [
  'SYNC_MUTATION_ACCEPTED',
  'SYNC_MUTATION_REJECTED',
  'SYNC_MUTATION_RETRY',
  'SYNC_MUTATION_CONTRADICTION',
  'DEVICE_REVOKED',
  'SETTINGS_UPDATED',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/**
 * §32.2A's rejection classification. `INGRESS` is the offline
 * authorization/conflict class (the re-validator's refusal — the
 * highest-severity offline family); `BUSINESS` is everything the business
 * effect refused.
 */
export type SyncRejectionClassification = 'INGRESS' | 'BUSINESS';

/** What one audit/emission payload may be: a plain, recursive JSON value. */
export type AuditPayload =
  null | boolean | number | string | readonly AuditPayload[] | { readonly [key: string]: AuditPayload };

/**
 * One business-history event (§32.2/§32.2A, server-implemented half). The
 * `scope` is the organization the event belongs to — a server fact, never a
 * body field.
 */
export interface AuditEventInput {
  readonly eventType: AuditEventType;
  readonly organizationId: string;
  readonly actor: AuditActor;
  /** The server-recorded time. Clients never supply it. */
  readonly occurredAt: Date;
  /** The §32.2A device-local event time, when the event carries one. */
  readonly localOccurredAt?: Date;
  readonly targetType?: string;
  readonly targetId?: string;
  /** The originating document, when the event carries one. */
  readonly documentRef?: string;
  /** The mutation that produced the event (§32.2A server rows). */
  readonly mutationId?: string;
  readonly deviceLocalSequence?: bigint;
  readonly payload?: AuditPayload;
}

/** One security-history event. `organizationId` is present only when verified. */
export interface SecurityEventInput {
  readonly eventType: SecurityEventType;
  readonly organizationId?: string;
  readonly actor: AuditActor;
  readonly occurredAt: Date;
  /** The server-resolved device the event concerns (never an assertion). */
  readonly deviceId?: string;
  /** The refusal's reason code — a code, never a raw error or a request body. */
  readonly reasonCode?: string;
  /** The throttle-scope client address ("never authority"). */
  readonly clientAddress?: string;
  readonly payload?: AuditPayload;
}

/** The one normalized row shape the writers append, post normalization. */
export interface NormalizedAuditRow {
  readonly organizationId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly localOccurredAt: Date | null;
  readonly actorKind: AuditActorKind;
  readonly actorUserId: string | null;
  readonly actorDeviceId: string | null;
  readonly actorPrincipal: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly documentRef: string | null;
  readonly mutationId: string | null;
  readonly deviceLocalSequence: bigint | null;
  readonly payload: Record<string, unknown> | null;
  readonly clientAddress: string | null;
  readonly reasonCode: string | null;
  readonly deviceId: string | null;
  readonly claimedUserId: string | null;
  readonly claimedEmail: string | null;
}

/** The client the appenders and the verifier need from a transaction. */
export type AuditTxClient = Pick<
  Prisma.TransactionClient,
  'auditEvent' | 'securityEvent' | 'auditStreamHead' | '$executeRaw' | '$queryRaw'
>;

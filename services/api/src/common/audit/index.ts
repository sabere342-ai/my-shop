/**
 * The audit streams domain (Master Plan §32; §40.6 M2-S6).
 *
 * Deliberately a **leaf** context: it may be consumed by identity, devices,
 * sync, and future business modules, and it imports nothing back — the only
 * edges it holds are to the database primitives (tenant context, Prisma) and
 * the identity port *types* it serves (type-only, no runtime coupling).
 */

export * from './stream.contract';
export * from './canonical';
export * from './audit-stream-writer';
export * from './durable-security-event-sink';
export * from './audit-integrity';

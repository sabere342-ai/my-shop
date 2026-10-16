/**
 * The database host the identity providers depend on.
 *
 * `PrismaService` (M1-S3) is a **host**, not a `PrismaClient` subclass: it exposes
 * the connected client through a `prisma` getter and connects lazily on
 * `onModuleInit`. The identity providers therefore depend on this structural
 * interface and read `host.prisma` *at call time*. Depending on the client type
 * directly would not type-check, and reading the getter at construction would throw
 * before `onModuleInit` has connected — the difference between a working graph and
 * a DI-time crash.
 *
 * This mirrors `MutationLedgerService`'s `PrismaHost`, restated here rather than
 * imported so the identity context does not depend on the sync context (§39.3).
 */

import type { PrismaClient } from '@prisma/client';

export interface PrismaHost {
  readonly prisma: PrismaClient;
}

/**
 * The pull service (Master Plan §40.5, M1b-S6; §38.11).
 *
 * It turns one authenticated read into one page of the change feed and is
 * deliberately thin: the §38.11.1 feed, the retention boundary, and the cursor
 * arithmetic belong to the M1b-S4 ledger, which this service calls once. What
 * lives here is the transport mapping the ledger does not own:
 *
 * - **Defaults and bounds** (§38.11.2): an omitted `limit` becomes the contract
 *   default (200); the global pipe has already refused anything above the hard
 *   maximum (1000), so this layer never re-decides a bound.
 * - **Wire shape**: the ledger speaks `bigint`; the wire speaks decimal strings,
 *   so a 64-bit sequence survives JSON without floating-point loss (§38.11.2).
 * - **Tenant scope from the context, never the query** (§38.16, §9.3): the
 *   request carries no organization field at all, and the scope handed to the
 *   ledger is the authenticated one.
 *
 * The service is a pure read. It never advances a cursor: §38.11.2 makes the
 * client store `nextAfter` **only after** the page is applied locally, so an
 * interrupted pull re-fetches rather than losing changes (T-O6).
 */

import type { Logger as PinoLogger } from 'pino';
import type { MutationLedgerService } from '../ledger/mutation-ledger.service';
import type { DeviceService } from '../../devices/device.service';
import {
  DEFAULT_PULL_PAGE_SIZE,
  PULL_RETENTION_DAYS,
  type PullChange,
  type PullPageResponse,
  type PullQuery,
} from './pull.contract';
import type { SyncTrustedContext } from './sync-auth';

export class SyncPullService {
  constructor(
    private readonly ledger: MutationLedgerService,
    private readonly logger?: PinoLogger,
    /**
     * §12.5 (M2-S5): the device service that records the pull metadata once per
     * served page. Optional only so a narrowly-scoped unit construction does not
     * have to depend on the devices module — the production wiring always
     * supplies it.
     */
    private readonly devices?: DeviceService,
  ) {}

  /**
   * Reads one page of the organization change feed (§38.11.2).
   *
   * @param query The validated `after`/`limit` cursor. Absent `after` means from
   *   the beginning; absent `limit` means the contract default.
   * @param context The authenticated scope — the only source of tenant identity.
   */
  async pullChanges(query: PullQuery, context: SyncTrustedContext): Promise<PullPageResponse> {
    const after = query.after === undefined ? 0n : BigInt(query.after);
    const limit = query.limit ?? DEFAULT_PULL_PAGE_SIZE;

    const page = await this.ledger.pullChanges({
      organizationId: context.organizationId,
      after,
      limit,
      retentionDays: PULL_RETENTION_DAYS,
    });

    // §12.5 (M2-S5): once per served page — never per row — the device's sync
    // metadata moves. The recording is best-effort and diagnostic; it can
    // neither fail the page the server just served nor authorize anything.
    await this.devices?.recordPullMetadata({
      organizationId: context.organizationId,
      deviceId: context.deviceId,
    });

    if (page.rebaselineRequired) {
      // §38.11.1: a cursor older than the retained window is a full re-baseline,
      // not a partial pull. It is a normal operational event, not a security one,
      // so it is logged as an advisory with the floor the client must restart from.
      this.logger?.warn(
        {
          component: 'sync-pull',
          organizationId: context.organizationId,
          deviceId: context.deviceId,
          after: after.toString(),
          retentionFloor: page.retentionFloor?.toString(),
        },
        'pull cursor is older than the change-log retention window — full re-baseline required (§38.11.1)',
      );
    }

    return {
      changes: page.changes.map((change): PullChange => mapChange(change)),
      nextAfter: page.nextAfter.toString(),
      hasMore: page.hasMore,
      rebaselineRequired: page.rebaselineRequired,
      // Present only when it is actionable: a client is told the floor exactly
      // when it has fallen behind it (or is re-baselining in the next step).
      ...(page.rebaselineRequired && page.retentionFloor !== null
        ? { retentionFloor: page.retentionFloor.toString() }
        : {}),
    };
  }
}

/** One ledger change as the wire carries it: sequences as decimal strings. */
function mapChange(change: {
  readonly serverSequence: bigint;
  readonly entityType: string;
  readonly entityId: string;
  readonly mutationId: string | null;
  readonly changedAt: Date;
}): PullChange {
  return {
    serverSequence: change.serverSequence.toString(),
    entityType: change.entityType,
    entityId: change.entityId,
    ...(change.mutationId === null ? {} : { mutationId: change.mutationId }),
    changedAt: change.changedAt.toISOString(),
  };
}

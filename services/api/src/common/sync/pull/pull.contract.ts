/**
 * The pull wire contract (Master Plan §40.5, M1b-S6; §38.11).
 *
 * `GET /api/v1/sync/pull?after={server_sequence}&limit={n}` reads the
 * per-organization change feed (§38.11.1) that M1b-S4's ledger writes in the
 * same transaction as every accepted mutation. It answers one **page of change
 * descriptors**, not payloads: `change_log` carries `entity_type`/`entity_id`
 * and the `server_sequence` that orders them (§38.11.2), and retrieving the full
 * state of a changed entity is a later business slice's job (§38.15). This is
 * deliberate — the feed's contract is "what changed, in what order", so the
 * transport can be proven before any business object exists.
 *
 * Four rules shape the page, and each is a §38.11.2 decision:
 *
 * - **Cursor, never offset.** Paging is on `server_sequence` (`after`, exclusive
 *   lower bound). There is no `page`/`offset` parameter: an offset page is not a
 *   snapshot (§38.11.2 "Each page is a snapshot at a sequence"), and a change
 *   inserted mid-page would be skipped or repeated.
 * - **Bounded.** `limit` defaults to 200 and is refused above a hard maximum of
 *   1000 (§38.11.2), so a device cannot ask the server to stream a whole feed in
 *   one response.
 * - **Resume is the client's.** The response hands back `nextAfter`; the client
 *   stores it **only after** the page is applied locally (§38.11.2). The server
 *   never advances the cursor on a read, so an interrupted pull re-fetches
 *   rather than losing changes (T-O6).
 * - **Retention, stated.** A client whose cursor is older than the retained
 *   window (default 90 days, O-21) is told to re-baseline rather than served a
 *   partial feed that would silently drop the aged-out prefix (§38.11.1).
 *
 * `server_sequence` is a 64-bit value, so both the request `after` and the
 * response `nextAfter`/`retentionFloor` are **decimal strings**: a JSON number
 * would lose precision beyond 2^53, and §38.11.2's ordering must survive every
 * value the counter can reach.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * §38.11.2: "limit bounded, default 200, hard maximum 1000". Both bounds are
 * contract constants so the client's compiled default and the server's refusal
 * threshold cannot drift apart.
 */
export const DEFAULT_PULL_PAGE_SIZE = 200;
export const MAX_PULL_PAGE_SIZE = 1000;

/**
 * §38.11.1 / O-21: `change_log` retention, default 90 days. A client whose
 * cursor is older than this window performs a full re-baseline rather than a
 * partial pull. It is a contract constant, not environment configuration:
 * §22.1 forbids a typed environment variable standing in for an organization
 * setting, and the per-organization override is M3-S1's database row.
 */
export const PULL_RETENTION_DAYS = 90;

/** §38.11.1 `server_sequence`: a non-negative 64-bit integer. */
const SEQUENCE_PATTERN = /^\d+$/;

const SEQUENCE_STRING_DESCRIPTION =
  'The §38.11.1 per-organization server sequence as a decimal string, so a 64-bit value survives ' +
  'JSON without floating-point loss.';

/**
 * The pull query (§38.11.2). A query DTO rather than a body, because a read must
 * not be able to assert tenant identity at all: `organizationId` is not a
 * parameter, it comes only from the authenticated context (§38.16, §9.3). The
 * global pipe's `forbidNonWhitelisted` turns an `offset`/`page` attempt into a
 * `400`, which is what keeps "cursor, never offset" structural.
 */
export class PullQuery {
  @ApiPropertyOptional({
    type: 'string',
    description:
      'Exclusive lower bound: return changes with `server_sequence` strictly greater than this ' +
      'cursor. Omitted means "from the beginning" (0). The client stores the returned `nextAfter` ' +
      'only after the page is applied locally (§38.11.2).',
    example: '0',
  })
  @IsOptional()
  @Matches(SEQUENCE_PATTERN, {
    message: 'after must be a non-negative decimal integer (server_sequence)',
  })
  readonly after?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PULL_PAGE_SIZE,
    default: DEFAULT_PULL_PAGE_SIZE,
    description:
      `Maximum changes to return (§38.11.2). Defaults to ${String(DEFAULT_PULL_PAGE_SIZE)}; ` +
      `refused above the hard maximum of ${String(MAX_PULL_PAGE_SIZE)}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PULL_PAGE_SIZE)
  readonly limit?: number;
}

/**
 * One change descriptor (§38.11.1, §38.11.2). It carries no business payload:
 * `entity_type`/`entity_id` name what changed, `server_sequence` is the order to
 * apply in (§38.12.1's sequence guard), and `mutation_id` — when the change
 * originated on a device — lets that device recognise its own echo rather than
 * re-apply blindly (§38.11.2 own-echo suppression).
 */
export class PullChange {
  @ApiProperty({ type: 'string', description: SEQUENCE_STRING_DESCRIPTION })
  readonly serverSequence!: string;

  @ApiProperty({
    description: 'The §38.8.1 `aggregate_type` the change touched (§38.11.3 change sets); an open vocabulary.',
    example: 'SALE',
  })
  readonly entityType!: string;

  @ApiProperty({
    description: 'The local identity of the changed business object (§38.11.1 `change_log.entity_id`).',
  })
  readonly entityId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The originating §38.8.1 `mutation_id` when the change came from a device mutation; absent for ' +
      'a server-originated change. It lets the originating device reconcile its own echo instead of ' +
      're-applying blind (§38.11.2 own-echo suppression).',
  })
  readonly mutationId?: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'When the server recorded the change (§38.11.1 `change_log.changed_at`), distinct from the ' +
      'client clock (§23.1).',
  })
  readonly changedAt!: string;
}

/**
 * One page of the §38.11.1 change feed (§38.11.2).
 *
 * `nextAfter` is the cursor to send on the next request — the sequence of the
 * last change in this page, or the request `after` unchanged when the page is
 * empty. The server never advances a stored cursor on a read: §38.11.2 makes the
 * client the owner of its resume position, and T-O6's "disconnect mid-pull loses
 * nothing" is a consequence of that.
 */
export class PullPageResponse {
  @ApiProperty({
    type: () => [PullChange],
    description:
      'Changes with `server_sequence` greater than the request `after`, ascending (§38.11.2). Empty ' +
      'when the client is current, and empty when `rebaselineRequired` is true.',
  })
  readonly changes!: PullChange[];

  @ApiProperty({
    type: 'string',
    description:
      'The cursor for the next pull: the last returned `server_sequence`, or the request `after` ' +
      'when nothing was returned. Store it only after applying this page locally (§38.11.2).',
    example: '200',
  })
  readonly nextAfter!: string;

  @ApiProperty({
    description:
      'True when more changes exist beyond this page. When false, the client is caught up to the ' +
      'sequence this page was taken at (§38.11.2).',
  })
  readonly hasMore!: boolean;

  @ApiProperty({
    description:
      'True when the client cursor is older than the §38.11.1 retention window (default 90 days, ' +
      'O-21). The page is deliberately empty: the plan requires a full re-baseline rather than a ' +
      'partial pull that would silently drop the aged-out prefix. `nextAfter` is returned unchanged.',
  })
  readonly rebaselineRequired!: boolean;

  @ApiPropertyOptional({
    type: 'string',
    description:
      'The first sequence still inside the retention window, present when `rebaselineRequired` is ' +
      'true. A client that re-baselines to this point resumes a partial pull from it.',
  })
  readonly retentionFloor?: string;
}

/** The wire path shared by the controller and the ACL declaration (§38.11.2). */
export const SYNC_PULL_PATH = 'api/v1/sync/pull';

/**
 * The stock-count closed vocabularies and bounds (Master Plan §15.8, §30.5,
 * O-14; §40.8 row M4-S4). The same §11.2/§15.3A discipline the inventory
 * contract states, restated for the count document: every constant here is a
 * code decision recorded with its owning slice, and the shape-carrying ones are
 * restated by the CHECKs of migration `0016_stock_counts` — the last line of
 * defence for a writer that bypasses the service.
 *
 * The count document is the one §15.5 movement cause's owning slice:
 * `STOCK_COUNT_ADJUSTMENT` movements exist **only** as the posting of a
 * recorded count (the variance is computed against the locked authoritative
 * level at post time, the movement attaches to its count line, and the whole
 * posting commits inside the count's one transaction — §15.6). The plain
 * movements route never accepts the cause; there is no parallel engine.
 */

import type { ADJUSTMENT_REASON_CODES } from '../inventory.contract';

/** The code catalog's own version, for the audit payload. */
export const STOCK_COUNT_CONTRACT_VERSION = 1;

/** The closed §15.8 lifecycle vocabulary, as the migration 0016 CHECK restates it. */
export const STOCK_COUNT_STATUSES = ['OPEN', 'POSTED', 'CANCELLED'] as const;

export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

/**
 * The document note shape: the operator's own words, the same §15.5 bounded
 * non-whitespace-ends text every inventory document note carries (migration
 * 0016's `chk_stock_count_note_bounded` restates it).
 */
export const STOCK_COUNT_NOTE_MAX_LENGTH = 300;

/**
 * The physically observed quantity: a non-negative exact integer in base
 * units, inside the same 12-digit magnitude every other inventory quantity
 * carries. **Zero is a real observation** — the shelf is empty — never a
 * stand-in for "not counted": an omitted variant simply has no line, and an
 * omitted line is never read as zero (§15.8).
 */
export const COUNTED_QUANTITY_WIRE_PATTERN = /^[0-9]{1,12}$/;

/** The per-line reason codes are the closed §38.5 adjustment vocabulary (re-approved here with its O-14 role). */
export type CountReasonCode = (typeof ADJUSTMENT_REASON_CODES)[number];

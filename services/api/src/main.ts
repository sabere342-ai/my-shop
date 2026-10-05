/**
 * Backend entry point placeholder.
 *
 * Master Plan §7.3 makes the backend the only authority for every business
 * invariant. This slice establishes the module boundary and nothing else:
 * NestJS, configuration validation, health and readiness, and the error contract
 * belong to M1-S2.
 *
 * The import boundary is present now because Master Plan §6.3 makes layering a
 * structural property rather than a convention, and a boundary that only starts
 * existing once code has been written is a boundary that will not hold.
 */

import { CONTRACT_VERSION } from '@my-shop/contracts';

export interface ApiBootstrap {
  readonly contractVersion: string;
  readonly namespace: string;
}

/**
 * The descriptor of the backend surface. M1-S2 replaces this with a real NestJS
 * application factory; the shape stays so nothing downstream depends on a
 * framework-specific constructor.
 */
export function describeApi(): ApiBootstrap {
  return {
    contractVersion: CONTRACT_VERSION,
    namespace: '/api/v1',
  };
}

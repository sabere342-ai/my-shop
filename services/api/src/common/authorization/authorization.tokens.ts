/**
 * M2-S3 §40.6 — DI tokens for the authorization composition layer.
 *
 * Kept in their own module so the controller and the module can share a token
 * without a circular import (the module imports the controller; the controller
 * must not import the module).
 */

/** Injection token for the authorization snapshot port (an exported interface). */
export const AUTHORIZATION_SNAPSHOT_SERVICE = Symbol('AUTHORIZATION_SNAPSHOT_SERVICE');

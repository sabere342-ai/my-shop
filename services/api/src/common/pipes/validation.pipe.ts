/**
 * Global validation pipe.
 *
 * Master Plan §34.2 requires **one** global pipe: whitelist, forbid non-whitelisted,
 * DTO-only. Each option earns its place:
 *
 * - `whitelist: true` strips any property without a decorator, so an attacker cannot
 *   smuggle `organizationId` or `roleId` into a body and have it reach a service.
 * - `forbidNonWhitelisted: true` turns that from a silent strip into a 400. Silent
 *   stripping is arguably safer, but it makes a client bug look like success, and §9.3's
 *   entire point is that a caller must never be able to assert tenant identity.
 * - `transform: true` lets a DTO field be populated by its decorator, and only by it.
 *   Implicit conversion is deliberately **off**: with it on, `unitPriceList: "0"` becomes
 *   a real zero and `quantity: "5"` becomes a number. §30.1 forbids a money value
 *   arriving as anything but an explicit integer minor-unit field, so the string must be
 *   rejected rather than converted.
 * - `stopAtFirstError: false` is deliberate: a caller fixing one field at a time over a
 *   shop's flaky connection is a worse experience than receiving every violation at once.
 */

import { ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';

export const VALIDATION_PIPE_OPTIONS: Readonly<ValidationPipeOptions> = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: false,
  validateCustomDecorators: false,
};

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({ ...VALIDATION_PIPE_OPTIONS });
}

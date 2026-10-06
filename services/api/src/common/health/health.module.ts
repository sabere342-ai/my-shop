/**
 * Health and readiness module.
 *
 * Platform infrastructure, not a business context: it owns no tables and therefore does
 * not appear in the §8.4 schema-ownership table.
 *
 * `ReadinessRegistry` is exported so a business module can register its own checks —
 * the database check in M1-S3 will do exactly that — without this module knowing what
 * those dependencies are.
 */

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadinessRegistry } from './readiness.registry';

@Module({
  controllers: [HealthController],
  providers: [ReadinessRegistry],
  exports: [ReadinessRegistry],
})
export class HealthModule {}

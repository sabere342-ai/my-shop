/**
 * Structured configuration.
 *
 * Master Plan §7.1 makes validated configuration a backend concern, and §22.3 makes
 * "settings are never cached as authority" a product rule. Both have the same
 * implementation consequence: **the process must refuse to start on invalid
 * configuration**, rather than defaulting and discovering the problem later at the
 * point of sale.
 *
 * This is the environment surface only. Organization settings (§22.2) are database
 * rows validated by the service layer and arrive with M3-S1; they are deliberately
 * not modelled here, because a typed key-value environment variable standing in for a
 * typed database setting is exactly the substitution §22.1 forbids.
 *
 * Secrets are read from the environment only (§13.6, §42.6). Nothing in this file has
 * a default that could silently be a production credential.
 */

import { Type, plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
  validateSync,
  type ValidationError,
} from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Pino log levels.
 *
 * `silent` is included because Pino supports it and it is a genuine operational need:
 * an assertion suite that prints a structured log line per request buries the one line a
 * failure needs, and a maintenance window sometimes needs the same suppression. It is
 * not a test-only affordance.
 */
export enum LogLevel {
  Silent = 'silent',
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
}

class HttpConfig {
  @IsInt({ message: 'HTTP_PORT must be an integer' })
  @Min(1, { message: 'HTTP_PORT must be at least 1' })
  @Max(65535, { message: 'HTTP_PORT must be at most 65535' })
  port = 3000;

  @IsString()
  @Matches(/^\/api\/v\d+$/, {
    message: 'HTTP_API_PREFIX must be a versioned namespace such as /api/v1 (Master Plan section 34.1)',
  })
  apiPrefix = '/api/v1';
}

class LoggingConfig {
  @IsEnum(LogLevel, {
    message: 'LOG_LEVEL must be one of silent, fatal, error, warn, info, debug, trace',
  })
  level: LogLevel = LogLevel.Info;

  /**
   * Master Plan §13.1 requires structured JSON logs, redacted by construction. In
   * production that is not negotiable, so it is asserted rather than configured.
   */
  @IsBoolean()
  // Annotated `boolean` rather than left to inference: a bare `= false` infers the
  // literal type `false`, which would make it impossible to ever configure the pretty
  // transport and would fail to compile the moment someone tried.
  readonly prettyPrint: boolean = false;
}

class DatabaseConfig {
  /**
   * Master Plan §13.4 requires two distinct roles: a migrator with DDL used only by
   * migration jobs, and an application role with DML only, subject to forced RLS and
   * without BYPASSRLS. Having both URLs present is what lets the startup check refuse
   * a deployment where they are the same credential.
   */
  @IsString()
  @IsOptional()
  applicationUrl?: string;

  @IsString()
  @IsOptional()
  migrationUrl?: string;
}

export class AppConfig {
  @IsEnum(NodeEnvironment)
  nodeEnv: NodeEnvironment = NodeEnvironment.Development;

  @ValidateNested()
  @Type(() => HttpConfig)
  http!: HttpConfig;

  @ValidateNested()
  @Type(() => LoggingConfig)
  logging!: LoggingConfig;

  @ValidateNested()
  @Type(() => DatabaseConfig)
  database!: DatabaseConfig;
}

export interface AppConfigShape {
  readonly nodeEnv: NodeEnvironment;
  readonly http: { readonly port: number; readonly apiPrefix: string };
  readonly logging: { readonly level: LogLevel; readonly prettyPrint: boolean };
  readonly database: { readonly applicationUrl?: string; readonly migrationUrl?: string };
}

/**
 * Injection token for the validated configuration.
 *
 * A Symbol rather than a string so it cannot collide with a third-party token, and so
 * the module graph fails at compile time if the two providers ever diverge in shape.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

export class ConfigurationError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(`Configuration is invalid; refusing to start.\n${violations.map((line) => `  - ${line}`).join('\n')}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * A nested configuration group as it arrives from the environment.
 *
 * Every field is `T | undefined` and **required to be present**, which is the shape
 * `exactOptionalPropertyTypes` (§7.1) forces and the reason `mergeDefaults` exists.
 * An optional property could not hold an explicit `undefined`, so "the operator set
 * PORT to nothing" and "the operator did not set PORT" would become indistinguishable —
 * and the first is a configuration error while the second is a default.
 */
type RawGroup<T> = { readonly [K in keyof T]: T[K] | undefined };

/** Nested environment groups, before defaults are applied and validated. */
interface RawEnvironment {
  readonly nodeEnv: unknown;
  readonly http: RawGroup<HttpConfig>;
  readonly logging: RawGroup<LoggingConfig>;
  readonly database: RawGroup<DatabaseConfig>;
}

function readRaw(env: NodeJS.ProcessEnv): RawEnvironment {
  return {
    nodeEnv: env['NODE_ENV'] ?? NodeEnvironment.Development,
    http: {
      port: env['PORT'] === undefined ? undefined : Number(env['PORT']),
      apiPrefix: env['API_PREFIX'],
    },
    logging: {
      level: env['LOG_LEVEL'] as LogLevel | undefined,
      prettyPrint: env['LOG_PRETTY'] === undefined ? undefined : env['LOG_PRETTY'] === 'true',
    },
    database: {
      applicationUrl: env['DATABASE_URL'],
      migrationUrl: env['MIGRATION_DATABASE_URL'],
    },
  };
}

/**
 * Overlays provided values on defaults, skipping `undefined`.
 *
 * `undefined` means "not supplied", which is exactly what `RawGroup` encodes.
 */
function mergeDefaults<T extends object>(defaults: T, provided: RawGroup<T>): T {
  const merged = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(provided)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as T;
}

/**
 * Flattens class-validator's nested violation tree into dotted paths.
 *
 * A `@ValidateNested()` group does not report its own constraints: each failing leaf
 * arrives as a child whose `property` is relative to that group. Without walking
 * `children`, `loadConfig({ PORT: '0' })` would report nothing at all and the operator
 * would be told the configuration was invalid by a message naming no field.
 *
 * Dotted paths are the operator-facing contract: `http.port`, `logging.level`.
 */
function flattenViolations(violations: readonly ValidationError[], prefix = ''): readonly string[] {
  return violations.flatMap((violation) => {
    const path = prefix.length === 0 ? violation.property : `${prefix}.${violation.property}`;

    const own = Object.values(violation.constraints ?? {}).map((message) => `${path}: ${String(message)}`);

    // class-validator types `children` as optional. `?? []` rather than a default
    // parameter, because the absence is per-violation rather than per-call.
    const grandChildren = violation.children ?? [];

    // A nested group that failed wholesale - for example a child that is not an object
    // at all - reports its failure on the parent with no leaf to descend into. Without
    // this, that failure produces an empty violation list and the operator is told the
    // configuration is invalid by a message naming no field.
    const structural = grandChildren.length === 0 && own.length === 0 ? [`${path}: is invalid`] : [];

    const children = flattenViolations(grandChildren, path);

    return [...own, ...structural, ...children];
  });
}

/**
 * Builds and validates the configuration, or throws ConfigurationError.
 *
 * Throwing is deliberate. Master Plan §36.1 T-1 requires that a rule be able to fail
 * the build; a configuration system that logs a warning and continues is a rule that
 * cannot.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfigShape {
  const raw = readRaw(env);

  const instance = plainToInstance(AppConfig, {
    nodeEnv: raw.nodeEnv,
    http: mergeDefaults(new HttpConfig(), raw.http),
    logging: mergeDefaults(new LoggingConfig(), raw.logging),
    database: mergeDefaults(new DatabaseConfig(), raw.database),
  });

  const violations = validateSync(instance, {
    whitelist: true,
    forbidUnknownValues: false,
    skipMissingProperties: false,
  });

  if (violations.length > 0) {
    throw new ConfigurationError(flattenViolations(violations));
  }

  const config: AppConfigShape = {
    nodeEnv: instance.nodeEnv,
    http: { port: instance.http.port, apiPrefix: instance.http.apiPrefix },
    logging: { level: instance.logging.level, prettyPrint: instance.logging.prettyPrint },
    database: {
      ...(instance.database.applicationUrl === undefined ? {} : { applicationUrl: instance.database.applicationUrl }),
      ...(instance.database.migrationUrl === undefined ? {} : { migrationUrl: instance.database.migrationUrl }),
    },
  };

  return config;
}

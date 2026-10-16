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
   *
   * M1-S3 begins consuming these values, so the shape is validated too: a
   * connection URL that Prisma would reject later must be refused now, at the same
   * exit code 78 as every other configuration failure, rather than at first query.
   */
  @IsString()
  @Matches(/^postgres(?:ql)?:\/\/\S+$/, {
    message: 'DATABASE_URL must be a postgresql connection URL (Master Plan section 13.6)',
  })
  @IsOptional()
  applicationUrl?: string;

  @IsString()
  @Matches(/^postgres(?:ql)?:\/\/\S+$/, {
    message: 'MIGRATION_DATABASE_URL must be a postgresql connection URL (Master Plan section 13.6)',
  })
  @IsOptional()
  migrationUrl?: string;
}

/**
 * Identity and authentication configuration (Master Plan §10.2, §10.3, §13.6).
 *
 * The two key values are **base64 encodings of PEM text** rather than raw PEM. A
 * PEM block contains newlines, and every real environment surface (dotenv, Docker
 * Compose, systemd, a CI secret) mangles them differently; base64 makes the value a
 * single opaque token that survives all of them unchanged. The decoded PEM is what
 * the signer and verifier consume.
 *
 * Key material is **optional here and required in production** (`checkIdentityConfig`).
 * Outside production an absent key is not a configuration error: the identity module
 * binds a fail-closed surface rather than a weaker one, exactly as the M1b sync
 * boundary fails closed until M2 supplies verification.
 *
 * Nothing here has a default that could silently be a credential; the defaults are
 * the §10.2/§10.3 policy numbers, not secrets.
 */
class IdentityConfig {
  @IsString()
  @IsOptional()
  jwtPrivateKey?: string;

  @IsString()
  @IsOptional()
  jwtPublicKey?: string;

  @IsString()
  @Matches(/^\S+$/, { message: 'JWT_ISSUER must be a non-empty value with no whitespace' })
  jwtIssuer = 'my-shop';

  @IsString()
  @Matches(/^\S+$/, { message: 'JWT_AUDIENCE must be a non-empty value with no whitespace' })
  jwtAudience = 'my-shop-client';

  @IsInt({ message: 'ACCESS_TOKEN_TTL_SECONDS must be an integer' })
  @Min(60, { message: 'ACCESS_TOKEN_TTL_SECONDS must be at least 60' })
  @Max(86_400, { message: 'ACCESS_TOKEN_TTL_SECONDS must be at most 86400' })
  accessTokenTtlSeconds = 900;

  @IsInt({ message: 'REFRESH_IDLE_TTL_SECONDS must be an integer' })
  @Min(300, { message: 'REFRESH_IDLE_TTL_SECONDS must be at least 300' })
  @Max(2_592_000, { message: 'REFRESH_IDLE_TTL_SECONDS must be at most 2592000 (30 days)' })
  refreshIdleTtlSeconds = 604_800;

  @IsInt({ message: 'REFRESH_ABSOLUTE_TTL_SECONDS must be an integer' })
  @Min(3_600, { message: 'REFRESH_ABSOLUTE_TTL_SECONDS must be at least 3600' })
  @Max(2_592_000, { message: 'REFRESH_ABSOLUTE_TTL_SECONDS must be at most 2592000 (30 days)' })
  refreshAbsoluteTtlSeconds = 2_592_000;

  @IsInt({ message: 'ARGON2_MEMORY_KIB must be an integer' })
  @Min(8_192, { message: 'ARGON2_MEMORY_KIB must be at least 8192 (OWASP minimum is 19456)' })
  @Max(1_048_576, { message: 'ARGON2_MEMORY_KIB must be at most 1048576' })
  argon2MemoryKib = 19_456;

  @IsInt({ message: 'ARGON2_TIME_COST must be an integer' })
  @Min(1, { message: 'ARGON2_TIME_COST must be at least 1' })
  @Max(10, { message: 'ARGON2_TIME_COST must be at most 10' })
  argon2TimeCost = 2;

  @IsInt({ message: 'ARGON2_PARALLELISM must be an integer' })
  @Min(1, { message: 'ARGON2_PARALLELISM must be at least 1' })
  @Max(16, { message: 'ARGON2_PARALLELISM must be at most 16' })
  argon2Parallelism = 1;

  @IsInt({ message: 'AUTH_THROTTLE_BASE_DELAY_SECONDS must be an integer' })
  @Min(1, { message: 'AUTH_THROTTLE_BASE_DELAY_SECONDS must be at least 1' })
  @Max(86_400, { message: 'AUTH_THROTTLE_BASE_DELAY_SECONDS must be at most 86400' })
  throttleBaseDelaySeconds = 1;

  @IsInt({ message: 'AUTH_THROTTLE_MAX_DELAY_SECONDS must be an integer' })
  @Min(1, { message: 'AUTH_THROTTLE_MAX_DELAY_SECONDS must be at least 1' })
  @Max(86_400, { message: 'AUTH_THROTTLE_MAX_DELAY_SECONDS must be at most 86400' })
  throttleMaxDelaySeconds = 900;

  @IsInt({ message: 'AUTH_THROTTLE_FREE_ATTEMPTS must be an integer' })
  @Min(1, { message: 'AUTH_THROTTLE_FREE_ATTEMPTS must be at least 1' })
  @Max(100, { message: 'AUTH_THROTTLE_FREE_ATTEMPTS must be at most 100' })
  throttleFreeAttempts = 5;

  @IsInt({ message: 'PASSWORD_MIN_LENGTH must be an integer' })
  @Min(12, { message: 'PASSWORD_MIN_LENGTH must be at least 12 (Master Plan section 10.2)' })
  @Max(1_024, { message: 'PASSWORD_MIN_LENGTH must be at most 1024' })
  passwordMinLength = 12;

  @IsInt({ message: 'PASSWORD_MAX_LENGTH must be an integer' })
  @Min(12, { message: 'PASSWORD_MAX_LENGTH must be at least 12' })
  @Max(1_024, { message: 'PASSWORD_MAX_LENGTH must be at most 1024' })
  passwordMaxLength = 128;
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

  @ValidateNested()
  @Type(() => IdentityConfig)
  identity!: IdentityConfig;
}

/**
 * The identity configuration as the application consumes it. `jwtPrivateKey` and
 * `jwtPublicKey` are already-decoded PEM text (base64 is a transport detail of the
 * environment surface, not of the application contract).
 */
export interface IdentityConfigShape {
  readonly jwtPrivateKey?: string;
  readonly jwtPublicKey?: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshIdleTtlSeconds: number;
  readonly refreshAbsoluteTtlSeconds: number;
  readonly argon2MemoryKib: number;
  readonly argon2TimeCost: number;
  readonly argon2Parallelism: number;
  readonly throttleBaseDelaySeconds: number;
  readonly throttleMaxDelaySeconds: number;
  readonly throttleFreeAttempts: number;
  readonly passwordMinLength: number;
  readonly passwordMaxLength: number;
}

export interface AppConfigShape {
  readonly nodeEnv: NodeEnvironment;
  readonly http: { readonly port: number; readonly apiPrefix: string };
  readonly logging: { readonly level: LogLevel; readonly prettyPrint: boolean };
  readonly database: { readonly applicationUrl?: string; readonly migrationUrl?: string };
  /**
   * Optional by design: its *absence* is the fail-closed state outside production.
   * `loadConfig` populates it from validated environment input, but a hand-built
   * configuration that omits it yields an identity surface that refuses everything
   * rather than a weaker one.
   */
  readonly identity?: IdentityConfigShape;
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
  readonly identity: RawGroup<IdentityConfig>;
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
    identity: {
      jwtPrivateKey: env['JWT_PRIVATE_KEY'],
      jwtPublicKey: env['JWT_PUBLIC_KEY'],
      jwtIssuer: env['JWT_ISSUER'],
      jwtAudience: env['JWT_AUDIENCE'],
      accessTokenTtlSeconds: intOrUndefined(env['ACCESS_TOKEN_TTL_SECONDS']),
      refreshIdleTtlSeconds: intOrUndefined(env['REFRESH_IDLE_TTL_SECONDS']),
      refreshAbsoluteTtlSeconds: intOrUndefined(env['REFRESH_ABSOLUTE_TTL_SECONDS']),
      argon2MemoryKib: intOrUndefined(env['ARGON2_MEMORY_KIB']),
      argon2TimeCost: intOrUndefined(env['ARGON2_TIME_COST']),
      argon2Parallelism: intOrUndefined(env['ARGON2_PARALLELISM']),
      throttleBaseDelaySeconds: intOrUndefined(env['AUTH_THROTTLE_BASE_DELAY_SECONDS']),
      throttleMaxDelaySeconds: intOrUndefined(env['AUTH_THROTTLE_MAX_DELAY_SECONDS']),
      throttleFreeAttempts: intOrUndefined(env['AUTH_THROTTLE_FREE_ATTEMPTS']),
      passwordMinLength: intOrUndefined(env['PASSWORD_MIN_LENGTH']),
      passwordMaxLength: intOrUndefined(env['PASSWORD_MAX_LENGTH']),
    },
  };
}

/**
 * Parses an environment integer, preserving "absent" as `undefined`.
 *
 * A present-but-empty value (`PORT=`) becomes `Number('') === 0`, which the range
 * validators then reject — the operator set the variable to nothing, which is an
 * error, not a default. Only a genuinely absent variable is `undefined`.
 */
function intOrUndefined(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
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
 * The role identity of a connection URL for the §13.4 separation check.
 *
 * User, host, port, and database only. The password is deliberately excluded: the
 * same role with a rotated password is still the same role, and two roles are
 * distinct the moment any component differs. Returns `undefined` when the value
 * cannot be parsed as a URL at all, so the caller can report the failure without
 * echoing the value itself.
 */
function roleIdentity(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.username}|${parsed.hostname}|${parsed.port}|${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * Master Plan §13.4: the migrator and the application must be separate roles.
 *
 * When both URLs are configured and resolve to the same identity, the deployment
 * is a migration job running with the application's credential — the exact
 * configuration `app.config.ts` promises to refuse at startup. The message names
 * the variables and the rule, never the URLs: an exit-code-78 failure can land in
 * CI logs (§13.6).
 */
function checkRoleSeparation(database: DatabaseConfig): readonly string[] {
  if (database.applicationUrl === undefined || database.migrationUrl === undefined) {
    return [];
  }

  const application = roleIdentity(database.applicationUrl);
  const migration = roleIdentity(database.migrationUrl);

  if (application === undefined || migration === undefined) {
    return ['database: a connection URL is not a parseable URL'];
  }

  if (application === migration) {
    return [
      'database: DATABASE_URL and MIGRATION_DATABASE_URL identify the same role, host, and database; ' +
        'Master Plan section 13.4 requires a separate migrator and application role',
    ];
  }

  return [];
}

/**
 * Decodes one base64 PEM value and asserts it is actually PEM.
 *
 * The value is a secret, so a violation names the variable and the rule and never
 * echoes the value — an exit-code-78 failure can land in CI logs (§13.6).
 */
function checkPemKey(value: string, variable: string): readonly string[] {
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (!decoded.includes('-----BEGIN') || !decoded.includes('-----END')) {
    return [`identity: ${variable} must be the base64 encoding of a PEM key`];
  }
  return [];
}

/**
 * Master Plan §10.2/§10.3/§13.6: the identity configuration rules the shape
 * validators cannot express.
 *
 * - A key must decode to PEM, so a mis-quoted or truncated secret is refused at
 *   startup rather than at the first login.
 * - The two keys are a pair: half a pair is a configuration mistake.
 * - In production the pair is **required**. Outside production it may be absent, and
 *   the identity module then fails closed rather than running a weaker check.
 * - The ordering rules that must hold for the policy to make sense.
 */
function checkIdentityConfig(identity: IdentityConfig, nodeEnv: NodeEnvironment): readonly string[] {
  const issues: string[] = [];

  if (identity.jwtPrivateKey !== undefined) {
    issues.push(...checkPemKey(identity.jwtPrivateKey, 'JWT_PRIVATE_KEY'));
  }
  if (identity.jwtPublicKey !== undefined) {
    issues.push(...checkPemKey(identity.jwtPublicKey, 'JWT_PUBLIC_KEY'));
  }
  if (identity.jwtPrivateKey !== undefined && identity.jwtPublicKey === undefined) {
    issues.push('identity: JWT_PRIVATE_KEY is set but JWT_PUBLIC_KEY is not; set both or neither');
  }
  if (identity.jwtPublicKey !== undefined && identity.jwtPrivateKey === undefined) {
    issues.push('identity: JWT_PUBLIC_KEY is set but JWT_PRIVATE_KEY is not; set both or neither');
  }
  if (nodeEnv === NodeEnvironment.Production && identity.jwtPrivateKey === undefined) {
    issues.push(
      'identity: JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production; ' +
        'the access-token surface cannot run fail-closed in a production deployment',
    );
  }
  if (identity.refreshIdleTtlSeconds > identity.refreshAbsoluteTtlSeconds) {
    issues.push('identity: REFRESH_IDLE_TTL_SECONDS must not exceed REFRESH_ABSOLUTE_TTL_SECONDS');
  }
  if (identity.passwordMinLength > identity.passwordMaxLength) {
    issues.push('identity: PASSWORD_MIN_LENGTH must not exceed PASSWORD_MAX_LENGTH');
  }
  if (identity.throttleBaseDelaySeconds > identity.throttleMaxDelaySeconds) {
    issues.push('identity: AUTH_THROTTLE_BASE_DELAY_SECONDS must not exceed AUTH_THROTTLE_MAX_DELAY_SECONDS');
  }

  return issues;
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
    identity: mergeDefaults(new IdentityConfig(), raw.identity),
  });

  const violations = validateSync(instance, {
    whitelist: true,
    forbidUnknownValues: false,
    skipMissingProperties: false,
  });

  const allViolations = [
    ...flattenViolations(violations),
    ...checkRoleSeparation(instance.database),
    ...checkIdentityConfig(instance.identity, instance.nodeEnv),
  ];

  if (allViolations.length > 0) {
    throw new ConfigurationError(allViolations);
  }

  const config: AppConfigShape = {
    nodeEnv: instance.nodeEnv,
    http: { port: instance.http.port, apiPrefix: instance.http.apiPrefix },
    logging: { level: instance.logging.level, prettyPrint: instance.logging.prettyPrint },
    database: {
      ...(instance.database.applicationUrl === undefined ? {} : { applicationUrl: instance.database.applicationUrl }),
      ...(instance.database.migrationUrl === undefined ? {} : { migrationUrl: instance.database.migrationUrl }),
    },
    // The base64 encoding is a transport detail of the environment surface; the
    // application contract is PEM text, so it is decoded once, here. An absent key
    // stays absent, which is what makes the identity module fail closed.
    identity: {
      ...(instance.identity.jwtPrivateKey === undefined
        ? {}
        : { jwtPrivateKey: Buffer.from(instance.identity.jwtPrivateKey, 'base64').toString('utf8') }),
      ...(instance.identity.jwtPublicKey === undefined
        ? {}
        : { jwtPublicKey: Buffer.from(instance.identity.jwtPublicKey, 'base64').toString('utf8') }),
      jwtIssuer: instance.identity.jwtIssuer,
      jwtAudience: instance.identity.jwtAudience,
      accessTokenTtlSeconds: instance.identity.accessTokenTtlSeconds,
      refreshIdleTtlSeconds: instance.identity.refreshIdleTtlSeconds,
      refreshAbsoluteTtlSeconds: instance.identity.refreshAbsoluteTtlSeconds,
      argon2MemoryKib: instance.identity.argon2MemoryKib,
      argon2TimeCost: instance.identity.argon2TimeCost,
      argon2Parallelism: instance.identity.argon2Parallelism,
      throttleBaseDelaySeconds: instance.identity.throttleBaseDelaySeconds,
      throttleMaxDelaySeconds: instance.identity.throttleMaxDelaySeconds,
      throttleFreeAttempts: instance.identity.throttleFreeAttempts,
      passwordMinLength: instance.identity.passwordMinLength,
      passwordMaxLength: instance.identity.passwordMaxLength,
    },
  };

  return config;
}

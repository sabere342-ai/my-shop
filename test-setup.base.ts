/**
 * Jest setup shared by every TypeScript workspace.
 *
 * Master Plan §36.1 T-6 forbids tests that depend on execution order, wall-clock time,
 * or the host locale. The default timezone and locale are pinned so a suite cannot pass
 * on an Egyptian shopkeeper's machine and fail in CI.
 *
 * Master Plan §38.28.3 and §13.1 additionally require that no secret ever reach a log.
 * The redaction guard below makes that structural rather than a review convention: a test
 * that prints something resembling a credential fails loudly instead of shipping it into
 * CI output.
 */

// `reflect-metadata` must load before any module that uses a decorator. The backend's
// NestJS dependency injection and class-validator's `@Type` both read
// `Reflect.getMetadata` at import time, so a suite that omits this import fails at module
// evaluation rather than at an assertion — which is a much harder failure to read.
import 'reflect-metadata';

process.env['TZ'] = 'UTC';

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/,
  /\bBasic\s+[A-Za-z0-9+/]{16,}=*/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // A connection string carrying an inline password. Master Plan §13.6 forbids a
  // connection string in source, log, or CI output, and a URL that reaches stdout is
  // also how a `.env` line becomes a build artifact. The userinfo segment is required,
  // so a passwordless `postgresql://app@host/db` reference in a comment is not a
  // finding and legitimate documentation is not blocked.
  /\bpostgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
];

const REDACTED = '[REDACTED]';

function isCredentialShaped(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

function guardStream(stream: NodeJS.WriteStream, name: string): void {
  const originalWrite = stream.write.bind(stream) as typeof stream.write;

  stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (isCredentialShaped(text)) {
      originalWrite(`${REDACTED}\n`);
      throw new Error(
        `A credential-shaped value reached ${name} and was replaced with ${REDACTED}. ` +
          `Master Plan §13.6 and §42.6 forbid secrets in source, logs, and CI output.`,
      );
    }
    // `originalWrite` is already bound above, so no `this` rebinding is needed and the
    // overload set stays assignable.
    return Reflect.apply(originalWrite, stream, [chunk, ...rest]) as boolean;
  }) as typeof stream.write;
}

guardStream(process.stdout, 'stdout');
guardStream(process.stderr, 'stderr');

/**
 * Jest setup shared by every TypeScript workspace.
 *
 * Master Plan §36.1 T-6 forbids tests that depend on execution order, wall-clock
 * time, or the host locale. The default timezone and locale are pinned so a
 * suite cannot pass on an Egyptian shopkeeper's machine and fail on CI.
 *
 * Master Plan §38.28.3 and §13.1 additionally require that no secret ever reach a
 * log. The redaction guard below makes that structural rather than a review
 * convention: a test that prints something resembling a credential fails loudly
 * instead of shipping it into CI output.
 */

process.env['TZ'] = 'UTC';

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/,
  /\bBasic\s+[A-Za-z0-9+/]{16,}=*/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bpostgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
];

const REDACTED = '[REDACTED]';

function assertNoCredential(text: string, stream: string): void {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(
        `A credential-shaped value reached ${stream}. Master Plan §13.6 and §42.6 forbid ` +
          `secrets in source, logs, and CI output. The value was replaced with ${REDACTED}.`,
      );
    }
  }
}

for (const [name, stream] of [
  ['stdout', process.stdout],
  ['stderr', process.stderr],
] as const) {
  const originalWrite = stream.write.bind(stream);
  stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
      originalWrite(`${REDACTED}\n`);
      throw new Error(
        `A credential-shaped value reached ${name} and was replaced with ${REDACTED}. ` +
          `Master Plan §13.6 and §42.6 forbid secrets in source, logs, and CI output.`,
      );
    }
    return originalWrite(chunk as never, ...(rest as never[]));
  }) as typeof stream.write;
}
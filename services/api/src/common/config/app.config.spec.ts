import { ConfigurationError, LogLevel, NodeEnvironment, loadConfig } from './app.config';

describe('loadConfig', () => {
  it('applies the documented defaults when the environment is empty', () => {
    // §22.2: every optional setting has a safe default, so the common path requires no
    // decision. An unset environment must produce a usable configuration, not an error.
    const config = loadConfig({});

    expect(config.nodeEnv).toBe(NodeEnvironment.Development);
    expect(config.http.port).toBe(3000);
    expect(config.http.apiPrefix).toBe('/api/v1');
    expect(config.logging.level).toBe(LogLevel.Info);
    expect(config.logging.prettyPrint).toBe(false);
    expect(config.database.applicationUrl).toBeUndefined();
    expect(config.database.migrationUrl).toBeUndefined();
  });

  it('reads values from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      API_PREFIX: '/api/v1',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'false',
      DATABASE_URL: 'postgresql://app@localhost:5432/myshop',
      MIGRATION_DATABASE_URL: 'postgresql://migrator@localhost:5432/myshop',
    });

    expect(config.nodeEnv).toBe(NodeEnvironment.Production);
    expect(config.http.port).toBe(8080);
    expect(config.logging.level).toBe(LogLevel.Warn);
    expect(config.logging.prettyPrint).toBe(false);
    expect(config.database.applicationUrl).toBe('postgresql://app@localhost:5432/myshop');
    expect(config.database.migrationUrl).toBe('postgresql://migrator@localhost:5432/myshop');
  });

  it('defaults the api namespace to the versioned one from §34.1', () => {
    // A namespace that is not versioned would make a breaking change undetectable.
    expect(loadConfig({}).http.apiPrefix).toMatch(/^\/api\/v\d+$/);
  });

  it('rejects a port that is not an integer', () => {
    // Refusing to start beats defaulting to 3000 and silently listening somewhere the
    // operator did not intend.
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ PORT: '3.5' })).toThrow(ConfigurationError);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigurationError);
  });

  it('rejects an unversioned api namespace', () => {
    // §34.1 with ADR-027: a breaking change requires v2, which means the namespace must
    // carry its version.
    expect(() => loadConfig({ API_PREFIX: '/api' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ API_PREFIX: '/api/v' })).toThrow(ConfigurationError);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'chatty' })).toThrow(ConfigurationError);
  });

  it('rejects an unknown node environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigurationError);
  });

  it('names every violation rather than only the first', () => {
    // An operator fixing one misconfigured variable per deploy is a poor experience.
    let caught: unknown;
    try {
      loadConfig({ PORT: '0', LOG_LEVEL: 'chatty' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    const violations = (caught as ConfigurationError).violations;
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.join('\n')).toContain('http.port');
    expect(violations.join('\n')).toContain('logging.level');
  });

  it('reports the violating property in the error message', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/http\.port/);
  });

  it('accepts both database URLs when they name different roles', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://app@localhost:5432/myshop',
      MIGRATION_DATABASE_URL: 'postgresql://migrator@localhost:5432/myshop',
    });

    expect(config.database.applicationUrl).toBeDefined();
    expect(config.database.migrationUrl).toBeDefined();
  });

  it('accepts one database URL without the other', () => {
    // The pairing check only applies when both are known. An operator who set one
    // is not told the other is wrong — it was never declared.
    const appOnly = loadConfig({ DATABASE_URL: 'postgresql://app@localhost:5432/myshop' });
    const migrationOnly = loadConfig({ MIGRATION_DATABASE_URL: 'postgresql://m@localhost:5432/myshop' });

    expect(appOnly.database.migrationUrl).toBeUndefined();
    expect(migrationOnly.database.applicationUrl).toBeUndefined();
  });

  it('refuses to start when both database URLs identify the same role', () => {
    // §13.4: a deployment where the migrator is the application credential has no
    // role separation, and the comment on DatabaseConfig promises this refusal.
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://same@localhost:5432/myshop',
        MIGRATION_DATABASE_URL: 'postgresql://same@localhost:5432/myshop',
      }),
    ).toThrow(ConfigurationError);
  });

  it('treats a rotated password on the same role as the same identity', () => {
    // The password is excluded from the identity on purpose: same role, same
    // server, same database is one credential whichever password it carries.
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://app:old-password@localhost:5432/myshop',
        MIGRATION_DATABASE_URL: 'postgresql://app:new-password@localhost:5432/myshop',
      }),
    ).toThrow(/section 13\.4/);
  });

  it('never echoes the connection URLs in the refusal', () => {
    // An exit-code-78 failure routinely lands in CI output (§13.6).
    let caught: unknown;
    try {
      loadConfig({
        DATABASE_URL: 'postgresql://app:do-not-log-this@localhost:5432/myshop',
        MIGRATION_DATABASE_URL: 'postgresql://app:do-not-log-that@localhost:5432/myshop',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    const message = (caught as ConfigurationError).message;
    expect(message).not.toContain('do-not-log-this');
    expect(message).not.toContain('do-not-log-that');
    expect(message).not.toContain('localhost');
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('MIGRATION_DATABASE_URL');
  });

  it('rejects a database URL that is not a postgresql URL', () => {
    // Prisma would fail at first use; §22.3 requires the failure at startup.
    expect(() => loadConfig({ DATABASE_URL: 'mysql://app@localhost:3306/myshop' })).toThrow(
      /DATABASE_URL must be a postgresql connection URL/,
    );
    expect(() => loadConfig({ DATABASE_URL: 'not a url' })).toThrow(ConfigurationError);
  });

  it('rejects a database URL that cannot be parsed as a URL', () => {
    // The shape check above catches most malformations; this catches the rest
    // without echoing the offending value.
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://app@localhost:not-a-port/myshop',
        MIGRATION_DATABASE_URL: 'postgresql://migrator@localhost:5432/myshop',
      }),
    ).toThrow(ConfigurationError);
  });
});

describe('ConfigurationError', () => {
  it('states that the process refuses to start', () => {
    const error = new ConfigurationError(['http.port: must be at least 1']);
    expect(error.message).toContain('refusing to start');
    expect(error.message).toContain('http.port: must be at least 1');
  });
});

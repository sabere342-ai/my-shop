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
});

describe('ConfigurationError', () => {
  it('states that the process refuses to start', () => {
    const error = new ConfigurationError(['http.port: must be at least 1']);
    expect(error.message).toContain('refusing to start');
    expect(error.message).toContain('http.port: must be at least 1');
  });
});

import { buildProxyLoginUrl, resolvePassword } from '../../../src/auth/proxy';

describe('auth proxy helpers', () => {
  const originalEnv = process.env.PROXY_PASSWORD;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PROXY_PASSWORD;
    } else {
      process.env.PROXY_PASSWORD = originalEnv;
    }
  });

  test('resolves proxy passwords from the configured environment variable', () => {
    process.env.PROXY_PASSWORD = 'secret';

    expect(
      resolvePassword({
        name: 'campus',
        proxyUrl: 'https://proxy.example',
        passwordEnvVar: 'PROXY_PASSWORD',
      })
    ).toBe('secret');
  });

  test('returns undefined when no password environment variable is configured', () => {
    expect(resolvePassword({ name: 'campus', proxyUrl: 'https://proxy.example' })).toBeUndefined();
  });

  test('builds login URLs using loginUrl when configured and proxyUrl otherwise', () => {
    expect(
      buildProxyLoginUrl(
        { name: 'campus', proxyUrl: 'https://proxy.example', loginUrl: 'https://login.example' },
        'https://publisher.example/paper?id=1&download=true'
      )
    ).toBe(
      'https://login.example?url=https%3A%2F%2Fpublisher.example%2Fpaper%3Fid%3D1%26download%3Dtrue'
    );

    expect(
      buildProxyLoginUrl(
        { name: 'campus', proxyUrl: 'https://proxy.example' },
        'https://publisher.example/paper'
      )
    ).toBe('https://proxy.example?url=https%3A%2F%2Fpublisher.example%2Fpaper');
  });
});

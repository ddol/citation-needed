import fs from 'fs';
import os from 'os';
import path from 'path';

function setUpIsolatedConfigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-auth-test-'));
  process.env.CITATION_NEEDED_DIR = dir;
  // Force re-import so getDataDir() picks up the new env var
  jest.resetModules();
  return dir;
}

describe('auth/config', () => {
  let tempDir: string;
  let originalDir: string | undefined;

  beforeEach(() => {
    originalDir = process.env.CITATION_NEEDED_DIR;
    tempDir = setUpIsolatedConfigDir();
  });

  afterEach(() => {
    if (originalDir === undefined) {
      delete process.env.CITATION_NEEDED_DIR;
    } else {
      process.env.CITATION_NEEDED_DIR = originalDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('loadAuthConfig returns empty object when file missing', () => {
    const { loadAuthConfig } = require('../../../src/auth/config');
    expect(loadAuthConfig()).toEqual({});
  });

  test('setEmail persists to disk and saves on second load', () => {
    const { setEmail, loadAuthConfig } = require('../../../src/auth/config');
    setEmail('reader@example.com');
    expect(loadAuthConfig().email).toBe('reader@example.com');

    const fileContents = JSON.parse(fs.readFileSync(path.join(tempDir, 'auth.json'), 'utf-8')) as {
      email?: string;
    };
    expect(fileContents.email).toBe('reader@example.com');
  });

  test('setEmail rejects malformed addresses', () => {
    const { setEmail, loadAuthConfig } = require('../../../src/auth/config');
    expect(() => setEmail('not-an-email')).toThrow(/Invalid email format/);
    expect(() => setEmail('no@domain')).toThrow(/Invalid email format/);
    expect(() => setEmail('')).toThrow(/Invalid email format/);
    // Config should be untouched
    expect(loadAuthConfig()).toEqual({});
  });

  test('setEmail trims whitespace before validation', () => {
    const { setEmail, loadAuthConfig } = require('../../../src/auth/config');
    setEmail('  trimmed@example.com  ');
    expect(loadAuthConfig().email).toBe('trimmed@example.com');
  });

  test('addProxy and removeProxy round-trip through the file', () => {
    const { addProxy, removeProxy, loadAuthConfig } = require('../../../src/auth/config');
    addProxy({ name: 'campus', proxyUrl: 'http://proxy.example.com', username: 'u' });
    expect(loadAuthConfig().proxies).toHaveLength(1);

    addProxy({ name: 'campus', proxyUrl: 'http://proxy.example.com:8080', username: 'u' });
    // Same name -> replace, still one entry
    expect(loadAuthConfig().proxies).toHaveLength(1);
    expect(loadAuthConfig().proxies?.[0].proxyUrl).toBe('http://proxy.example.com:8080');

    addProxy({ name: 'second', proxyUrl: 'http://other.example.com' });
    expect(loadAuthConfig().proxies).toHaveLength(2);

    removeProxy('campus');
    expect(loadAuthConfig().proxies?.map((p: { name: string }) => p.name)).toEqual(['second']);
  });

  test('isValidEmail accepts common shapes, rejects junk', () => {
    const { isValidEmail } = require('../../../src/auth/config');
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.com')).toBe(true);
    expect(isValidEmail('no-at-symbol')).toBe(false);
    expect(isValidEmail('two@@signs.com')).toBe(false);
    expect(isValidEmail('missing.tld@example')).toBe(false);
  });
});

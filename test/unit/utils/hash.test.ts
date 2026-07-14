import path from 'path';
import os from 'os';
import fs from 'fs';
import { sha256File, sha256String } from '../../../src/utils/hash';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('hash helpers', () => {
  test('sha256String matches the known test vector', () => {
    expect(sha256String('abc')).toBe(ABC_SHA256);
  });

  test('sha256File streams a file to the same digest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-hash-'));
    const filePath = path.join(dir, 'vector.txt');
    fs.writeFileSync(filePath, 'abc');

    await expect(sha256File(filePath)).resolves.toBe(ABC_SHA256);

    // Larger-than-one-chunk content still hashes correctly.
    const big = 'x'.repeat(1024 * 1024);
    fs.writeFileSync(filePath, big);
    await expect(sha256File(filePath)).resolves.toBe(sha256String(big));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('sha256File rejects for missing files', async () => {
    await expect(sha256File('/nonexistent/nope.bin')).rejects.toThrow();
  });
});

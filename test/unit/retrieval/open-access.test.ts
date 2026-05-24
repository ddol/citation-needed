import fs from 'fs';
import os from 'os';
import path from 'path';

import { OpenAccessDownloader } from '../../../src/retrieval/downloaders/open-access';

jest.mock('axios');
const axios = require('axios');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-oa-'));
}

describe('OpenAccessDownloader', () => {
  let storage: string;

  beforeEach(() => {
    storage = tempDir();
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(storage, { recursive: true, force: true });
  });

  test('downloads to <stem>.pdf and returns the path', async () => {
    axios.get = jest.fn().mockResolvedValueOnce({ data: Buffer.from('%PDF-1.4\n%mock') });
    const downloader = new OpenAccessDownloader(storage);

    const result = await downloader.download('10.1234/test', 'https://example.com/p.pdf', 'paper1');

    expect(result).toBe(path.join(storage, 'paper1.pdf'));
    expect(fs.existsSync(result)).toBe(true);
    expect(fs.readFileSync(result, 'utf-8')).toContain('%PDF-1.4');
  });

  test('sends a User-Agent built from VERSION and the injected email', async () => {
    axios.get = jest.fn().mockResolvedValueOnce({ data: Buffer.from('x') });
    const downloader = new OpenAccessDownloader({ storageDir: storage, email: 'me@me.com' });

    await downloader.download('10.1234/ua', 'https://example.com/p.pdf', 'ua-test');

    const callArgs = axios.get.mock.calls[0];
    expect(callArgs[0]).toBe('https://example.com/p.pdf');
    expect(callArgs[1].headers['User-Agent']).toMatch(/^citation-needed\/.+\(mailto:me@me\.com\)/);
  });

  test('getLocalPath finds preferred stem first, falls back to sanitised DOI', () => {
    const downloader = new OpenAccessDownloader(storage);

    expect(downloader.getLocalPath('10.1234/foo', 'paper1')).toBeNull();

    const preferred = path.join(storage, 'paper1.pdf');
    fs.writeFileSync(preferred, '%PDF');
    expect(downloader.getLocalPath('10.1234/foo', 'paper1')).toBe(preferred);

    // If only the legacy DOI-named file is on disk, fall through to it
    fs.rmSync(preferred);
    const legacy = path.join(storage, '10.1234_foo.pdf');
    fs.writeFileSync(legacy, '%PDF');
    expect(downloader.getLocalPath('10.1234/foo', 'paper1')).toBe(legacy);
  });
});

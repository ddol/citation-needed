import fs from 'fs';
import os from 'os';
import path from 'path';

// Build a stateful Playwright mock that records the URLs and credentials we feed it.
type Recorded = {
  contextOptions: Array<Record<string, unknown> | undefined>;
  navigated: string[];
  filled: Array<{ field: 'user' | 'pass'; value: string }>;
  savedAs: string[];
};

const recorded: Recorded = { contextOptions: [], navigated: [], filled: [], savedAs: [] };

function makeFilledLocator(field: 'user' | 'pass', count: number) {
  return {
    count: jest.fn().mockResolvedValue(count),
    first: jest.fn().mockReturnValue({
      fill: jest.fn(async (value: string) => {
        recorded.filled.push({ field, value });
      }),
    }),
  };
}

function makeClickableLocator(count: number) {
  return {
    count: jest.fn().mockResolvedValue(count),
    first: jest.fn().mockReturnValue({
      count: jest.fn().mockResolvedValue(count),
      click: jest.fn(),
    }),
    click: jest.fn(),
  };
}

jest.mock(
  'playwright',
  () => ({
    chromium: {
      launch: jest.fn().mockResolvedValue({
        newContext: jest.fn(async (options?: Record<string, unknown>) => {
          recorded.contextOptions.push(options);
          return {
            newPage: jest.fn().mockResolvedValue({
              goto: jest.fn(async (url: string) => {
                recorded.navigated.push(url);
                return {
                  headers: () => ({ 'content-type': 'application/pdf' }),
                  body: async () => Buffer.from('%PDF mock body'),
                };
              }),
              locator: jest.fn((selector: string) => {
                if (selector.includes('password')) {
                  return makeFilledLocator('pass', 1);
                }
                if (selector.includes('user')) {
                  return makeFilledLocator('user', 1);
                }
                // pdfLink selector: locator(...).first() is awaited for count and click
                return makeClickableLocator(1);
              }),
              waitForLoadState: jest.fn(),
              waitForEvent: jest.fn().mockResolvedValue({
                saveAs: jest.fn(async (target: string) => {
                  recorded.savedAs.push(target);
                  fs.writeFileSync(target, '%PDF saved-as');
                }),
              }),
              keyboard: { press: jest.fn() },
            }),
          };
        }),
        close: jest.fn(),
      }),
    },
  }),
  { virtual: true }
);

// eslint-disable-next-line import/first, import/order
import { AuthenticatedDownloader } from '../../../src/retrieval/downloaders/authenticated';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-auth-dl-'));
}

describe('AuthenticatedDownloader', () => {
  let storage: string;

  beforeEach(() => {
    storage = tempDir();
    recorded.contextOptions.length = 0;
    recorded.navigated.length = 0;
    recorded.filled.length = 0;
    recorded.savedAs.length = 0;
  });

  afterEach(() => {
    fs.rmSync(storage, { recursive: true, force: true });
  });

  test('passes proxy and credentials through Playwright and writes the PDF', async () => {
    const downloader = new AuthenticatedDownloader(storage);
    const result = await downloader.download('10.1/test', 'https://example.com/paper', {
      proxyUrl: 'http://proxy.example.com:3128',
      username: 'student',
      password: 'hunter2',
      fileStem: 'paper-stem',
    });

    expect(result).toBe(path.join(storage, 'paper-stem.pdf'));
    expect(recorded.contextOptions[0]).toEqual({
      proxy: { server: 'http://proxy.example.com:3128' },
    });
    expect(recorded.navigated[0]).toBe('https://example.com/paper');
    expect(recorded.filled).toEqual(
      expect.arrayContaining([
        { field: 'user', value: 'student' },
        { field: 'pass', value: 'hunter2' },
      ])
    );
    expect(recorded.savedAs[0]).toBe(result);
    expect(fs.existsSync(result)).toBe(true);
  });
});

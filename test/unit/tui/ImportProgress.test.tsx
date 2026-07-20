import React from 'react';
import { render } from 'ink-testing-library';
import { lastVisibleFrame } from '../../helpers/ansi';
import { ImportProgress } from '../../../src/tui/components/ImportProgress';
import type { ImportRequest, ImportSummary } from '../../../src/services/import';

const mockImport = jest.fn();

// The view's only collaborator is the service, so that is what gets doubled.
// The pipeline underneath has its own suite.
jest.mock('../../../src/services/import', () => ({
  ImportService: jest.fn().mockImplementation(() => ({
    import: (...args: unknown[]) => mockImport(...args),
  })),
}));

jest.mock('../../../src/db/index', () => ({
  getDatabase: jest.fn(() => ({})),
}));

const result: ImportSummary = {
  source: 'refs.bib',
  metadataOnly: false,
  bibtexPath: 'refs.bib',
  paperPath: 'papers',
  markdownPath: 'markdown',
  importedCount: 1,
  downloadedCount: 1,
  markdownCount: 1,
  skippedCount: 1,
  failures: [{ doi: '10/fail', stage: 'download', message: 'network failed' }],
  skippedEntries: [{ label: 'No DOI', reason: 'missing DOI' }],
};

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('ImportProgress', () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  test('renders progress rows and the final import summary', async () => {
    process.env.LOG_LEVEL = 'debug';
    mockImport.mockImplementation(async (request: ImportRequest): Promise<ImportSummary> => {
      request.onProgress?.({
        doi: '10/alpha',
        label: 'Alpha paper',
        fileStem: 'alpha',
        stage: 'retrieving',
        settled: false,
      });
      request.onProgress?.({
        doi: '10/alpha',
        label: 'Alpha paper',
        fileStem: 'alpha',
        stage: 'markdown',
        message: 'Extracting text',
        settled: false,
      });
      request.onProgress?.({
        doi: '10/alpha',
        label: 'Alpha paper',
        fileStem: 'alpha',
        stage: 'completed',
        settled: true,
      });
      request.onProgress?.({
        label: 'No DOI',
        fileStem: 'no-doi',
        stage: 'skipped',
        settled: true,
      });
      request.onProgress?.({
        doi: '10/fail',
        label: 'Failed paper',
        fileStem: 'failed',
        stage: 'failed',
        settled: true,
      });
      return result;
    });

    const instance = render(
      <ImportProgress
        bibtexPath="refs.bib"
        options={{ paperPath: 'papers', markdownPath: 'markdown' }}
      />
    );
    await flush();
    await flush();

    const frame = lastVisibleFrame(instance);
    expect(mockImport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { bibtexPath: 'refs.bib' },
        paperPath: 'papers',
        markdownPath: 'markdown',
      })
    );
    expect(frame).toContain('Importing refs.bib');
    expect(frame).toContain('Alpha paper Done');
    expect(frame).toContain('No DOI Skipped');
    expect(frame).toContain('Failed paper Failed');
    expect(frame).toContain('Processed BibTeX file: refs.bib');
    expect(frame).toContain('Imported citations: 1');
    // The summary counts failures rather than reprinting them: every failure
    // already has its own ✗ line above, and repeating the list doubled the
    // output of a 69-failure import.
    expect(frame).toContain('Failed to retrieve: 1 (listed above)');
    expect(frame).not.toContain('10/fail [download] network failed');
    expect(process.env.LOG_LEVEL).toBe('debug');
    instance.unmount();
  });

  // Finished rows are handed to <Static>, which replays by index — a row that
  // is emitted twice, or mutated after finishing, would print twice.
  test('prints each finished row exactly once, even if progress repeats it', async () => {
    mockImport.mockImplementation(async (request: ImportRequest): Promise<ImportSummary> => {
      const row = {
        doi: '10/alpha',
        label: 'Alpha paper',
        fileStem: 'alpha',
        stage: 'completed' as const,
        settled: true,
      };
      request.onProgress?.(row);
      request.onProgress?.(row);
      return { ...result, failures: [] };
    });

    const instance = render(<ImportProgress bibtexPath="refs.bib" options={{}} />);
    await flush();
    await flush();

    const occurrences = lastVisibleFrame(instance).split('Alpha paper').length - 1;
    expect(occurrences).toBe(1);
    instance.unmount();
  });

  // The bug: Ink clears and rewrites the whole terminal whenever its *live*
  // tree is taller than the terminal, so a long import strobed. Finished rows
  // must leave the live tree. ink-testing-library renders with debug:true,
  // which merges static and live output into one frame, so this asserts the
  // reachable half — every row is accounted for exactly once — while the live
  // region's height is verified by running the real CLI.
  test('keeps every row of a long import, one line each', async () => {
    mockImport.mockImplementation(async (request: ImportRequest): Promise<ImportSummary> => {
      for (let i = 0; i < 60; i += 1) {
        request.onProgress?.({
          doi: `10/d${i}`,
          label: `Paper${i}`,
          fileStem: `f${i}`,
          stage: i % 2 === 0 ? 'completed' : 'failed',
          settled: true,
        });
      }
      request.onProgress?.({
        doi: '10/live',
        label: 'LivePaper',
        fileStem: 'live',
        stage: 'retrieving',
        settled: false,
      });
      return { ...result, failures: [] };
    });

    const instance = render(<ImportProgress bibtexPath="refs.bib" options={{}} />);
    await flush();
    await flush();

    const frame = lastVisibleFrame(instance);
    for (let i = 0; i < 60; i += 1) {
      expect(frame.split(`Paper${i} `).length - 1).toBe(1);
    }
    instance.unmount();
  });

  test('renders waiting state, failed imports, and restores an unset log level', async () => {
    delete process.env.LOG_LEVEL;
    mockImport.mockRejectedValue(new Error('cannot read BibTeX'));

    const instance = render(<ImportProgress bibtexPath="missing.bib" options={{}} />);
    expect(lastVisibleFrame(instance)).toContain('Waiting for citations...');
    await flush();
    await flush();

    expect(lastVisibleFrame(instance)).toContain('Import failed: cannot read BibTeX');
    expect(process.env.LOG_LEVEL).toBeUndefined();
    instance.unmount();
  });
});

import React from 'react';
import { render } from 'ink-testing-library';
import { ImportProgress } from '../../../src/tui/components/ImportProgress';
import type {
  ProcessBibtexOptions,
  ProcessBibtexResult,
} from '../../../src/workflows/process-bibtex';

const mockProcessBibtexFile = jest.fn();

jest.mock('../../../src/workflows/process-bibtex', () => ({
  processBibtexFile: (...args: unknown[]) => mockProcessBibtexFile(...args),
}));

const result: ProcessBibtexResult = {
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
    mockProcessBibtexFile.mockImplementation(
      async (bibtexPath: string, options: ProcessBibtexOptions): Promise<ProcessBibtexResult> => {
        options.onProgress?.({
          doi: '10/alpha',
          label: 'Alpha paper',
          fileStem: 'alpha',
          stage: 'retrieving',
        });
        options.onProgress?.({
          doi: '10/alpha',
          label: 'Alpha paper',
          fileStem: 'alpha',
          stage: 'markdown',
          message: 'Extracting text',
        });
        options.onProgress?.({
          doi: '10/alpha',
          label: 'Alpha paper',
          fileStem: 'alpha',
          stage: 'completed',
        });
        options.onProgress?.({
          label: 'No DOI',
          fileStem: 'no-doi',
          stage: 'skipped',
        });
        options.onProgress?.({
          doi: '10/fail',
          label: 'Failed paper',
          fileStem: 'failed',
          stage: 'failed',
        });
        return { ...result, bibtexPath };
      }
    );

    const instance = render(
      <ImportProgress
        bibtexPath="refs.bib"
        options={{ paperPath: 'papers', markdownPath: 'markdown' }}
      />
    );
    await flush();
    await flush();

    const frame = instance.lastFrame() ?? '';
    expect(mockProcessBibtexFile).toHaveBeenCalledWith(
      'refs.bib',
      expect.objectContaining({ paperPath: 'papers', markdownPath: 'markdown' })
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
    mockProcessBibtexFile.mockImplementation(
      async (bibtexPath: string, options: ProcessBibtexOptions): Promise<ProcessBibtexResult> => {
        const row = {
          doi: '10/alpha',
          label: 'Alpha paper',
          fileStem: 'alpha',
          stage: 'completed' as const,
        };
        options.onProgress?.(row);
        options.onProgress?.(row);
        return { ...result, bibtexPath, failures: [] };
      }
    );

    const instance = render(<ImportProgress bibtexPath="refs.bib" options={{}} />);
    await flush();
    await flush();

    const occurrences = (instance.lastFrame() ?? '').split('Alpha paper').length - 1;
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
    mockProcessBibtexFile.mockImplementation(
      async (bibtexPath: string, options: ProcessBibtexOptions): Promise<ProcessBibtexResult> => {
        for (let i = 0; i < 60; i += 1) {
          options.onProgress?.({
            doi: `10/d${i}`,
            label: `Paper${i}`,
            fileStem: `f${i}`,
            stage: i % 2 === 0 ? 'completed' : 'failed',
          });
        }
        options.onProgress?.({
          doi: '10/live',
          label: 'LivePaper',
          fileStem: 'live',
          stage: 'retrieving',
        });
        return { ...result, bibtexPath, failures: [] };
      }
    );

    const instance = render(<ImportProgress bibtexPath="refs.bib" options={{}} />);
    await flush();
    await flush();

    const frame = instance.lastFrame() ?? '';
    for (let i = 0; i < 60; i += 1) {
      expect(frame.split(`Paper${i} `).length - 1).toBe(1);
    }
    instance.unmount();
  });

  test('renders waiting state, failed imports, and restores an unset log level', async () => {
    delete process.env.LOG_LEVEL;
    mockProcessBibtexFile.mockRejectedValue(new Error('cannot read BibTeX'));

    const instance = render(<ImportProgress bibtexPath="missing.bib" options={{}} />);
    expect(instance.lastFrame()).toContain('Waiting for citations...');
    await flush();
    await flush();

    expect(instance.lastFrame()).toContain('Import failed: cannot read BibTeX');
    expect(process.env.LOG_LEVEL).toBeUndefined();
    instance.unmount();
  });
});

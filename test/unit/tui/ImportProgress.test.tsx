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
    expect(frame).toContain('Failures:');
    expect(frame).toContain('10/fail [download] network failed');
    expect(process.env.LOG_LEVEL).toBe('debug');
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

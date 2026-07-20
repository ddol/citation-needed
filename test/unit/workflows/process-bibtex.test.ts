import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRetrievePdf = jest.fn();
const mockRetrievalOrchestrator = jest.fn().mockImplementation(() => ({
  retrievePdf: mockRetrievePdf,
}));

jest.mock('../../../src/retrieval/index', () => ({
  RetrievalOrchestrator: mockRetrievalOrchestrator,
}));

// eslint-disable-next-line import/first, import/order
import * as bibtexParser from '../../../src/parsers/bibtex';
// eslint-disable-next-line import/first, import/order
import {
  processBibtexFile,
  type ProcessBibtexProgress,
} from '../../../src/workflows/process-bibtex';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-workflow-test-'));
}

describe('processBibtexFile', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('defaults outputs next to the BibTeX file and writes markdown', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

    try {
      const result = await processBibtexFile(bibtexPath, {
        db: { addCitation: jest.fn() } as never,
        retrievePdf: async () => ({
          success: true,
          localPath: path.join(bibtexDir, 'papers', 'pdf', 'paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.paperPath).toBe(path.join(bibtexDir, 'papers', 'pdf'));
      expect(result.markdownPath).toBe(path.join(bibtexDir, 'papers', 'markdown'));
      expect(result.importedCount).toBe(1);
      expect(result.downloadedCount).toBe(1);
      expect(result.markdownCount).toBe(1);
      expect(
        fs.readFileSync(path.join(bibtexDir, 'papers', 'markdown', 'paper.md'), 'utf-8')
      ).toContain('# Test Paper');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('uses the configured paper path', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const customPaperPath = path.join(tempRoot, 'custom-papers');
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

    try {
      const result = await processBibtexFile(bibtexPath, {
        paperPath: customPaperPath,
        db: { addCitation: jest.fn() } as never,
        retrievePdf: async () => ({
          success: true,
          localPath: path.join(customPaperPath, 'paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.paperPath).toBe(customPaperPath);
      expect(result.markdownPath).toBe(path.join(bibtexDir, 'papers', 'markdown'));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('passes the configured paper path to the retrieval orchestrator', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const customPaperPath = path.join(tempRoot, 'custom-papers');
    const db = { addCitation: jest.fn() } as never;
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );
    mockRetrievePdf.mockResolvedValue({
      success: true,
      localPath: path.join(customPaperPath, 'paper.pdf'),
      source: 'cache',
      message: 'ok',
    });

    try {
      await processBibtexFile(bibtexPath, {
        paperPath: customPaperPath,
        db,
        authConfig: { email: 'reader@example.com' },
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(mockRetrievalOrchestrator).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ email: 'reader@example.com' }),
        customPaperPath
      );
      expect(mockRetrievePdf).toHaveBeenCalledWith(
        '10.1234/test.paper',
        expect.objectContaining({ bibtexKey: 'paper', doi: '10.1234/test.paper' })
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('emits progress updates for skipped, successful, and failed entries', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    const progressEvents: Array<{ label: string; stage: string; message?: string }> = [];

    fs.mkdirSync(bibtexDir, { recursive: true });
    fs.writeFileSync(
      bibtexPath,
      [
        '@article{skip, title={Skipped Paper}, author={No DOI Author}}',
        '@article{success, title={Successful Paper}, doi={10.1234/success}, author={Success Author}}',
        '@article{failure, title={Failed Paper}, doi={10.1234/failure}, author={Failure Author}}',
      ].join('\n\n'),
      'utf-8'
    );

    try {
      await processBibtexFile(bibtexPath, {
        db: { addCitation: jest.fn() } as never,
        retrievePdf: async (doi, entry) => {
          if (entry.bibtexKey === 'failure') {
            return {
              success: false,
              source: 'open-access',
              message: 'No PDF available',
            };
          }

          return {
            success: true,
            localPath: path.join(bibtexDir, 'papers', 'pdf', `${entry.bibtexKey}.pdf`),
            source: 'cache',
            message: `ok:${doi}`,
          };
        },
        extractMarkdown: async () => '# Markdown\n',
        onProgress: (progress) => {
          progressEvents.push({
            label: progress.label,
            stage: progress.stage,
            message: progress.message,
          });
        },
      });

      expect(progressEvents).toEqual([
        { label: 'skip', stage: 'skipped', message: 'Skipped: no DOI' },
        { label: 'success', stage: 'retrieving', message: 'Downloading PDF' },
        { label: 'success', stage: 'markdown', message: 'Generating Markdown' },
        {
          label: 'success',
          stage: 'completed',
          message: 'PDF downloaded and Markdown created',
        },
        { label: 'failure', stage: 'retrieving', message: 'Downloading PDF' },
        { label: 'failure', stage: 'failed', message: 'No PDF available' },
      ]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('uses a normalized DOI for fallback markdown filenames', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const bibtexPath = path.join(bibtexDir, 'library.bib');

    fs.mkdirSync(bibtexDir, { recursive: true });
    fs.writeFileSync(bibtexPath, '@article{paper, title={Ignored}}', 'utf-8');

    jest.spyOn(bibtexParser, 'parseBibtex').mockReturnValueOnce([
      {
        doi: 'https://doi.org/10.1234/test.paper',
        title: 'Test Paper',
        authors: 'Test Author',
      },
    ]);

    try {
      const result = await processBibtexFile(bibtexPath, {
        db: { addCitation: jest.fn().mockReturnValue({ id: 1 }) } as never,
        retrievePdf: async () => ({
          success: true,
          localPath: path.join(bibtexDir, 'papers', 'pdf', 'paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(fs.existsSync(path.join(result.markdownPath, '10.1234_test.paper.md'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('skips retrieval logging when injected db stubs do not return a stored citation', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    const logRetrieval = jest.fn();

    fs.mkdirSync(bibtexDir, { recursive: true });
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

    try {
      await expect(
        processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn().mockReturnValue(undefined), logRetrieval } as never,
          retrievePdf: async () => ({
            success: true,
            localPath: path.join(bibtexDir, 'papers', 'pdf', 'paper.pdf'),
            source: 'cache',
            message: 'ok',
          }),
          extractMarkdown: async () => '# Test Paper\n',
        })
      ).resolves.toMatchObject({ importedCount: 1, downloadedCount: 1, markdownCount: 1 });

      expect(logRetrieval).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('does not count duplicate DOIs as newly imported', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    const existingCitation = { id: 7, doi: '10.1234/test.paper' };
    const addCitation = jest.fn();
    const addCitationWithResult = jest.fn().mockReturnValue({
      citation: existingCitation,
      inserted: false,
    });

    fs.mkdirSync(bibtexDir, { recursive: true });
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

    try {
      const result = await processBibtexFile(bibtexPath, {
        db: { addCitation, addCitationWithResult } as never,
        retrievePdf: async () => ({
          success: false,
          source: 'cache',
          message: 'already handled elsewhere',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.importedCount).toBe(0);
      expect(addCitationWithResult).toHaveBeenCalledWith(
        expect.objectContaining({ doi: '10.1234/test.paper' })
      );
      expect(addCitation).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('throttled second pass', () => {
    function writeTwoEntryBib(): { tempRoot: string; bibtexPath: string } {
      const tempRoot = makeTempRoot();
      const bibtexPath = path.join(tempRoot, 'library.bib');
      fs.writeFileSync(
        bibtexPath,
        `@article{alpha, title={Alpha}, doi={10.1234/alpha}}\n` +
          `@article{beta, title={Beta}, doi={10.1234/beta}}`,
        'utf-8'
      );
      return { tempRoot, bibtexPath };
    }

    // A throttled DOI was refused before it was looked up, so waiting changes
    // the answer — unlike "no source has this paper".
    test('retries throttled entries after the cooldown and counts the recovery', async () => {
      const { tempRoot, bibtexPath } = writeTwoEntryBib();
      const calls: string[] = [];

      try {
        const result = await processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn(() => ({ id: 1 })) } as never,
          retryCooldownMs: 0,
          retrievePdf: async (doi) => {
            calls.push(doi);
            const isFirstAttempt = calls.filter((d) => d === doi).length === 1;
            if (doi === '10.1234/alpha' && isFirstAttempt) {
              return {
                success: false,
                throttled: true,
                source: 'open-access',
                message: 'rate limited',
              };
            }
            return {
              success: true,
              localPath: path.join(tempRoot, 'papers', 'pdf', 'x.pdf'),
              source: 'unpaywall',
              message: 'ok',
            };
          },
          extractMarkdown: async () => '# Paper\n',
        });

        // alpha twice (throttled, then retried), beta once.
        expect(calls).toEqual(['10.1234/alpha', '10.1234/beta', '10.1234/alpha']);
        expect(result.downloadedCount).toBe(2);
        expect(result.failures).toEqual([]);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    test('records a failure when the retry is throttled again, without looping', async () => {
      const { tempRoot, bibtexPath } = writeTwoEntryBib();
      const calls: string[] = [];

      try {
        const result = await processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn(() => ({ id: 1 })) } as never,
          retryCooldownMs: 0,
          retrievePdf: async (doi) => {
            calls.push(doi);
            return {
              success: false,
              throttled: true,
              source: 'open-access',
              message: 'rate limited',
            };
          },
          extractMarkdown: async () => '# Paper\n',
        });

        // Exactly one extra attempt each — a second pass, not a retry loop.
        expect(calls).toHaveLength(4);
        expect(result.downloadedCount).toBe(0);
        expect(result.failures).toHaveLength(2);
        expect(result.failures[0].message).toContain('Still rate limited after cooldown');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    // A paper no source has is not worth a second lookup.
    test('does not retry an ordinary failure', async () => {
      const { tempRoot, bibtexPath } = writeTwoEntryBib();
      const calls: string[] = [];

      try {
        const result = await processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn(() => ({ id: 1 })) } as never,
          retryCooldownMs: 0,
          retrievePdf: async (doi) => {
            calls.push(doi);
            return { success: false, source: 'open-access', message: 'No PDF found' };
          },
          extractMarkdown: async () => '# Paper\n',
        });

        expect(calls).toHaveLength(2);
        expect(result.failures).toHaveLength(2);
        expect(result.failures[0].message).toBe('No PDF found');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    test('clears transient retriever state at the start and before retrying', async () => {
      const { tempRoot, bibtexPath } = writeTwoEntryBib();
      const resetTransientState = jest.fn();
      mockRetrievalOrchestrator.mockImplementation(() => ({
        retrievePdf: mockRetrievePdf,
        resetTransientState,
      }));
      mockRetrievePdf
        .mockResolvedValueOnce({
          success: false,
          throttled: true,
          source: 'oa',
          message: 'rate limited',
        })
        .mockResolvedValue({ success: false, source: 'oa', message: 'No PDF found' });

      try {
        await processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn(() => ({ id: 1 })) } as never,
          retryCooldownMs: 0,
          extractMarkdown: async () => '# Paper\n',
        });

        expect(resetTransientState).toHaveBeenCalledTimes(2);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    test('marks the retry pass on progress so the two attempts are distinguishable', async () => {
      const { tempRoot, bibtexPath } = writeTwoEntryBib();
      const passes: Array<string | undefined> = [];

      try {
        await processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn(() => ({ id: 1 })) } as never,
          retryCooldownMs: 0,
          retrievePdf: async (doi) =>
            doi === '10.1234/alpha'
              ? { success: false, throttled: true, source: 'oa', message: 'rate limited' }
              : { success: false, source: 'oa', message: 'No PDF found' },
          extractMarkdown: async () => '# Paper\n',
          onProgress: (p) => {
            if (p.doi === '10.1234/alpha' && p.stage === 'failed') passes.push(p.pass);
          },
        });

        expect(passes).toEqual([undefined, 'retry']);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    // Regression: consumers that count entries by looking for a terminal stage
    // over-count twice. The retry banner also uses stage 'skipped', and a
    // retried entry reaches a terminal stage on both passes. `settled` marks
    // the one event per entry that carries its final outcome.
    test('settles each entry exactly once, whatever the retry pass does', async () => {
      const { tempRoot, bibtexPath } = writeTwoEntryBib();
      const events: ProcessBibtexProgress[] = [];

      try {
        await processBibtexFile(bibtexPath, {
          db: { addCitation: jest.fn(() => ({ id: 1 })) } as never,
          retryCooldownMs: 0,
          retrievePdf: async (doi) =>
            doi === '10.1234/alpha'
              ? { success: false, throttled: true, source: 'oa', message: 'rate limited' }
              : { success: false, source: 'oa', message: 'No PDF found' },
          extractMarkdown: async () => '# Paper\n',
          onProgress: (progress) => events.push(progress),
        });

        const settled = events.filter((event) => event.settled);
        expect(settled).toHaveLength(2); // two entries in the .bib, two settlements
        expect(settled.map((event) => event.doi).sort()).toEqual(['10.1234/alpha', '10.1234/beta']);

        // The throttled entry settles on the retry pass, not on the attempt
        // that queued it, so the queued failure is never counted as an outcome.
        const alpha = events.filter((event) => event.doi === '10.1234/alpha');
        expect(alpha.map((event) => ({ stage: event.stage, settled: event.settled }))).toEqual([
          { stage: 'retrieving', settled: false },
          { stage: 'failed', settled: false },
          { stage: 'retrieving', settled: false },
          { stage: 'failed', settled: true },
        ]);

        // The retry banner is a notice about the run, not an entry.
        const banner = events.filter((event) => event.fileStem === '__retry');
        expect(banner).not.toHaveLength(0);
        expect(banner.every((event) => event.settled === false)).toBe(true);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  });
});

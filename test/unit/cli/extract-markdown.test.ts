import { Command } from 'commander';
import { stripAnsi } from '../../helpers/ansi';
import { registerExtractMarkdownCommand } from '../../../src/cli/commands/extract-markdown';

const mockReextractMarkdownFromLocalPdfs = jest.fn();
const mockReextractMarkdownFromPdfFolder = jest.fn();

jest.mock('../../../src/services/markdown-extraction', () => ({
  reextractMarkdownFromLocalPdfs: (...args: unknown[]) =>
    mockReextractMarkdownFromLocalPdfs(...args),
  reextractMarkdownFromPdfFolder: (...args: unknown[]) =>
    mockReextractMarkdownFromPdfFolder(...args),
}));

describe('extract-markdown command', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;
  let stderrWrite: jest.SpyInstance;

  const output = (): string =>
    stripAnsi(
      [...stdout.mock.calls, ...stderr.mock.calls].map((args) => args.join(' ')).join('\n')
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    stderrWrite.mockRestore();
    process.exitCode = 0;
  });

  test('passes filters to the local re-extraction service and prints a summary', async () => {
    mockReextractMarkdownFromLocalPdfs.mockResolvedValue({
      scanned: 2,
      extracted: 2,
      missingPdf: 0,
      failed: 0,
      errors: [],
    });
    const program = new Command();
    registerExtractMarkdownCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'extract-markdown',
      '--doi',
      '10.1/example',
      '--limit',
      '2',
      '--markdown-path',
      'papers/markdown',
    ]);

    expect(mockReextractMarkdownFromLocalPdfs).toHaveBeenCalledWith(
      expect.objectContaining({
        doi: '10.1/example',
        limit: 2,
        markdownPath: 'papers/markdown',
        onProgress: expect.any(Function),
      })
    );
    expect(output()).toContain('Re-extracted Markdown for 2 citation(s)');
    expect(output()).toContain('Network: disabled');
    expect(process.exitCode).toBe(0);
  });

  test('renders progress as a single refreshing stderr line', async () => {
    mockReextractMarkdownFromLocalPdfs.mockImplementation(async (options) => {
      options.onProgress({ current: 0, total: 2, status: 'starting' });
      options.onProgress({
        current: 1,
        total: 2,
        doi: '10.1/first',
        status: 'extracted',
      });
      options.onProgress({
        current: 2,
        total: 2,
        doi: '10.1/second',
        status: 'missing-pdf',
      });
      return {
        scanned: 2,
        extracted: 1,
        missingPdf: 1,
        failed: 0,
        errors: [],
      };
    });
    const program = new Command();
    registerExtractMarkdownCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'extract-markdown']);

    const writes = stderrWrite.mock.calls.map((args) => String(args[0])).join('');
    expect(writes).toContain('\rMarkdown extraction 0/2 starting');
    expect(writes).toContain('\rMarkdown extraction 1/2 10.1/first (extracted)');
    expect(writes).toContain('\rMarkdown extraction 2/2 10.1/second (missing-pdf)');
    expect(writes.endsWith('\n')).toBe(true);
  });

  test('extracts directly from a PDF folder when --paper-path is provided', async () => {
    mockReextractMarkdownFromPdfFolder.mockResolvedValue({
      scanned: 2,
      extracted: 2,
      missingPdf: 0,
      failed: 0,
      errors: [],
    });
    const program = new Command();
    registerExtractMarkdownCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'extract-markdown',
      '--paper-path',
      '/tmp/pdf',
      '--markdown-path',
      '/tmp/markdown',
      '--recursive',
    ]);

    expect(mockReextractMarkdownFromPdfFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        paperPath: '/tmp/pdf',
        markdownPath: '/tmp/markdown',
        recursive: true,
        onProgress: expect.any(Function),
      })
    );
    expect(mockReextractMarkdownFromLocalPdfs).not.toHaveBeenCalled();
    expect(output()).toContain('Re-extracted Markdown for 2 citation(s)');
  });

  test('requires --markdown-path when extracting directly from a PDF folder', async () => {
    const program = new Command();
    registerExtractMarkdownCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'extract-markdown',
      '--paper-path',
      '/tmp/pdf',
    ]);

    expect(mockReextractMarkdownFromPdfFolder).not.toHaveBeenCalled();
    expect(output()).toContain('--markdown-path is required when --paper-path is used');
    expect(process.exitCode).toBe(1);
  });

  test('prints JSON and exits non-zero when local PDFs are missing', async () => {
    mockReextractMarkdownFromLocalPdfs.mockResolvedValue({
      scanned: 1,
      extracted: 0,
      missingPdf: 1,
      failed: 0,
      errors: [],
    });
    const program = new Command();
    registerExtractMarkdownCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'extract-markdown', '--json']);

    expect(mockReextractMarkdownFromLocalPdfs).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: undefined })
    );
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.mock.calls[0][0])).toMatchObject({
      scanned: 1,
      extracted: 0,
      missingPdf: 1,
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects invalid limits before calling the service', async () => {
    const program = new Command();
    registerExtractMarkdownCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'extract-markdown', '--limit', '0']);

    expect(mockReextractMarkdownFromLocalPdfs).not.toHaveBeenCalled();
    expect(output()).toContain('--limit must be a positive integer');
    expect(process.exitCode).toBe(1);
  });
});

import { Command } from 'commander';
import { registerCheckLocalPapersCommand } from '../../../src/cli/commands/check-local-papers';

const mockCheckLocalPapers = jest.fn();

jest.mock('../../../src/services/local-paper-check', () => ({
  checkLocalPapers: (...args: unknown[]) => mockCheckLocalPapers(...args),
}));

describe('check-local-papers command', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  const output = (): string =>
    [...stdout.mock.calls, ...stderr.mock.calls].map((args) => args.join(' ')).join('\n');

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  test('prints a plain local-only report and fails when any entry is not matched', async () => {
    mockCheckLocalPapers.mockResolvedValue({
      bibtexPath: '/tmp/refs.bib',
      paperPath: '/tmp/papers',
      summary: { total: 2, matched: 1, missing: 1, mismatch: 0, ambiguous: 0, skipped: 0 },
      entries: [
        {
          label: 'alpha',
          doi: '10.1234/alpha',
          status: 'matched',
          expectedFilenames: ['alpha.pdf'],
          pdfPath: '/tmp/papers/alpha.pdf',
          candidates: [],
          message: 'Matched by doi.',
        },
        {
          label: 'beta',
          doi: '10.1234/beta',
          status: 'missing',
          expectedFilenames: ['beta.pdf'],
          candidates: [],
          message: 'No matching local PDF found.',
        },
      ],
    });

    const program = new Command();
    registerCheckLocalPapersCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'check-local-papers',
      '/tmp/refs.bib',
      '--paper-path',
      '/tmp/papers',
    ]);

    expect(mockCheckLocalPapers).toHaveBeenCalledWith('/tmp/refs.bib', {
      paperPath: '/tmp/papers',
      recursive: undefined,
    });
    expect(output()).toContain('Network: disabled');
    expect(output()).toContain('MATCHED 10.1234/alpha -> /tmp/papers/alpha.pdf');
    expect(output()).toContain('MISSING 10.1234/beta');
    expect(process.exitCode).toBe(1);
  });

  test('prints JSON when requested', async () => {
    mockCheckLocalPapers.mockResolvedValue({
      bibtexPath: '/tmp/refs.bib',
      paperPath: '/tmp/papers',
      summary: { total: 1, matched: 1, missing: 0, mismatch: 0, ambiguous: 0, skipped: 0 },
      entries: [],
    });

    const program = new Command();
    registerCheckLocalPapersCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'check-local-papers',
      '/tmp/refs.bib',
      '--recursive',
      '--json',
    ]);

    expect(mockCheckLocalPapers).toHaveBeenCalledWith('/tmp/refs.bib', {
      paperPath: undefined,
      recursive: true,
    });
    expect(JSON.parse(stdout.mock.calls[0][0])).toMatchObject({
      summary: { matched: 1 },
    });
    expect(process.exitCode).toBe(0);
  });
});

import { Command } from 'commander';
import { stripAnsi } from '../../helpers/ansi';
import { registerCheckLocalPapersCommand } from '../../../src/cli/commands/check-local-papers';

const mockCheckLocalPapers = jest.fn();

jest.mock('../../../src/services/local-paper-check', () => ({
  checkLocalPapers: (...args: unknown[]) => mockCheckLocalPapers(...args),
}));

describe('check-local-papers command', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  /** Everything written, as a reader would see it — escapes stripped. */
  const output = (): string =>
    stripAnsi(
      [...stdout.mock.calls, ...stderr.mock.calls].map((args) => args.join(' ')).join('\n')
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = 0;
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

  test('formats every non-matched status and catches service errors', async () => {
    mockCheckLocalPapers.mockResolvedValueOnce({
      bibtexPath: '/tmp/refs.bib',
      paperPath: '/tmp/papers',
      summary: { total: 3, matched: 0, missing: 0, mismatch: 1, ambiguous: 1, skipped: 1 },
      entries: [
        {
          label: 'gamma',
          doi: '10/gamma',
          status: 'mismatch',
          expectedFilenames: ['gamma.pdf'],
          candidates: [],
          message: 'Wrong PDF.',
        },
        {
          label: 'dupe',
          doi: '10/dupe',
          status: 'ambiguous',
          expectedFilenames: ['dupe.pdf'],
          candidates: [],
          message: 'Multiple PDFs.',
        },
        {
          label: 'nodoi',
          status: 'skipped',
          expectedFilenames: [],
          candidates: [],
          message: 'No DOI.',
        },
      ],
    });

    const program = new Command();
    registerCheckLocalPapersCommand(program);
    await program.parseAsync(['node', 'citation-needed', 'check-local-papers', '/tmp/refs.bib']);

    expect(output()).toContain('MISMATCH 10/gamma');
    expect(output()).toContain('AMBIGUOUS 10/dupe');
    expect(output()).toContain('SKIPPED nodoi');
    expect(process.exitCode).toBe(1);

    mockCheckLocalPapers.mockRejectedValueOnce(new Error('cannot read refs.bib'));
    const failingProgram = new Command();
    registerCheckLocalPapersCommand(failingProgram);
    await failingProgram.parseAsync([
      'node',
      'citation-needed',
      'check-local-papers',
      '/tmp/missing.bib',
    ]);

    expect(stderr.mock.calls.join('\n')).toContain('cannot read refs.bib');
    expect(process.exitCode).toBe(1);
  });
});

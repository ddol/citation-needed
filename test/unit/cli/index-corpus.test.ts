import { Command } from 'commander';
import { registerIndexCommand } from '../../../src/cli/commands/index-corpus';
import { IndexService } from '../../../src/services/indexer';

const mockGetDatabase = jest.fn();
const mockIndexCorpus = jest.fn();

jest.mock('../../../src/db/index', () => ({
  getDatabase: () => mockGetDatabase(),
}));

jest.mock('../../../src/services/indexer', () => ({
  IndexService: jest.fn().mockImplementation(() => ({
    indexCorpus: mockIndexCorpus,
  })),
}));

describe('index command', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    mockGetDatabase.mockReturnValue({ db: true });
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = 0;
  });

  test('prints a successful indexing summary', async () => {
    mockIndexCorpus.mockResolvedValue({
      indexed: 2,
      unchanged: 3,
      missingMarkdown: 1,
      scanned: 6,
      errors: [],
    });
    const program = new Command();
    registerIndexCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'index']);

    expect(IndexService).toHaveBeenCalledWith({ db: true });
    expect(stdout.mock.calls.join('\n')).toContain('Indexed 2 citation(s); 3 unchanged');
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  test('prints failures to stderr and sets exitCode', async () => {
    mockIndexCorpus.mockResolvedValue({
      indexed: 1,
      unchanged: 0,
      missingMarkdown: 0,
      scanned: 2,
      errors: [{ doi: '10/fail', message: 'missing file' }],
    });
    const program = new Command();
    registerIndexCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'index']);

    expect(stderr.mock.calls.join('\n')).toContain('Failures: 10/fail: missing file');
    expect(process.exitCode).toBe(1);
  });
});

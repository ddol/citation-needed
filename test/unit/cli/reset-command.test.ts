import { Command } from 'commander';
import { registerResetCommand } from '../../../src/cli/commands/reset';

const mockDb = {
  getRowCounts: jest.fn(),
  getStoredFilePaths: jest.fn(),
  deleteAllCitations: jest.fn(),
  vacuum: jest.fn(),
};
const mockGetDatabase = jest.fn();

jest.mock('../../../src/db/index', () => ({
  getDatabase: (...args: unknown[]) => mockGetDatabase(...args),
}));

describe('reset command registration', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    mockGetDatabase.mockReturnValue(mockDb);
    mockDb.getRowCounts.mockReturnValue({
      citations: 1,
      retrievalLog: 2,
      manifestations: 3,
      chunks: 4,
    });
    mockDb.getStoredFilePaths.mockReturnValue([]);
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = 0;
  });

  test('prints reset summaries and uses an explicit database path', async () => {
    const program = new Command();
    registerResetCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'reset', '--db', '/tmp/custom.db']);

    expect(mockGetDatabase).toHaveBeenCalledWith('/tmp/custom.db');
    expect(stdout.mock.calls.join('\n')).toContain('/tmp/custom.db');
    expect(mockDb.deleteAllCitations).not.toHaveBeenCalled();
  });

  test('sets exitCode when reset throws', async () => {
    mockDb.getRowCounts.mockImplementation(() => {
      throw new Error('database locked');
    });
    const program = new Command();
    registerResetCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'reset', '--yes']);

    expect(stderr.mock.calls.join('\n')).toContain('database locked');
    expect(process.exitCode).toBe(1);
  });
});

import { Command } from 'commander';

import { stripAnsi } from '../../helpers/ansi';
import { registerImportCommand } from '../../../src/cli/commands/import';
import { registerListCommand } from '../../../src/cli/commands/list';
import { registerDownloadCommand } from '../../../src/cli/commands/download';
import { registerAuthCommand } from '../../../src/cli/commands/auth';
import { registerServerCommand } from '../../../src/cli/commands/server';

const mockRender = jest.fn();

const mockGetCitation = jest.fn();
const mockGetAllCitations = jest.fn();
const mockUpdatePdfPath = jest.fn();
const mockUpdateVerificationStatus = jest.fn();

const mockDownload = jest.fn();
const mockGetOpenAccessPdf = jest.fn();

const mockSetEmail = jest.fn();
const mockAddProxy = jest.fn();
const mockLoadAuthConfig = jest.fn();

const mockStartMcpServer = jest.fn();

// Only `import-bibtex` still renders through Ink (it needs live redraw); every
// other command writes plain lines, so those are asserted against real stdout.
jest.mock('ink', () => ({
  render: (...args: unknown[]) => mockRender(...args),
  Text: 'Text',
}));

jest.mock('../../../src/db/index', () => ({
  getDatabase: jest.fn(() => ({
    getCitation: mockGetCitation,
    getAllCitations: mockGetAllCitations,
    updatePdfPath: mockUpdatePdfPath,
    updateVerificationStatus: mockUpdateVerificationStatus,
  })),
}));

jest.mock('../../../src/retrieval/downloaders/open-access', () => ({
  OpenAccessDownloader: jest.fn().mockImplementation(() => ({
    download: mockDownload,
  })),
}));

jest.mock('../../../src/retrieval/resolvers/unpaywall', () => ({
  UnpaywallResolver: jest.fn().mockImplementation(() => ({
    getOpenAccessPdf: mockGetOpenAccessPdf,
  })),
}));

jest.mock('../../../src/auth/config', () => ({
  setEmail: (...args: unknown[]) => mockSetEmail(...args),
  addProxy: (...args: unknown[]) => mockAddProxy(...args),
  loadAuthConfig: (...args: unknown[]) => mockLoadAuthConfig(...args),
}));

jest.mock('../../../src/mcp/server', () => ({
  startMcpServer: (...args: unknown[]) => mockStartMcpServer(...args),
}));

describe('CLI command registrations', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  /** Everything the command wrote, as a reader would see it — escapes stripped. */
  const output = (): string =>
    stripAnsi(
      [...stdout.mock.calls, ...stderr.mock.calls].map((args) => args.join(' ')).join('\n')
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRender.mockReturnValue({ waitUntilExit: jest.fn().mockResolvedValue(undefined) });
    mockGetCitation.mockReturnValue(undefined);
    mockLoadAuthConfig.mockReturnValue({ email: 'reader@example.com', proxies: [] });
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = 0;
  });

  test('import-bibtex renders ImportProgress and waits until exit', async () => {
    const program = new Command();
    registerImportCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'import-bibtex',
      'sample.bib',
      '--paper-path',
      'papers/pdf',
      '--markdown-path',
      'papers/markdown',
      '--email',
      'reader@example.com',
    ]);

    expect(mockRender).toHaveBeenCalledTimes(1);
    const [renderedElement] = mockRender.mock.calls[0];
    expect((renderedElement as { props: { bibtexPath: string } }).props.bibtexPath).toBe(
      'sample.bib'
    );
    expect(
      (renderedElement as { props: { options: { paperPath: string; markdownPath: string } } }).props
        .options
    ).toEqual(
      expect.objectContaining({
        paperPath: 'papers/pdf',
        markdownPath: 'papers/markdown',
        email: 'reader@example.com',
      })
    );
  });

  test('list prints a table of DB records without going through Ink', async () => {
    mockGetAllCitations.mockReturnValue([
      {
        doi: '10.1/alpha',
        title: 'Alpha',
        year: 2024,
        verificationStatus: 'verified',
      },
    ]);
    const program = new Command();
    registerListCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'list']);

    expect(output()).toContain('10.1/alpha');
    expect(output()).toContain('Alpha');
    expect(output()).toContain('verified');
    expect(mockRender).not.toHaveBeenCalled();
  });

  test('list prints the empty-state hint when the DB has no citations', async () => {
    mockGetAllCitations.mockReturnValue([]);
    const program = new Command();
    registerListCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'list']);

    expect(output()).toContain('No citations found');
  });

  test('download with --url stores pdf path and marks citation as downloaded', async () => {
    mockGetCitation.mockReturnValue({ doi: '10.1/alpha', bibtexKey: 'alpha2024' });
    mockDownload.mockResolvedValue('/tmp/alpha2024.pdf');

    const program = new Command();
    registerDownloadCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'download',
      '10.1/alpha',
      '--url',
      'https://example.com/alpha.pdf',
    ]);

    expect(mockDownload).toHaveBeenCalledWith(
      '10.1/alpha',
      'https://example.com/alpha.pdf',
      'alpha2024'
    );
    expect(mockUpdatePdfPath).toHaveBeenCalledWith('10.1/alpha', '/tmp/alpha2024.pdf');
    expect(mockUpdateVerificationStatus).toHaveBeenCalledWith('10.1/alpha', 'downloaded');
  });

  test('download with --email resolves URL through Unpaywall before download', async () => {
    mockGetCitation.mockReturnValue({ doi: '10.1/beta', bibtexKey: 'beta2024' });
    mockGetOpenAccessPdf.mockResolvedValue({ ok: true, value: 'https://oa.example/beta.pdf' });
    mockDownload.mockResolvedValue('/tmp/beta2024.pdf');

    const program = new Command();
    registerDownloadCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'download',
      '10.1/beta',
      '--email',
      'reader@example.com',
    ]);

    expect(mockGetOpenAccessPdf).toHaveBeenCalledWith('10.1/beta');
    expect(mockDownload).toHaveBeenCalledWith(
      '10.1/beta',
      'https://oa.example/beta.pdf',
      'beta2024'
    );
  });

  test('download reports Unpaywall lookup failures and untracked citations', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: false, error: 'rate limited' });
    const failedProgram = new Command();
    registerDownloadCommand(failedProgram);

    await failedProgram.parseAsync([
      'node',
      'citation-needed',
      'download',
      '10.1/rate-limited',
      '--email',
      'reader@example.com',
    ]);

    expect(stderr.mock.calls.join('\n')).toContain('Unpaywall lookup failed: rate limited');
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    mockGetCitation.mockReturnValueOnce(undefined);
    mockDownload.mockResolvedValueOnce('/tmp/untracked.pdf');
    const untrackedProgram = new Command();
    registerDownloadCommand(untrackedProgram);

    await untrackedProgram.parseAsync([
      'node',
      'citation-needed',
      'download',
      '10.1/untracked',
      '--url',
      'https://example.com/untracked.pdf',
    ]);

    expect(stdout.mock.calls.join('\n')).toContain('not found in database');
    expect(stdout.mock.calls.join('\n')).toContain('Saved to: /tmp/untracked.pdf');
    expect(mockUpdatePdfPath).not.toHaveBeenCalledWith('10.1/untracked', '/tmp/untracked.pdf');
  });

  test('download without URL source prints a guidance error to stderr', async () => {
    const program = new Command();
    registerDownloadCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'download', '10.1/missing']);

    expect(stderr.mock.calls.join('\n')).toContain(
      'No PDF URL. Use --url or --email for Unpaywall lookup.'
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('auth set-email delegates to config API', async () => {
    const program = new Command();
    registerAuthCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'auth',
      'set-email',
      'reader@example.com',
    ]);

    expect(mockSetEmail).toHaveBeenCalledWith('reader@example.com');
  });

  test('auth set-email surfaces validation failures and sets process.exitCode', async () => {
    mockSetEmail.mockImplementation(() => {
      throw new Error('Invalid email format');
    });
    const program = new Command();
    registerAuthCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'auth', 'set-email', 'not-an-email']);

    expect(stderr.mock.calls.join('\n')).toContain('Invalid email format');
    expect(process.exitCode).toBe(1);
  });

  test('auth add-proxy maps option names to config shape', async () => {
    const program = new Command();
    registerAuthCommand(program);

    await program.parseAsync([
      'node',
      'citation-needed',
      'auth',
      'add-proxy',
      'campus',
      'http://proxy.example.com:3128',
      '--login-url',
      'https://login.example.com',
      '--username',
      'student',
      '--password-env',
      'PROXY_PASSWORD',
    ]);

    expect(mockAddProxy).toHaveBeenCalledWith({
      name: 'campus',
      proxyUrl: 'http://proxy.example.com:3128',
      loginUrl: 'https://login.example.com',
      username: 'student',
      passwordEnvVar: 'PROXY_PASSWORD',
    });
  });

  test('auth show renders sanitized auth config', async () => {
    mockLoadAuthConfig.mockReturnValue({
      email: 'reader@example.com',
      proxies: [{ name: 'campus', proxyUrl: 'http://proxy', passwordEnvVar: 'SECRET' }],
    });
    const program = new Command();
    registerAuthCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'auth', 'show']);

    expect(output()).toContain('reader@example.com');
    expect(output()).toContain('"passwordEnvVar": "***"');
  });

  test('server command starts MCP server', async () => {
    mockStartMcpServer.mockResolvedValue(undefined);
    const program = new Command();
    registerServerCommand(program);

    await program.parseAsync(['node', 'citation-needed', 'server']);

    expect(mockStartMcpServer).toHaveBeenCalledTimes(1);
  });
});

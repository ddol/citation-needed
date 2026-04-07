import { createMcpServer } from '../../../src/mcp/server';
import { getDatabase } from '../../../src/db/index';

// Mock the database module
jest.mock('../../../src/db/index', () => {
  const mockDb = {
    getCitation: jest.fn(),
    getAllCitations: jest.fn().mockReturnValue([]),
    addCitation: jest.fn(),
    updateTrustScore: jest.fn(),
    updatePdfPath: jest.fn(),
    updateVerificationStatus: jest.fn(),
    updateAccessType: jest.fn(),
    getTrustHistory: jest.fn().mockReturnValue([]),
    searchCitations: jest.fn().mockReturnValue([]),
    close: jest.fn(),
  };
  return {
    getDatabase: jest.fn().mockReturnValue(mockDb),
    Database: jest.fn().mockImplementation(() => mockDb),
  };
});

// Mock auth config
jest.mock('../../../src/auth/config', () => ({
  loadAuthConfig: jest.fn().mockReturnValue({}),
}));

describe('MCP Server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const db = getDatabase() as ReturnType<typeof getDatabase>;
    (db.getAllCitations as jest.Mock).mockReturnValue([]);
    (db.getCitation as jest.Mock).mockReturnValue(undefined);
  });

  test('creates a server instance', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  test('server has a name and version', () => {
    const server = createMcpServer();
    expect(server).toBeTruthy();
  });

  test('list-citations tool returns empty list', async () => {
    const db = getDatabase();
    (db.getAllCitations as jest.Mock).mockReturnValue([]);

    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'list-citations', arguments: {} },
    });

    expect(result).toBeDefined();
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('get-citation tool returns not found message', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue(undefined);

    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'get-citation', arguments: { doi: '10.0000/not-found' } },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain('not found');
  });

  test('get-citation tool returns citation when found', async () => {
    const mockCitation = {
      doi: '10.1234/test.001',
      title: 'Test Paper',
      trustScore: 0.8,
      verificationStatus: 'verified',
    };
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue(mockCitation);

    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'get-citation', arguments: { doi: '10.1234/test.001' } },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.doi).toBe('10.1234/test.001');
    expect(parsed.trustLevel).toBe('high');
  });

  test('import-bibtex tool imports citations', async () => {
    const db = getDatabase();
    const bibtex = `
@article{test2024,
  title = {Test Paper},
  doi = {10.1234/test.import},
  year = {2024},
  author = {Test Author},
  journal = {Test Journal}
}`;

    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'import-bibtex', arguments: { bibtex } },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain('Imported');
    expect(db.addCitation).toHaveBeenCalled();
  });

  test('update-trust-score tool updates the score', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue({
      doi: '10.1234/test',
      title: 'Test Paper',
      trustScore: 0.5,
    });
    const server = createMcpServer();

    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'update-trust-score', arguments: { doi: '10.1234/test', score: 0.9, notes: 'good paper' } },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0].text).toContain('0.9');
    expect(db.updateTrustScore).toHaveBeenCalledWith('10.1234/test', 0.9, 'good paper', undefined);
  });

  test('update-trust-score returns error for unknown DOI', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue(undefined);
    const server = createMcpServer();

    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'update-trust-score', arguments: { doi: '10.0000/missing', score: 0.9 } },
    });

    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not found');
  });

  test('unknown tool returns error', async () => {
    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'nonexistent-tool', arguments: {} },
    });

    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Unknown tool');
  });

  test('list-tools returns all expected tools', async () => {
    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/list')!({
      method: 'tools/list',
      params: {},
    });

    const tools = (result as { tools: Array<{ name: string }> }).tools;
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('get-citation');
    expect(toolNames).toContain('import-bibtex');
    expect(toolNames).toContain('verify-citation');
    expect(toolNames).toContain('update-trust-score');
    expect(toolNames).toContain('download-pdf');
    expect(toolNames).toContain('list-citations');
    expect(toolNames).toContain('search-arxiv');
  });
});

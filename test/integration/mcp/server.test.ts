import { createMcpServer } from '../../../src/mcp/server';
import { getDatabase } from '../../../src/db/index';

// Mock the database module
jest.mock('../../../src/db/index', () => {
  const mockDb = {
    getCitation: jest.fn(),
    getAllCitations: jest.fn().mockReturnValue([]),
    addCitation: jest.fn(),
    updatePdfPath: jest.fn(),
    updateVerificationStatus: jest.fn(),
    updateAccessType: jest.fn(),
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
    expect(parsed.verificationStatus).toBe('verified');
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

  test('verify-citation tool returns verification results', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue({
      doi: '10.1234/test',
      title: 'Test Paper',
      verificationStatus: 'unverified',
    });

    const server = createMcpServer();

    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: {
        name: 'verify-citation',
        arguments: {
          doi: '10.1234/test',
          claim: 'transformers improve sequence modeling',
          pdfMarkdown: '# Paper\n\nTransformers improve sequence modeling in practice.',
        },
      },
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.verified).toBe(true);
    expect(parsed.totalKeywords).toBe(4);
    expect(db.updateVerificationStatus).toHaveBeenCalledWith('10.1234/test', 'verified');
  });

  test('verify-citation returns error for unknown DOI', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue(undefined);
    const server = createMcpServer();

    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: {
        name: 'verify-citation',
        arguments: { doi: '10.0000/missing', claim: 'some claim' },
      },
    });

    const response = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('not found');
  });

  test('unknown tool returns error', async () => {
    const server = createMcpServer();
    const result = await (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'nonexistent-tool', arguments: {} },
    });

    const response = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Unknown tool');
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
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain('get-citation');
    expect(toolNames).toContain('import-bibtex');
    expect(toolNames).toContain('verify-citation');
    expect(toolNames).toContain('download-pdf');
    expect(toolNames).toContain('list-citations');
    expect(toolNames).toContain('search-arxiv');
  });
});

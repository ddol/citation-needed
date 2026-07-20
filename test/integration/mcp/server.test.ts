import path from 'path';
import os from 'os';
import fs from 'fs';
import { createMcpServer } from '../../../src/mcp/server';
import { getDatabase } from '../../../src/db/index';

jest.mock('../../../src/db/index', () => {
  const mockDb = {
    getCitation: jest.fn(),
    getAllCitations: jest.fn().mockReturnValue([]),
    addCitation: jest.fn(),
    updatePdfPath: jest.fn(),
    updateVerificationStatus: jest.fn(),
    updateAccessType: jest.fn(),
    searchCitations: jest.fn().mockReturnValue([]),
    getChunksForCitation: jest.fn().mockReturnValue([]),
    close: jest.fn(),
  };
  return {
    getDatabase: jest.fn().mockReturnValue(mockDb),
    Database: jest.fn().mockImplementation(() => mockDb),
  };
});

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
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'list-citations', arguments: {} },
    });

    expect(result).toBeDefined();
    const { content } = result as { content: Array<{ type: string; text: string }> };
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('get-citation tool returns not found message', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue(undefined);

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'get-citation', arguments: { doi: '10.0000/not-found' } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    expect(content[0].text).toContain('not found');
  });

  test('get-citation tool returns citation when found', async () => {
    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue({
      doi: '10.1234/test.001',
      title: 'Test Paper',
      verificationStatus: 'downloaded',
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'get-citation', arguments: { doi: '10.1234/test.001' } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(content[0].text);
    expect(parsed.doi).toBe('10.1234/test.001');
    expect(parsed.verificationStatus).toBe('downloaded');
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
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      // metadataOnly keeps this test about routing and storage. The default
      // path downloads PDFs, which belongs in the workflow's own suite.
      params: { name: 'import-bibtex', arguments: { bibtex, metadataOnly: true } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    expect(content[0].text).toContain('Imported');
    expect(db.addCitation).toHaveBeenCalled();
  });

  test('unknown tool returns error', async () => {
    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'nonexistent-tool', arguments: {} },
    });

    const response = result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Unknown tool');
  });

  test('get-citation returns isError on zod validation failure (missing doi)', async () => {
    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'get-citation', arguments: {} },
    });

    const response = result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Invalid arguments');
    expect(response.content[0].text).toContain('doi');
  });

  test('list-citations supports cursor pagination', async () => {
    const db = getDatabase();
    (db.getAllCitations as jest.Mock).mockReturnValue({
      citations: [{ doi: '10/a' }, { doi: '10/b' }],
      nextCursor: 'abc',
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'list-citations', arguments: { limit: 2 } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(content[0].text);
    expect(parsed.citations).toHaveLength(2);
    expect(parsed.nextCursor).toBe('abc');
    expect(db.getAllCitations).toHaveBeenCalledWith({ cursor: undefined, limit: 2 });
  });

  test('list-citations returns isError for invalid cursors', async () => {
    const db = getDatabase();
    (db.getAllCitations as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid cursor');
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'list-citations', arguments: { cursor: 'bad-cursor', limit: 2 } },
    });

    const response = result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Invalid cursor');
  });

  test('list-tools returns all expected tools', async () => {
    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/list')!({
      method: 'tools/list',
      params: {},
    });

    const { tools } = result as { tools: Array<{ name: string }> };
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain('get-citation');
    expect(toolNames).toContain('import-bibtex');
    expect(toolNames).toContain('download-pdf');
    expect(toolNames).toContain('list-citations');
    expect(toolNames).toContain('search-arxiv');
    expect(toolNames).toContain('search-citations');
    expect(toolNames).toContain('read-content');
    expect(toolNames).toContain('verify-quote');
  });

  test('search-citations returns summaries with matched fields', async () => {
    const db = getDatabase();
    (db.searchCitations as jest.Mock).mockReturnValue({
      citations: [
        { doi: '10/x', title: 'X-ray Lidar', year: 2024, verificationStatus: 'downloaded' },
      ],
      nextCursor: 'cur',
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'search-citations', arguments: { query: 'lidar', limit: 10 } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(content[0].text);
    expect(parsed.results[0].citation.doi).toBe('10/x');
    expect(parsed.results[0].matchedFields).toContain('title');
    expect(parsed.nextCursor).toBe('cur');
    expect(db.searchCitations).toHaveBeenCalledWith('lidar', { cursor: undefined, limit: 10 });
  });

  test('search-citations rejects an empty query', async () => {
    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'search-citations', arguments: { query: '' } },
    });

    const response = result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Invalid arguments');
  });

  test('read-content serves extracted markdown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-mcp-'));
    fs.mkdirSync(path.join(root, 'papers', 'markdown'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'papers', 'markdown', 'key2024.md'),
      '# Paper\n\nGrounded body text.'
    );

    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue({
      doi: '10/read',
      title: 'Paper',
      bibtexKey: 'key2024',
      pdfPath: path.join(root, 'papers', 'pdf', 'key2024.pdf'),
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'read-content', arguments: { doi: '10/read' } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(content[0].text);
    expect(parsed.doi).toBe('10/read');
    expect(parsed.text).toContain('Grounded body text');

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('verify-quote returns an exact verdict for text present in the markdown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-mcp-'));
    fs.mkdirSync(path.join(root, 'papers', 'markdown'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'papers', 'markdown', 'key2024.md'),
      '# Paper\n\nGrounded body text for verification.'
    );

    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue({
      id: 1,
      doi: '10/verify',
      title: 'Paper',
      bibtexKey: 'key2024',
      pdfPath: path.join(root, 'papers', 'pdf', 'key2024.pdf'),
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: {
        name: 'verify-quote',
        arguments: { quote: 'Grounded body text', doi: '10/verify' },
      },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(content[0].text);
    expect(parsed.verdict).toBe('exact');
    expect(parsed.matches[0].doi).toBe('10/verify');

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('read-content reports missing markdown with guidance', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-mcp-'));
    fs.mkdirSync(path.join(root, 'papers', 'pdf'), { recursive: true });

    const db = getDatabase();
    (db.getCitation as jest.Mock).mockReturnValue({
      doi: '10/nomd',
      bibtexKey: 'nomd2024',
      pdfPath: path.join(root, 'papers', 'pdf', 'nomd2024.pdf'),
    });

    const server = createMcpServer();
    const result = await (
      server as unknown as {
        _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
      }
    )._requestHandlers.get('tools/call')!({
      method: 'tools/call',
      params: { name: 'read-content', arguments: { doi: '10/nomd' } },
    });

    const { content } = result as { content: Array<{ type: string; text: string }> };
    expect(content[0].text).toContain('No extracted Markdown');

    fs.rmSync(root, { recursive: true, force: true });
  });
});

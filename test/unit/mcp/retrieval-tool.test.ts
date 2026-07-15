import type { Database } from '../../../src/db/index';
import { handleRetrievalTool } from '../../../src/mcp/tools/retrieval';
import { OpenAccessDownloader } from '../../../src/retrieval/downloaders/open-access';
import { UnpaywallResolver } from '../../../src/retrieval/resolvers/unpaywall';

const mockDownload = jest.fn();
const mockGetOpenAccessPdf = jest.fn();

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

function makeDb(citation: unknown = { doi: '10/test' }): Database {
  return {
    getCitation: jest.fn(() => citation),
    transaction: jest.fn((fn: () => unknown) => fn()),
    updatePdfPath: jest.fn(),
    updateVerificationStatus: jest.fn(),
  } as unknown as Database;
}

describe('MCP retrieval tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDownload.mockResolvedValue('/papers/test.pdf');
  });

  test('returns null for unknown tools', async () => {
    await expect(handleRetrievalTool('unknown', {}, makeDb())).resolves.toBeNull();
  });

  test('validates download-pdf arguments', async () => {
    const result = await handleRetrievalTool('download-pdf', { doi: '' }, makeDb());

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('doi');
  });

  test('returns guidance when no PDF URL can be resolved', async () => {
    const result = await handleRetrievalTool('download-pdf', { doi: '10/test' }, makeDb());

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'No PDF URL available. Provide pdfUrl or use useUnpaywall with email.',
        },
      ],
    });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test('downloads a direct PDF URL and records it against the citation', async () => {
    const db = makeDb();

    const result = await handleRetrievalTool(
      'download-pdf',
      { doi: '10/test', pdfUrl: 'https://example.com/paper.pdf' },
      db
    );

    expect(OpenAccessDownloader).toHaveBeenCalledWith({ email: undefined });
    expect(mockDownload).toHaveBeenCalledWith('10/test', 'https://example.com/paper.pdf');
    expect(db.updatePdfPath).toHaveBeenCalledWith('10/test', '/papers/test.pdf');
    expect(db.updateVerificationStatus).toHaveBeenCalledWith('10/test', 'downloaded');
    expect(result).toEqual({ content: [{ type: 'text', text: 'PDF saved to: /papers/test.pdf' }] });
  });

  test('reports when a downloaded DOI is not present in the database', async () => {
    const result = await handleRetrievalTool(
      'download-pdf',
      { doi: '10/missing', pdfUrl: 'https://example.com/paper.pdf' },
      makeDb(null)
    );

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('not found in database');
  });

  test('resolves a URL through Unpaywall with explicit or configured email', async () => {
    mockGetOpenAccessPdf.mockResolvedValue({ ok: true, value: 'https://oa.example/paper.pdf' });
    const db = makeDb();

    const result = await handleRetrievalTool(
      'download-pdf',
      { doi: '10/test', useUnpaywall: true },
      db,
      { email: 'reader@example.com' }
    );

    expect(UnpaywallResolver).toHaveBeenCalledWith('reader@example.com');
    expect(OpenAccessDownloader).toHaveBeenCalledWith({ email: 'reader@example.com' });
    expect(mockDownload).toHaveBeenCalledWith('10/test', 'https://oa.example/paper.pdf');
    expect(result?.content[0].text).toBe('PDF saved to: /papers/test.pdf');
  });

  test('returns lookup failures and unresolved Unpaywall lookups without downloading', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: false, error: 'rate limited' });
    const failure = await handleRetrievalTool(
      'download-pdf',
      { doi: '10/test', useUnpaywall: true, email: 'reader@example.com' },
      makeDb()
    );

    expect(failure?.isError).toBe(true);
    expect(failure?.content[0].text).toContain('rate limited');

    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    const unresolved = await handleRetrievalTool(
      'download-pdf',
      { doi: '10/test', useUnpaywall: true, email: 'reader@example.com' },
      makeDb()
    );

    expect(unresolved?.content[0].text).toContain('No PDF URL available');
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

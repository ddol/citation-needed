import type { Database } from '../../../src/db/index';
import { handleCitationTool } from '../../../src/mcp/tools/citations';

const mockSearchByTitle = jest.fn();

jest.mock('../../../src/retrieval/resolvers/arxiv', () => ({
  ArxivResolver: jest.fn().mockImplementation(() => ({
    searchByTitle: mockSearchByTitle,
  })),
}));

function makeDb(): Database {
  return {
    getCitation: jest.fn(),
    getAllCitations: jest.fn(() => []),
    addCitation: jest.fn(),
  } as unknown as Database;
}

describe('MCP citation tool handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('imports valid BibTeX entries, skips invalid entries, and sends progress', async () => {
    const db = makeDb();
    const sendProgress = jest.fn();
    const bibtex = `
@article{valid2024, title={Valid}, doi={https://doi.org/10.1234/VALID}, year={2024}}
@article{bad2024, title={Bad}, doi={not-a-doi}, year={2024}}
@article{nodoi2024, title={No DOI}, year={2024}}
`;

    const result = await handleCitationTool('import-bibtex', { bibtex }, db, { sendProgress });

    expect(db.addCitation).toHaveBeenCalledWith(expect.objectContaining({ doi: '10.1234/VALID' }));
    expect(sendProgress).toHaveBeenCalledTimes(3);
    expect(result?.content[0].text).toContain('Imported 1 citations: 10.1234/VALID');
    expect(result?.content[0].text).toContain('Skipped 2');
  });

  test('supports arXiv search success and failure responses', async () => {
    mockSearchByTitle.mockResolvedValueOnce({
      ok: true,
      value: [{ title: 'Found Paper', pdfUrl: 'https://arxiv.org/pdf/1' }],
    });
    const success = await handleCitationTool('search-arxiv', { title: 'Found Paper' }, makeDb());

    expect(JSON.parse(success?.content[0].text ?? '[]')[0].title).toBe('Found Paper');

    mockSearchByTitle.mockResolvedValueOnce({ ok: false, error: 'offline' });
    const failure = await handleCitationTool('search-arxiv', { title: 'Found Paper' }, makeDb());

    expect(failure?.isError).toBe(true);
    expect(failure?.content[0].text).toBe('arXiv search failed: offline');
  });

  test('returns null for unknown tools and validation errors for bad arguments', async () => {
    await expect(handleCitationTool('unknown', {}, makeDb())).resolves.toBeNull();

    const result = await handleCitationTool('list-citations', { limit: 500 }, makeDb());

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('Invalid arguments for list-citations');
  });
});

import type { Database } from '../../../src/db/index';
import { handleCitationTool } from '../../../src/mcp/tools/citations';

const mockSearchByTitle = jest.fn();

jest.mock('../../../src/retrieval/resolvers/arxiv', () => ({
  ArxivResolver: jest.fn().mockImplementation(() => ({
    searchByTitle: mockSearchByTitle,
  })),
}));

// import-bibtex now runs the real retrieval pipeline by default. Stub the
// retriever and the extractor rather than the workflow, so this suite still
// exercises the tool through ImportService into the workflow, but can never
// reach the network.
jest.mock('../../../src/retrieval/index', () => ({
  RetrievalOrchestrator: jest.fn().mockImplementation(() => ({
    retrievePdf: async () => ({ success: false, source: 'test', message: 'no PDF in tests' }),
    resetTransientState: () => undefined,
  })),
}));

function makeDb(): Database {
  return {
    getCitation: jest.fn(),
    getAllCitations: jest.fn(() => []),
    addCitation: jest.fn((citation) => citation),
  } as unknown as Database;
}

describe('MCP citation tool handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const bibtex = `
@article{valid2024, title={Valid}, doi={https://doi.org/10.1234/VALID}, year={2024}}
@article{bad2024, title={Bad}, doi={not-a-doi}, year={2024}}
@article{nodoi2024, title={No DOI}, year={2024}}
`;

  test('imports valid BibTeX entries, skips invalid entries, and sends progress', async () => {
    const db = makeDb();
    const sendProgress = jest.fn();

    const result = await handleCitationTool('import-bibtex', { bibtex, metadataOnly: true }, db, {
      sendProgress,
    });

    expect(db.addCitation).toHaveBeenCalledWith(expect.objectContaining({ doi: '10.1234/VALID' }));
    // One notification per entry, sent when that entry reaches a terminal
    // stage, so the count matches the entries rather than the stage changes.
    expect(sendProgress).toHaveBeenCalledTimes(3);
    expect(result?.content[0].text).toContain('Imported 1 citations');
    expect(result?.content[0].text).toContain('skipped 2');
    // Metadata-only says nothing about downloads it never attempted.
    expect(result?.content[0].text).not.toContain('downloaded');
  });

  // The consolidation this guards: an agent importing a .bib gets the same
  // pipeline the CLI runs, so the corpus it just imported is groundable.
  test('runs the full pipeline by default, reporting downloads and failures', async () => {
    const db = makeDb();

    const result = await handleCitationTool('import-bibtex', { bibtex }, db);

    expect(result?.content[0].text).toContain('downloaded 0 PDFs');
    expect(result?.content[0].text).toContain('wrote 0 Markdown files');
    expect(result?.content[0].text).toContain('failed 1: 10.1234/VALID (no PDF in tests)');
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

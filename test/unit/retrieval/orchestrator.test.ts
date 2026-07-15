import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock the resolvers + open-access downloader so the orchestrator runs in isolation.
const mockGetOpenAccessPdf = jest.fn();
const mockArxivSearch = jest.fn();
const mockSemanticScholar = jest.fn();
const mockDownload = jest.fn();
const mockGetLocalPath = jest.fn();
const mockAuthenticatedDownload = jest.fn();

jest.mock('../../../src/retrieval/resolvers/unpaywall', () => ({
  UnpaywallResolver: jest.fn().mockImplementation(() => ({
    getOpenAccessPdf: mockGetOpenAccessPdf,
  })),
}));
jest.mock('../../../src/retrieval/resolvers/semantic-scholar', () => ({
  SemanticScholarResolver: jest.fn().mockImplementation(() => ({
    getOpenAccessPdf: mockSemanticScholar,
  })),
}));
jest.mock('../../../src/retrieval/resolvers/arxiv', () => ({
  // Keep the real selectArxivMatch: the orchestrator's job is to reject
  // unrelated arXiv hits, so that guard must run for real here.
  ...jest.requireActual('../../../src/retrieval/resolvers/arxiv'),
  ArxivResolver: jest.fn().mockImplementation(() => ({
    searchByTitle: mockArxivSearch,
    getPdfUrl: (id: string) => `https://arxiv.org/pdf/${id}`,
  })),
}));
jest.mock('../../../src/retrieval/downloaders/open-access', () => ({
  OpenAccessDownloader: jest.fn().mockImplementation(() => ({
    download: mockDownload,
    getLocalPath: mockGetLocalPath,
  })),
}));
jest.mock('../../../src/retrieval/downloaders/authenticated', () => ({
  AuthenticatedDownloader: jest.fn().mockImplementation(() => ({
    download: mockAuthenticatedDownload,
  })),
}));

// eslint-disable-next-line import/first, import/order
import { RetrievalOrchestrator } from '../../../src/retrieval/index';

function makeFakeDb(citation: { doi: string; title?: string; pdfPath?: string } | null) {
  return {
    getCitation: jest.fn().mockReturnValue(citation),
    updatePdfPath: jest.fn(),
    updateVerificationStatus: jest.fn(),
    updateAccessType: jest.fn(),
    transaction: <T>(fn: () => T) => fn(),
  } as any;
}

describe('RetrievalOrchestrator', () => {
  let tempStorage: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-orch-'));
    mockGetLocalPath.mockReturnValue(null);
    mockAuthenticatedDownload.mockResolvedValue(path.join(tempStorage, 'auth.pdf'));
    // Default: Semantic Scholar has nothing, so tests that predate it still
    // exercise the arXiv fallback. Real calls here would hit the network.
    mockSemanticScholar.mockResolvedValue({ ok: true, value: null });
  });

  afterEach(() => {
    fs.rmSync(tempStorage, { recursive: true, force: true });
  });

  test('returns cached PDF when DB row already has a pdf_path that exists on disk', async () => {
    const cached = path.join(tempStorage, 'cached.pdf');
    fs.writeFileSync(cached, '%PDF');
    const db = makeFakeDb({ doi: '10/test', pdfPath: cached });
    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);

    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(true);
    expect(result.source).toBe('cache');
    expect(mockGetOpenAccessPdf).not.toHaveBeenCalled();
  });

  test('downloads via Unpaywall when an OA URL is found', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: 'https://oa.example/paper.pdf' });
    mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'paper.pdf'));
    const db = makeFakeDb({ doi: '10/test', title: 'A Paper' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(true);
    expect(result.source).toBe('unpaywall');
    expect(db.updatePdfPath).toHaveBeenCalledWith('10/test', path.join(tempStorage, 'paper.pdf'));
    expect(db.updateVerificationStatus).toHaveBeenCalledWith('10/test', 'downloaded');
    expect(db.updateAccessType).toHaveBeenCalledWith('10/test', 'open-access');
  });

  test('returns a cached PDF found at the downloader local path', async () => {
    const cached = path.join(tempStorage, 'local-cache.pdf');
    mockGetLocalPath.mockReturnValueOnce(cached);
    const db = makeFakeDb({ doi: '10/test', title: 'A Paper' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test', { bibtexKey: 'paper2024' });

    expect(result).toEqual({
      success: true,
      localPath: cached,
      source: 'cache',
      message: 'Already downloaded',
    });
    expect(mockGetOpenAccessPdf).not.toHaveBeenCalled();
  });

  test('falls through when Unpaywall finds a URL but the download fails', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: 'https://oa.example/paper.pdf' });
    mockDownload.mockRejectedValueOnce(new Error('disk full'));
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/test', title: 'A Paper' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(false);
    expect(result.message).toContain('unpaywall(download failed: disk full)');
  });

  test('falls back to arXiv when Unpaywall has nothing, recording attempts', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({
      ok: true,
      value: [{ arxivId: '1706.03762', pdfUrl: 'https://arxiv.org/pdf/1706.03762', title: 'Att' }],
    });
    mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'paper.pdf'));
    const db = makeFakeDb({ doi: '10/test', title: 'Att' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.source).toBe('arxiv');
    expect(result.success).toBe(true);
  });

  // Regression: the real run downloaded arXiv 1411.4413 (a CERN B_s->mumu
  // paper) for 10 unrelated citations, including papers published decades
  // before arXiv existed, because the first search hit was taken unchecked.
  test('does not download an arXiv hit whose title does not match the citation', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          arxivId: '1411.4413',
          pdfUrl: 'https://arxiv.org/pdf/1411.4413',
          title: 'Observation of the rare $B^0_s\\to\\mu^+\\mu^-$ decay from CMS and LHCb data',
        },
      ],
    });
    const db = makeFakeDb({
      doi: '10/kalman',
      title: 'A New Approach to Linear Filtering and Prediction Problems',
    });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/kalman');

    expect(mockDownload).not.toHaveBeenCalled();
    expect(db.updatePdfPath).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain('arxiv(no confident title match');
  });

  test('downloads via Semantic Scholar when Unpaywall has nothing', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockSemanticScholar.mockResolvedValueOnce({
      ok: true,
      value: {
        pdfUrl: 'https://pointclouds.org/pcl.pdf',
        title: '3D is Here: Point Cloud Library',
      },
    });
    mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'pcl.pdf'));
    const db = makeFakeDb({ doi: '10/pcl', title: '3D is Here: Point Cloud Library (PCL)' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@lab.edu' }, tempStorage);
    const result = await orch.retrievePdf('10/pcl');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-scholar');
    // A precise DOI source answered, so the fuzzy title search never ran.
    expect(mockArxivSearch).not.toHaveBeenCalled();
  });

  // Semantic Scholar returned koval2013precontact.pdf for Held 2016: a DOI
  // match does not make the upstream PDF correct.
  test('rejects a Semantic Scholar PDF whose title is grossly wrong for the DOI', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockSemanticScholar.mockResolvedValueOnce({
      ok: true,
      value: {
        pdfUrl: 'https://ri.cmu.edu/koval2013precontact.pdf',
        title: 'Pre- and post-contact policy decomposition for planar contact manipulation',
      },
    });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({
      doi: '10/held',
      title: 'Robust Real-Time Tracking Combining 3D Shape, Colour, and Motion',
    });

    const orch = new RetrievalOrchestrator(db, { email: 'me@lab.edu' }, tempStorage);
    const result = await orch.retrievePdf('10/held');

    expect(mockDownload).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain('semantic-scholar(title mismatch');
  });

  test('records Semantic Scholar lookup and download failures before trying arXiv', async () => {
    mockGetOpenAccessPdf.mockResolvedValue({ ok: true, value: null });
    mockSemanticScholar.mockResolvedValueOnce({ ok: false, error: 'service unavailable' });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/ss', title: 'Semantic Search Paper' });

    const lookupFailure = await new RetrievalOrchestrator(
      db,
      { email: 'me@lab.edu' },
      tempStorage
    ).retrievePdf('10/ss');

    expect(lookupFailure.message).toContain('semantic-scholar(service unavailable)');

    mockSemanticScholar.mockResolvedValueOnce({
      ok: true,
      value: { pdfUrl: 'https://ss.example/paper.pdf', title: 'Semantic Search Paper' },
    });
    mockDownload.mockRejectedValueOnce(new Error('timeout'));
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });

    const downloadFailure = await new RetrievalOrchestrator(
      db,
      { email: 'me@lab.edu' },
      tempStorage
    ).retrievePdf('10/ss');

    expect(downloadFailure.message).toContain('semantic-scholar(download failed: timeout)');
  });

  // The DOI already proves identity, so an abbreviated BibTeX subtitle (which
  // scores 0.65 and would fail arXiv's 0.9 bar) must still be accepted here.
  test('accepts a Semantic Scholar PDF whose title is merely abbreviated', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockSemanticScholar.mockResolvedValueOnce({
      ok: true,
      value: {
        pdfUrl: 'https://x/patchwork.pdf',
        title:
          'Patchwork: Concentric Zone-based Region-wise Ground Segmentation with Ground Likelihood Estimation Using a 3D LiDAR Sensor',
      },
    });
    mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'patchwork.pdf'));
    const db = makeFakeDb({
      doi: '10/patchwork',
      title: 'Patchwork: Concentric Zone-Based Region-Wise Ground Segmentation with Tilted LiDAR',
    });

    const orch = new RetrievalOrchestrator(db, { email: 'me@lab.edu' }, tempStorage);
    const result = await orch.retrievePdf('10/patchwork');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-scholar');
  });

  test('accumulates per-step attempts into RetrievalResult.message on terminal failure', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({
      ok: false,
      error: 'Unpaywall lookup failed: timeout',
    });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/test', title: 'A Paper' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(false);
    expect(result.message).toContain('unpaywall(');
    expect(result.message).toContain('timeout');
    expect(result.message).toContain('arxiv(no matching paper)');
  });

  test('records arXiv skipped, lookup failure, and download failure branches', async () => {
    mockGetOpenAccessPdf.mockResolvedValue({ ok: true, value: null });
    const noTitle = await new RetrievalOrchestrator(
      makeFakeDb({ doi: '10/notitle' }),
      { email: 'me@me.com' },
      tempStorage
    ).retrievePdf('10/notitle');
    expect(noTitle.message).toContain('arxiv(skipped: no title for search)');

    mockArxivSearch.mockResolvedValueOnce({ ok: false, error: 'arXiv down' });
    const lookupFailure = await new RetrievalOrchestrator(
      makeFakeDb({ doi: '10/arxiv', title: 'Arxiv Paper' }),
      { email: 'me@me.com' },
      tempStorage
    ).retrievePdf('10/arxiv');
    expect(lookupFailure.message).toContain('arxiv(arXiv down)');

    mockArxivSearch.mockResolvedValueOnce({
      ok: true,
      value: [
        { arxivId: '1234.5678', pdfUrl: 'https://arxiv.org/pdf/1234.5678', title: 'Arxiv Paper' },
      ],
    });
    mockDownload.mockRejectedValueOnce(new Error('network lost'));
    const downloadFailure = await new RetrievalOrchestrator(
      makeFakeDb({ doi: '10/arxiv', title: 'Arxiv Paper' }),
      { email: 'me@me.com' },
      tempStorage
    ).retrievePdf('10/arxiv');
    expect(downloadFailure.message).toContain('arxiv(download failed: network lost)');
  });

  test('routes Springer DOIs through the publisher adapter step (currently no-op)', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10.1007/s00146-021-01196-y' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10.1007/s00146-021-01196-y');

    expect(result.success).toBe(false);
    expect(result.message).toContain('publisher(Springer');
  });

  test('marks publisher step as no-adapter for unknown DOI prefixes', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10.9999/unknown' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10.9999/unknown');

    expect(result.message).toContain('publisher(no adapter for DOI prefix)');
  });

  test('uses authenticated proxy fallback when open access and publisher steps fail', async () => {
    process.env.PROXY_PASSWORD = 'secret';
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10.9999/auth', title: 'Proxy Paper' });

    const result = await new RetrievalOrchestrator(
      db,
      {
        email: 'me@me.com',
        proxies: [
          {
            name: 'campus',
            proxyUrl: 'https://proxy.example',
            username: 'reader',
            passwordEnvVar: 'PROXY_PASSWORD',
          },
        ],
      },
      tempStorage
    ).retrievePdf('10.9999/auth');

    expect(result.success).toBe(true);
    expect(result.source).toBe('authenticated');
    expect(mockAuthenticatedDownload).toHaveBeenCalledWith(
      '10.9999/auth',
      'https://doi.org/10.9999/auth',
      expect.objectContaining({
        username: 'reader',
        password: 'secret',
        proxyUrl: 'https://proxy.example',
      })
    );
    expect(db.updateAccessType).toHaveBeenCalledWith('10.9999/auth', 'institutional');
    delete process.env.PROXY_PASSWORD;
  });

  test('returns authenticated failure with previous attempts when proxy download fails', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    mockAuthenticatedDownload.mockRejectedValueOnce(new Error('login failed'));

    const result = await new RetrievalOrchestrator(
      makeFakeDb({ doi: '10.9999/auth', title: 'Proxy Paper' }),
      { email: 'me@me.com', proxies: [{ name: 'campus', proxyUrl: 'https://proxy.example' }] },
      tempStorage
    ).retrievePdf('10.9999/auth');

    expect(result.success).toBe(false);
    expect(result.source).toBe('authenticated');
    expect(result.message).toContain('login failed');
    expect(result.message).toContain('publisher(no adapter for DOI prefix)');
  });

  test('skips Unpaywall entirely when no email is configured, and says how to fix it', async () => {
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/test', title: 'X' });

    const orch = new RetrievalOrchestrator(db, {}, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(mockGetOpenAccessPdf).not.toHaveBeenCalled();
    expect(result.message).toContain('auth set-email');
  });

  // Unpaywall answers placeholder addresses with HTTP 422, so spending a
  // lookup on one is guaranteed waste and reports a misleading error.
  test('treats a placeholder contact email as no email at all', async () => {
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/test', title: 'X' });

    const orch = new RetrievalOrchestrator(
      db,
      { email: 'citation-needed@example.com' },
      tempStorage
    );
    const result = await orch.retrievePdf('10/test');

    expect(mockGetOpenAccessPdf).not.toHaveBeenCalled();
    expect(result.message).toContain('auth set-email');
  });

  test('falls back to CITATION_NEEDED_EMAIL so the env var enables Unpaywall', async () => {
    const previous = process.env.CITATION_NEEDED_EMAIL;
    process.env.CITATION_NEEDED_EMAIL = 'reader@lab.edu';
    try {
      mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: 'https://oa.example/p.pdf' });
      mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'p.pdf'));
      const db = makeFakeDb({ doi: '10/test', title: 'X' });

      const orch = new RetrievalOrchestrator(db, {}, tempStorage);
      const result = await orch.retrievePdf('10/test');

      expect(mockGetOpenAccessPdf).toHaveBeenCalledWith('10/test');
      expect(result.source).toBe('unpaywall');
    } finally {
      if (previous === undefined) delete process.env.CITATION_NEEDED_EMAIL;
      else process.env.CITATION_NEEDED_EMAIL = previous;
    }
  });
});

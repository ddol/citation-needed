import { ArxivResolver } from '../../../src/retrieval/resolvers/arxiv';
import { UnpaywallResolver } from '../../../src/retrieval/resolvers/unpaywall';

// Mock axios to avoid real HTTP calls
jest.mock('axios');
const axios = require('axios');

describe('Retrieval Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ArxivResolver', () => {
    test('getPdfUrl constructs correct URL', () => {
      const resolver = new ArxivResolver();
      expect(resolver.getPdfUrl('2301.12345')).toBe('https://arxiv.org/pdf/2301.12345');
    });

    test('getPdfUrl strips version suffix', () => {
      const resolver = new ArxivResolver();
      expect(resolver.getPdfUrl('2301.12345v2')).toBe('https://arxiv.org/pdf/2301.12345');
    });

    test('searchByTitle returns results from mock XML', async () => {
      const mockXml = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>http://arxiv.org/abs/2301.12345v1</id>
    <title>Test Paper Title</title>
  </entry>
</feed>`;
      axios.get = jest.fn().mockResolvedValueOnce({ data: mockXml });

      const resolver = new ArxivResolver();
      const result = await resolver.searchByTitle('Test Paper');
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value).toHaveLength(1);
      expect(result.value[0].arxivId).toBe('2301.12345');
      expect(result.value[0].title).toBe('Test Paper Title');
    });

    test('searchByTitle normalizes whitespace in the query', async () => {
      const mockXml = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>http://arxiv.org/abs/2301.12345v1</id>
    <title>Test Paper Title</title>
  </entry>
</feed>`;
      axios.get = jest.fn().mockResolvedValueOnce({ data: mockXml });

      const resolver = new ArxivResolver();
      await resolver.searchByTitle('Test   Paper\n   Title');

      // The phrase stays quoted (%22) — unquoted, arXiv ORs the words apart.
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('search_query=ti:%22Test%20Paper%20Title%22'),
        expect.objectContaining({ timeout: 30000, responseType: 'text' })
      );
    });

    test('searchByTitle retries once on rate limit errors', async () => {
      const mockXml = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>http://arxiv.org/abs/2301.12345v1</id>
    <title>Recovered Paper</title>
  </entry>
</feed>`;
      axios.get = jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({ data: mockXml });

      const resolver = new ArxivResolver();
      const result = await resolver.searchByTitle('Recovered Paper');

      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value[0].title).toBe('Recovered Paper');
    });

    test('searchByTitle surfaces an error result on network failure', async () => {
      axios.get = jest.fn().mockRejectedValueOnce(new Error('Network error'));
      const resolver = new ArxivResolver();
      const result = await resolver.searchByTitle('Test');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error).toContain('Network error');
    });
  });

  describe('UnpaywallResolver', () => {
    test('getOpenAccessPdf returns null value for closed access', async () => {
      axios.get = jest.fn().mockResolvedValueOnce({ data: { doi: '10.1234/test', is_oa: false } });
      const resolver = new UnpaywallResolver('test@example.com');
      const result = await resolver.getOpenAccessPdf('10.1234/test');
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value).toBeNull();
    });

    test('getOpenAccessPdf returns PDF URL for open access', async () => {
      axios.get = jest.fn().mockResolvedValueOnce({
        data: {
          doi: '10.1234/test',
          is_oa: true,
          best_oa_location: { url_for_pdf: 'https://example.com/paper.pdf' },
        },
      });
      const resolver = new UnpaywallResolver('test@example.com');
      const result = await resolver.getOpenAccessPdf('10.1234/test');
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value).toBe('https://example.com/paper.pdf');
    });

    test('getOpenAccessPdf surfaces an error result on network failure', async () => {
      axios.get = jest.fn().mockRejectedValueOnce(new Error('Network error'));
      const resolver = new UnpaywallResolver('test@example.com');
      const result = await resolver.getOpenAccessPdf('10.1234/test');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected error');
      expect(result.error).toContain('Network error');
    });
  });
});

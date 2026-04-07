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
      const results = await resolver.searchByTitle('Test Paper');
      expect(results.length).toBe(1);
      expect(results[0].arxivId).toBe('2301.12345');
      expect(results[0].title).toBe('Test Paper Title');
    });

    test('searchByTitle returns empty array on error', async () => {
      axios.get = jest.fn().mockRejectedValueOnce(new Error('Network error'));
      const resolver = new ArxivResolver();
      const results = await resolver.searchByTitle('Test');
      expect(results).toEqual([]);
    });
  });

  describe('UnpaywallResolver', () => {
    test('getOpenAccessPdf returns null for closed access', async () => {
      axios.get = jest.fn().mockResolvedValueOnce({ data: { doi: '10.1234/test', is_oa: false } });
      const resolver = new UnpaywallResolver('test@example.com');
      const result = await resolver.getOpenAccessPdf('10.1234/test');
      expect(result).toBeNull();
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
      expect(result).toBe('https://example.com/paper.pdf');
    });

    test('getOpenAccessPdf returns null on error', async () => {
      axios.get = jest.fn().mockRejectedValueOnce(new Error('Network error'));
      const resolver = new UnpaywallResolver('test@example.com');
      const result = await resolver.getOpenAccessPdf('10.1234/test');
      expect(result).toBeNull();
    });
  });
});

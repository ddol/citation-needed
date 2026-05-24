import { DoiResolver } from '../../../src/retrieval/resolvers/doi';

jest.mock('axios');
const axios = require('axios');

describe('DoiResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parses Crossref response into structured metadata on success', async () => {
    axios.get = jest.fn().mockResolvedValueOnce({
      data: {
        message: {
          title: ['Attention Is All You Need'],
          author: [
            { given: 'Ashish', family: 'Vaswani' },
            { given: 'Noam', family: 'Shazeer' },
          ],
          'published-print': { 'date-parts': [[2017]] },
          'container-title': ['NeurIPS'],
          publisher: 'Curran',
          URL: 'https://example.org/doi',
        },
      },
    });

    const resolver = new DoiResolver('reader@example.com');
    const result = await resolver.resolve('10.48550/arXiv.1706.03762');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(
      expect.objectContaining({
        doi: '10.48550/arXiv.1706.03762',
        title: 'Attention Is All You Need',
        authors: ['Ashish Vaswani', 'Noam Shazeer'],
        year: 2017,
        journal: 'NeurIPS',
        publisher: 'Curran',
        url: 'https://example.org/doi',
      })
    );
  });

  test('returns { ok: false, error } on network failures', async () => {
    axios.get = jest.fn().mockRejectedValueOnce(new Error('connect ECONNRESET'));
    const resolver = new DoiResolver('reader@example.com');
    const result = await resolver.resolve('10.1/broken');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toContain('ECONNRESET');
  });

  test('builds User-Agent with version + injected email', async () => {
    axios.get = jest.fn().mockResolvedValueOnce({ data: { message: {} } });
    const resolver = new DoiResolver('hello@me.io');
    await resolver.resolve('10.1/x');
    const { headers } = axios.get.mock.calls[0][1];
    expect(headers['User-Agent']).toMatch(/^citation-needed\/.+\(mailto:hello@me\.io\)/);
  });
});

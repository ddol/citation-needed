import { classifyUrl } from '../../../src/parsers/url';

describe('URL Classifier', () => {
  test('classifies arXiv abstract URL', () => {
    const result = classifyUrl('https://arxiv.org/abs/2301.12345');
    expect(result.type).toBe('arxiv');
    expect(result.identifier).toBe('2301.12345');
  });

  test('classifies arXiv PDF URL', () => {
    const result = classifyUrl('https://arxiv.org/pdf/2301.12345');
    expect(result.type).toBe('arxiv');
    expect(result.identifier).toBe('2301.12345');
  });

  test('classifies doi.org URL', () => {
    const result = classifyUrl('https://doi.org/10.1234/test');
    expect(result.type).toBe('doi');
    expect(result.identifier).toBe('10.1234/test');
  });

  test('classifies PubMed URL', () => {
    const result = classifyUrl('https://pubmed.ncbi.nlm.nih.gov/12345678');
    expect(result.type).toBe('pubmed');
    expect(result.identifier).toBe('12345678');
  });

  test('classifies PDF URL by extension', () => {
    const result = classifyUrl('https://example.com/paper.pdf');
    expect(result.type).toBe('pdf');
  });

  test('classifies generic https URL as html', () => {
    const result = classifyUrl('https://example.com/paper');
    expect(result.type).toBe('html');
  });

  test('classifies unknown non-URL string', () => {
    const result = classifyUrl('some random text');
    expect(result.type).toBe('unknown');
  });

  test('preserves original URL', () => {
    const url = 'https://arxiv.org/abs/2301.12345';
    const result = classifyUrl(url);
    expect(result.url).toBe(url);
  });
});

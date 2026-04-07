import { normalizeDoi, isValidDoi, extractDoiFromUrl } from '../../../src/parsers/doi';

describe('DOI Parser', () => {
  describe('normalizeDoi', () => {
    test('strips https://doi.org/ prefix', () => {
      expect(normalizeDoi('https://doi.org/10.1234/test')).toBe('10.1234/test');
    });

    test('strips http://doi.org/ prefix', () => {
      expect(normalizeDoi('http://doi.org/10.1234/test')).toBe('10.1234/test');
    });

    test('strips https://dx.doi.org/ prefix', () => {
      expect(normalizeDoi('https://dx.doi.org/10.1234/test')).toBe('10.1234/test');
    });

    test('strips doi: prefix', () => {
      expect(normalizeDoi('doi:10.1234/test')).toBe('10.1234/test');
    });

    test('trims whitespace', () => {
      expect(normalizeDoi('  10.1234/test  ')).toBe('10.1234/test');
    });

    test('returns bare DOI unchanged', () => {
      expect(normalizeDoi('10.1234/test.001')).toBe('10.1234/test.001');
    });
  });

  describe('isValidDoi', () => {
    test('validates a standard DOI', () => {
      expect(isValidDoi('10.1234/test.001')).toBe(true);
    });

    test('validates DOI with URL prefix', () => {
      expect(isValidDoi('https://doi.org/10.1234/test')).toBe(true);
    });

    test('rejects invalid DOI', () => {
      expect(isValidDoi('not-a-doi')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isValidDoi('')).toBe(false);
    });

    test('rejects DOI missing slash', () => {
      expect(isValidDoi('10.1234')).toBe(false);
    });

    test('validates DOI with complex suffix', () => {
      expect(isValidDoi('10.1016/j.cell.2023.01.001')).toBe(true);
    });
  });

  describe('extractDoiFromUrl', () => {
    test('extracts DOI from doi.org URL', () => {
      expect(extractDoiFromUrl('https://doi.org/10.1234/test')).toBe('10.1234/test');
    });

    test('extracts DOI from dx.doi.org URL', () => {
      expect(extractDoiFromUrl('https://dx.doi.org/10.1234/test')).toBe('10.1234/test');
    });

    test('extracts DOI from publisher URL containing DOI', () => {
      const result = extractDoiFromUrl('https://example.com/paper/10.1234/test.001');
      expect(result).toBe('10.1234/test.001');
    });

    test('returns null for URL without DOI', () => {
      expect(extractDoiFromUrl('https://example.com/paper')).toBeNull();
    });
  });
});

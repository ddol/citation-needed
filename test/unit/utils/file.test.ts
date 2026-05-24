import {
  getCitationFileStem,
  getCitationDisplayName,
  sanitizeFilename,
} from '../../../src/utils/file';

describe('utils/file', () => {
  describe('sanitizeFilename', () => {
    test('replaces unsafe characters with underscores', () => {
      expect(sanitizeFilename('10.1234/foo bar')).toBe('10.1234_foo_bar');
      expect(sanitizeFilename('a/b/c')).toBe('a_b_c');
    });

    test('keeps safe characters', () => {
      expect(sanitizeFilename('paper_v1.2-final.pdf')).toBe('paper_v1.2-final.pdf');
    });
  });

  describe('getCitationFileStem', () => {
    test('prefers bibtexKey when present', () => {
      expect(getCitationFileStem({ bibtexKey: 'smith2024', doi: '10.1/foo', title: 'Title' })).toBe(
        'smith2024'
      );
    });

    test('falls back to DOI when bibtexKey is missing', () => {
      expect(getCitationFileStem({ doi: '10.1/foo', title: 'Title' })).toBe('10.1_foo');
    });

    test('falls back to the literal "citation" when nothing usable is provided', () => {
      expect(getCitationFileStem({ title: 'Just a Title' })).toBe('citation');
      expect(getCitationFileStem({})).toBe('citation');
    });

    test('treats whitespace-only fields as missing', () => {
      expect(getCitationFileStem({ bibtexKey: '  ', doi: '10.1/foo' })).toBe('10.1_foo');
    });
  });

  describe('getCitationDisplayName', () => {
    test('prefers bibtexKey over DOI and title', () => {
      expect(
        getCitationDisplayName({ bibtexKey: 'smith2024', doi: '10.1/foo', title: 'A Title' })
      ).toBe('smith2024');
    });

    test('uses DOI when bibtexKey is missing', () => {
      expect(getCitationDisplayName({ doi: '10.1/foo' })).toBe('10.1/foo');
    });

    test('uses title only when key and DOI are missing', () => {
      expect(getCitationDisplayName({ title: 'A Title' })).toBe('A Title');
    });

    test('returns "citation" placeholder when nothing is provided', () => {
      expect(getCitationDisplayName({})).toBe('citation');
    });
  });
});

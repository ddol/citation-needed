import { SpringerAdapter } from '../../../src/retrieval/publishers/springer';
import { ElsevierAdapter } from '../../../src/retrieval/publishers/elsevier';
import { AcmAdapter } from '../../../src/retrieval/publishers/acm';
import { publishers, getAdapter } from '../../../src/retrieval/publishers/index';

describe('Publisher adapters', () => {
  describe('SpringerAdapter', () => {
    const adapter = new SpringerAdapter();

    test('handles Springer DOIs', () => {
      expect(adapter.handles('10.1007/s00146-021-01196-y')).toBe(true);
      expect(adapter.handles('10.1038/nature12373')).toBe(true);
      expect(adapter.handles('10.1145/3242969.3242991')).toBe(false);
    });

    test('builds landing page URL', () => {
      expect(adapter.getLandingPageUrl('10.1007/s00146-021-01196-y')).toBe(
        'https://link.springer.com/article/10.1007/s00146-021-01196-y'
      );
    });

    test('does not yet expose a direct PDF URL (M1)', () => {
      expect(adapter.getPdfUrl?.('10.1007/foo')).toBeNull();
    });
  });

  describe('ElsevierAdapter', () => {
    const adapter = new ElsevierAdapter();
    test('handles Elsevier prefix', () => {
      expect(adapter.handles('10.1016/j.cosrev.2022.100451')).toBe(true);
      expect(adapter.handles('10.1007/foo')).toBe(false);
    });

    test('builds landing page via doi.org', () => {
      expect(adapter.getLandingPageUrl('10.1016/foo')).toBe('https://doi.org/10.1016/foo');
    });
  });

  describe('AcmAdapter', () => {
    const adapter = new AcmAdapter();
    test('handles ACM prefix', () => {
      expect(adapter.handles('10.1145/3242969.3242991')).toBe(true);
      expect(adapter.handles('10.1016/foo')).toBe(false);
    });

    test('builds ACM landing page', () => {
      expect(adapter.getLandingPageUrl('10.1145/foo')).toBe('https://dl.acm.org/doi/10.1145/foo');
    });
  });

  describe('getAdapter / publishers registry', () => {
    test('exports all three adapters', () => {
      expect(publishers).toHaveLength(3);
    });

    test('returns the first adapter whose handles() matches the DOI', () => {
      expect(getAdapter('10.1007/foo')?.name).toBe('Springer');
      expect(getAdapter('10.1016/foo')?.name).toBe('Elsevier');
      expect(getAdapter('10.1145/foo')?.name).toBe('ACM');
    });

    test('returns null when no adapter handles the DOI prefix', () => {
      expect(getAdapter('10.9999/unknown')).toBeNull();
    });
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkLocalPapers } from '../../../src/services/local-paper-check';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-local-paper-check-'));
}

function writeBibtex(filePath: string, entries: string[]): void {
  fs.writeFileSync(filePath, entries.join('\n\n'), 'utf-8');
}

function writePdf(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '%PDF-1.4\nmock', 'utf-8');
}

describe('checkLocalPapers', () => {
  test('classifies matched, missing, mismatched, and skipped local papers without network work', async () => {
    const root = makeTempRoot();
    const bibtexPath = path.join(root, 'refs.bib');
    const paperPath = path.join(root, 'papers');

    writeBibtex(bibtexPath, [
      '@article{alpha2024, title={Alpha Study}, doi={10.1234/alpha}, author={Jane Doe}, year={2024}}',
      '@article{beta2023, title={Beta Methods}, doi={10.1234/beta}, author={John Smith}, year={2023}}',
      '@article{gamma2022, title={Gamma Failure}, doi={10.1234/gamma}, author={Mismatch Author}, year={2022}}',
      '@article{missing2021, title={Missing Paper}, doi={10.1234/missing}, author={No File}, year={2021}}',
      '@article{nodoi, title={No DOI Paper}, author={Unknown Author}}',
    ]);

    writePdf(path.join(paperPath, 'alpha2024.pdf'));
    writePdf(path.join(paperPath, 'beta-random-name.pdf'));
    writePdf(path.join(paperPath, 'gamma2022.pdf'));

    const textByName: Record<string, string> = {
      'alpha2024.pdf': 'This PDF includes DOI 10.1234/alpha.',
      'beta-random-name.pdf': 'Beta Methods by John Smith, 2023.',
      'gamma2022.pdf': 'Completely unrelated article.',
    };

    try {
      const result = await checkLocalPapers(bibtexPath, {
        paperPath,
        extractText: async (pdfPath) => textByName[path.basename(pdfPath)] ?? '',
      });

      expect(result.summary).toEqual({
        total: 5,
        matched: 2,
        missing: 1,
        mismatch: 1,
        ambiguous: 0,
        skipped: 1,
      });
      expect(result.entries.map((entry) => [entry.label, entry.status])).toEqual([
        ['alpha2024', 'matched'],
        ['beta2023', 'matched'],
        ['gamma2022', 'mismatch'],
        ['missing2021', 'missing'],
        ['nodoi', 'skipped'],
      ]);
      expect(result.entries[1].pdfPath).toBe(path.join(paperPath, 'beta-random-name.pdf'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports ambiguous when multiple PDFs strongly match the same BibTeX entry', async () => {
    const root = makeTempRoot();
    const bibtexPath = path.join(root, 'refs.bib');
    const paperPath = path.join(root, 'papers');

    writeBibtex(bibtexPath, [
      '@article{dupe2024, title={Duplicated Paper}, doi={10.1234/dupe}, author={Jane Doe}, year={2024}}',
    ]);
    writePdf(path.join(paperPath, 'first.pdf'));
    writePdf(path.join(paperPath, 'second.pdf'));

    try {
      const result = await checkLocalPapers(bibtexPath, {
        paperPath,
        extractText: async () => 'Duplicated Paper DOI 10.1234/dupe',
      });

      expect(result.summary.ambiguous).toBe(1);
      expect(result.entries[0].status).toBe('ambiguous');
      expect(result.entries[0].candidates).toHaveLength(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('can scan PDF folders recursively', async () => {
    const root = makeTempRoot();
    const bibtexPath = path.join(root, 'refs.bib');
    const paperPath = path.join(root, 'papers');
    const nestedPdf = path.join(paperPath, 'nested', 'recursive.pdf');

    writeBibtex(bibtexPath, [
      '@article{recursive2024, title={Recursive Paper}, doi={10.1234/recursive}, author={Jane Doe}, year={2024}}',
    ]);
    writePdf(nestedPdf);

    try {
      const result = await checkLocalPapers(bibtexPath, {
        paperPath,
        recursive: true,
        extractText: async () => 'Recursive Paper 10.1234/recursive',
      });

      expect(result.entries[0]).toMatchObject({
        status: 'matched',
        pdfPath: nestedPdf,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports invalid DOI entries and extraction errors on filename mismatches', async () => {
    const root = makeTempRoot();
    const bibtexPath = path.join(root, 'refs.bib');
    const paperPath = path.join(root, 'papers');

    writeBibtex(bibtexPath, [
      '@article{invalid2024, title={Invalid DOI}, doi={not-a-doi}, author={Jane Doe}, year={2024}}',
      '@article{error2024, title={Extraction Error}, doi={10.1234/error}, author={Jane Doe}, year={2024}}',
    ]);
    writePdf(path.join(paperPath, 'invalid2024.pdf'));
    writePdf(path.join(paperPath, 'error2024.pdf'));

    try {
      const result = await checkLocalPapers(bibtexPath, {
        paperPath,
        extractText: async (pdfPath) => {
          if (path.basename(pdfPath) === 'error2024.pdf') throw new Error('cannot extract');
          return '';
        },
      });

      expect(result.entries[0]).toMatchObject({
        status: 'skipped',
        message: 'Invalid DOI in BibTeX entry: not-a-doi',
      });
      expect(result.entries[1].status).toBe('mismatch');
      expect(result.entries[1].candidates[0].evidence.extractionError).toBe('cannot extract');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires recursive mode for nested PDFs and throws for missing paper directories', async () => {
    const root = makeTempRoot();
    const bibtexPath = path.join(root, 'refs.bib');
    const paperPath = path.join(root, 'papers');

    writeBibtex(bibtexPath, [
      '@article{nested2024, title={Nested Paper}, doi={10.1234/nested}, author={Jane Doe}, year={2024}}',
    ]);
    writePdf(path.join(paperPath, 'nested', 'nested2024.pdf'));

    try {
      const nonRecursive = await checkLocalPapers(bibtexPath, {
        paperPath,
        extractText: async () => 'Nested Paper DOI 10.1234/nested',
      });

      expect(nonRecursive.entries[0].status).toBe('missing');
      await expect(
        checkLocalPapers(bibtexPath, { paperPath: path.join(root, 'missing') })
      ).rejects.toThrow('Paper directory not found');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { resolveMarkdownPath } from '../../../src/services/markdown-locator';
import { handleGroundingTool } from '../../../src/mcp/tools/grounding';
import { processBibtexFile } from '../../../src/workflows/process-bibtex';

describe('resolveMarkdownPath', () => {
  let db: Database;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-locator-'));
    db = new Database(path.join(root, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, body: string): string {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, 'utf-8');
    return target;
  }

  // The point of the manifestation table: --markdown-path can put extracted
  // Markdown anywhere, including somewhere with no PDF beside it at all.
  test('finds Markdown recorded only as a manifestation, with no PDF path', () => {
    const citation = db.addCitation({ doi: '10.1/manifest-only', title: 'Manifest Only' });
    const markdownPath = writeFile('elsewhere/deep/paper.md', '# Manifest Only');
    db.upsertManifestation({
      citationId: citation.id!,
      kind: 'markdown-extracted',
      path: markdownPath,
    });

    expect(db.getCitation('10.1/manifest-only')?.pdfPath).toBeUndefined();
    expect(resolveMarkdownPath(db.getCitation('10.1/manifest-only')!, db)).toBe(markdownPath);
  });

  // A stale row must not shadow a copy the fallback can still find. Trusting the
  // path here would hand the caller a file that fails on read.
  test('ignores a manifestation whose file is gone and falls back to the stem', () => {
    const citation = db.addCitation({ doi: '10.1/stale', title: 'Stale', bibtexKey: 'stale2024' });
    db.updatePdfPath('10.1/stale', writeFile('papers/pdf/stale2024.pdf', 'pdf'));
    const survivor = writeFile('papers/markdown/stale2024.md', '# Stale');
    db.upsertManifestation({
      citationId: citation.id!,
      kind: 'markdown-extracted',
      path: path.join(root, 'papers', 'markdown', 'deleted.md'),
    });

    expect(resolveMarkdownPath(db.getCitation('10.1/stale')!, db)).toBe(survivor);
  });

  test('returns null when the manifestation is gone and no stem file exists', () => {
    const citation = db.addCitation({ doi: '10.1/nothing', title: 'Nothing' });
    db.updatePdfPath('10.1/nothing', writeFile('papers/pdf/nothing.pdf', 'pdf'));
    db.upsertManifestation({
      citationId: citation.id!,
      kind: 'markdown-extracted',
      path: path.join(root, 'papers', 'markdown', 'deleted.md'),
    });

    expect(resolveMarkdownPath(db.getCitation('10.1/nothing')!, db)).toBeNull();
  });

  test('heals a missing manifestation row when the stem fallback hits', () => {
    const citation = db.addCitation({
      doi: '10.1/legacy',
      title: 'Legacy',
      bibtexKey: 'legacy2024',
    });
    db.updatePdfPath('10.1/legacy', writeFile('papers/pdf/legacy2024.pdf', 'pdf'));
    const markdownPath = writeFile('papers/markdown/legacy2024.md', '# Legacy body');

    expect(db.getManifestation(citation.id!, 'markdown-extracted')).toBeUndefined();

    resolveMarkdownPath(db.getCitation('10.1/legacy')!, db);

    const healed = db.getManifestation(citation.id!, 'markdown-extracted');
    expect(healed?.path).toBe(markdownPath);
    expect(healed?.contentHash).toHaveLength(64);
    // We did not extract this file, so we do not claim to know what produced it.
    expect(healed?.extractorName).toBeUndefined();
  });

  test('works without a database, and never lets a healing failure hide a hit', () => {
    const citation = {
      doi: '10.1/nodb',
      title: 'No DB',
      bibtexKey: 'nodb2024',
      pdfPath: writeFile('papers/pdf/nodb2024.pdf', 'pdf'),
    };
    const markdownPath = writeFile('papers/markdown/nodb2024.md', '# No DB');

    expect(resolveMarkdownPath(citation)).toBe(markdownPath);

    const brokenDb = {
      getManifestation: () => undefined,
      upsertManifestation: () => {
        throw new Error('database is locked');
      },
    } as unknown as Database;
    expect(resolveMarkdownPath({ ...citation, id: 1 }, brokenDb)).toBe(markdownPath);
  });
});

describe('custom --markdown-path is readable over MCP', () => {
  let db: Database;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-locator-mcp-'));
    db = new Database(path.join(root, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The regression this guards: an import with --markdown-path writes Markdown
  // where the PDF-sibling guess will never look, so read-content could only find
  // it through the manifestation the import records.
  test('read-content serves Markdown written outside the default layout', async () => {
    const bibtexPath = path.join(root, 'refs.bib');
    fs.writeFileSync(
      bibtexPath,
      '@article{custom2024,\n title={Custom Path Paper},\n doi={10.1000/custom2024}\n}\n'
    );
    const paperPath = path.join(root, 'pdfs-here');
    const markdownPath = path.join(root, 'somewhere', 'else', 'markdown-here');

    await processBibtexFile(bibtexPath, {
      db,
      paperPath,
      markdownPath,
      retryThrottled: false,
      retrievePdf: async () => {
        const localPath = path.join(paperPath, 'custom2024.pdf');
        fs.writeFileSync(localPath, 'pdf bytes');
        return { success: true, localPath, source: 'test', message: 'ok' };
      },
      extractMarkdown: async () => '# Custom Path Paper\n\nThe body lives off the default path.',
    });

    const result = await handleGroundingTool('read-content', { doi: '10.1000/custom2024' }, db);
    const payload = JSON.parse(result?.content[0].text ?? '{}');

    expect(result?.isError).toBeUndefined();
    expect(payload.text).toContain('The body lives off the default path.');
    expect(
      db.getManifestation(db.getCitation('10.1000/custom2024')!.id!, 'markdown-extracted')?.path
    ).toBe(path.join(markdownPath, 'custom2024.md'));
  });
});

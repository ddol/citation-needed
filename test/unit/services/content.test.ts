import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { ContentService, decodeOffsetCursor } from '../../../src/services/content';

function makeTestDb(): { db: Database; dbPath: string } {
  const dbPath = path.join(
    os.homedir(),
    '.citation-needed-test',
    `svc-content-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = new Database(dbPath);
  return { db, dbPath };
}

function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-content-'));
  fs.mkdirSync(path.join(root, 'papers', 'pdf'), { recursive: true });
  fs.mkdirSync(path.join(root, 'papers', 'markdown'), { recursive: true });
  return root;
}

describe('ContentService', () => {
  let db: Database;
  let dbPath: string;
  let root: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTestDb());
    root = makeWorkspace();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterAll(() => {
    const dir = path.join(os.homedir(), '.citation-needed-test');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedCitation(doi: string, bibtexKey: string | undefined, markdownName?: string): void {
    db.addCitation({ doi, title: 'Readable Paper', bibtexKey });
    db.updatePdfPath(doi, path.join(root, 'papers', 'pdf', 'anything.pdf'));
    if (markdownName) {
      fs.writeFileSync(
        path.join(root, 'papers', 'markdown', markdownName),
        '# Readable Paper\n\nBody text of the extracted markdown.'
      );
    }
  }

  test('reads whole markdown via the stem naming', () => {
    seedCitation('10.1/read.1', 'read2024', 'read2024.md');

    const result = new ContentService(db).read({ doi: '10.1/read.1' });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.response.doi).toBe('10.1/read.1');
    expect(result.response.title).toBe('Readable Paper');
    expect(result.response.text).toContain('Body text');
    expect(result.response.nextCursor).toBeUndefined();
  });

  test('falls back to the legacy DOI-named markdown file', () => {
    seedCitation('10.1/read.2', 'missingkey', '10.1_read.2.md');

    const result = new ContentService(db).read({ doi: '10.1/read.2' });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.response.text).toContain('Body text');
  });

  test('paginates by maxChars and reassembles losslessly', () => {
    seedCitation('10.1/read.3', 'read3key', 'read3key.md');
    const full = fs.readFileSync(path.join(root, 'papers', 'markdown', 'read3key.md'), 'utf-8');

    const service = new ContentService(db);
    let reassembled = '';
    let cursor: string | undefined;
    let pages = 0;

    do {
      const result = service.read({ doi: '10.1/read.3', maxChars: 10, cursor });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      reassembled += result.response.text;
      cursor = result.response.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);

    expect(reassembled).toBe(full);
    expect(pages).toBe(Math.ceil(full.length / 10));
  });

  test('distinguishes unknown DOI from missing markdown', () => {
    const service = new ContentService(db);

    expect(service.read({ doi: '10.1/absent' }).status).toBe('unknown-doi');

    seedCitation('10.1/read.4', 'nomd2024'); // pdfPath set, no markdown written
    expect(service.read({ doi: '10.1/read.4' }).status).toBe('no-markdown');

    db.addCitation({ doi: '10.1/read.5', title: 'No PDF path' });
    expect(service.read({ doi: '10.1/read.5' }).status).toBe('no-markdown');
  });

  test('rejects invalid cursors', () => {
    seedCitation('10.1/read.6', 'read6key', 'read6key.md');
    const service = new ContentService(db);

    expect(() => service.read({ doi: '10.1/read.6', cursor: 'garbage' })).toThrow('Invalid cursor');
    expect(() => decodeOffsetCursor('garbage')).toThrow('Invalid cursor');
  });
});

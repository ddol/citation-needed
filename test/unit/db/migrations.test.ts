import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { migrations } from '../../../src/db/migrations';

const RawSqlite = require('better-sqlite3');

const LATEST_VERSION = migrations[migrations.length - 1].version;

function makeDbDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cn-migrations-'));
}

describe('schema migrations', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = makeDbDir();
    dbPath = path.join(dir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('FTS5 is available in the bundled better-sqlite3 (spike)', () => {
    const raw = new RawSqlite(':memory:');
    expect(() => raw.exec('CREATE VIRTUAL TABLE t USING fts5(x)')).not.toThrow();
    raw.close();
  });

  test('a fresh database reaches the latest user_version with all tables', () => {
    const db = new Database(dbPath);
    db.close();

    const raw = new RawSqlite(dbPath);
    expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row: { name: string }) => row.name);
    for (const expected of [
      'citations',
      'retrieval_log',
      'manifestations',
      'chunks',
      'chunks_fts',
      'citations_fts',
    ]) {
      expect(tables).toContain(expected);
    }
    raw.close();
  });

  test('re-opening is idempotent and preserves data', () => {
    const first = new Database(dbPath);
    first.addCitation({ doi: '10.1/m.1', title: 'Kept Across Reopens' });
    first.close();

    const second = new Database(dbPath);
    expect(second.getCitation('10.1/m.1')?.title).toBe('Kept Across Reopens');
    second.close();

    const raw = new RawSqlite(dbPath);
    expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
    raw.close();
  });

  test('migration backfills citations_fts for pre-existing rows', () => {
    // Simulate a database created before the FTS migration: build it, wipe
    // user_version and drop FTS artifacts, then reopen.
    const db = new Database(dbPath);
    db.addCitation({ doi: '10.1/m.2', title: 'Prehistoric Entry' });
    db.close();

    const raw = new RawSqlite(dbPath);
    raw.exec('DROP TABLE citations_fts');
    raw.exec('DROP TABLE chunks');
    raw.exec("DELETE FROM sqlite_sequence WHERE name = 'chunks'");
    raw.pragma('user_version = 1');
    raw.close();

    const reopened = new Database(dbPath);
    const { results } = reopened.searchFts('prehistoric');
    expect(results.map((r) => r.citation.doi)).toEqual(['10.1/m.2']);
    reopened.close();
  });

  describe('manifestations', () => {
    test('upsert refreshes without nulling previously recorded fields', () => {
      const db = new Database(dbPath);
      const citation = db.addCitation({ doi: '10.1/m.3', title: 'Hashed' });

      const id = db.upsertManifestation({
        citationId: citation.id!,
        kind: 'markdown-extracted',
        path: '/tmp/x.md',
        contentHash: 'hash-1',
        extractorName: 'pdf2md',
        extractorVersion: '0.2.6',
      });
      // Second writer knows only the path — hash/extractor must survive.
      const idAgain = db.upsertManifestation({
        citationId: citation.id!,
        kind: 'markdown-extracted',
        path: '/tmp/x.md',
      });

      expect(idAgain).toBe(id);
      const stored = db.getManifestation(citation.id!, 'markdown-extracted');
      expect(stored?.contentHash).toBe('hash-1');
      expect(stored?.extractorName).toBe('pdf2md');
      db.close();
    });

    test('derived pdfPath prefers the manifestation over the legacy column', () => {
      const db = new Database(dbPath);
      const citation = db.addCitation({ doi: '10.1/m.4', title: 'Derived' });

      expect(db.getCitation('10.1/m.4')?.pdfPath).toBeUndefined();

      db.updatePdfPath('10.1/m.4', '/papers/pdf/derived.pdf');
      expect(db.getCitation('10.1/m.4')?.pdfPath).toBe('/papers/pdf/derived.pdf');

      // A newer manifestation wins over the stale legacy column.
      db.upsertManifestation({
        citationId: citation.id!,
        kind: 'pdf',
        path: '/papers/pdf/moved.pdf',
      });
      expect(db.getCitation('10.1/m.4')?.pdfPath).toBe('/papers/pdf/moved.pdf');
      db.close();
    });
  });
});

import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';

const BetterSqlite3 = require('better-sqlite3');

function makeTestDb(): { db: Database; dbPath: string } {
  const dbPath = path.join(
    os.homedir(),
    '.citation-needed-test',
    `db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = new Database(dbPath);
  return { db, dbPath };
}

describe('Database', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = makeTestDb());
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterAll(() => {
    const dir = path.join(os.homedir(), '.citation-needed-test');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('addCitation inserts a new citation', () => {
    const citation = {
      doi: '10.1234/test.001',
      title: 'Test Paper',
      authors: 'Jane Doe',
      year: 2024,
      journal: 'Journal of Tests',
    };
    const result = db.addCitation(citation);
    expect(result).toBeDefined();
    expect(result.doi).toBe(citation.doi);
    expect(result.title).toBe(citation.title);
  });

  test('getCitation returns citation by DOI', () => {
    const doi = '10.1234/test.002';
    db.addCitation({ doi, title: 'Another Paper' });
    const found = db.getCitation(doi);
    expect(found).toBeDefined();
    expect(found?.doi).toBe(doi);
    expect(found?.title).toBe('Another Paper');
  });

  test('getCitation returns undefined for unknown DOI', () => {
    const result = db.getCitation('10.0000/does.not.exist');
    expect(result).toBeUndefined();
  });

  test('addCitation ignores duplicate DOIs (INSERT OR IGNORE)', () => {
    const doi = '10.1234/test.dup';
    db.addCitation({ doi, title: 'First' });
    db.addCitation({ doi, title: 'Second' });
    const found = db.getCitation(doi);
    expect(found?.title).toBe('First');
  });

  test('getAllCitations returns all records', () => {
    db.addCitation({ doi: '10.1/a', title: 'A' });
    db.addCitation({ doi: '10.1/b', title: 'B' });
    const all = db.getAllCitations();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test('migrates legacy citation tables with unexpected columns', () => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const legacyDb = new BetterSqlite3(dbPath);
    legacyDb.exec(`
      CREATE TABLE citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doi TEXT UNIQUE,
        url TEXT,
        title TEXT,
        authors TEXT,
        year INTEGER,
        journal TEXT,
        bibtex_key TEXT,
        pdf_path TEXT,
        legacy_flag TEXT,
        verification_status TEXT DEFAULT 'unverified',
        access_type TEXT DEFAULT 'unknown',
        last_verified TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO citations (
        doi,
        title,
        verification_status,
        access_type,
        created_at,
        updated_at,
        legacy_flag
      ) VALUES (
        '10.1234/legacy',
        'Legacy Paper',
        'verified',
        'unknown',
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
        'old'
      );
      CREATE TABLE legacy_events (id INTEGER PRIMARY KEY AUTOINCREMENT);
    `);
    legacyDb.close();

    db = new Database(dbPath);

    const citation = db.getCitation('10.1234/legacy');
    expect(citation?.title).toBe('Legacy Paper');
    expect(citation?.verificationStatus).toBe('verified');
  });

  test('updatePdfPath stores the path', () => {
    const doi = '10.1234/test.pdf';
    db.addCitation({ doi });
    db.updatePdfPath(doi, '/home/test/paper.pdf');
    const citation = db.getCitation(doi);
    expect(citation?.pdfPath).toBe('/home/test/paper.pdf');
  });

  test('updateVerificationStatus updates the status', () => {
    const doi = '10.1234/test.verify';
    db.addCitation({ doi });
    db.updateVerificationStatus(doi, 'verified');
    const citation = db.getCitation(doi);
    expect(citation?.verificationStatus).toBe('verified');
  });

  test('updateAccessType updates the access type', () => {
    const doi = '10.1234/test.access';
    db.addCitation({ doi });
    db.updateAccessType(doi, 'open-access');
    const citation = db.getCitation(doi);
    expect(citation?.accessType).toBe('open-access');
  });

  test('searchCitations finds by title', () => {
    db.addCitation({ doi: '10.1/search1', title: 'Neural Networks in Practice' });
    db.addCitation({ doi: '10.1/search2', title: 'Quantum Computing' });
    const results = db.searchCitations('neural');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain('Neural');
  });
});

import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../db/index';

const TEST_DB_DIR = path.join(os.homedir(), '.sober-sources-test');
const TEST_DB_PATH = path.join(TEST_DB_DIR, `test-${Date.now()}.db`);

let db: Database;

beforeEach(() => {
  db = new Database(TEST_DB_PATH);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

afterAll(() => {
  if (fs.existsSync(TEST_DB_DIR)) {
    fs.rmdirSync(TEST_DB_DIR, { recursive: true });
  }
});

describe('Database', () => {
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
    db.addCitation({ doi, title: 'Second' }); // should be ignored

    const found = db.getCitation(doi);
    expect(found?.title).toBe('First');
  });

  test('getAllCitations returns all records', () => {
    db.addCitation({ doi: '10.1/a', title: 'A' });
    db.addCitation({ doi: '10.1/b', title: 'B' });

    const all = db.getAllCitations();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test('updateTrustScore changes the score and records event', () => {
    const doi = '10.1234/test.trust';
    db.addCitation({ doi, title: 'Trust Paper' });
    db.updateTrustScore(doi, 0.9, 'great paper', 'agent-1');

    const updated = db.getCitation(doi);
    expect(updated?.trustScore).toBeCloseTo(0.9);

    const history = db.getTrustHistory(doi);
    expect(history.length).toBe(1);
    expect(history[0].eventType).toBe('score_update');
    expect(history[0].notes).toBe('great paper');
    expect(history[0].agentId).toBe('agent-1');
  });

  test('getTrustHistory returns empty array for unknown DOI', () => {
    const history = db.getTrustHistory('10.0000/nope');
    expect(history).toEqual([]);
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
});

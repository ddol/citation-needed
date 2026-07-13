import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { normalizeForMatch, VerifyQuoteService } from '../../../src/services/verify-quote';

function makeTestDb(): { db: Database; dbPath: string } {
  const dbPath = path.join(
    os.homedir(),
    '.citation-needed-test',
    `svc-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = new Database(dbPath);
  return { db, dbPath };
}

describe('normalizeForMatch', () => {
  test('folds ligatures, curly quotes, and unicode dashes', () => {
    expect(normalizeForMatch('The “ﬁrst” — result')).toBe('the "first" - result');
  });

  test('re-joins words split by line-break hyphenation', () => {
    expect(normalizeForMatch('trajectory classi-\nfication works')).toBe(
      'trajectory classification works'
    );
  });

  test('collapses whitespace runs and lowercases', () => {
    expect(normalizeForMatch('  A\n B\t\tC ')).toBe('a b c');
  });
});

describe('VerifyQuoteService', () => {
  let db: Database;
  let dbPath: string;
  let root: string;

  const SOURCE_TEXT =
    '# Anomaly Detection\n\n' +
    'Our classi-\nfication of “trajectory anomalies” uses lidar point clouds\n' +
    'collected at urban intersections over two years of observation.\n';

  beforeEach(() => {
    ({ db, dbPath } = makeTestDb());
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-verify-'));
    fs.mkdirSync(path.join(root, 'papers', 'pdf'), { recursive: true });
    fs.mkdirSync(path.join(root, 'papers', 'markdown'), { recursive: true });

    db.addCitation({ doi: '10.1/v.1', title: 'Anomaly Detection', bibtexKey: 'anomaly2024' });
    db.updatePdfPath('10.1/v.1', path.join(root, 'papers', 'pdf', 'anomaly2024.pdf'));
    fs.writeFileSync(path.join(root, 'papers', 'markdown', 'anomaly2024.md'), SOURCE_TEXT);
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

  test('verifies a quote across hyphenation and typography differences', () => {
    const result = new VerifyQuoteService(db).verify({
      quote: 'classification of "trajectory anomalies" uses lidar',
      doi: '10.1/v.1',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.response.verdict).toBe('exact');
    expect(result.response.matches).toHaveLength(1);
    expect(result.response.matches[0]).toMatchObject({ doi: '10.1/v.1', similarity: 1 });
    expect(result.response.matches[0].snippet).toContain('classification');
  });

  test('returns not-found for a fabricated quote', () => {
    const result = new VerifyQuoteService(db).verify({
      quote: 'quantum blockchain synergy paradigm',
      doi: '10.1/v.1',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.response.verdict).toBe('not-found');
    expect(result.response.matches).toHaveLength(0);
  });

  test('searches the whole corpus when doi is omitted, skipping markdown-less rows', () => {
    db.addCitation({ doi: '10.1/v.2', title: 'No markdown here' });

    const result = new VerifyQuoteService(db).verify({
      quote: 'collected at urban intersections',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.response.verdict).toBe('exact');
    expect(result.response.matches.map((m) => m.doi)).toEqual(['10.1/v.1']);
  });

  test('guards against too-short quotes', () => {
    expect(new VerifyQuoteService(db).verify({ quote: 'short' }).status).toBe('quote-too-short');
  });

  test('reports unknown DOI and missing markdown distinctly', () => {
    const service = new VerifyQuoteService(db);

    expect(
      service.verify({ quote: 'collected at urban intersections', doi: '10.1/absent' }).status
    ).toBe('unknown-doi');

    db.addCitation({ doi: '10.1/v.3', title: 'PDF only', bibtexKey: 'pdfonly' });
    db.updatePdfPath('10.1/v.3', path.join(root, 'papers', 'pdf', 'pdfonly.pdf'));
    expect(
      service.verify({ quote: 'collected at urban intersections', doi: '10.1/v.3' }).status
    ).toBe('no-markdown');
  });
});

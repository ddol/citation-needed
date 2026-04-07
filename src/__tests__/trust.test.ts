import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../db/index';
import { TrustScorer } from '../trust/scorer';

const TEST_DB_PATH = path.join(
  os.homedir(),
  '.sober-sources-test',
  `trust-test-${Date.now()}.db`
);

let db: Database;
let scorer: TrustScorer;

beforeEach(() => {
  db = new Database(TEST_DB_PATH);
  scorer = new TrustScorer(db);
  // Add a test citation
  db.addCitation({
    doi: '10.1234/trust.test',
    title: 'Trust Scoring Test Paper about neural networks and deep learning',
    authors: 'Test Author',
    year: 2024,
  });
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

afterAll(() => {
  const dir = path.join(os.homedir(), '.sober-sources-test');
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir, { recursive: true });
  }
});

describe('TrustScorer', () => {
  test('calculateScore returns default 0.5 for new citation', async () => {
    const score = await scorer.calculateScore('10.1234/trust.test');
    expect(score).toBeCloseTo(0.5);
  });

  test('calculateScore returns 0.5 for unknown DOI', async () => {
    const score = await scorer.calculateScore('10.0000/unknown');
    expect(score).toBeCloseTo(0.5);
  });

  test('updateScore applies delta and returns new score', async () => {
    const newScore = await scorer.updateScore(
      '10.1234/trust.test',
      0.2,
      'positive feedback',
      'test-agent'
    );
    expect(newScore).toBeCloseTo(0.7);
  });

  test('updateScore clamps score to maximum 1.0', async () => {
    await scorer.updateScore('10.1234/trust.test', 0.4, 'boost', 'agent');
    const finalScore = await scorer.updateScore(
      '10.1234/trust.test',
      0.4,
      'boost again',
      'agent'
    );
    expect(finalScore).toBeLessThanOrEqual(1.0);
  });

  test('updateScore clamps score to minimum 0.0', async () => {
    await scorer.updateScore('10.1234/trust.test', -0.4, 'penalty', 'agent');
    const finalScore = await scorer.updateScore(
      '10.1234/trust.test',
      -0.4,
      'penalty again',
      'agent'
    );
    expect(finalScore).toBeGreaterThanOrEqual(0.0);
  });

  test('getTrustLevel returns high for score >= 0.7', () => {
    expect(scorer.getTrustLevel(0.7)).toBe('high');
    expect(scorer.getTrustLevel(0.9)).toBe('high');
    expect(scorer.getTrustLevel(1.0)).toBe('high');
  });

  test('getTrustLevel returns medium for score 0.4-0.7', () => {
    expect(scorer.getTrustLevel(0.4)).toBe('medium');
    expect(scorer.getTrustLevel(0.55)).toBe('medium');
    expect(scorer.getTrustLevel(0.69)).toBe('medium');
  });

  test('getTrustLevel returns low for score > 0 and < 0.4', () => {
    expect(scorer.getTrustLevel(0.1)).toBe('low');
    expect(scorer.getTrustLevel(0.39)).toBe('low');
  });

  test('getTrustLevel returns unverified for score 0', () => {
    expect(scorer.getTrustLevel(0)).toBe('unverified');
  });

  test('verifyAndScore with matching PDF content increases score', async () => {
    const pdfContent =
      'This paper is about neural networks and deep learning models used in practice.';
    const result = await scorer.verifyAndScore(
      '10.1234/trust.test',
      'neural networks deep learning',
      pdfContent
    );
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('verified');
    expect(result).toHaveProperty('notes');
    expect(typeof result.score).toBe('number');
  });

  test('verifyAndScore with no PDF returns result without crash', async () => {
    const result = await scorer.verifyAndScore(
      '10.1234/trust.test',
      'some claim without PDF',
      undefined
    );
    expect(result).toHaveProperty('score');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('verifyAndScore for unknown DOI returns score 0', async () => {
    const result = await scorer.verifyAndScore(
      '10.0000/not-found',
      'some claim'
    );
    expect(result.score).toBe(0);
    expect(result.verified).toBe(false);
  });
});

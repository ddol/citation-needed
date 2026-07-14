import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database, toFtsQuery } from '../../../src/db/index';
import { CHUNKER_VERSION } from '../../../src/services/chunker';

const RawSqlite = require('better-sqlite3');

describe('toFtsQuery', () => {
  test('quotes each token (implicit AND) and strips embedded quotes', () => {
    expect(toFtsQuery('lidar NEAR anomaly*')).toBe('"lidar" "NEAR" "anomaly*"');
    expect(toFtsQuery('say "hi" there')).toBe('"say" "hi" "there"');
  });

  test('keeps a fully quoted query as one phrase', () => {
    expect(toFtsQuery('"trajectory anomaly detection"')).toBe('"trajectory anomaly detection"');
  });
});

describe('Database.searchFts', () => {
  let dir: string;
  let db: Database;

  function seed(doi: string, title: string, body?: string, sectionPath: string[] = ['Methods']) {
    const citation = db.addCitation({ doi, title, bibtexKey: doi.replace(/\W/g, '') });
    if (body) {
      const manifestationId = db.upsertManifestation({
        citationId: citation.id!,
        kind: 'markdown-extracted',
        path: `/virtual/${citation.id}.md`,
        contentHash: `hash-${citation.id}`,
      });
      db.replaceChunks({
        manifestationId,
        citationId: citation.id!,
        contentHash: `hash-${citation.id}`,
        chunkerVersion: CHUNKER_VERSION,
        chunks: [{ ordinal: 0, sectionPath, text: body }],
      });
    }
    return citation;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fts-'));
    db = new Database(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('matches body text with snippet and section provenance', () => {
    seed('10.1/f.1', 'Unrelated Title', 'The trajectory classifier uses lidar point clouds.', [
      'Methods',
      'Classification',
    ]);
    seed('10.1/f.2', 'Also Unrelated', 'Nothing relevant here at all.');

    const { results, hasMore } = db.searchFts('lidar');

    expect(hasMore).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0].citation.doi).toBe('10.1/f.1');
    expect(results[0].matches[0].sectionPath).toEqual(['Methods', 'Classification']);
    expect(results[0].matches[0].snippet).toContain('<b>lidar</b>');
  });

  test('porter stemming matches inflected forms', () => {
    seed('10.1/f.3', 'Stemming', 'We evaluate several classifiers on the corpus.');

    const { results } = db.searchFts('classifier');
    expect(results.map((r) => r.citation.doi)).toEqual(['10.1/f.3']);
  });

  test('phrase queries only match adjacent terms', () => {
    seed('10.1/f.4', 'Phrase A', 'anomaly detection at intersections');
    seed('10.1/f.5', 'Phrase B', 'detection of any anomaly whatsoever');

    const phrase = db.searchFts('"anomaly detection"');
    expect(phrase.results.map((r) => r.citation.doi)).toEqual(['10.1/f.4']);

    const both = db.searchFts('anomaly detection');
    expect(both.results.map((r) => r.citation.doi).sort()).toEqual(['10.1/f.4', '10.1/f.5']);
  });

  test('matches unicode text and metadata fields including doi', () => {
    seed('10.1/f.6', 'Éléments de trajectoire', 'Analyse des données de trafic à Zürich.');

    expect(db.searchFts('zürich').results.map((r) => r.citation.doi)).toEqual(['10.1/f.6']);
    expect(db.searchFts('"10.1/f.6"').results.map((r) => r.citation.doi)).toEqual(['10.1/f.6']);
  });

  test('metadata-only hits rank alongside body hits and paginate by offset', () => {
    seed('10.1/f.7', 'Lidar Survey', undefined);
    seed('10.1/f.8', 'Other Title', 'lidar lidar lidar everywhere in the body.');

    const page1 = db.searchFts('lidar', { limit: 1, offset: 0 });
    expect(page1.results).toHaveLength(1);
    expect(page1.hasMore).toBe(true);

    const page2 = db.searchFts('lidar', { limit: 1, offset: 1 });
    expect(page2.results).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    const dois = [...page1.results, ...page2.results].map((r) => r.citation.doi).sort();
    expect(dois).toEqual(['10.1/f.7', '10.1/f.8']);
  });

  test('sync triggers keep the index consistent through update, delete, and cascade', () => {
    const citation = seed('10.1/f.9', 'Trigger Test', 'original searchable body');
    const raw = new RawSqlite(path.join(dir, 'test.db'));

    // Row updates flow through to the index.
    raw
      .prepare("UPDATE chunks SET text = 'replacement searchable body' WHERE citation_id = ?")
      .run(citation.id);
    raw
      .prepare("UPDATE citations SET title = 'Renamed Trigger Test' WHERE id = ?")
      .run(citation.id);
    raw.close();

    expect(db.searchFts('replacement').results).toHaveLength(1);
    expect(db.searchFts('original').results).toHaveLength(0);
    expect(db.searchFts('renamed').results).toHaveLength(1);

    // Cascade delete removes chunks and keeps both FTS tables consistent.
    db.transaction(() => {
      const handle = (db as unknown as { db: { prepare(sql: string): { run(v: unknown): void } } })
        .db;
      handle.prepare('DELETE FROM citations WHERE id = ?').run(citation.id);
    });
    expect(db.searchFts('replacement').results).toHaveLength(0);

    const verify = new RawSqlite(path.join(dir, 'test.db'));
    expect(() =>
      verify.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')")
    ).not.toThrow();
    expect(() =>
      verify.exec("INSERT INTO citations_fts(citations_fts) VALUES('integrity-check')")
    ).not.toThrow();
    verify.close();
  });
});

import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { SearchService } from '../../../src/services/search';

// Each suite gets its own temp dir so parallel jest workers never race on a
// shared cleanup path.
function makeTestDb(): { db: Database; dbDir: string } {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-svc-search-'));
  const db = new Database(path.join(dbDir, 'test.db'));
  return { db, dbDir };
}

describe('SearchService', () => {
  let db: Database;
  let dbDir: string;

  beforeEach(() => {
    ({ db, dbDir } = makeTestDb());
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  test('returns trimmed summaries with matched fields', () => {
    db.addCitation({
      doi: '10.1/s.1',
      title: 'Lidar Trajectories',
      authors: 'Ada Lovelace',
      year: 2024,
      journal: 'J Traffic',
      bibtexKey: 'lovelace2024',
    });
    db.addCitation({ doi: '10.1/s.2', title: 'Unrelated', authors: 'Bob' });

    const { results, nextCursor } = new SearchService(db).search({ query: 'lidar' });

    expect(results).toHaveLength(1);
    expect(results[0].citation).toEqual({
      doi: '10.1/s.1',
      title: 'Lidar Trajectories',
      year: 2024,
      journal: 'J Traffic',
      verificationStatus: 'unverified',
    });
    expect(results[0].matchedFields).toEqual(['title']);
    expect(nextCursor).toBeUndefined();
  });

  test('matchedFields reports every matching field', () => {
    db.addCitation({
      doi: '10.1/smith',
      title: 'Smith Methods',
      authors: 'J. Smith',
      bibtexKey: 'smith2020',
    });

    const { results } = new SearchService(db).search({ query: 'smith' });

    expect(results[0].matchedFields).toEqual(['title', 'authors', 'bibtexKey', 'doi']);
  });

  test('includes body-match snippets with provenance once chunks exist', () => {
    const citation = db.addCitation({ doi: '10.1/s.3', title: 'Chunky', bibtexKey: 'chunky2024' });
    const manifestationId = db.upsertManifestation({
      citationId: citation.id!,
      kind: 'markdown-extracted',
      path: '/virtual/chunky.md',
      contentHash: 'hash-chunky',
    });
    db.replaceChunks({
      manifestationId,
      citationId: citation.id!,
      contentHash: 'hash-chunky',
      chunkerVersion: 1,
      chunks: [{ ordinal: 0, sectionPath: ['Intro'], text: 'grounded retrieval with snippets' }],
    });

    const { results } = new SearchService(db).search({ query: 'snippets' });

    expect(results).toHaveLength(1);
    expect(results[0].citation.doi).toBe('10.1/s.3');
    expect(results[0].matches?.[0].snippet).toContain('<b>');
    expect(results[0].matches?.[0].sectionPath).toEqual(['Intro']);
  });

  test('paginates via cursor without duplicates', () => {
    for (let i = 0; i < 3; i += 1) {
      db.addCitation({ doi: `10.1/c.${i}`, title: `Common Term ${i}` });
    }
    const service = new SearchService(db);

    const first = service.search({ query: 'common', limit: 2 });
    expect(first.results).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();

    const second = service.search({ query: 'common', limit: 2, cursor: first.nextCursor });
    expect(second.results).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();

    const dois = [...first.results, ...second.results].map((r) => r.citation.doi);
    expect(new Set(dois).size).toBe(3);
  });
});

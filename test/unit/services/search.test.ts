import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { SearchService } from '../../../src/services/search';

function makeTestDb(): { db: Database; dbPath: string } {
  const dbPath = path.join(
    os.homedir(),
    '.citation-needed-test',
    `svc-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = new Database(dbPath);
  return { db, dbPath };
}

describe('SearchService', () => {
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

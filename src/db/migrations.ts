// Versioned schema migrations driven by PRAGMA user_version. The three
// pre-existing ad-hoc migrators in Database.initSchema remain as bootstrap
// (they are idempotent); every new schema change goes through this list.

export interface MigrationDb {
  exec(sql: string): unknown;
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: () => T): () => T;
}

export interface Migration {
  version: number; // PRAGMA user_version after this migration applies
  name: string;
  up(db: MigrationDb): void;
}

export const CREATE_MANIFESTATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS manifestations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('pdf', 'markdown-extracted')),
    path TEXT NOT NULL,
    content_hash TEXT,
    extractor_name TEXT,
    extractor_version TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    UNIQUE (citation_id, kind, path)
  );
  CREATE INDEX IF NOT EXISTS idx_manifestations_citation_id
    ON manifestations (citation_id);
`;

export const CREATE_CHUNKS_SQL = `
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    manifestation_id INTEGER NOT NULL REFERENCES manifestations(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    section_path TEXT,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    chunker_version INTEGER NOT NULL,
    UNIQUE (manifestation_id, ordinal)
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_citation_id ON chunks (citation_id);
`;

// External-content FTS5 tables kept in sync by triggers (the standard
// pattern): text is stored once, in chunks/citations. Everything uses
// IF NOT EXISTS so ensureFtsSchema() can also run defensively on every open —
// the legacy table-rebuild bootstrap drops `citations` (and with it the
// triggers), so re-creating missing triggers idempotently keeps the index in
// sync no matter the order things happened in.
export const CREATE_FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
  END;

  CREATE VIRTUAL TABLE IF NOT EXISTS citations_fts USING fts5(
    title, authors, journal, bibtex_key, doi,
    content='citations',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS citations_fts_ai AFTER INSERT ON citations BEGIN
    INSERT INTO citations_fts(rowid, title, authors, journal, bibtex_key, doi)
    VALUES (new.id, new.title, new.authors, new.journal, new.bibtex_key, new.doi);
  END;
  CREATE TRIGGER IF NOT EXISTS citations_fts_ad AFTER DELETE ON citations BEGIN
    INSERT INTO citations_fts(citations_fts, rowid, title, authors, journal, bibtex_key, doi)
    VALUES ('delete', old.id, old.title, old.authors, old.journal, old.bibtex_key, old.doi);
  END;
  CREATE TRIGGER IF NOT EXISTS citations_fts_au AFTER UPDATE ON citations BEGIN
    INSERT INTO citations_fts(citations_fts, rowid, title, authors, journal, bibtex_key, doi)
    VALUES ('delete', old.id, old.title, old.authors, old.journal, old.bibtex_key, old.doi);
    INSERT INTO citations_fts(rowid, title, authors, journal, bibtex_key, doi)
    VALUES (new.id, new.title, new.authors, new.journal, new.bibtex_key, new.doi);
  END;
`;

export function ensureFtsSchema(db: MigrationDb): void {
  db.exec(CREATE_FTS_SQL);
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'manifestations',
    up(db) {
      db.exec(CREATE_MANIFESTATIONS_SQL);
    },
  },
  {
    version: 2,
    name: 'chunks-and-fts',
    up(db) {
      db.exec(CREATE_CHUNKS_SQL);
      ensureFtsSchema(db);
      // Index pre-existing rows. External-content FTS tables delegate plain
      // row reads to their content table, so the only reliable backfill is
      // the 'rebuild' command, which regenerates the index from the content
      // table (and is idempotent).
      db.exec(`
        INSERT INTO citations_fts(citations_fts) VALUES('rebuild');
        INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
      `);
    },
  },
];

export function runMigrations(db: MigrationDb): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations
    .filter((migration) => migration.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

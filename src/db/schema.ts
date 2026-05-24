// Keep these enum lists aligned with src/models/citation.ts.
// They drive CHECK constraints on the citations table.
export const VERIFICATION_STATUSES = [
  'unverified',
  'downloaded',
  'verified',
  'failed',
  'not-found',
] as const;

export const ACCESS_TYPES = ['open-access', 'institutional', 'unknown'] as const;

const verificationCheck = VERIFICATION_STATUSES.map((s) => `'${s}'`).join(',');
const accessTypeCheck = ACCESS_TYPES.map((s) => `'${s}'`).join(',');

export const CREATE_CITATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doi TEXT UNIQUE,
    url TEXT,
    title TEXT,
    authors TEXT,
    year INTEGER,
    journal TEXT,
    bibtex_key TEXT,
    pdf_path TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified'
      CHECK (verification_status IN (${verificationCheck})),
    access_type TEXT NOT NULL DEFAULT 'unknown'
      CHECK (access_type IN (${accessTypeCheck})),
    last_verified TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;

export const CREATE_RETRIEVAL_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS retrieval_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citation_id INTEGER NOT NULL
      REFERENCES citations(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    url TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  )`;

export const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_citations_doi ON citations(doi)',
  'CREATE INDEX IF NOT EXISTS idx_citations_created_at ON citations(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_retrieval_log_citation_id ON retrieval_log(citation_id)',
];

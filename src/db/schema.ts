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
    trust_score REAL DEFAULT 0.5,
    verification_status TEXT DEFAULT 'unverified',
    access_type TEXT DEFAULT 'unknown',
    last_verified TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;

export const CREATE_TRUST_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS trust_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citation_id INTEGER NOT NULL REFERENCES citations(id),
    event_type TEXT NOT NULL,
    score_delta REAL NOT NULL DEFAULT 0,
    notes TEXT,
    agent_id TEXT,
    created_at TEXT NOT NULL
  )`;

export const CREATE_RETRIEVAL_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS retrieval_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citation_id INTEGER NOT NULL REFERENCES citations(id),
    source TEXT NOT NULL,
    url TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  )`;

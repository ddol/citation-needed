// DoiResolver is deliberately absent: nothing in the cascade calls it, and a
// barrel export makes it look scheduled. Import it from './doi' directly when
// Crossref metadata enrichment lands (see docs/plans/retrieval-pipeline.md).
export { ArxivResolver } from './arxiv';
export type { ArxivResult } from './arxiv';
export { UnpaywallResolver } from './unpaywall';

/**
 * Shared title matching for every retrieval source.
 *
 * A returned result is a *candidate*, not a match: arXiv ranks by relevance and
 * always answers with something, and DOI-keyed aggregators occasionally carry
 * bad metadata (Semantic Scholar offered `koval2013precontact.pdf` for Held
 * 2016). Downloading an unverified candidate is silent corruption, so every
 * source checks the title before we trust it.
 */

/**
 * Title search (arXiv): the title is the *only* evidence of identity, so the
 * bar is near-exact. Below this, "Attention Is All You Need" would accept
 * "Not All Attention Is All You Need".
 */
export const TITLE_SEARCH_THRESHOLD = 0.9;

/**
 * DOI lookup (Unpaywall, Semantic Scholar): the DOI already establishes
 * identity, so the title is only a guard against grossly wrong upstream
 * metadata. Holding these to 0.9 rejects real matches whose BibTeX subtitle is
 * abbreviated — "Patchwork: ...with Tilted LiDAR" vs the full published title
 * scores 0.65 and is the same paper.
 */
export const DOI_LOOKUP_THRESHOLD = 0.5;

/**
 * Collapse a title to comparable form: LaTeX braces, punctuation, case and
 * whitespace all vary between BibTeX and upstream metadata for the same paper.
 */
function normalizeForCompare(title: string): string {
  return title
    .replace(/[{}\\]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** 1 = identical after normalization, 0 = nothing in common. */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const longest = Math.max(left.length, right.length);
  return (longest - levenshtein(left, right)) / longest;
}

export function isTitleMatch(expected: string, actual: string, threshold: number): boolean {
  return titleSimilarity(expected, actual) >= threshold;
}

/** Best candidate at or above `threshold`, or undefined if none qualifies. */
export function selectBestMatch<T>(
  expectedTitle: string,
  candidates: T[],
  getTitle: (candidate: T) => string,
  threshold: number
): T | undefined {
  let best: T | undefined;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = titleSimilarity(expectedTitle, getTitle(candidate));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= threshold ? best : undefined;
}

/** Normalizes a DOI string (strips URL prefix, whitespace, etc.) */
export function normalizeDoi(doi: string): string {
  const trimmed = doi.trim();
  // Strip common URL prefixes
  const stripped = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
  return stripped;
}

/** Returns true if the string looks like a valid DOI */
export function isValidDoi(doi: string): boolean {
  const normalized = normalizeDoi(doi);
  // DOIs start with 10. followed by registrant code and suffix
  return /^10\.\d{4,}(\.\d+)*\/\S+/.test(normalized);
}

/** Extracts DOI from a URL like https://doi.org/10.1234/abc */
export function extractDoiFromUrl(url: string): string | null {
  const match = /(?:https?:\/\/(?:dx\.)?doi\.org\/)(10\.\S+)/i.exec(url);
  if (match) return match[1];
  const doiMatch = /(10\.\d{4,}(\.\d+)*\/\S+)/.exec(url);
  return doiMatch ? doiMatch[1] : null;
}

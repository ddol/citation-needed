/**
 * Heading recovery from `pdftotext -layout`.
 *
 * pdf2md loses section structure: headings arrive welded into the surrounding
 * prose ("… patchwork-plusplus I. INTRODUCTION Recently, mobile robots …"), so
 * a paper can end up with three headings instead of twenty. The layout text
 * still has each heading on its own line, which makes it a reliable source —
 * once two artefacts are handled:
 *
 * - **Small caps**: a heading set in small caps extracts as `I. I NTRODUCTION`
 *   / `R ELATED W ORKS`, with a space after each leading capital.
 * - **Two-column bleed**: `-layout` puts the adjacent column on the same line,
 *   so `II. R ELATED W ORKS      of interest in object clustering …`. Only the
 *   first whitespace-separated column is the heading.
 */

export interface LayoutHeading {
  /** Normalized heading text, e.g. `II. RELATED WORKS`. */
  text: string;
  /** Markdown level: 2 for top-level sections, 3 for lettered/decimal subsections. */
  level: number;
  page: number;
}

const MAX_HEADING_LENGTH = 90;
const MAX_HEADING_WORDS = 14;

export function extractLayoutHeadings(layoutText: string): LayoutHeading[] {
  const headings: LayoutHeading[] = [];
  const seen = new Set<string>();

  for (const [index, page] of layoutText.split('\f').entries()) {
    const lines = page.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      // Every column, not just the first: in a two-column paper half the
      // subsection headings live in the right-hand column.
      for (const segment of segmentsWithPositions(lines[i])) {
        const candidate = headingCandidateFromText(joinHyphenContinuation(segment, lines[i + 1]));
        if (!candidate) continue;
        const key = candidate.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        headings.push({ ...candidate, page: index + 1 });

        // Everything after the bibliography heading is reference entries, which
        // mimic numbered sections. Stop once it starts.
        if (/^(?:references|bibliography)\b/i.test(candidate.text)) return headings;
      }
    }
  }

  return headings;
}

interface Segment {
  text: string;
  start: number;
}

/** Columns are separated by runs of two or more spaces. */
function segmentsWithPositions(line: string): Segment[] {
  return Array.from(line.matchAll(/\S+(?: \S+)*/g), (match) => ({
    text: match[0],
    start: match.index!,
  }));
}

/**
 * A heading wrapped mid-word ends in a hyphen ("… Parameters De-"); its tail is
 * the segment starting at roughly the same column on the next line.
 */
function joinHyphenContinuation(segment: Segment, nextLine: string | undefined): string {
  if (!/[A-Za-z]-$/.test(segment.text) || nextLine === undefined) return segment.text;
  const continuation = segmentsWithPositions(nextLine).find(
    (candidate) => Math.abs(candidate.start - segment.start) <= 6
  );
  if (!continuation) return segment.text;
  return `${segment.text.slice(0, -1)}${continuation.text}`;
}

/**
 * The paper title: the leading centred lines of page one, before the author or
 * abstract block. Joined so a title broken across lines becomes one heading.
 */
export function extractLayoutTitle(layoutText: string): string | undefined {
  const firstPage = layoutText.split('\f')[0] ?? '';
  const lines = firstPage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const line of lines.slice(0, 14)) {
    // Skipped, not stopped at: an arXiv stamp is a rotated sidebar that can sit
    // *between* two lines of the title, and journal banners precede it.
    if (isTitleNoiseLine(line)) continue;
    if (isAuthorOrAbstractLine(line)) break;
    if (headingCandidateFromLine(line)) break;
    parts.push(line);
    if (parts.length >= 3) break;
  }

  const title = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (title.length < 8 || title.length > 250) return undefined;
  if (!/[A-Za-z]{3,}/.test(title)) return undefined;
  return title;
}

function isAuthorOrAbstractLine(line: string): boolean {
  return (
    /^(?:abstract\b|index terms|keywords)/i.test(line) ||
    /\b(?:Student|Senior|Life|Fellow)?\s*Member,\s*IEEE\b/i.test(line) ||
    /@/.test(line) ||
    /\b(?:University|Institute|Department|Laboratory|Univ\.)\b/i.test(line) ||
    // "Seungjae Lee1,∗" — a name carrying an affiliation marker.
    /[A-Za-z]{2,}\s*\d\s*[,∗†‡§*]/.test(line) ||
    // "Alex Bewley† , Zongyuan Ge†" — a name carrying a footnote marker.
    /[A-Za-z]{2,}\s*[†‡§∗]/.test(line) ||
    /^\s*(?:and\s+)[A-Z]/.test(line) ||
    looksLikeAuthorList(line)
  );
}

/** "Holger Caesar, Varun Bankiti, Alex H. Lang, …" — three or more person names. */
function looksLikeAuthorList(line: string): boolean {
  const names = line
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^[A-Z][a-zà-ÿ'’-]+(?:\s+[A-Z]\.)*(?:\s+[A-Z][a-zà-ÿ'’-]+)+$/.test(part));
  return names.length >= 3;
}

/** Journal furniture that surrounds — and sometimes interrupts — the title. */
function isTitleNoiseLine(line: string): boolean {
  const text = normalizeSmallCaps(line);
  return (
    /^arXiv:/i.test(text) ||
    /^https?:\/\//i.test(text) ||
    /^(?:REVIEW|RESEARCH|ORIGINAL|SURVEY|ARTICLE|LETTER|EDITORIAL|Open Access)\b/i.test(text) ||
    /\b(?:Journal|Proceedings|Transactions)\b.*\b(?:19|20)\d{2}\b/.test(text) ||
    /^\d+$/.test(text)
  );
}

function headingCandidateFromLine(raw: string): { text: string; level: number } | undefined {
  const segment = firstColumnSegment(raw);
  if (!segment) return undefined;
  return headingCandidateFromText(segment);
}

function headingCandidateFromText(segment: string): { text: string; level: number } | undefined {
  const text = normalizeSmallCaps(segment);
  if (text.length > MAX_HEADING_LENGTH) return undefined;
  if (looksLikeReferenceEntry(text)) return undefined;

  const roman = text.match(/^(X{0,3}(?:IX|IV|V?I{1,3}|V))\.\s+(\S.*)$/);
  if (roman && isSectionTitleText(roman[2])) return { text, level: 2 };

  const decimal = text.match(/^\d+\.\d+(?:\.\d+)?\.?\s+(\S.*)$/);
  if (decimal && isSectionTitleText(decimal[1])) return { text, level: 3 };

  const arabic = text.match(/^\d{1,2}\.?\s+(\S.*)$/);
  if (arabic && isSectionTitleText(arabic[1])) return { text, level: 2 };

  const letter = text.match(/^([A-Z])\.\s+([A-Z]\S.*)$/);
  if (letter && isSectionTitleText(letter[2])) return { text, level: 3 };

  if (/^(?:ABSTRACT|REFERENCES|ACKNOWLEDGE?MENTS?|APPENDIX|CONCLUSIONS?)\b[:.]?$/i.test(text)) {
    return { text, level: 2 };
  }

  return undefined;
}

/**
 * A bibliography entry mimics a lettered heading ("N. Kawaguchi, “A slope-robust
 * cascaded ground segmentation …"): an initial, a surname, then a comma or a
 * quoted title.
 */
function looksLikeReferenceEntry(text: string): boolean {
  if (/["“”]/.test(text)) return true;
  // Springer style: "1. Rajamani R (2006) Vehicle dynamics and control."
  if (/\((?:19|20)\d{2}[a-z]?\)/.test(text)) return true;
  return /^[A-Z]\.\s+[A-Z][a-z]+,/.test(text);
}

const TITLE_CASE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'via',
  'with',
]);

/**
 * Headings are title-cased or all-caps; enumerated prose is not. This is what
 * separates a real section ("3. Lane Graph Representations") from a numbered
 * list item ("3. Interaction-aware motion models take into account").
 */
function isTitleCased(text: string): boolean {
  if (/[a-z]/.test(text) === false) return true; // ALL CAPS heading
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => /[A-Za-z]/.test(word))
    .filter((word) => !TITLE_CASE_STOPWORDS.has(word.toLowerCase().replace(/[^a-z-]/g, '')));
  if (words.length === 0) return false;
  const capitalized = words.filter((word) => /^[("']?[A-Z0-9]/.test(word)).length;
  return capitalized / words.length >= 0.7;
}

/** Only the first whitespace-separated column; the rest is the neighbouring column. */
function firstColumnSegment(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const [first] = trimmed.split(/\s{2,}/);
  return first?.trim() || undefined;
}

/** `R ELATED W ORKS` → `RELATED WORKS`; applied until stable. */
export function normalizeSmallCaps(text: string): string {
  // Typographic ligatures survive extraction in one source but not the other
  // ("Diﬀerent" vs "Different"), so fold them before any comparison.
  let current = text
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl');
  for (let i = 0; i < 8; i += 1) {
    const next = current.replace(/\b([A-Z]) ([A-Z]{2,})/g, '$1$2');
    if (next === current) break;
    current = next;
  }
  return current
    .replace(/([A-Za-z])\s+(\+\+)/g, '$1$2') // "PATCHWORK ++" → "PATCHWORK++"
    .replace(/\s+/g, ' ')
    .trim();
}

function isSectionTitleText(title: string): boolean {
  const text = title.trim();
  if (text.length < 3 || text.length > MAX_HEADING_LENGTH) return false;
  if (!/^[A-Z(]/.test(text)) return false;
  // Headings are not sentences.
  if (/[.!?]$/.test(text) && !/\b[A-Z]\.$/.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > MAX_HEADING_WORDS) return false;
  if (!/[A-Za-z]{3,}/.test(text)) return false;
  // Postcodes and street numbers mark an affiliation line, not a heading.
  if (/\b\d{3,}\b/.test(text)) return false;
  if (looksLikeAffiliation(text)) return false;
  // Chart axis labels ("Megvii 0.2", "MonoDIS0.8") carry a decimal; headings do
  // not — their own section number has already been stripped by this point.
  if (/\d\.\d/.test(text)) return false;
  return isTitleCased(text);
}

/**
 * An author affiliation ("University of Warsaw, Warsaw, Poland") reads like a
 * numbered heading. The combination of an organisation word and a comma-
 * separated location is what distinguishes it from a real section title.
 */
function looksLikeAffiliation(text: string): boolean {
  if (!text.includes(',')) return false;
  return /\b(?:Universit(?:y|ä|é)\w*|Institut\w*|Laborator\w*|Department|College|School|Academy|Corporation|Inc\.?|Ltd\.?|GmbH|AG|Research)\b/i.test(
    text
  );
}

/**
 * Splice recovered headings into the Markdown at their proper level, and make
 * the paper title the single `#` at the top. Headings welded into prose are cut
 * out onto their own line; only the first occurrence of each is promoted, so a
 * later cross-reference to the same words is left alone.
 */
export function applyLayoutHeadings(markdown: string, layoutText?: string): string {
  if (!layoutText) return markdown;

  // Whether a heading existed *before* promotion decides how the title is
  // applied: a section heading this pass creates must not be mistaken for the
  // paper title and retitled.
  const hadHeading = /^\s*#{1,6}\s+\S/m.test(markdown);

  let result = markdown;
  for (const heading of extractLayoutHeadings(layoutText)) {
    result = promoteHeading(result, heading);
  }

  return applyTitleHeading(result, extractLayoutTitle(layoutText), hadHeading);
}

function promoteHeading(markdown: string, heading: LayoutHeading): string {
  const pattern = headingPattern(heading.text);
  if (!pattern) return markdown;

  const marker = '#'.repeat(heading.level);
  let replaced = false;
  let inFence = false;
  let inMath = false;

  return markdown
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^(?:```|~~~)/.test(trimmed)) {
        inFence = !inFence;
        return line;
      }
      if (trimmed === '$$') {
        inMath = !inMath;
        return line;
      }
      if (replaced || inFence || inMath) return line;

      // Never rewrite existing headings, table rows, or quoted blocks. A long
      // line only *looks* like a heading — "# of frames 1 2 4 IoU …" is a
      // collapsed table row, and may still carry a real heading inside it.
      const isExistingHeading = /^#{1,6}\s/.test(trimmed) && trimmed.length <= 120;
      if (isExistingHeading || /^(?:\||>)/.test(trimmed)) return line;
      const match = line.match(pattern);
      if (!match) return line;

      replaced = true;
      const before = line.slice(0, match.index).trim();
      const after = line.slice(match.index! + match[0].length).trim();
      return [before, `${marker} ${heading.text}`, after].filter(Boolean).join('\n\n');
    })
    .join('\n');
}

function headingPattern(text: string): RegExp | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  // `\s*` not `\s+`: pdf2md and pdftotext disagree on spacing around punctuation
  // ("PATCHWORK++:" vs "PATCHWORK ++:"), so the gap must be allowed to vanish.
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(escaped);
}

/**
 * The document's first heading must be the title at level 1. An existing first
 * heading is retitled when the layout offers a fuller version (a title split
 * across lines); otherwise its level is simply corrected.
 */
function applyTitleHeading(
  markdown: string,
  title: string | undefined,
  hadHeading: boolean
): string {
  const lines = markdown.split('\n');
  const firstHeadingIndex = lines.findIndex((line) => /^\s*#{1,6}\s+\S/.test(line));

  // No pre-existing heading means the title has nothing to correct — prepend it
  // rather than commandeering a section heading this pass just recovered.
  if (firstHeadingIndex < 0 || !hadHeading) {
    return title ? `# ${title}\n\n${markdown}` : markdown;
  }

  const existing = lines[firstHeadingIndex].replace(/^\s*#{1,6}\s+/, '').trim();
  // Prefer the layout title when it merely completes the existing heading, or
  // when what pdf2md promoted is journal furniture ("REVIEW Open Access")
  // rather than the paper's title.
  const useLayoutTitle =
    title !== undefined &&
    ((title.length > existing.length && titleExtends(title, existing)) ||
      isTitleNoiseLine(existing));
  lines[firstHeadingIndex] = `# ${useLayoutTitle ? title : existing}`;

  if (useLayoutTitle) removeTitleRemainder(lines, firstHeadingIndex + 1, title);
  return lines.join('\n');
}

/** Whether the layout title starts with the heading already present. */
function titleExtends(title: string, existing: string): boolean {
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return normalize(title).startsWith(normalize(existing).slice(0, 24));
}

/** Drop the orphaned tail of a title that pdf2md left as its own paragraph. */
function removeTitleRemainder(lines: string[], startIndex: number, title: string): void {
  const normalizedTitle = normalizeForTitleMatch(title);

  for (let i = startIndex; i < Math.min(lines.length, startIndex + 6); i += 1) {
    const candidate = normalizeForTitleMatch(lines[i]);
    if (!candidate) continue;
    // Any following paragraph wholly contained in the title is the orphaned
    // tail pdf2md split off — whether the title extended the old heading or
    // replaced it outright.
    if (candidate.length >= 8 && normalizedTitle.includes(candidate)) {
      // Drop the trailing blank too, so removing the paragraph does not leave a
      // double gap behind the title.
      const extra = !lines[i + 1]?.trim() && !lines[i - 1]?.trim() ? 2 : 1;
      lines.splice(i, extra);
      return;
    }
    break;
  }
}

function normalizeForTitleMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

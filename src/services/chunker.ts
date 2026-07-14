// Heading-based Markdown chunker: provenance is the heading trail
// (sectionPath), with a max-size split inside long sections. Bump
// CHUNKER_VERSION whenever the algorithm changes — the indexer eagerly
// re-chunks everything on a version mismatch.

export const CHUNKER_VERSION = 1;

const DEFAULT_MAX_CHARS = 2000;

export interface MarkdownChunk {
  ordinal: number;
  sectionPath: string[];
  text: string;
}

interface Section {
  sectionPath: string[];
  lines: string[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;

export function chunkMarkdown(markdown: string, maxChars = DEFAULT_MAX_CHARS): MarkdownChunk[] {
  const sections: Section[] = [];
  let trail: string[] = [];
  let current: Section = { sectionPath: [], lines: [] };

  for (const line of markdown.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      sections.push(current);
      const level = heading[1].length;
      trail = [...trail.slice(0, level - 1), heading[2].trim()];
      // Keep the heading line in the chunk text so its terms are searchable.
      current = { sectionPath: [...trail], lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const chunks: MarkdownChunk[] = [];
  let ordinal = 0;
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (text.length === 0) continue;
    for (const piece of splitToSize(text, maxChars)) {
      chunks.push({ ordinal, sectionPath: section.sectionPath, text: piece });
      ordinal += 1;
    }
  }
  return chunks;
}

/** Split oversized text on paragraph boundaries, hard-splitting only when a
 *  single paragraph exceeds the budget on its own. */
function splitToSize(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const pieces: string[] = [];
  let buffer = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    const candidate = buffer.length === 0 ? paragraph : `${buffer}\n\n${paragraph}`;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      continue;
    }
    if (buffer.length > 0) {
      pieces.push(buffer);
      buffer = '';
    }
    if (paragraph.length <= maxChars) {
      buffer = paragraph;
    } else {
      for (let start = 0; start < paragraph.length; start += maxChars) {
        const slice = paragraph.slice(start, start + maxChars);
        if (start + maxChars >= paragraph.length) {
          buffer = slice;
        } else {
          pieces.push(slice);
        }
      }
    }
  }
  if (buffer.trim().length > 0) pieces.push(buffer);
  return pieces.map((p) => p.trim()).filter((p) => p.length > 0);
}

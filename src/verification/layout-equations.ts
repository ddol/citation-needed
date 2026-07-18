/**
 * 2D display-equation reconstruction from `pdftotext -layout`.
 *
 * pdf2md serializes a display equation row-by-row, so a fraction arrives as
 * three fragments (`mAP =`, `1`, `|C||D|`) that the old repair stacked into a
 * `\begin{aligned}` block — visually garbage. The layout text still holds the
 * 2D arrangement with x-positions, which is enough to rebuild real LaTeX:
 *
 *     .            1 XX                          ← numerator + Σ glyphs
 *     .   mAP =           APc,d      (1)         ← main line with the label
 *     .          |C||D|                          ← denominator
 *     .                c∈C d∈D                   ← Σ limits
 *
 * becomes `mAP = \frac{1}{|C||D|} \sum_{c\in C} \sum_{d\in D} AP_{c,d}`.
 *
 * Computer Modern quirks handled: `X`/`P` render for `Σ`, lone `n`/`o` for big
 * braces, `k…k` for norm bars `‖…‖`, and `6=` for `≠`.
 */

export interface LayoutEquation {
  label: string;
  latex: string;
  page: number;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

interface PlacedPart {
  x: number;
  latex: string;
}

const LABEL_RE = /\((\d{1,3})\)/g;
const SUM_GLYPH_RE = /^(?:[XP]{1,3}|[Σ∑]{1,3})$/;
const LIMIT_TOKEN_RE = /[∈=]|≠|6=/;

export function extractLayoutEquations(layoutText: string): Map<string, LayoutEquation> {
  const equations = new Map<string, LayoutEquation>();

  for (const [pageIndex, page] of layoutText.split('\f').entries()) {
    const lines = page.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      for (const found of labeledEquationsOnLine(lines, i)) {
        if (equations.has(found.label)) continue;
        equations.set(found.label, { ...found, page: pageIndex + 1 });
      }
    }
  }

  return equations;
}

function labeledEquationsOnLine(
  lines: string[],
  lineIndex: number
): Array<{ label: string; latex: string }> {
  const line = lines[lineIndex];
  const results: Array<{ label: string; latex: string }> = [];

  for (const match of line.matchAll(LABEL_RE)) {
    const labelStart = match.index!;
    const after = line.slice(labelStart + match[0].length);
    // A display-equation label ends its column: only other-column text (2+
    // spaces away) or the line end may follow.
    if (after.trim() && !/^\s{2,}/.test(after)) continue;

    const latex = reconstructEquation(lines, lineIndex, labelStart);
    if (latex) results.push({ label: match[1], latex });
  }

  return results;
}

function reconstructEquation(
  lines: string[],
  mainIndex: number,
  labelStart: number
): string | undefined {
  const region = equationRegionTokens(lines, mainIndex, labelStart);
  const byX = (a: Token, b: Token): number => a.start - b.start;
  const mainTokens = region
    .filter((row) => row.offset === 0)
    .map((row) => row.token)
    .sort(byX);
  if (mainTokens.length === 0) return undefined;

  // Context rows are cropped to the main line's own span: anything left of it
  // is the neighbouring sentence, not part of this equation.
  const mainMin = Math.min(...mainTokens.map((token) => token.start));
  const contextRows: ContextRow[] = [-2, -1, 1, 2]
    .map((offset) => ({
      offset,
      tokens: region
        .filter((row) => row.offset === offset)
        .map((row) => row.token)
        .filter((token) => token.start >= mainMin - 12)
        .sort(byX),
    }))
    .filter((row) => row.tokens.length > 0);

  const casesLatex = reconstructCases(mainTokens, contextRows);
  if (casesLatex) return casesLatex;

  const parts = assembleParts(mainTokens, contextRows);
  if (!parts) return undefined;

  const joined = parts
    .sort((a, b) => a.x - b.x)
    .map((part) => part.latex)
    .join(' ');
  const latex = finalizeLatex(joined);
  return looksLikeEquationLatex(latex) ? latex : undefined;
}

/**
 * The equation's tokens, selected by growing an x-region leftward from the
 * label across all five rows at once. Vertical structure bridges horizontal
 * holes — the label may sit far right of the main line's last token, but the
 * fraction's denominator row fills that x-range, so the region stays connected.
 * The first too-wide gap ends the growth, which is what keeps the other
 * column's prose out.
 */
function equationRegionTokens(lines: string[], mainIndex: number, labelStart: number): RowToken[] {
  const candidates: RowToken[] = [];
  for (const offset of [-2, -1, 0, 1, 2]) {
    const line = lines[mainIndex + offset];
    if (!line) continue;
    for (const token of tokensWithPositions(line)) {
      if (token.end > labelStart + 1) continue;
      if (token.text.length > 30) continue;
      if (offset !== 0 && isContextNoise(token.text)) continue;
      candidates.push({ token, offset });
    }
  }

  candidates.sort((a, b) => b.token.end - a.token.end);
  const kept: RowToken[] = [];
  let regionStart = labelStart;
  for (const candidate of candidates) {
    const gap = regionStart - candidate.token.end;
    if (kept.length > 0 && gap > 14) break;
    kept.push(candidate);
    regionStart = Math.min(regionStart, candidate.token.start);
  }
  return kept;
}

const CONTEXT_STOPWORDS = new Set([
  'a',
  'an',
  'as',
  'at',
  'be',
  'by',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'so',
  'to',
  'we',
]);

function isContextNoise(text: string): boolean {
  const plain = text.replace(/[.,;:]$/, '');
  if (/^(?:if|otherwise|for|where|st)$/.test(plain)) return false;
  // CM norm-bar artifacts (`kxi` from ‖x_i‖) look like lowercase words; keep
  // short k-prefixed tokens so the norm can be rebuilt.
  if (/^k[a-z0-9]{1,5}$/.test(plain)) return false;
  if (CONTEXT_STOPWORDS.has(plain)) return true;
  return /^[a-z]{3,}$/.test(plain) || isBigBraceArtifact(text);
}

/** Lone `n`/`o`/`(`/`)` tokens are the tops and bottoms of tall CM delimiters. */
function isBigBraceArtifact(text: string): boolean {
  return /^[no()[\]{}|]$/.test(text);
}

function tokensWithPositions(line: string): Token[] {
  return Array.from(line.matchAll(/\S+/g), (match) => ({
    text: match[0],
    start: match.index!,
    end: match.index! + match[0].length,
  }));
}

function overlap(a: Token, b: Token): boolean {
  return centerOf(a) >= b.start - 3 && centerOf(a) <= b.end + 3;
}

function centerOf(token: Token): number {
  return (token.start + token.end) / 2;
}

interface ContextRow {
  offset: number;
  tokens: Token[];
}

interface RowToken {
  token: Token;
  offset: number;
}

function assembleParts(mainTokens: Token[], contextRows: ContextRow[]): PlacedPart[] | null {
  const parts: PlacedPart[] = [];
  const claimed = new Set<Token>();
  const above: RowToken[] = contextRows
    .filter((row) => row.offset < 0)
    .flatMap((row) => row.tokens.map((token) => ({ token, offset: row.offset })));
  const below: RowToken[] = contextRows
    .filter((row) => row.offset > 0)
    .flatMap((row) => row.tokens.map((token) => ({ token, offset: row.offset })));

  // Sums first: each Σ glyph (above or on the main line) claims the limit
  // tokens aligned under it, and a short superscript from a row strictly above
  // the glyph's own row — never a same-row neighbour like a fraction numerator.
  const glyphs: RowToken[] = [
    ...mainTokens.map((token) => ({ token, offset: 0 })),
    ...above,
  ].filter(
    ({ token }) =>
      SUM_GLYPH_RE.test(token.text) && below.some((limit) => overlap(limit.token, token))
  );
  for (const glyph of glyphs) {
    claimed.add(glyph.token);
    const sumCount = glyph.token.text.replace(/[^XPΣ∑]/g, '').length || 1;
    const limits = below
      .filter(({ token }) => !claimed.has(token) && LIMIT_TOKEN_RE.test(token.text))
      .filter(
        ({ token }) => token.start >= glyph.token.start - 8 && token.start <= glyph.token.end + 16
      )
      .slice(0, sumCount);
    const sup = above.find(
      ({ token, offset }) =>
        !claimed.has(token) &&
        offset < glyph.offset &&
        overlap(token, glyph.token) &&
        token.text.length <= 4
    );

    const sums: string[] = [];
    for (let s = 0; s < sumCount; s += 1) {
      const limit = limits[s];
      if (limit) claimed.add(limit.token);
      const useSup = s === sumCount - 1 ? sup : undefined;
      if (useSup) claimed.add(useSup.token);
      sums.push(
        `\\sum${limit ? `_{${limit.token.text}}` : ''}${useSup ? `^{${useSup.token.text}}` : ''}`
      );
    }
    parts.push({ x: glyph.token.start, latex: sums.join(' ') });
  }

  // Fractions: an unclaimed token above pairing with unclaimed tokens below at
  // the same x becomes \frac. Numerators look numeric or normed (`1`,
  // `|IDTP|`) — a capitalized prose word from the sentence above does not
  // qualify — and the row nearest the main line pairs first. Neighbouring
  // below-tokens merge into the denominator ("M (K − 1)" arrives as four
  // tokens).
  const belowTokens = below.map(({ token }) => token);
  const numeratorCandidates = [...above].sort(
    (a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.token.start - b.token.start
  );
  for (const { token: numerator } of numeratorCandidates) {
    if (claimed.has(numerator)) continue;
    if (!/^[\d|]/.test(numerator.text)) continue;
    const denominatorTokens = belowTokens
      .filter((token) => !claimed.has(token) && !LIMIT_TOKEN_RE.test(token.text))
      .filter((token) => Math.abs(centerOf(token) - centerOf(numerator)) <= 12)
      .sort((a, b) => a.start - b.start);
    if (denominatorTokens.length === 0) continue;

    const merged = mergeAdjacent(denominatorTokens, belowTokens, claimed);
    claimed.add(numerator);
    for (const token of merged) claimed.add(token);
    parts.push({
      x: numerator.start,
      latex: `\\frac{${numerator.text}}{${merged.map((token) => token.text).join(' ')}}`,
    });
  }

  // Anything left above/below that we cannot place means the reconstruction is
  // unreliable — but stray single symbols are tolerable to drop.
  const unplaced = [...above, ...below].filter(
    ({ token }) => !claimed.has(token) && token.text.length > 2
  );
  if (unplaced.length > 2) return null;

  for (const token of mainTokens) {
    if (claimed.has(token)) continue;
    parts.push({ x: token.start, latex: token.text });
  }

  return parts;
}

/** Grow a denominator group with tokens separated by a single space. */
function mergeAdjacent(seed: Token[], pool: Token[], claimed: Set<Token>): Token[] {
  const group = [...seed];
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of pool) {
      if (claimed.has(token) || group.includes(token)) continue;
      if (LIMIT_TOKEN_RE.test(token.text)) continue;
      const near = group.some(
        (member) => token.start - member.end <= 2 && token.start - member.end >= 0
      );
      const nearLeft = group.some(
        (member) => member.start - token.end <= 2 && member.start - token.end >= 0
      );
      if (near || nearLeft) {
        group.push(token);
        changed = true;
      }
    }
  }
  return group.sort((a, b) => a.start - b.start);
}

/**
 * Piecewise definitions: rows above/below the main line carrying `if …` /
 * `otherwise` become a `\begin{cases}` body.
 */
function reconstructCases(mainTokens: Token[], contextRows: ContextRow[]): string | undefined {
  const caseRows = contextRows.filter((row) =>
    row.tokens.some((token) => /^(?:if|otherwise[,.]?)$/.test(token.text))
  );
  if (caseRows.length === 0) return undefined;

  const lhs = mainTokens.map((token) => token.text).join(' ');
  const rows = caseRows
    .sort((a, b) => a.offset - b.offset)
    .map((row) => {
      const text = row.tokens.map((token) => token.text).join(' ');
      const split = text.match(/^(.*?)\s+(if\s+.*|otherwise[,.]?)$/);
      if (!split) return normalizeMathGlyphs(text);
      const condition = split[2].replace(/^if\s+/, '');
      const conditionLatex =
        condition === split[2]
          ? '\\text{otherwise}'
          : `\\text{if } ${normalizeMathGlyphs(condition).replace(/[,.]$/, '')}`;
      return `${normalizeMathGlyphs(split[1])} & ${conditionLatex}`;
    });

  return finalizeLatex(`${lhs} \\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`, {
    skipGlyphs: true,
  });
}

function finalizeLatex(latex: string, options: { skipGlyphs?: boolean } = {}): string {
  const normalized = options.skipGlyphs ? latex : normalizeMathGlyphs(latex);
  return repairSubscripts(normalized).replace(/\s+/g, ' ').trim();
}

/**
 * Map extraction glyphs to LaTeX. Shared with the pdf2md-side equation repair
 * so both sources speak the same dialect.
 */
export function normalizeMathGlyphs(text: string): string {
  return (
    text
      // Norm bars: CM renders ‖x‖ as `kxk` / `kx k`; the bare variable inside
      // regains its subscript (`kxi k` → `\|x_i\|`).
      .replace(/\bk([A-Za-z0-9^_{}\\]+?)\s?k\b/g, '\\|$1\\|')
      .replace(/\\\|([a-z])([a-z0-9])\\\|/g, '\\|$1_$2\\|')
      .replace(/\b6\s*=/g, '\\ne ')
      .replace(/≠/g, '\\ne ')
      .replace(/∆/g, '\\Delta ')
      .replace(/[Σ∑]/g, '\\sum ')
      .replace(/√/g, '\\sqrt ')
      .replace(/∫/g, '\\int ')
      .replace(/≤/g, '\\le ')
      .replace(/≥/g, '\\ge ')
      .replace(/≈/g, '\\approx ')
      .replace(/±/g, '\\pm ')
      .replace(/−/g, '-')
      .replace(/·/g, ' \\cdot ')
      .replace(/×/g, '\\times ')
      .replace(/÷/g, '\\div ')
      .replace(/∈/g, '\\in ')
      .replace(/∪/g, '\\cup ')
      .replace(/∞/g, '\\infty ')
      .replace(/α/g, '\\alpha ')
      .replace(/β/g, '\\beta ')
      .replace(/γ/g, '\\gamma ')
      .replace(/λ/g, '\\lambda ')
      .replace(/μ/g, '\\mu ')
      .replace(/φ/g, '\\phi ')
      .replace(/θ/g, '\\theta ')
      .replace(/π/g, '\\pi ')
      .replace(/[εϵ]/g, '\\epsilon ')
      .replace(/∗/g, '*')
      .replace(/ˆ\s*([A-Za-z])/g, '\\hat{$1}')
      .replace(/([A-Za-z])̂/g, '\\hat{$1}')
      .replace(/\s+/g, ' ')
  );
}

/**
 * Conservative subscript recovery for tokens whose markup pdf2text flattened:
 * `APc,d` → `AP_{c,d}`, `TPc` → `TP_c`, `x2i` → `x_i^2`.
 */
export function repairSubscripts(text: string): string {
  return (
    text
      .replace(/\b([A-Z]{2,})([a-z](?:,[a-z0-9])+)\b/g, '$1_{$2}')
      .replace(/\b([A-Z]{2,})([a-z])\b/g, '$1_$2')
      // `Lcls +` / `Lreg ,` — a single capital with a short lowercase tail is a
      // subscripted symbol only when an operator or punctuation follows;
      // English words ("The quick") are followed by more words instead.
      .replace(/(?<![\\{A-Za-z])([A-Z])([a-z]{2,3})(?=\s*(?:[=+\-,)]|$))/g, '$1_{$2}')
      // `x2i` → `x_i^2` (digit→letter has no \b, so anchor on the pattern).
      .replace(/([A-Za-z])(\d)([a-z])\b/g, '$1_$3^$2')
  );
}

function looksLikeEquationLatex(latex: string): boolean {
  if (latex.length < 3 || latex.length > 400) return false;
  const mathSignals = (latex.match(/[=+\-*/^_{}|]|\\(?:frac|sum|in|ne|le|ge|cdot|begin)/g) ?? [])
    .length;
  return mathSignals >= 1;
}

/**
 * Replace the body of each labeled `$$ … \tag{N} … $$` block with the
 * layout-derived LaTeX. The layout is the richer source — pdf2md's serialized
 * fragments cannot express the 2D structure this rebuilds.
 */
export function replaceLabeledEquationsFromLayout(markdown: string, layoutText?: string): string {
  if (!layoutText) return markdown;
  const equations = extractLayoutEquations(layoutText);
  if (equations.size === 0) return markdown;

  const replacedLabels = new Set<string>();
  const replaced = markdown.replace(
    /\$\$\n([\s\S]*?)\\tag\{(\d{1,3})\}\n\$\$/g,
    (block, _body: string, label: string) => {
      const recovered = equations.get(label);
      if (!recovered) return block;
      replacedLabels.add(label);
      return ['$$', recovered.latex, `\\tag{${label}}`, '$$'].join('\n');
    }
  );

  return removeEquationDebris(replaced, equations, replacedLabels);
}

/**
 * pdf2md serializes an equation's visual rows into the running text; the old
 * repair folded only some of them into the `$$` block, leaving strays like
 * `1 10` and `[5 mAP +` in the paragraphs just above it. With the block now
 * rebuilt from layout, a preceding fragment line whose every token already
 * appears in the reconstructed equation is residue and is dropped.
 */
function removeEquationDebris(
  markdown: string,
  equations: Map<string, LayoutEquation>,
  replacedLabels: Set<string>
): string {
  const lines = markdown.split('\n');
  const drop = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== '$$') continue;
    const label = lines
      .slice(i, i + 6)
      .map((line) => line.match(/^\\tag\{(\d{1,3})\}$/)?.[1])
      .find(Boolean);
    if (!label || !replacedLabels.has(label)) continue;
    const latex = equations.get(label)?.latex ?? '';

    let inspected = 0;
    for (let j = i - 1; j >= 0 && inspected < 4; j -= 1) {
      if (!lines[j].trim()) continue;
      inspected += 1;
      if (!isEquationDebrisLine(lines[j], latex)) break;
      drop.add(j);
    }
  }

  if (drop.size === 0) return markdown;
  return lines.filter((_, index) => !drop.has(index)).join('\n');
}

function isEquationDebrisLine(line: string, latex: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (/^(?:#{1,6}\s|\||>|```|~~~|\$\$)/.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return false;
  // Prose words mean a sentence, not debris.
  if (tokens.some((token) => /^[a-z]{3,}[,;:]?$/.test(token))) return false;

  return tokens.every((token) => {
    const core = token.replace(/[^\w|]/g, '');
    return core.length === 0 || latex.includes(core);
  });
}

/**
 * The single output surface for non-interactive CLI commands.
 *
 * Static, one-shot output goes through here rather than Ink: a React
 * reconciler plus a flexbox layout engine buys nothing for a line of text,
 * and Ink's yoga layout hard-wraps at the measured terminal width, which
 * breaks copy-paste of long values like file paths. Plain writes let the
 * terminal soft-wrap instead.
 *
 * Ink is still the right tool for live, redrawing output — see
 * `src/tui/components/ImportProgress.tsx`.
 */

export type Style = 'bold' | 'dim' | 'red' | 'green' | 'yellow' | 'cyan' | 'gray';

// [open, close]. Colours close with 39 and bold/dim with 22 so styles nest
// without truncating an outer style.
const CODES: Record<Style, [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  gray: [90, 39],
};

/**
 * Colour is decided from stdout for every stream: when output is redirected,
 * stdout and stderr are normally redirected together, and one rule keeps the
 * styling predictable. Honours the NO_COLOR convention.
 */
export function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

export function paint(text: string, style: Style): string {
  if (!supportsColor()) return text;
  const [open, close] = CODES[style];
  return `\x1b[${open}m${text}\x1b[${close}m`;
}

export const bold = (text: string): string => paint(text, 'bold');
export const dim = (text: string): string => paint(text, 'dim');
export const red = (text: string): string => paint(text, 'red');
export const green = (text: string): string => paint(text, 'green');
export const yellow = (text: string): string => paint(text, 'yellow');
export const cyan = (text: string): string => paint(text, 'cyan');

/* eslint-disable no-console --
 * This module is the one sanctioned place for CLI writes; commands call print
 * and printError rather than reaching for console themselves.
 */

/** Write informational lines to stdout. No args prints a blank line. */
export function print(...lines: string[]): void {
  console.log(lines.length ? lines.join('\n') : '');
}

/** Write error lines to stderr, so stdout stays pipeable. */
export function printError(...lines: string[]): void {
  console.error(lines.join('\n'));
}

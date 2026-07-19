// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escapes so an assertion describes what a reader sees rather than
 * the bytes we happened to emit.
 *
 * Colour is environment-dependent: `jest --colors` sets `FORCE_COLOR=1` in
 * worker processes, so rendered output carries escapes in an editor or CI run
 * and none when stdout is piped. Asserting on raw output therefore passes in one
 * environment and fails in the other — `toContain('Alpha paper Done')` misses
 * `Alpha paper\x1b[2m Done\x1b[22m`.
 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/** Longest line by *visible* width, ignoring escapes that occupy no columns. */
export function visibleWidth(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
}

interface RenderFrames {
  frames: string[];
  lastFrame: () => string | undefined;
}

/**
 * The last frame a reader would actually see, ANSI stripped — robust to ink's
 * empty final frame under CI.
 *
 * ink 3's `unmount()` writes a trailing `lastOutput + '\n'` frame when it
 * detects a CI environment (truthy `process.env.CI`), but `lastOutput` is only
 * populated on ink's non-debug render path. ink-testing-library always renders
 * with `debug: true`, so that trailing frame is just `'\n'` and clobbers
 * `lastFrame()`. A component that calls `exit()` when it finishes (as
 * ImportProgress does) therefore reads as blank in CI yet correct locally —
 * the same passes-here-fails-there trap as raw-ANSI assertions above. Reading
 * back to the last non-blank frame describes what the user saw in either
 * environment.
 */
export function lastVisibleFrame(instance: RenderFrames): string {
  const frames = instance.frames ?? [];
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const stripped = stripAnsi(frames[index] ?? '');
    if (stripped.trim() !== '') {
      return stripped;
    }
  }
  return stripAnsi(instance.lastFrame() ?? '');
}

interface ColorEnv {
  FORCE_COLOR?: string;
  NO_COLOR?: string;
}

async function withColorEnv<T>(env: ColorEnv, fn: () => T | Promise<T>): Promise<T> {
  const previous: ColorEnv = {
    FORCE_COLOR: process.env.FORCE_COLOR,
    NO_COLOR: process.env.NO_COLOR,
  };
  const apply = (values: ColorEnv): void => {
    for (const key of ['FORCE_COLOR', 'NO_COLOR'] as const) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  };

  apply(env);
  try {
    return await fn();
  } finally {
    apply(previous);
  }
}

/**
 * Run `fn` with colour forced on, restoring the environment after. Colour is
 * otherwise ambient — on under `jest --colors`, off when piped — so a test that
 * cares either way must pin it rather than inherit it.
 */
export async function withForcedColor<T>(fn: () => T | Promise<T>): Promise<T> {
  return withColorEnv({ FORCE_COLOR: '1' }, fn);
}

/** Run `fn` with colour off, for a deterministic uncoloured baseline. */
export async function withoutColor<T>(fn: () => T | Promise<T>): Promise<T> {
  return withColorEnv({ NO_COLOR: '1' }, fn);
}

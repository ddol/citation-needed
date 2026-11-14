/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Watchman off: it indexes the whole tree, including .claude/worktrees, and
  // a stale crawl there has surfaced as tests that pass or fail depending on
  // which checkouts happen to exist. Jest's own crawler is fast enough here.
  watchman: false,
  testMatch: [
    '**/test/**/*.test.ts',
    '**/test/**/*.test.tsx',
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  // .claude/worktrees holds full checkouts of this repo. Without these, Jest
  // collects every worktree's copy of every test (running the suite N times,
  // against N versions of the source) and jest-haste-map reports duplicate
  // package.json manifests. modulePathIgnorePatterns is the one that silences
  // haste; testPathIgnorePatterns alone only stops the tests from running.
  // Both patterns match absolute paths, so they anchor on <rootDir>: a bare
  // '/.claude/' also matches the root of a checkout that is itself a worktree
  // under .claude/worktrees, and that run then finds no tests at all.
  // <rootDir>/eval/ is the claim-grounding eval harness: standalone ts-node
  // scripts that hit the Anthropic API, deliberately outside the Jest suite and
  // the coverage ratchet (docs/plans/claim-grounding-eval.md). Anchored for the
  // same reason, so a test directory named eval/ elsewhere still runs.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/', '<rootDir>/eval/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/auth/index.ts',
    '!src/cli/app.tsx',
    '!src/cli/index.ts',
    '!src/mcp/index.ts',
    '!src/parsers/index.ts',
    '!src/retrieval/downloaders/index.ts',
    '!src/retrieval/resolvers/index.ts',
    '!src/tui/index.ts',
    '!src/utils/index.ts',
    '!src/verification/index.ts',
  ],
  // Coverage is a ratchet: this floor sits just below actual coverage so any
  // regression fails CI, and it rises as real coverage rises. It never goes
  // down — see DESIGN.md § Testing. The next 95% push needs branch-heavy tests
  // around database migrations/backfills, retrieval resolver error shapes,
  // workflow provenance recording, and authenticated browser-download paths.
  coverageThreshold: {
    global: {
      lines: 93,
      branches: 78,
      functions: 91,
      statements: 92,
    },
  },
};

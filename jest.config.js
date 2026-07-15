/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  testMatch: [
    '**/test/**/*.test.ts',
    '**/test/**/*.test.tsx',
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
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

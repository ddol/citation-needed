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
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/index.ts'],
  // Coverage is a ratchet: this floor sits just below actual coverage so any
  // regression fails CI, and it rises as real coverage rises. It never goes
  // down — see DESIGN.md § Testing. Least-covered areas today: ImportProgress,
  // the MCP retrieval tool, and the authenticated download path.
  coverageThreshold: {
    global: {
      lines: 77,
      branches: 60,
      functions: 68,
      statements: 75,
    },
  },
};

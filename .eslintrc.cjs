module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: 'detect' },
  },
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    '*.cjs',
    '*.js',
  ],
  rules: {
    // Project conventions
    'import/prefer-default-export': 'off',
    'import/no-default-export': 'off',
    'react/react-in-jsx-scope': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Relative TS imports do not use file extensions; package imports may carry `.js`
    // (e.g. @modelcontextprotocol/sdk exposes ESM entries that require the suffix).
    'import/extensions': 'off',
    // Project deliberately keeps playwright as an optionalDependency
    'import/no-extraneous-dependencies': ['error', { optionalDependencies: true }],
    // Leading-underscore allowed for module-private singletons
    '@typescript-eslint/naming-convention': 'off',
    // Function hoisting is fine — helpers can sit below their callers
    '@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false }],
    // Allow CommonJS require for dynamic JSON loads (e.g. package.json version)
    '@typescript-eslint/no-var-requires': 'off',
    'global-require': 'off',
    // airbnb is opinionated about loops; keep ours
    'no-restricted-syntax': 'off',
    'no-await-in-loop': 'off',
    'no-plusplus': 'off',
    'no-continue': 'off',
    'no-underscore-dangle': 'off',
    'class-methods-use-this': 'off',
    'max-classes-per-file': 'off',
    'lines-between-class-members': 'off',
  },
  overrides: [
    {
      files: ['test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
      rules: {
        'import/no-extraneous-dependencies': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};

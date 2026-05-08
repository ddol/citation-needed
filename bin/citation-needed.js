#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const distEntry = path.join(__dirname, '..', 'dist', 'index.js');
const sourceEntry = path.join(__dirname, '..', 'src', 'index.ts');

if (fs.existsSync(distEntry)) {
  require(distEntry);
  return;
}

if (fs.existsSync(sourceEntry)) {
  try {
    require('ts-node').register({
      project: path.join(__dirname, '..', 'tsconfig.json'),
      transpileOnly: true,
      compilerOptions: {
        module: 'commonjs',
        moduleResolution: 'node'
      }
    });
    require(sourceEntry);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `citation-needed: failed to start from source: ${message}\nRun \"npm install\" to install dev dependencies or \"npm run build\" to compile the CLI.\n`
    );
    process.exit(1);
  }
}

process.stderr.write(
  'citation-needed: no runnable entry point found. Run "npm run build" first.\n'
);
process.exit(1);
#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const testFiles = [];

const walk = (dir, predicate) => {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, predicate);
      continue;
    }
    if (stats.isFile() && predicate(entry, fullPath)) {
      testFiles.push(relative(root, fullPath));
    }
  }
};

walk(join(root, 'src'), (entry) => entry.endsWith('.test.ts') || entry.endsWith('.test.tsx'));
walk(join(root, 'electron'), (entry) => entry.endsWith('.test.js'));

testFiles.sort();

if (testFiles.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);

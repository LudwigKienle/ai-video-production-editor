#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const projectId = process.env.SUPABASE_PROJECT_ID;

if (!projectId) {
  console.error('Set SUPABASE_PROJECT_ID before running npm run gen:types.');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['supabase', 'gen', 'types', 'typescript', '--project-id', projectId],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout);

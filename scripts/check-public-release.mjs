#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const strictArtifacts = process.argv.includes('--strict-artifacts');
const ignoredDirs = new Set([
  '.git',
  '.playwright-cli',
  'build',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);
const ignoredFiles = new Set([
  'package-lock.json',
]);
const blockedArtifactNames = new Set([
  '.env',
  '.env.local',
  '.gemini',
  '.venv',
  'certificate.txt',
  'dist-electron',
]);
const blockedArtifactPatterns = [
  /^\.env(?:\.(?!example$).+)?$/u,
  /^\.venv-/u,
  /^.+\.(?:p12|pfx|pem|key)$/iu,
  /^.+\.tgz$/u,
  /^.+\.pyc$/u,
  /^__pycache__$/u,
  /^certificate(?:\..*)?$/iu,
];
const forbiddenPatterns = [
  new RegExp('/' + 'Users/', 'u'),
  new RegExp('Downloads/' + 'claude' + '-code-main', 'iu'),
  new RegExp('bucks' + 'wood', 'iu'),
  new RegExp('bucks' + 'wood' + 'studios\\.com', 'iu'),
  new RegExp('nov' + 'ella', 'iu'),
  new RegExp('\\b' + 'li' + 'dl' + '\\b', 'iu'),
  new RegExp('star\\s*' + 'wars|' + 'star' + 'wars|' + 'dar' + 'th|' + 'ma' + 'lak|' + 're' + 'van', 'iu'),
  new RegExp('studio\\s*' + 'ghib' + 'li|' + 'pix' + 'ar|' + 'dis' + 'ney', 'iu'),
  new RegExp('blade\\s*' + 'runner|' + 'the\\s*mat' + 'rix|\\b' + 'du' + 'ne' + '\\b|' + 'tron\\s*legacy', 'iu'),
  new RegExp('her' + 'editary|' + 'mid' + 'sommar|' + 'sin\\s*' + 'city', 'iu'),
  new RegExp('christopher\\s*' + 'nolan|' + 'quentin\\s*' + 'tarantino|' + 'steven\\s*' + 'spielberg', 'iu'),
  new RegExp('wes\\s*' + 'anderson|' + 'alfred\\s*' + 'hitchcock|' + 'edward\\s*' + 'hopper', 'iu'),
  new RegExp('charit' + '[eé]|' + 'dali' + '-esque|' + 'la' + 'ika', 'iu'),
];

const findings = [];
const artifactFindings = [];

const isBlockedArtifact = (relPath, name) => {
  if (blockedArtifactNames.has(relPath) || blockedArtifactNames.has(name)) return true;
  return blockedArtifactPatterns.some((pattern) => pattern.test(relPath) || pattern.test(name));
};

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relPath = relative(root, fullPath);
    if (strictArtifacts && isBlockedArtifact(relPath, entry)) {
      artifactFindings.push(relPath);
      continue;
    }
    if (ignoredDirs.has(entry)) continue;
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!stats.isFile() || ignoredFiles.has(relPath)) continue;
    if (stats.size > 2_000_000) continue;

    let text;
    try {
      text = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenPatterns.some((pattern) => pattern.test(line))) {
        findings.push(`${relPath}:${index + 1}: ${line.trim()}`);
      }
    });
  }
};

walk(root);

if (artifactFindings.length > 0) {
  console.error('Public release local artifacts found:');
  artifactFindings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

if (findings.length > 0) {
  console.error('Public release branding leaks found:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Public release branding check passed.');

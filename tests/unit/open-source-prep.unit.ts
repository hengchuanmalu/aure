import { afterAll, beforeAll, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let sandbox: string;
beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'aure-open-source-test-'));
  for (const item of ['src', 'public', 'resources', 'scripts', 'tests', '.github', 'design/spec', 'design/tokens', 'docs',
    'src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'src-tauri/build.rs', 'src-tauri/tauri.conf.json', '.gitignore', '.gitattributes', '.node-version', '.npmrc',
    'LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
    'package.json', 'package-lock.json', 'index.html', 'components.json', 'tsconfig.json',
    'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts']) {
    cpSync(path.resolve(item), path.join(sandbox, item), { recursive: true });
  }
});
afterAll(() => { if (sandbox) rmSync(sandbox, { recursive: true, force: true }); });

function check() {
  return spawnSync(process.execPath, [path.join(sandbox, 'scripts/prepare-open-source.mjs'), '--check'], {
    cwd: sandbox, encoding: 'utf8', windowsHide: true,
  });
}

it('accepts the complete curated source without requiring Git or a real catalog', () => {
  const result = check();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).syntheticFixtures).toBe(16);
});

it('rejects modified media even when its filename remains approved', () => {
  const fixture = path.join(sandbox, 'tests/fixtures/media/p-1239291.jpg');
  const original = readFileSync(fixture);
  try {
    writeFileSync(fixture, Buffer.from('unreviewed media'));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture-provenance-mismatch');
  } finally { writeFileSync(fixture, original); }
});

it('rejects new credentials and database files without printing the credential', () => {
  const credential = `ghp_${'a'.repeat(36)}`;
  const text = path.join(sandbox, 'src/private-test.txt');
  const database = path.join(sandbox, 'src/private-test.sqlite3');
  try {
    writeFileSync(text, credential);
    writeFileSync(database, 'disposable');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('github-token');
    expect(result.stderr).toContain('private-file');
    expect(result.stderr).not.toContain(credential);
  } finally { rmSync(text, { force: true }); rmSync(database, { force: true }); }
});

it('refuses directory links that could pull outside files into the export', () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'aure-outside-test-'));
  const link = path.join(sandbox, 'src/outside-test');
  try {
    writeFileSync(path.join(outside, 'private.txt'), 'disposable');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Symlink refused');
    expect(readFileSync(path.join(outside, 'private.txt'), 'utf8')).toBe('disposable');
  } finally { rmSync(link, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

it('rejects an added static image until its origin and hash are reviewed', () => {
  const extra = path.join(sandbox, 'public/unreviewed.jpg');
  try {
    cpSync(path.join(sandbox, 'tests/fixtures/media/p-1239291.jpg'), extra);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unreviewed-static-asset');
  } finally { rmSync(extra, { force: true }); }
});

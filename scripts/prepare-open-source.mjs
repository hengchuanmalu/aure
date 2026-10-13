import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported.');
const directories = ['src', 'public', 'resources', 'scripts', 'tests', '.github', 'design/spec', 'design/tokens', 'docs'];
const rootFiles = ['.gitignore', '.gitattributes', '.node-version', '.npmrc', 'LICENSE', 'README.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'index.html',
  'components.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'];
const nativeDirectories = ['src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities'];
const nativeFiles = ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs', 'src-tauri/tauri.conf.json'];
const excluded = new Set(['resources/aure-icon.prompt.txt', 'tests/fixtures/MDN-CC0.txt']);
const textExtensions = /\.(?:[cm]?[jt]sx?|json|md|txt|html|css|svg|toml|lock|ya?ml|ps1)$/i;
const hash = data => createHash('sha256').update(data).digest('hex');
const normalized = value => value.split(path.sep).join('/');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const issues = [];

function walk(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${relative}`);
  if (stat.isDirectory()) return fs.readdirSync(absolute).sort().flatMap(name => walk(`${relative}/${name}`));
  if (!stat.isFile()) throw new Error(`Non-regular file refused: ${relative}`);
  return excluded.has(relative) ? [] : [relative];
}

const files = [...rootFiles.flatMap(walk), ...nativeFiles.flatMap(walk), ...directories.flatMap(walk), ...nativeDirectories.flatMap(walk)].sort();
const privatePath = /(?:^|\/)(?:\.git|AGENTS\.md|node_modules|target(?:-[^/]*)?|dist|backups|references|verification|test-results|playwright-report|\.env(?:\..*)?)(?:\/|$)|\.(?:sqlite3?|db)(?:-(?:wal|shm))?$|\.(?:pem|key|pfx|p12)$/i;
const checks = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['provider-token', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],
  ['credential-value', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["'][A-Za-z0-9_+\/-]{20,}["']/i],
  ['private-home', /[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b|example\b|test\b)[^\s"'`<>]+/i],
  ['personal-design-path', /[A-Z]:[\\/]personal-design-system\b|\.\.\/personal-design-system\b/i],
];

function inspect(relative, data) {
  if (privatePath.test(relative)) issues.push({ file: relative, rule: 'private-file' });
  if (data.length >= 100 * 1024 * 1024) issues.push({ file: relative, rule: 'github-file-limit' });
  if (!textExtensions.test(relative) && !rootFiles.includes(relative)) return;
  const content = data.toString('utf8');
  for (const [rule, pattern] of checks) if (pattern.test(content)) issues.push({ file: relative, rule });
}

const manifest = files.map(file => {
  const data = fs.readFileSync(path.join(root, file));
  inspect(file, data);
  return { file, bytes: data.length, sha256: hash(data) };
});
const provenance = readJson('tests/fixtures/provenance.json');
const metadata = readJson('tests/fixtures/media-manifest.json');
const approvedAssets = readJson('docs/public-assets.json');
const staticAssets = manifest.filter(item => /^(?:public\/|resources\/|src-tauri\/icons\/)/.test(item.file) &&
  /\.(?:png|jpg|jpeg|webp|gif|ico|icns|mp4|svg)$/i.test(item.file));
for (const entry of staticAssets) {
  const approved = approvedAssets.files.find(item => item.file === entry.file);
  if (!approved || approved.sha256 !== entry.sha256 || !approved.origin || !approved.license) {
    issues.push({ file: entry.file, rule: 'unreviewed-static-asset' });
  }
}
if (staticAssets.length !== approvedAssets.files.length) issues.push({ rule: 'static-asset-count-mismatch' });
if (provenance.generator !== 'scripts/generate-fixtures.mjs' || provenance.version !== 1 || provenance.license !== 'MIT') {
  issues.push({ file: 'tests/fixtures/provenance.json', rule: 'unrecognized-fixture-origin' });
}
const declared = new Set();
for (const entry of provenance.files) {
  if (!/^media\/(?:p-\d+\.jpg|flower(?:-portrait)?\.(?:jpg|mp4))$/.test(entry.file) || declared.has(entry.file)) {
    issues.push({ file: 'tests/fixtures/provenance.json', rule: 'invalid-fixture-entry' });
    continue;
  }
  declared.add(entry.file);
  const file = `tests/fixtures/${entry.file}`;
  const actual = manifest.find(item => item.file === file);
  const dimensions = metadata[`/${file}`];
  if (!actual || actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes ||
    !dimensions || dimensions.size !== entry.bytes || dimensions.width !== entry.width || dimensions.height !== entry.height) {
    issues.push({ file, rule: 'fixture-provenance-mismatch' });
  }
}
for (const file of files.filter(file => file.startsWith('tests/fixtures/media/'))) {
  if (!declared.has(file.slice('tests/fixtures/'.length))) issues.push({ file, rule: 'undeclared-media' });
}
if (Object.keys(metadata).length !== declared.size || declared.size !== 16) issues.push({ rule: 'fixture-count-mismatch' });

const designReadme = '# aure 设计规范\n\n本目录提供可随源码独立阅读的产品、交互、视觉、架构与验收规范。历史概念图和本机设计档案不随公开仓库分发；功能状态以源码和本次验证为准。\n\n- [产品与页面](spec/01-product-and-pages.md)\n- [视觉与组件](spec/02-design-system.md)\n- [交互](spec/03-interactions.md)\n- [实现边界](spec/04-development-handoff.md)\n- [验收](spec/05-acceptance.md)\n- [大规模图库](spec/06-large-library.md)\n- [CSS Tokens](tokens/tokens.css)\n- [性能指南](../docs/performance-guide.md)\n';
const publicFiles = new Set([...files, 'design/README.md', 'docs/dependency-licenses.json']);
for (const file of [...files.filter(file => /\.md$/i.test(file)), 'design/README.md']) {
  const content = file === 'design/README.md' ? designReadme : fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    const resolved = normalized(path.relative(root, path.resolve(root, path.dirname(file), target)));
    if (!publicFiles.has(resolved)) issues.push({ file, rule: 'missing-public-link', target });
  }
}
if (issues.length) {
  console.error(JSON.stringify({ status: 'failed', issues }, null, 2));
  process.exit(1);
}
if (checkOnly) {
  console.log(JSON.stringify({ status: 'passed', files: files.length + 1, syntheticFixtures: declared.size,
    scope: 'Curated public files, heuristic secrets/private paths, sizes, relative Markdown links and fixture hashes; Git history is not exported.' }, null, 2));
  process.exit(0);
}

function command(program, args, input) {
  const result = spawnSync(program, args, { cwd: root, input, encoding: 'utf8', windowsHide: true, maxBuffer: 80 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}

// Read all tracked historical text without printing credential values. History never enters the export.
const historicalFindings = [];
const commits = command('git', ['rev-list', '--all']).trim().split('\n').filter(Boolean);
const historyPatterns = '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}';
for (const commit of commits) {
  const result = spawnSync('git', ['grep', '-I', '-l', '-E', '-e', historyPatterns, commit], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Git history scan failed');
  if (result.stdout.trim()) historicalFindings.push(...result.stdout.trim().split('\n'));
}

const lock = readJson('package-lock.json');
const npm = Object.entries(lock.packages).filter(([location]) => location).map(([location, pkg]) => ({
  package: pkg.name || location.split('node_modules/').at(-1), version: pkg.version,
  license: pkg.license || null, development: Boolean(pkg.dev),
}));
const cargo = JSON.parse(command('cargo', ['metadata', '--locked', '--offline', '--manifest-path', 'src-tauri/Cargo.toml',
  '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc']));
const rust = cargo.packages.filter(pkg => pkg.source).map(pkg => ({ package: pkg.name, version: pkg.version, license: pkg.license }));
const unknown = [...npm, ...rust].filter(pkg => !pkg.license);
if (unknown.length) throw new Error(`Unknown dependency licenses: ${unknown.map(pkg => `${pkg.package}@${pkg.version}`).join(', ')}`);
const dependencyLicenses = { scope: 'Locked npm dependencies and Cargo Windows dependency metadata, including development/build tools.',
  npm, rust, limitations: 'Package license metadata only. Preserve upstream full license notices for binary distribution.' };

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const container = path.join(root, 'output/open-source', `aure-${stamp}`);
const destination = path.join(container, 'repository');
fs.mkdirSync(destination, { recursive: true });
for (const file of files) {
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Copy the same content that was inspected; reject edits made during preparation.
  const data = fs.readFileSync(path.join(root, file));
  if (hash(data) !== manifest.find(item => item.file === file).sha256) throw new Error(`Source changed during export: ${file}`);
  fs.writeFileSync(target, data);
}
fs.writeFileSync(path.join(destination, 'design/README.md'), designReadme);
fs.writeFileSync(path.join(destination, 'docs/dependency-licenses.json'), JSON.stringify(dependencyLicenses, null, 2) + '\n');
for (const file of ['design/README.md', 'docs/dependency-licenses.json']) {
  const data = fs.readFileSync(path.join(destination, file));
  inspect(file, data);
  manifest.push({ file, bytes: data.length, sha256: hash(data) });
}
if (issues.length) throw new Error(JSON.stringify(issues));
fs.writeFileSync(path.join(container, 'manifest.json'), JSON.stringify({ files: manifest.sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
fs.writeFileSync(path.join(container, 'audit.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
  status: historicalFindings.length ? 'candidate-passed-history-needs-review' : 'candidate-passed',
  publicFiles: manifest.length, sourceHistoryCommits: commits.length, historicalCredentialFindings: historicalFindings,
  sourceHistoryIncluded: false, syntheticFixtures: declared.size, npmPackages: npm.length, rustPackages: rust.length,
  unknownLicenses: unknown, limitations: ['Heuristic scan is not an exhaustive secret audit.', 'Asset rights and binary attribution require separate review.'] }, null, 2) + '\n');
console.log(JSON.stringify({ repository: destination, manifest: path.join(container, 'manifest.json'),
  audit: path.join(container, 'audit.json'), files: manifest.length, historyIncluded: false,
  historicalCredentialFindings: historicalFindings.length, npmPackages: npm.length, rustPackages: rust.length }, null, 2));

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const lock = readJson(path.join(root, 'package-lock.json'));
const cargo = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--offline', '--manifest-path',
  'src-tauri/Cargo.toml', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'],
{ cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 80 * 1024 ** 2 }));
const texts = new Map();
const packages = [];
const normalize = text => text.replace(/\r\n/g, '\n').trim() + '\n';
function addText(text) {
  const normalized = normalize(text);
  const id = createHash('sha256').update(normalized).digest('hex');
  texts.set(id, normalized);
  return id;
}
function licenseFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (!/^(?:licen[cs]e|copying|notice|copyright|unlicense)(?:[._-]|$)/i.test(entry.name)) return [];
    const location = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Symlink in dependency notices');
    if (entry.isFile()) return [location];
    if (!entry.isDirectory()) return [];
    return fs.readdirSync(location, { withFileTypes: true }).filter(child => child.isFile())
      .map(child => path.join(location, child.name));
  });
}
function addPackage(pkg, directory) {
  if (!pkg.license) throw Error(`Unknown dependency license: ${pkg.name}`);
  const fullText = new Set(licenseFiles(directory).map(file => addText(fs.readFileSync(file, 'utf8'))));
  const upstream = path.join(root, 'resources/licenses/upstream', `${pkg.name.replaceAll('/', '--')}.txt`);
  if (fs.existsSync(upstream)) fullText.add(addText(fs.readFileSync(upstream, 'utf8')));
  // Include every SPDX alternative, rather than relabeling upstream code as MIT.
  for (const id of new Set(pkg.license.match(/[A-Za-z][A-Za-z0-9.-]*|0BSD/g) || [])) {
    if (['AND', 'OR', 'WITH'].includes(id)) continue;
    const standard = path.join(root, 'resources/licenses/spdx', `${id}.txt`);
    if (!fs.existsSync(standard)) throw Error(`Missing SPDX license text: ${id}`);
    fullText.add(addText(fs.readFileSync(standard, 'utf8')));
  }
  if (!fullText.size) throw Error(`Missing full license: ${pkg.name}`);
  packages.push({ ...pkg, fullText: [...fullText].sort() });
}
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev) continue;
  const directory = path.join(root, location);
  if (!fs.existsSync(directory)) continue; // Platform-specific optional packages absent on Windows.
  const metadata = readJson(path.join(directory, 'package.json'));
  const name = metadata.name || location.split('node_modules/').at(-1);
  addPackage({ ecosystem: 'npm', name, version: pkg.version, license: pkg.license,
    source: `https://www.npmjs.com/package/${name}/v/${pkg.version}`,
    authors: metadata.author ? [typeof metadata.author === 'string' ? metadata.author : metadata.author.name] : [] }, directory);
}
for (const pkg of cargo.packages.filter(pkg => pkg.source)) {
  addPackage({ ecosystem: 'Cargo', name: pkg.name, version: pkg.version, license: pkg.license,
    source: `https://crates.io/crates/${pkg.name}/${pkg.version}`, authors: pkg.authors || [],
    repository: pkg.repository || undefined }, path.dirname(pkg.manifest_path));
}
packages.sort((a, b) => `${a.ecosystem}/${a.name}/${a.version}`.localeCompare(`${b.ecosystem}/${b.name}/${b.version}`));
const output = ['aure - third-party license notices', '',
  'Scope: installed npm runtime packages and the locked Cargo Windows dependency graph,',
  'including native build dependencies. Inclusion does not imply every package is linked.',
  'Upstream license expressions, copyright notices and full license texts are preserved.',
  'Source links identify the exact package versions, including MPL-covered source.',
  'FFmpeg, ffprobe and Microsoft WebView2 are not included in this distribution.', '',
  ...packages.flatMap(pkg => [`${pkg.ecosystem}: ${pkg.name}@${pkg.version}`,
    `License: ${pkg.license}`, `Source: ${pkg.source}`,
    ...(pkg.repository ? [`Repository: ${pkg.repository}`] : []),
    ...(pkg.authors.length ? [`Authors: ${pkg.authors.join('; ')}`] : []),
    `Full texts: ${pkg.fullText.join(', ')}`, '']),
  ...[...texts].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, text]) => [`===== ${id} =====`, text]),
];
fs.writeFileSync(path.join(root, 'resources/third-party-licenses.txt'), output.join('\n'));
console.log(JSON.stringify({ packages: packages.length, uniqueLicenseTexts: texts.size,
  file: 'resources/third-party-licenses.txt' }, null, 2));

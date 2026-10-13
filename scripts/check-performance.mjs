import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'dist/.vite/manifest.json'), 'utf8'));
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
if (entries.length !== 1) throw Error('Expected exactly one application entry');
const [entryKey] = entries[0];
const homeKey = Object.keys(manifest).find(key => key.endsWith('pages/Home.tsx'));
if (!homeKey) throw Error('Home must remain a separate route chunk');
const closure = keys => {
  const seen = new Set();
  const visit = key => {
    if (seen.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw Error(`Missing build chunk: ${key}`);
    seen.add(key);
    for (const dependency of chunk.imports || []) visit(dependency);
  };
  keys.forEach(visit);
  return seen;
};
const entry = closure([entryKey]);
const home = closure([entryKey, homeKey]);
const bytes = keys => [...keys].reduce((sum, key) => sum + statSync(resolve(root, 'dist', manifest[key].file)).size, 0);
const entryBytes = bytes(entry), homeBytes = bytes(home);
// Raw JS is the relevant parsing budget for the packaged desktop protocol.
// These ceilings leave some growth room without hiding a return to eager loading.
if (entryBytes > 670000 || homeBytes > 720000) throw Error(`Startup JS budget exceeded: entry=${entryBytes}, home=${homeBytes}`);
for (const name of ['Settings', 'Models', 'AlbumDetail', 'Library', 'TagManager', 'ModelDetail', 'Collections']) {
  const key = Object.keys(manifest).find(key => key.endsWith(`pages/${name}.tsx`));
  if (!key || entry.has(key) || home.has(key)) throw Error(`${name} must load outside the startup closure`);
}
const viewerKey = Object.keys(manifest).find(key => key.endsWith('features/viewer/Viewer.tsx'));
if (!viewerKey || home.has(viewerKey)) throw Error('Viewer must remain lazy');
console.log(JSON.stringify({ entryBytes, homeBytes, entryChunks: entry.size, homeChunks: home.size, budgets: { entryBytes: 670000, homeBytes: 720000 } }, null, 2));

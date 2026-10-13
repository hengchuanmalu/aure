import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--desktop')) throw Error('Only --desktop is supported');
const folderBytes = directory => readdirSync(directory, { withFileTypes: true }).reduce((bytes, entry) => {
  if (entry.isSymbolicLink()) throw Error(`Symlink refused: ${entry.name}`);
  const path = resolve(directory, entry.name);
  return bytes + (entry.isDirectory() ? folderBytes(path) : statSync(path).size);
}, 0);
const budgets = { frontendBytes: 1.5 * 1024 ** 2, executableBytes: 16 * 1024 ** 2 };
const frontendBytes = folderBytes(resolve(root, 'dist'));
if (frontendBytes > budgets.frontendBytes) throw Error(`Frontend size budget exceeded: ${frontendBytes}`);
const report = { frontendBytes, budgets };
if (args.includes('--desktop')) {
  report.executableBytes = statSync(resolve(root, 'src-tauri/target/release/aure.exe')).size;
  if (report.executableBytes > budgets.executableBytes) throw Error(`Executable size budget exceeded: ${report.executableBytes}`);
}
console.log(JSON.stringify(report, null, 2));

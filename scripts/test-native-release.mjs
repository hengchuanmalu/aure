// Current release gate. Historical native scripts remain focused diagnostics;
// do not discover and execute every file against the user's installed catalog.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedIdentifier, readIsolatedBuild } from '../tests/support/native-session.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 1 || !['--isolated', '--installed'].includes(args[0]))
  throw Error('Use --isolated (disposable writes) or --installed (read-only).');
const isolated = args[0] === '--isolated';
const cases = isolated
  ? ['native-desktop', 'native-user-journeys', 'native-maintenance', 'native-release-boundaries', 'native-video']
  : ['native-release-installed', 'native-release-performance'];
const receipt = isolated ? await readIsolatedBuild(isolatedIdentifier('local.jingji.user-journey-audit')) : null;
const output = resolve(root, 'verification/native-release');
await mkdir(output, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];
for (const name of cases) {
  const started = performance.now();
  console.log(`Native release gate: ${name}`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/native/${name}.mjs`], {
      cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, ...(isolated ? { AURE_NATIVE_IDENTIFIER: receipt.Identifier } : {}) },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  results.push({ name, exitCode, durationMs: Math.round(performance.now() - started) });
  if (exitCode !== 0) break;
}
const passed = results.length === cases.length && results.every(result => result.exitCode === 0);
const report = { mode: isolated ? 'isolated' : 'installed-read-only', startedAt,
  completedAt: new Date().toISOString(), receipt, passed, results,
  pending: cases.filter(name => !results.some(result => result.name === name)),
  limits: ['OS native file-picker interaction', 'clean Windows computer without developer tools',
    'missing WebView2 and offline installation', 'Windows DPI and low-memory/slow-disk endurance',
    'permission denial and disk-full system faults'],
};
await writeFile(resolve(output, `${isolated ? 'isolated' : 'installed'}-gate.json`), JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;

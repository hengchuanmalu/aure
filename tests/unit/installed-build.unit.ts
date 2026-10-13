import { afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalledBuild } from '../../scripts/check-installed.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'aure-build-receipt-'));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

it.skipIf(process.platform !== 'win32')('rejects a matching executable from stale source and accepts the current receipt', async () => {
  const executable = Buffer.from('disposable receipt verification fixture');
  writeFileSync(join(sandbox, 'aure.exe'), executable);
  const receipt = {
    Identifier: 'local.jingji.desktop',
    ExecutableHash: createHash('sha256').update(executable).digest('hex').toUpperCase(),
    SourceFingerprint: 'stale-source',
    FrontendEntry: '/assets/index-current.js',
  };
  writeFileSync(join(sandbox, 'build.json'), JSON.stringify(receipt));
  await expect(readInstalledBuild(sandbox)).rejects.toThrow('当前源码不一致');
  receipt.SourceFingerprint = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-fingerprint.ps1',
  ], { encoding: 'utf8', windowsHide: true }).trim();
  writeFileSync(join(sandbox, 'build.json'), `\uFEFF${JSON.stringify(receipt)}`);
  expect(await readInstalledBuild(sandbox)).toEqual(receipt);
  for (const entry of [undefined, '/src/main.tsx', '/assets/index.js?stale=true']) {
    writeFileSync(join(sandbox, 'build.json'), JSON.stringify({ ...receipt, FrontendEntry: entry }));
    await expect(readInstalledBuild(sandbox)).rejects.toThrow('有效前端入口');
  }
  writeFileSync(join(sandbox, 'build.json'), JSON.stringify(receipt));
  writeFileSync(join(sandbox, 'aure.exe'), 'changed executable');
  await expect(readInstalledBuild(sandbox)).rejects.toThrow('程序哈希不匹配');
}, 15000);

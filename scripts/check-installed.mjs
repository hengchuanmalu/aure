import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export async function readBuildReceipt(executable, identifier, receiptPath = `${executable}.build.json`) {
  const receipt = JSON.parse((await readFile(receiptPath, 'utf8')).replace(/^\uFEFF/, ''));
  const hash = createHash('sha256').update(await readFile(executable)).digest('hex').toUpperCase();
  if (receipt.Identifier !== identifier || hash !== receipt.ExecutableHash) {
    throw Error('构建标识或程序哈希不匹配，拒绝作为验收结果。');
  }
  const { stdout } = await promisify(execFile)('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(projectRoot, 'scripts', 'build-fingerprint.ps1'), '-ProjectRoot', projectRoot,
  ], { windowsHide: true });
  if (stdout.trim() !== receipt.SourceFingerprint) {
    throw Error('构建与当前源码不一致。请先重新构建，再运行原生验收。');
  }
  if (!/^\/assets\/[\w.-]+\.js$/.test(receipt.FrontendEntry || '')) throw Error('构建收据缺少有效前端入口。');
  return receipt;
}

export async function readInstalledBuild(root = join(process.env.LOCALAPPDATA, 'Programs', 'aure')) {
  return readBuildReceipt(join(root, 'aure.exe'), 'local.jingji.desktop', join(root, 'build.json'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await readInstalledBuild(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

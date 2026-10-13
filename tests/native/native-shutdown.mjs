import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFile, writeFile, stat, readdir, utimes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { connectNative, nativePage, invokeNative, catalogSnapshot } from '../support/native-session.mjs';
import { readBuildReceipt } from '../../scripts/check-installed.mjs';

const run = promisify(execFile);
const identifier = 'local.jingji.shutdown-audit';
const endpoint = 'http://127.0.0.1:9288';
const executable = resolve('src-tauri/target-automatic-import/release/aure.exe');
const output = resolve('verification/shutdown-audit');
const temporaryFiles = async () => {
  const found = [];
  for (const [directory, pattern] of [
    ['', /^metadata-.+\.json$/],
    ['thumbnails-v1', /\.(?:decode\.png|tmp|probe\.json)$/],
    ['video-playback-v1', /\.(?:json|progress|pending\.mp4)$/],
  ]) {
    let names;
    try { names = await readdir(join(process.env.LOCALAPPDATA, identifier, directory)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    found.push(...names.filter(name => pattern.test(name)).map(name => join(directory, name)));
  }
  return found.sort();
};
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const ps = async script => (await run('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })).stdout.trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const receipt = await readBuildReceipt(executable, identifier);
process.env.AURE_NATIVE_EXE = executable;
process.env.AURE_NATIVE_IDENTIFIER = identifier;
process.env.AURE_CDP_URL = endpoint;
const formal = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const formalBefore = catalogSnapshot(formal, 'tables');
const ownedPids = new Set();
const ownedAppPids = new Set();
const ownedTools = new Map();
let browser;
const launch = async () => {
  const pid = Number(await ps(`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9288'; $shutdownApp=Start-Process -FilePath ${quote(executable)} -WindowStyle Hidden -PassThru; $shutdownApp.Id`));
  if (!Number.isInteger(pid) || pid <= 0) throw Error('isolated app did not return a valid PID');
  ownedPids.add(pid);
  ownedAppPids.add(pid);
  for (let i = 0; i < 80; i++) {
    try { browser = await connectNative(endpoint, identifier); return { pid, page: nativePage(browser) }; }
    catch { await delay(250); }
  }
  throw Error('isolated shutdown app CDP did not start');
};
const children = async pid => JSON.parse(await ps(`@((Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}') | Where-Object {$_.Name -in @('ffmpeg.exe','ffprobe.exe')} | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress -Depth 3`) || '[]');
const exists = async pid => (await ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) {'alive'} else {'exited'}`)) === 'alive';
const close = async pid => {
  const result = await ps(`$shutdownApp=Get-Process -Id ${pid}; $shutdownApp.Refresh(); @{pid=$shutdownApp.Id;window=[long]$shutdownApp.MainWindowHandle;closeRequested=$shutdownApp.CloseMainWindow()} | ConvertTo-Json -Compress`);
  const parsed = JSON.parse(result);
  if (!parsed.closeRequested) throw Error('normal CloseMainWindow failed');
  for (let i = 0; i < 100; i++) { if (!await exists(pid)) return parsed; await delay(100); }
  throw Error('isolated app did not exit after normal close');
};
try {
  const sources = ['synthetic-progressive-large.jpg', 'synthetic-video.ts'];
  const media = await Promise.all(sources.map(async (name, i) => ({
    id: `shutdown-${i}`, name, kind: i ? 'video' : 'image', sourcePath: join(output, name),
    src: `http://jingji.localhost/media/shutdown-${i}`, size: (await stat(join(output, name))).size,
    width: 0, height: 0, tags: [], favorite: false, liked: false, rating: 0,
  })));
  const hashes = await Promise.all(media.map(async m => createHash('sha256').update(await readFile(m.sourcePath)).digest('hex')));
  const previousTime = await stat(media[0].sourcePath);
  await utimes(media[0].sourcePath, previousTime.atime, new Date());
  const first = await launch();
  const beforeTemps = await temporaryFiles();
  await invokeNative(first.page, 'catalog_reset', { seed: { version:1, albums:[], media, models:[], groups:[], tags:[], recent:[], importRules:[], settings:{reducedMotion:true} } });
  const isolated = new DatabaseSync(join(process.env.APPDATA, identifier, 'catalog.sqlite3'));
  for (const m of media) isolated.prepare('INSERT OR IGNORE INTO authorized VALUES(?)').run(m.sourcePath.replaceAll('\\', '/').toLowerCase());
  isolated.close();
  await first.page.goto('http://tauri.localhost/#/settings');
  await expect(first.page.getByRole('heading', { level:1, name:'设置', exact:true })).toBeVisible();
  await first.page.evaluate(() => {
    window.__shutdownJobs = [];
    const schedule = (command,args) => window.__TAURI_INTERNALS__.invoke(command,args).then(result => window.__shutdownJobs.push({command,result}), error => window.__shutdownJobs.push({command,error:String(error)}));
    // Two image workers and one queued request exercise semaphore shutdown.
    for (let i = 0; i < 3; i++) void schedule('image_thumbnail', {source:'media:shutdown-0',edge:3072});
    void schedule('read_media_metadata', {id:'shutdown-1',force:true});
  });
  let active = [];
  for (let i = 0; i < 20; i++) {
    active = await children(first.pid);
    if (!Array.isArray(active)) active = [active];
    if (active.some(p => p.Name.toLowerCase()==='ffmpeg.exe')) break;
    await delay(100);
  }
  if (!active.length) throw Error('could not catch native FFmpeg/FFprobe workload while active: '+JSON.stringify(await first.page.evaluate(() => window.__shutdownJobs)));
  active.forEach(p => { ownedPids.add(p.ProcessId); ownedTools.set(p.ProcessId,p); });
  console.log(JSON.stringify({phase:'active-media-workers',appPid:first.pid,children:active}));
  const started = Date.now();
  const closeResult = await close(first.pid);
  const survivors = [];
  for (const elapsed of [0, 2000, 5000, 10000]) {
    const remaining = elapsed - (Date.now()-started);
    if (remaining > 0) await delay(remaining);
    const alive = [];
    for (const p of active) if (await exists(p.ProcessId)) alive.push(p);
    survivors.push({ms:Date.now()-started,pids:alive.map(p=>p.ProcessId)});
    console.log(JSON.stringify({phase:'after-normal-close',...survivors.at(-1)}));
  }
  await browser.close().catch(()=>{});
  browser=undefined;
  const afterTemps = await temporaryFiles();
  expect(survivors.every(sample => sample.pids.length === 0)).toBe(true);
  expect(afterTemps).toEqual(beforeTemps);
  const second = await launch();
  if (second.pid === first.pid) throw Error('restart did not create a new application process');
  await second.page.goto('http://tauri.localhost/#/settings');
  await expect(second.page.getByRole('heading', {level:1,name:'设置',exact:true})).toBeVisible();
  const home = await invokeNative(second.page,'catalog_view',{query:{route:'home'}});
  expect(home.mediaCount).toBe(2);
  const restartClose = await close(second.pid);
  await browser.close().catch(()=>{});browser=undefined;
  const afterHashes = await Promise.all(media.map(async m=>createHash('sha256').update(await readFile(m.sourcePath)).digest('hex')));
  expect(afterHashes).toEqual(hashes);
  expect(catalogSnapshot(formal,'tables')).toEqual(formalBefore);
  expect(await temporaryFiles()).toEqual(beforeTemps);
  const report = {identifier,receipt,closeResult,observedChildren:active,survivors,queuedThumbnailRequests:3,newTemporaryFiles:afterTemps.filter(name=>!beforeTemps.includes(name)),restart:{firstPid:first.pid,secondPid:second.pid,settingsVisible:true,mediaCount:home.mediaCount,close:restartClose},originalHashesUnchanged:true,formalCatalogUnchanged:true};
  await writeFile(join(output,'fixed-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  formal.close();
  await browser?.close().catch(()=>{});
  // Verify the executable or tool ancestry again before stopping an owned PID.
  for (const pid of ownedPids) {
    const raw = await ps(`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
    if (!raw) continue;
    const current = JSON.parse(raw);
    const previous = ownedTools.get(pid);
    const ownedApp = ownedAppPids.has(pid) && current.ExecutablePath?.toLowerCase() === executable.toLowerCase();
    const ownedTool = previous && current.Name === previous.Name && current.ParentProcessId === previous.ParentProcessId && current.CommandLine === previous.CommandLine;
    if (ownedApp || ownedTool) await ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
  }
}



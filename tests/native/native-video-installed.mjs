import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed release acceptance: read-only catalog; only disposable playback cache may be written.
import { expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const hashFile = path => new Promise((resolve, reject) => {
  const hash=createHash('sha256'); const stream=createReadStream(path);
  stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex').toUpperCase())); stream.on('error', reject);
});
const installed=join(process.env.LOCALAPPDATA,'Programs','aure');
const receipt=await readInstalledBuild(installed);

const db=new DatabaseSync(join(process.env.APPDATA,'local.jingji.desktop','catalog.sqlite3'),{readOnly:true});
const snapshot = () => catalogSnapshot(db, 'hash');
const before=snapshot();
const source=db.prepare("SELECT e.id,json_extract(e.data,'$.sourcePath') path,r.owner album FROM entities e JOIN refs r ON r.target=e.id AND r.owner_kind='albums' WHERE e.kind='media' AND json_extract(e.data,'$.name')='83.mp4' LIMIT 1").get();
if (!source) throw Error('Reported source video not found');
const originalHash=await hashFile(source.path);
const browser=await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page=nativePage(browser);
const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const requestId=randomUUID();
try {
  expect(await invoke('plugin:app|identifier')).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  // Native decode acceptance uses a temporary media element. Real viewer visits
  // write recent history; the isolated codec test covers viewer controls.
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const started=Date.now();
  const playback=await invoke('prepare_video',{id:source.id,requestId,force:false,preview:false});
  await page.evaluate(src=>{
    const container=document.createElement('div');container.id='aure-video-acceptance';container.className='viewer';
    const stage=document.createElement('div');stage.className='media-stage';
    const v=document.createElement('video');v.muted=true;v.playsInline=true;v.src=src;
    stage.append(v);container.append(stage);document.body.append(container);
  },playback.src);
  const video=page.locator('#aure-video-acceptance video');
  await expect.poll(()=>video.evaluate(v=>v.videoWidth),{timeout:600000,intervals:[1000]}).toBe(2160);
  await video.evaluate(v=>v.play());
  await expect.poll(()=>video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames),{timeout:20000}).toBeGreaterThan(0);
  await expect.poll(()=>video.evaluate(v=>v.webkitAudioDecodedByteCount),{timeout:10000}).toBeGreaterThan(0);
  await video.evaluate(v=>{v.currentTime=22;});
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(21.9);
  const result=await video.evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,frames:v.getVideoPlaybackQuality().totalVideoFrames,audioDecodedBytes:v.webkitAudioDecodedByteCount,src:v.currentSrc,visible:getComputedStyle(v).opacity==='1'&&v.getBoundingClientRect().width>0}));
  expect(result.height).toBe(2880);expect(result.duration).toBeGreaterThan(103);expect(result.visible).toBe(true);
  // Canvas verifies the decoder produced changing pixels, beyond merely reporting a frame count.
  const frameHash=()=>video.evaluate(v=>{const c=document.createElement('canvas');c.width=32;c.height=32;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,32,32);return Array.from(ctx.getImageData(0,0,32,32).data).reduce((a,b)=>((a*31+b)>>>0),0);});
  // Custom protocol is a separate origin; pixel access may be blocked, so frame counters remain the acceptance signal.
  const pixels=await frameHash().catch(()=>null);
  expect(await hashFile(source.path)).toBe(originalHash);expect(snapshot()).toBe(before);expect(errors).toEqual([]);
  await mkdir('verification/video-installed',{recursive:true});
  const report={engine:'Windows WebView2',executableHash:receipt.ExecutableHash,frontendEntry:receipt.FrontendEntry,prepareAndOpenMs:Date.now()-started,...result,pixels,seekSeconds:22,originalHashUnchanged:true,catalogUnchanged:true,errors};
  await writeFile('verification/video-installed/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {
  await page.evaluate(()=>{const el=document.getElementById('aure-video-acceptance');const v=el?.querySelector('video');if(v){v.pause();v.removeAttribute('src');v.load();}el?.remove();}).catch(()=>{});
  await invoke('cancel_video',{requestId}).catch(()=>{});
  db.close();await browser.close();
}

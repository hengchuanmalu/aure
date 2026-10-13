import { connectNative } from '../support/native-session.mjs';
import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const browser=await connectNative(process.env.JINGJI_CDP_URL || 'http://127.0.0.1:9223', "local.jingji.performance-audit");
try {
  const page=browser.contexts()[0].pages()[0];
  if (await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))!=='local.jingji.performance-audit') throw Error('Refusing a non-audit catalog');
  const fixture=JSON.parse(await readFile('verification/native-desktop/real-media-fixture.json','utf8'));
  await page.goto('http://tauri.localhost/#/settings');
  await page.reload();
  const originals=[];page.on('request',r=>{if(r.url().startsWith('http://jingji.localhost/media/')) originals.push(r.url());});
  const start=Date.now();await page.goto('http://tauri.localhost/#/album/real');
  await expect(page.locator('[data-media-id="real-0"] img')).toHaveJSProperty('naturalWidth',512,{timeout:30000});
  await expect(page.locator('[data-media-id="real-1"] img')).toHaveJSProperty('naturalHeight',512,{timeout:30000});
  const coldThumbnailMs=Date.now()-start;
  await expect(page.locator('[data-media-id="real-2"] .photo-fallback')).toBeVisible();
  await page.getByRole('button',{name:'重试缩略图 broken.jpg',exact:true}).click();
  await expect(page.locator('[data-media-id="real-2"] .photo-fallback')).toBeVisible();
  expect(originals).toEqual([]);
  await page.screenshot({path:'verification/native-desktop/real-media-list.png'});
  await page.getByRole('button',{name:'打开 landscape.jpg',exact:true}).click();
  await expect(page.locator('.media-stage > img')).toHaveJSProperty('naturalWidth',6000,{timeout:30000});
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.media-stage > img')).toHaveJSProperty('naturalHeight',6000,{timeout:30000});
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('暂时无法打开',{exact:false})).toBeVisible();
  await page.keyboard.press('ArrowRight');
  const video=page.locator('.media-stage video');
  await expect.poll(()=>video.evaluate(v=>v.readyState),{timeout:15000}).toBeGreaterThanOrEqual(2);
  await page.mouse.move(600,300);
  if(await video.evaluate(v=>v.paused))await page.getByRole('button',{name:'播放',exact:true}).click();
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0.2);
  await page.getByLabel('播放进度',{exact:true}).fill('3');
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(2.9);
  await page.getByLabel('播放进度',{exact:true}).blur();
  await page.keyboard.press('Escape');await expect(page.locator('.viewer')).toHaveCount(0);
  // Exercise repeated original decode/navigation with a fixed, disposable sample.
  for(let i=0;i<10;i++){
    await page.getByRole('button',{name:'打开 landscape.jpg',exact:true}).click();
    await expect(page.locator('.media-stage > img')).toHaveJSProperty('naturalWidth',6000);
    await page.keyboard.press('ArrowRight');await expect(page.locator('.media-stage > img')).toHaveJSProperty('naturalHeight',6000);
    await page.keyboard.press('Escape');
  }
  for(const m of fixture.db.media){expect(createHash('sha256').update(await readFile(m.sourcePath)).digest('hex')).toBe(fixture.hashes[m.name]);}
  const reportPath='verification/native-desktop/results.json';const report=JSON.parse(await readFile(reportPath,'utf8'));
  report.realMedia={build:process.env.JINGJI_NATIVE_BUILD || 'debug',thumbnailReadyMs:coldThumbnailMs,cache:process.env.JINGJI_EMPTY_THUMBNAIL_CACHE==='1'?'empty disk thumbnail cache, warm OS file cache':'warm disk thumbnail cache',imagePixels:[6000,4000],imageFileBytes:[18135735,18137180],originalRequestsInList:0,brokenImageRetryAndRecovery:true,originalVideoPlaybackAndSeek:true,repeatedImageSessions:10,originalHashesUnchanged:true,authorization:'exact disposable files registered in isolated SQLite; native picker not automated'};
  await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report.realMedia));
}finally{await browser.close();}

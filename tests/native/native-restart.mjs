import { connectNative } from '../support/native-session.mjs';
// Run immediately after starting the isolated audit executable; never mutates a catalog.
import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const endpoint=process.env.JINGJI_CDP_URL || 'http://127.0.0.1:9224';
let browser;
for(let i=0;i<100 && !browser;i++){
  try{browser=await connectNative(endpoint, "local.jingji.performance-audit");}catch{await new Promise(r=>setTimeout(r,100));}
}
if(!browser)throw Error('Audit WebView2 did not become available');
try{
  const page=browser.contexts()[0].pages()[0];
  await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
  expect(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.performance-audit');
  await expect(page.locator('.album-card').first()).toBeVisible({timeout:30000});
  const readyMs=process.env.JINGJI_PROCESS_START_MS ? Date.now()-Number(process.env.JINGJI_PROCESS_START_MS) : null;
  const sample=await page.evaluate(async()=>{
    const times=[];
    for(let i=0;i<20;i++){
      const start=performance.now();
      const view=await window.__TAURI_INTERNALS__.invoke('catalog_view',{query:{route:'library',q:'人像',tags:['portrait'],page:i%10,limit:96}});
      if(view.db.albums.length>96 || view.db.media.length>480)throw Error('Unbounded native window');
      times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);
    const home=await window.__TAURI_INTERNALS__.invoke('catalog_view',{query:{route:'home'}});
    return {searchBridgeP95Ms:times[18],albums:home.albumTotal,media:home.mediaCount};
  });
  expect(sample.media).toBe(300000);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const {metrics}=await cdp.send('Performance.getMetrics');
  const persistedRestart={...sample,build:process.env.JINGJI_NATIVE_BUILD || 'release',processStartToCardsVisibleMs:readyMs,cache:'warm OS file cache and WebView profile; existing on-disk catalog',jsHeapBytes:metrics.find(m=>m.name==='JSHeapUsedSize')?.value,cards:await page.locator('.album-card').count(),imageNodes:await page.locator('img').count()};
  await page.screenshot({path:'verification/native-desktop/restart-300000.png'});
  const reportPath='verification/native-desktop/results.json';
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  report.persistedRestart=persistedRestart;
  await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify(persistedRestart));
}finally{await browser.close();}

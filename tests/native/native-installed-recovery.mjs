// Read-only acceptance against the installed application and existing catalog.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectNative,nativePage,readInstalledBuild,catalogSnapshot } from '../support/native-session.mjs';
const before=JSON.parse(await readFile('verification/recovery-installed-before.json','utf8'));
const receipt=await readInstalledBuild();
const browser=await connectNative('http://127.0.0.1:9237','local.jingji.desktop');
const page=nativePage(browser);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const db=new DatabaseSync(join(process.env.APPDATA,'local.jingji.desktop/catalog.sqlite3'),{readOnly:true});
try {
  expect(catalogSnapshot(db)).toBe(before.snapshot);
  const entry=await page.evaluate(()=>document.querySelector('script[type="module"][src]')?.getAttribute('src'));
  expect(entry).toBe(receipt.FrontendEntry);
  await page.goto('http://tauri.localhost/#/settings');await page.reload();
  await expect(page.getByRole('button',{name:'选择备份',exact:true})).toBeVisible();
  await expect(page.getByRole('switch',{name:'同步已导入文件夹',exact:true})).toBeVisible();
  await page.screenshot({path:'verification/recovery-installed-settings.png'});
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'写真库',exact:true}).click();
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'批量标签',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/上一页|下一页/})).toHaveCount(0);
  await page.screenshot({path:'verification/recovery-installed-library.png'});
  expect(catalogSnapshot(db)).toBe(before.snapshot);expect(errors).toEqual([]);
  const result={engine:'installed Windows WebView2',receipt,frontendEntryMatches:true,catalogUnchanged:true,counts:before.counts,newControlsVisible:true,errors};
  await writeFile('verification/recovery-installed-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {db.close();await browser.close();}

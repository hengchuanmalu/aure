import { expect, test } from '../support/browser.fixture';
import { seedFixture } from '../support/demo.fixture';

test('batch tagging controls and selection mode are absent across application pages',async({page})=>{
  await page.goto('/#/library');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  for(const path of ['/', '/library', '/tags', '/models', '/favorites', '/recent', '/settings']){
    await page.evaluate(path=>{location.hash=path;},path);
    await expect(page.getByRole('button',{name:/^(批量标签|结束选择|选择已加载的写真)$/})).toHaveCount(0);
    await expect(page.locator('.batch-selection-toolbar,.album-select-card,.batch-tags-form')).toHaveCount(0);
  }
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jingji.mock.v1')!));
  expect(saved).toEqual(before);
});

test('more than twenty-four models remain reachable in the continuous filter rail',async({page})=>{
  const db=seedFixture();
  db.models=Array.from({length:101},(_,i)=>({...db.models[0],id:`model-${i}`,name:`模特 ${i}`}));
  db.albums[0].modelIds=['model-100'];
  await page.addInitScript(db=>localStorage.setItem('jingji.mock.v1',JSON.stringify(db)),db);
  await page.goto('/#/library');
  const rail=page.getByRole('group',{name:'按模特快速筛选'});
  await expect(rail.getByRole('button',{name:/上一页|下一页/})).toHaveCount(0);
  const last=rail.getByRole('button').filter({has:page.locator('span').filter({hasText:/^模特 100$/})});
  await last.scrollIntoViewIfNeeded();await last.click();
  await expect(page.locator('.album-card')).toHaveCount(1);
  await expect(page.getByRole('link',{name:'打开写真 光落在肩上',exact:true})).toBeVisible();
});

test('native restore is previewed, cancel leaves data intact and failure retains the preview for retry',async({page})=>{
  const db=seedFixture();
  await page.addInitScript(full=>{
    const w=window as any;w.__recoveryCalls=[];let attempts=0;let restores=0;
    w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
      w.__recoveryCalls.push(command);
      if(command==='catalog_initialize')return false;
      if(command==='image_thumbnail')return '/tests/fixtures/media/p-1239291.jpg';
      if(command==='catalog_view')return {db:full,page:0,limit:96,total:full.albums.length,mediaTotal:0,albumTotal:restores?2:full.albums.length,modelTotal:full.models.length,mediaCount:full.media.length};
      if(command==='prepare_catalog_restore')return {token:'preview',name:'test.sqlite3',albums:2,models:1,media:3};
      if(command==='cancel_catalog_maintenance')return;
      if(command==='confirm_catalog_restore'){if(++attempts===1)throw Error('磁盘空间不足');restores++;return;}
      throw Error(command);
    }};
  },db);
  await page.goto('/#/settings');
  await page.getByRole('button',{name:'选择备份',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('2 套写真');
  await page.getByRole('dialog').getByRole('button',{name:'取消'}).click();
  expect(await page.evaluate(()=>(window as any).__recoveryCalls.filter((c:string)=>c==='confirm_catalog_restore'))).toHaveLength(0);
  await page.getByRole('button',{name:'选择备份',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'恢复备份',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('磁盘空间不足');
  await page.getByRole('dialog').getByRole('button',{name:'恢复备份',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.settings-library-summary')).toContainText('2');
});

test('native model recommendations exclude appended unrelated favorites and recent albums',async({page})=>{
  const db=seedFixture();
  const model=db.models[0].id;
  db.albums.forEach((a,i)=>{a.modelIds=i===0?[model]:[db.models[1].id];});
  await page.addInitScript(full=>{
    (window as any).__TAURI_INTERNALS__={invoke:async(command:string)=>{
      if(command==='catalog_initialize')return false;
      if(command==='image_thumbnail')return '/tests/fixtures/media/p-1239291.jpg';
      if(command==='catalog_view')return {db:full,page:0,limit:96,total:1,mediaTotal:0,albumTotal:full.albums.length,modelTotal:full.models.length,mediaCount:full.media.length};
      throw Error(command);
    }};
  },db);
  await page.goto(`/#/?model=${model}`);
  await expect(page.locator('.featured-section .album-card')).toHaveCount(1);
  await expect(page.locator('.featured-section').getByRole('link',{name:'打开写真 光落在肩上',exact:true})).toBeVisible();
});

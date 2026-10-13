import { readInstalledBuild, catalogSnapshot, connectNative, nativePage } from '../support/native-session.mjs';
// Installed WebView2 acceptance. Only existing profile records are read.
import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const install = join(process.env.LOCALAPPDATA, 'Programs', 'aure');
const receipt = await readInstalledBuild(install);
const executableHash = createHash('sha256').update(await readFile(join(install, 'aure.exe'))).digest('hex').toUpperCase();

const db = new DatabaseSync(join(process.env.APPDATA, 'local.jingji.desktop', 'catalog.sqlite3'), { readOnly: true });
const snapshot = () => catalogSnapshot(db, 'hash');
const before = snapshot();
const models = db.prepare("SELECT data FROM entities WHERE kind='models'").all().map(row => JSON.parse(row.data));
const pictured = models.find(model => /Machi|馬吉/i.test(model.name) && model.avatar && model.background)
  || models.find(model => model.avatar && model.background);
if (!pictured) throw Error('An existing profile with avatar and background is required');
const detailed = models.find(model => /鱼子|魚子|fish/i.test(model.name) && model.background && model.fields.filter(field => field.value.trim()).length > 2)
  || models.find(model => model.background && model.fields.filter(field => field.value.trim()).length > 2);
const browser = await connectNative(process.env.AURE_CDP_URL || 'http://127.0.0.1:9237', "local.jingji.desktop");
const page = nativePage(browser);
if (!page) throw Error('Installed aure page not found');
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const originalRoute = await page.evaluate(() => location.hash);
const output = 'verification/model-profile-installed';
try {
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'))).toBe('local.jingji.desktop');
  expect(await page.locator('script[type=module]').getAttribute('src')).toBe(receipt.FrontendEntry);
  await mkdir(output, { recursive: true });
  await page.evaluate(id => { location.hash = `/models/${id}`; }, pictured.id);
  const hero = page.getByRole('region', { name: '模特资料', exact: true });
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(pictured.name);
  await expect.poll(() => hero.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  const bounds = async selector => (await hero.locator(selector).first().boundingBox());
  const avatar = await bounds('.profile-image-trigger');
  const name = await bounds('h1');
  const background = await bounds('.model-backdrop');
  expect(name.x).toBeGreaterThan(avatar.x + avatar.width);
  expect(name.y).toBeLessThan(avatar.y + avatar.height);
  expect(name.y + name.height).toBeGreaterThan(avatar.y);
  expect(background.x).toBeGreaterThan(name.x + name.width);
  expect(avatar.width).toBe(96);
  if (pictured.bio.trim()) {
    const bio = await bounds('.biography');
    expect(bio.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(bio.x).toBeCloseTo(avatar.x, 0);
    expect(bio.x + bio.width).toBeLessThan(background.x);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/profile.png`, fullPage: true });
  // Preview both saved crops, close using Escape, and confirm focus returns.
  for (const label of ['查看头像大图', '查看背景大图']) {
    const trigger = hero.getByRole('button', { name: label, exact: true });
    const style = await trigger.locator('img').getAttribute('style');
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await dialog.locator('img').getAttribute('style')).toBe(style);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  const expansionTarget = detailed || pictured;
  await page.evaluate(id => { location.hash = `/models/${id}`; }, expansionTarget.id);
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(expansionTarget.name);
  const toggle = hero.locator('.profile-expand');
  const fields = expansionTarget.fields.filter(field => field.value.trim());
  await expect(hero.locator('.profile-field')).toHaveCount(fields.length);
  const content = hero.locator('.profile-content');
  await expect(content).toHaveAttribute('inert', '');
  await expect(content).toHaveCSS('mask-image', /linear-gradient/);
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(hero.getByRole('heading', { name: '详细资料', exact: true })).toHaveCount(0);
  const albumHeading = page.getByRole('region', { name: '关联写真集', exact: true }).getByRole('heading', { level: 2 });
  const collapsedAlbumY = (await albumHeading.boundingBox()).y;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/collapsed-details.png`, fullPage: true });
  let expansionVerified = false;
  let reclaimedPixels = 0;
  if (detailed || await toggle.count()) {
    await expect(toggle).toHaveText('展开更多');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveText('收起');
    await expect(toggle).toBeFocused();
    await expect(hero.locator('.profile-field')).toHaveCount(fields.length);
    await expect(content).not.toHaveAttribute('inert', '');
    expect(await content.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    reclaimedPixels = (await albumHeading.boundingBox()).y - collapsedAlbumY;
    expect(reclaimedPixels).toBeGreaterThanOrEqual(0);
    const fieldsBounds = await bounds('.profile-fields');
    const backgroundBounds = await bounds('.model-backdrop');
    const detailAvatar = await bounds('.profile-image-trigger');
    expect(fieldsBounds.x).toBeCloseTo(detailAvatar.x, 0);
    expect(fieldsBounds.x + fieldsBounds.width).toBeLessThan(backgroundBounds.x);
    const contentBounds = await bounds('.profile-content');
    const actionBounds = await bounds('.profile-content-actions');
    expect(actionBounds.y).toBeGreaterThanOrEqual(contentBounds.y + contentBounds.height);
    expect(actionBounds.y - contentBounds.y - contentBounds.height).toBeLessThanOrEqual(4);
    expect(actionBounds.x + actionBounds.width).toBeLessThan(backgroundBounds.x);
    for (const field of fields) await expect(hero.getByText(field.value, { exact: true })).toBeVisible();
    await page.mouse.click(800, 100);
    await page.screenshot({ path: `${output}/expanded.png`, fullPage: true });
    const links = expansionTarget.links.filter(link => /^https?:\/\//i.test(link.url) || /^[\w.-]+\.[a-z]{2,}/i.test(link.url));
    await expect(hero.locator('.profile-social-link')).toHaveCount(links.length);
    await toggle.click();
    await expect(toggle).toHaveText('展开更多');
    await expect(content).toHaveAttribute('inert', '');
    expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect((await albumHeading.boundingBox()).y).toBeCloseTo(collapsedAlbumY, 0);
    expansionVerified = true;
  }
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(snapshot()).toBe(before);
  expect(errors).toEqual([]);
  const report = { engine: 'installed Windows WebView2', executableHash, frontendEntry: receipt.FrontendEntry,
    approvedHorizontalIdentity: true, allInformationInLeftColumn: true, bottomFade: true, collapseControlInLeftColumn: true,
    savedAvatarAndBackgroundPreviews: true, expansionVerified, compactCollapsedRegion: true, reclaimedPixels,
    editorOpensAndCancels: true, noHorizontalOverflow: true, catalogUnchanged: true, errors };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.evaluate(hash => { location.hash = hash; window.scrollTo(0, 0); }, originalRoute).catch(() => {});
  db.close();
  await browser.close();
}

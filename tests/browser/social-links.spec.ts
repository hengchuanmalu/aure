import { expect,test } from "../support/browser.fixture";

test('pasted social links infer names and icons, save, reopen and keep canceled edits private', async ({ page, context }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('socialFixtureReady')) return;
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    for (const model of db.models) model.links = [];
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
    sessionStorage.setItem('socialFixtureReady', '1');
  });
  await page.goto('/#/models');
  await page.locator('.model-card').first().click();
  const modelId = page.url().split('/models/')[1];
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '社交链接', exact: true }).click();
  const examples = [
    ['x.com/example', 'Twitter', 'x'], ['https://www.instagram.com/example/', 'Instagram', 'instagram'],
    ['https://space.bilibili.com/123', '哔哩哔哩', 'bilibili'], ['https://weibo.com/u/123', '微博', 'sinaweibo'],
    ['https://www.douyin.com/user/example', '抖音', 'tiktok'],
  ];
  for (const [url, name, icon] of examples) {
    await page.getByRole('button', { name: '添加社交链接', exact: true }).click();
    const row = page.locator('.social-link-row').last();
    await row.getByLabel('网址', { exact: true }).fill(url);
    await expect(row.getByLabel('平台名称', { exact: true })).toHaveValue(name);
    await expect(row.locator('.social-icon')).toHaveCSS('mask-image', new RegExp(`${icon}\.svg`));
    expect((await page.request.get(`/social-icons/${icon}.svg`)).ok()).toBe(true);
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '展开更多', exact: true }).click();
  for (const [, name] of examples) await expect(page.locator('.profile-social-links').getByRole('link', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: 'verification/social-links/profile.png', animations: 'disabled' });
  const twitter = page.locator('.profile-social-links').getByRole('link', { name: 'Twitter', exact: true });
  await expect(twitter).toHaveAttribute('href', 'https://x.com/example');
  await context.route('https://x.com/example', route => route.fulfill({ body: '<title>Link destination</title>' }));
  const popup = page.waitForEvent('popup');
  await twitter.click();
  const destination = await popup;
  await expect(destination).toHaveURL('https://x.com/example');
  await destination.close();
  const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('jingji.mock.v1')!).models.find((model: { id: string }) => model.id === id).links, modelId);
  expect(stored).toHaveLength(5);
  await page.reload();
  await page.getByRole('button', { name: '展开更多', exact: true }).click();
  await expect(twitter).toBeVisible();
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('button', { name: '社交链接', exact: true }).click();
  const first = page.locator('.social-link-row').first();
  await expect(first.getByLabel('平台名称', { exact: true })).toHaveValue('Twitter');
  await page.screenshot({ path: 'verification/social-links/editor.png', animations: 'disabled' });
  await first.getByLabel('网址', { exact: true }).fill('https://www.instagram.com/changed/');
  await expect(first.getByLabel('平台名称', { exact: true })).toHaveValue('Instagram');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(twitter).toBeVisible();
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem('jingji.mock.v1')!).models.find((model: { id: string }) => model.id === id).links, modelId)).toEqual(stored);
});

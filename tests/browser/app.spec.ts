import { expect,test,type Page } from "../support/browser.fixture";
async function open(page: Page, path = "/") {
  await page.goto("/#" + path);
  await expect(page.locator("#root")).not.toBeEmpty();
}
async function saved(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("jingji.mock.v1") || "null"),
  );
}
test("album create, editor cancel, persistence and combined filters", async ({
  page,
}) => {
  await open(page, "/library");
  await expect(page.locator(".album-card")).toHaveCount(12);
  await page.getByRole("button", { name: "添加写真", exact: true }).click();
  await page
    .getByLabel("写真集名称", { exact: true })
    .fill("测试·长中文写真名称");
  await page.getByLabel("编号", { exact: true }).fill("009");
  await expect(page.getByRole('button', { name: '选择封面', exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator("h1")).toHaveText("测试·长中文写真名称");
  await page.getByRole("button", { name: "编辑写真集", exact: true }).click();
  await page.getByLabel("写真集名称", { exact: true }).fill("不应保存");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("测试·长中文写真名称");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("测试·长中文写真名称");
  await open(page, "/album/a0");
  await expect(page.getByRole("button", { name: "批量选择" })).toHaveCount(0);
  await open(page, "/library?tag=t00&tag=t10&kind=video");
  await expect(page.locator(".album-card")).toHaveCount(1);
  await open(page, "/library?q=不存在的内容");
  await expect(page.getByText("没有找到匹配的写真")).toBeVisible();
});
test("model shared draft, independent images/custom fields and atomic associations", async ({
  page,
}) => {
  await open(page, "/models/m0");
  await expect(page.locator('.topbar').getByRole('button', { name: '编辑资料', exact: true })).toBeVisible();
  await expect(page.locator('.model-bio').getByRole('button', { name: '编辑资料', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加模特', exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByLabel("模特名称", { exact: true }).fill("林夏 · 已编辑");
  await page.getByRole("button", { name: "模特头像", exact: true }).click();
  await expect(page.getByRole('button', { name: '档案照片', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '头像图片来源' }).getByRole('button')).toHaveCount(3);
  const originalAvatar = (await saved(page)).models[0].avatar;
  const originalBackground = (await saved(page)).models[0].background;
  const originalPhotos = (await saved(page)).models[0].photoIds;
  await page.getByRole('button', { name: '从本地选择图片', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请在 aure 桌面版使用');
  await expect(page.getByLabel('背景裁切焦点')).toHaveCount(0);
  await page.getByRole("button", { name: "详细资料", exact: true }).click();
  await page.getByLabel("身高", { exact: true }).fill("未公开");
  await page.getByRole("button", { name: "关联写真集", exact: true }).click();
  await page.getByRole("checkbox", { name: "城市漫游", exact: true }).check();
  await page.getByRole("button", { name: "基本资料", exact: true }).click();
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(
    "林夏 · 已编辑",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("林夏 · 已编辑");
  await expect(page.getByText("未公开", { exact: true })).toBeVisible();
  let d = await saved(page);
  expect(d.models[0].avatar).toBe(originalAvatar);
  expect(d.models[0].photoIds).toEqual(originalPhotos);
  expect(d.models[0].background).toBe(originalBackground);
  expect(d.albums.find((a: any) => a.id === "a1").modelIds).toContain("m0");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("林夏 · 已编辑");
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByLabel("模特名称", { exact: true }).fill("丢弃");
  await page.keyboard.press("Escape");
  await expect(page.getByText("放弃未保存的修改？")).toBeVisible();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  expect((await saved(page)).models[0].name).toBe("林夏 · 已编辑");
});
test("video preview stability, exclusivity, leave/blur cleanup, full playback and media switch", async ({
  page,
}) => {
  await open(page, "/album/a0");
  const first = page.locator('[data-media-id="v0"]'),
    second = page.locator('[data-media-id="v1"]');
  await first.scrollIntoViewIfNeeded();
  const before = await first.boundingBox();
  await first.hover();
  await expect(first).toHaveAttribute("data-preview", "playing");
  await page.waitForTimeout(600);
  expect(
    await first
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeGreaterThan(0.2);
  expect(await first.boundingBox()).toEqual(before);
  expect(
    await first
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.muted && v.loop),
  ).toBeTruthy();
  await second.hover();
  await expect(second).toHaveAttribute("data-preview", "playing");
  expect(
    await first.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
  ).toBeTruthy();
  expect(
    await page
      .locator("video")
      .evaluateAll(
        (vs) => vs.filter((v) => !(v as HTMLVideoElement).paused).length,
      ),
  ).toBe(1);
  await page.mouse.move(200, 100);
  await expect(second).toHaveAttribute("data-preview", "idle");
  expect(await second.locator("video").getAttribute("src")).toBeNull();
  await first.hover();
  await expect(first).toHaveAttribute("data-preview", "playing");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(first).toHaveAttribute("data-preview", "idle");
  await first.click();
  await expect(page.locator(".viewer")).toBeVisible();
  await page.mouse.move(600, 300);
  const v = page.locator(".media-stage video");
  await expect
    .poll(() => v.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  if (await v.evaluate((v: HTMLVideoElement) => v.paused))
    await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => v.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.2);
  expect(await v.evaluate((v: HTMLVideoElement) => v.volume)).toBe(0.5);
  await page.getByLabel("播放进度", { exact: true }).fill("3");
  expect(
    await v.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeGreaterThanOrEqual(2.9);
  await page.getByLabel("音量", { exact: true }).fill("0.3");
  expect(await v.evaluate((v: HTMLVideoElement) => v.volume)).toBeCloseTo(0.3);
  await page.getByRole("button", { name: "下一项", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(v).toHaveAttribute("src", "/tests/fixtures/media/flower-portrait.mp4");
  await page.keyboard.press("Escape");
  await expect(page.locator(".viewer")).toHaveCount(0);
  expect(
    await page
      .locator("video")
      .evaluateAll((vs) => vs.every((v) => (v as HTMLVideoElement).paused)),
  ).toBeTruthy();
});
test("image immersion, ratings, favorite, tag edits, error and empty states", async ({
  page,
}) => {
  await open(page, "/album/a0");
  await page.locator('[data-media-id="p0"]').click();
  await page.waitForTimeout(2400);
  await expect(page.locator(".viewer-controls")).toHaveCSS("opacity", "1");
  await page.mouse.move(700, 300);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "媒体信息", exact: true }).click();
  await page.getByRole("button", { name: "4 星", exact: true }).click();
  await page.getByRole("button", { name: "关闭信息", exact: true }).click();
  await page.getByRole("button", { name: "收藏照片", exact: true }).click();
  await page.keyboard.press("1");
  expect(
    await page
      .locator(".media-stage img")
      .evaluate((e) => getComputedStyle(e).transform),
  ).not.toBe("none");
  await page.keyboard.press("Escape");
  const d = await saved(page);
  expect(d.media[0].rating).toBe(4);
  expect(d.media[0].favorite).toBe(true);
  await open(page, "/favorites");
  await page.getByRole("button", { name: /照片与视频/ }).click();
  await expect(page.locator(".media-card")).toHaveCount(2);
  await page.route("**/p-1239291.jpg", (r) => r.abort());
  await open(page, "/library");
  await expect(page.getByText("图片暂不可用").first()).toBeVisible();
  await open(page, "/album/missing");
  await expect(page.getByText("写真集不存在")).toBeVisible();
});
test("deleting a tag group preserves its tags in ungrouped and reduced motion", async ({ page }) => {
  await open(page, "/tags/manage");
  await page.getByRole("button", { name: "新建分组" }).click();
  await page.getByLabel("名称", { exact: true }).fill("新分组");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const group = page
    .locator(".tag-group")
    .filter({ has: page.getByRole("heading", { name: /新分组/ }) });
  await group.getByRole("button", { name: "添加标签" }).click();
  await page.getByRole("combobox", { name: "标签名称", exact: true }).fill("测试标签");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    group.getByText("测试标签", { exact: false }).first(),
  ).toBeVisible();
  await group.getByRole("button", { name: "删除分组" }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  expect((await saved(page)).tags.some((t: any) => t.name === "测试标签")).toBe(
    true,
  );
  await open(page, "/settings");
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  await page.getByRole("switch", { name: "减少动态效果" }).check();
  await page.reload();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeChecked();
});
test("responsive pages have no horizontal document overflow", async ({
  page,
}) => {
  for (const [width, height] of [
    [1024, 720],
    [1440, 960],
    [1920, 1080],
    [1152, 768],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const route of [
      "/",
      "/library",
      "/album/a0",
      "/models",
      "/models/m0",
      "/tags",
      "/settings",
    ]) {
      await open(page, route);
      await page.waitForTimeout(200);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} ${width}x${height}`,
      ).toBeTruthy();
    }
    await open(page, "/");
    await page.screenshot({ path: `verification/home-${width}x${height}.png` });
  }
});

test('rapid hover, delayed load, scroll cleanup and decoding failure recover',async({page})=>{
 await page.addInitScript(() => localStorage.setItem('aure.media-view.v1', JSON.stringify({ mode: 'adaptive', columns: 2 })));
 await open(page,'/album/a0');const card=page.locator('[data-media-id="v0"]');await card.scrollIntoViewIfNeeded();await card.hover();await page.mouse.move(200,100);await page.waitForTimeout(400);expect(await card.locator('video').getAttribute('src')).toBeNull();
 await page.route('**/flower.mp4',async r=>{await new Promise(resolve=>setTimeout(resolve,700));await r.continue().catch(()=>{})});await card.hover();await page.waitForTimeout(350);await page.mouse.move(200,100);await page.waitForTimeout(800);await expect(card).toHaveAttribute('data-preview','idle');expect(await card.locator('video').evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);await page.unroute('**/flower.mp4');await card.hover();await expect(card).toHaveAttribute('data-preview','playing');await page.evaluate(()=>scrollTo(0,scrollY === 0 ? document.documentElement.scrollHeight : 0));await expect(card).toHaveAttribute('data-preview','idle');await page.mouse.move(0,0);
 await page.route('**/flower.mp4',r=>r.abort());await card.scrollIntoViewIfNeeded();await card.hover();await expect(card).toHaveAttribute('data-preview','error');await card.click();await expect(page.getByText('暂时无法打开')).toBeVisible();await page.mouse.move(500,300);await page.getByRole('button',{name:'下一项',exact:true}).click();await expect(page.locator('.media-stage video')).toHaveAttribute('src','/tests/fixtures/media/flower-portrait.mp4');await expect(page.locator('.viewer-error')).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.locator('.viewer')).toHaveCount(0);
});

test('long profile text, save failure retains draft, fullscreen and return position',async({page})=>{
 await open(page,'/models/m0');await page.getByRole('button',{name:'编辑资料',exact:true}).click();await page.getByLabel('简介',{exact:true}).fill('很长的中文资料内容。'.repeat(35));await page.getByRole('button',{name:'保存',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'编辑资料',exact:true}).click();await page.getByLabel('模特名称',{exact:true}).fill('保留草稿');await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('quota')}});await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存失败');await expect(page.getByLabel('模特名称',{exact:true})).toHaveValue('保留草稿');await page.reload();await expect(page.locator('h1')).toHaveText('林夏');
 await open(page,'/album/a0?type=video');await page.locator('[data-media-id="v0"]').scrollIntoViewIfNeeded();const y=await page.evaluate(()=>scrollY);await page.locator('[data-media-id="v0"]').click();await page.mouse.move(500,300);await page.getByRole('button',{name:'全屏',exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await page.keyboard.press('Escape');await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);await expect(page.locator('.viewer')).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(/type=video/);expect(Math.abs((await page.evaluate(()=>scrollY))-y)).toBeLessThan(5);
});

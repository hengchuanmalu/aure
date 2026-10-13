import { expect,test } from "../support/browser.fixture";

test("album shelf changes complete groups without repeating albums or skipping the final partial group", async ({ page }) => {
  await page.addInitScript(() => {
    const db = JSON.parse(localStorage.getItem('jingji.mock.v1')!);
    db.albums = db.albums.slice(0, 10);
    localStorage.setItem('jingji.mock.v1', JSON.stringify(db));
  });
  await page.goto('/');
  const shelf = page.getByRole('region', { name: '图集展台' });
  const covers = shelf.locator('.shelf-grid:not([inert]) .cover-link');
  const previous = shelf.getByRole('button', { name: '上一组图集' });
  const next = shelf.getByRole('button', { name: '下一组图集' });
  const hrefs = (ids: number[]) => ids.map(id => `#/album/a${id}`);
  const displayed = () => covers.evaluateAll(links => links.map(link => link.getAttribute('href')));
  await expect.poll(displayed).toEqual(hrefs([0, 1, 2, 3]));
  await expect(previous).toBeDisabled();
  await expect(shelf.locator('.shelf-position')).toHaveCount(0);
  await next.click();
  await expect.poll(displayed).toEqual(hrefs([4, 5, 6, 7]));
  await expect(shelf.getByRole('link', { name: '查看全部', exact: true })).toHaveAttribute('href', '#/library');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect.poll(displayed).toEqual(hrefs([8, 9]));
  await expect(next).toBeDisabled();
  await previous.click();
  await expect.poll(displayed).toEqual(hrefs([4, 5, 6, 7]));
  await previous.click();
  await expect.poll(displayed).toEqual(hrefs([0, 1, 2, 3]));
  await next.click();
  await page.getByRole('group', { name: '按模特快速筛选' }).getByRole('button', { name: /^林夏/ }).click();
  await expect.poll(displayed).toEqual(hrefs([0, 6]));
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  await expect(shelf.getByRole('link', { name: '查看全部', exact: true })).toHaveAttribute('href', '#/library?model=m0');
});

test("discovery filters and album stack keep navigation aligned with the chosen album", async ({
  page,
}) => {
  await page.goto("/#/");
  const stack = page.getByRole("region", { name: "图集展台" });
  await expect(
    stack.getByRole("button", { name: "上一组图集" }),
  ).toBeDisabled();
  await stack.getByRole("button", { name: "下一组图集" }).click();
  await expect(stack.getByRole("heading", { name: "绿意之间" })).toBeVisible();
  await stack.getByRole("link", { name: "打开写真 绿意之间", exact: true }).click();
  await expect(page).toHaveURL(/#\/album\/a4$/);
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "发现", exact: true })
    .click();
  await page
    .getByRole("group", { name: "按模特快速筛选" })
    .getByRole("button", { name: /^林夏/ })
    .click();
  await expect(
    page.getByRole("region", { name: "精选写真" }).locator('.featured-grid[data-active="true"] .album-card'),
  ).toHaveCount(2);
  await expect(
    stack.getByRole("button", { name: "上一组图集" }),
  ).toBeDisabled();
  await expect(
    stack.getByRole("button", { name: "下一组图集" }),
  ).toBeDisabled();
  await stack.getByRole("link", { name: "查看全部", exact: true }).click();
  await expect(page).toHaveURL(/model=m0/);
  await expect(page.locator(".album-grid .album-card")).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("button", { name: /^林夏/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "搜索写真、模特或标签" });
  await expect(search).toBeFocused();
  await search.fill("不存在的测试内容");
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的写真" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(search).toHaveValue("");
});

test("rail bounds and reduced motion remain usable from the keyboard", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '高级设置' }).click();
  await page.getByRole("switch", { name: "减少动态效果" }).check();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "发现", exact: true })
    .click();
  const left = page.getByRole("button", { name: "最近更新 向左滚动" });
  const right = page.getByRole("button", { name: "最近更新 向右滚动" });
  await expect(left).toBeDisabled();
  await right.focus();
  await page.keyboard.press("Enter");
  await expect(left).toBeEnabled();
  await expect(page.locator(".album-card").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  for (let i = 0; i < 5 && (await right.isEnabled()); i++) await right.click();
  await expect(right).toBeDisabled();
});

test("all redesigned surfaces render without runtime errors and preserve minimum window layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 960 });
    for (const [name, route] of Object.entries({
      home: "/",
      library: "/library",
      album: "/album/a0",
      models: "/models",
      model: "/models/m0",
      tags: "/tags",
      favorites: "/favorites",
      recent: "/recent",
      settings: "/settings",
    })) {
      await page.goto("/#" + route);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(".page-content > div")).toHaveCSS(
        "opacity",
        "1",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name} at ${width}`,
      ).toBeTruthy();
      await expect(
        page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("link", { name: "最近浏览" }),
      ).toBeVisible();
      await page.screenshot({
        path: `verification/redesign-${name}-${width}.png`,
      });
    }
  }
  await page.goto("/#/models/m0");
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByRole("button", { name: "模特头像", exact: true }).click();
  await page.screenshot({ path: "verification/redesign-editor.png" });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.goto("/#/viewer/a0/p0");
  await expect(page.locator(".media-stage > img")).toBeVisible();
  await page.mouse.move(550, 330);
  await expect(page.locator(".viewer-controls")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "verification/redesign-viewer.png" });
  expect(errors).toEqual([]);
});

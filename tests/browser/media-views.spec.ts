import { expect,test } from "@playwright/test";
import { seedFixture } from "../support/demo.fixture";

test("icon views with hints, thumbnail proportions, row count and persistence share one media sequence", async ({
  page,
}) => {
  const db = seedFixture();
  db.media.forEach((item) => {
    if (item.kind === "image") {
      item.width = 0;
      item.height = 0;
    }
  });
  db.albums[0].mediaIds = db.media.map((item) => item.id);
  await page.addInitScript(
    (db) => localStorage.setItem("jingji.mock.v1", JSON.stringify(db)),
    db,
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/album/a0");
  const grid = page.locator(".media-layout");
  await expect(grid).toHaveAttribute("data-layout-mode", "adaptive");
  const slider = page.getByRole("slider", { name: "每行照片数" });
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("3");
  await page.getByRole("button", { name: "平铺视图", exact: true }).click();
  await expect(grid).toHaveAttribute("data-layout-mode", "tiles");
  await expect
    .poll(async () => {
      const boxes = await grid
        .locator(".media-layout-item")
        .evaluateAll((els) =>
          els.slice(0, 4).map((el) => {
            const { x, y, width, height } = el.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      return (
        boxes.length === 4 &&
        boxes
          .slice(0, 3)
          .every(
            (b) =>
              Math.abs(b.y - boxes[0].y) < 1 &&
              Math.abs(b.width - b.height) < 1,
          ) &&
        boxes[3].y > boxes[0].y + boxes[0].height
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "瀑布流视图", exact: true }).click();
  await expect(grid).toHaveAttribute("data-layout-mode", "masonry");
  const first = grid.locator('[data-layout-id="p0"]');
  await expect
    .poll(() => first.locator("img").evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const box = await first.boundingBox();
      const ratio = await first
        .locator("img")
        .evaluate((img) => img.naturalWidth / img.naturalHeight);
      return Math.abs(box!.width / box!.height - ratio);
    })
    .toBeLessThan(0.01);
  await expect(
    page.getByRole("button", { name: "批量选择", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".media-column-control")).toHaveText("");
  for (const label of ["瀑布流", "平铺", "自适应"]) {
    const button = page.getByRole("button", {
      name: `${label}视图`,
      exact: true,
    });
    await expect(button).toHaveText("");
    await page.mouse.move(0, 0);
    await button.hover();
    await expect(page.getByRole('tooltip', {name: label, exact: true})).toBeVisible();
  }
  await page.getByRole("button", { name: "自适应视图", exact: true }).click();
  await page.reload();
  await expect(slider).toHaveValue("3");
  await expect(grid).toHaveAttribute("data-layout-mode", "adaptive");
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await expect(grid.locator(".media-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "打开 flower.mp4", exact: true })
    .click();
  await expect(page.locator(".viewer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid).toHaveAttribute("data-layout-mode", "adaptive");
  await expect(slider).toHaveValue("3");
  expect(errors).toEqual([]);
});

test("large gallery stays virtual, preserves focused media and reaches the last item in every layout", async ({
  page,
}) => {
  const db = seedFixture();
  const sample = db.media.filter((item) => item.kind === "image");
  db.media = Array.from({ length: 600 }, (_, i) => ({
    ...sample[i % sample.length],
    id: `layout-${i}`,
    name: `照片 ${i}.jpg`,
  }));
  db.albums[0].mediaIds = db.media.map((item) => item.id);
  db.settings.reducedMotion = true;
  await page.addInitScript(
    (db) => localStorage.setItem("jingji.mock.v1", JSON.stringify(db)),
    db,
  );
  await page.goto("/#/album/a0");
  const grid = page.locator(".media-layout");
  await expect(grid).toHaveAttribute("data-total-items", "600");
  await expect(grid).toHaveAttribute("data-animated", "false");
  for (const label of ["平铺", "瀑布流", "自适应"]) {
    await page
      .getByRole("button", { name: `${label}视图`, exact: true })
      .click();
    expect(await grid.locator(".media-card").count()).toBeLessThan(100);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(
      page.getByRole("button", { name: "打开 照片 599.jpg", exact: true }),
    ).toBeVisible();
    expect(await grid.locator(".media-card").count()).toBeLessThan(100);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page
    .getByRole("button", { name: "打开 照片 0.jpg", exact: true })
    .focus();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(
    page.getByRole("button", { name: "打开 照片 0.jpg", exact: true }),
  ).toBeFocused();
  expect(await grid.locator(".media-card").count()).toBeLessThan(110);
  for (const width of [1024, 800]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("layout changes animate without scaling videos and respect system reduced motion", async ({
  page,
}) => {
  const db = seedFixture();
  await page.addInitScript(
    (db) => localStorage.setItem("jingji.mock.v1", JSON.stringify(db)),
    db,
  );
  await page.goto("/#/album/a0");
  const grid = page.locator(".media-layout");
  await expect(grid).toHaveAttribute("data-animated", "true");
  const video = page.locator('[data-media-id="v0"]');
  await video.hover();
  await expect(video).toHaveAttribute("data-preview", "playing");
  const frames = await page.evaluate(async () => {
    const item = document.querySelector('[data-layout-id="p0"]')!;
    (document.querySelector('[aria-label="平铺视图"]') as HTMLElement).click();
    const sizes: number[] = [];
    for (let frame = 0; frame < 22; frame++) {
      await new Promise(requestAnimationFrame);
      sizes.push(item.getBoundingClientRect().width);
    }
    return sizes;
  });
  expect(Math.max(...frames) - Math.min(...frames)).toBeGreaterThan(1);
  await expect(video).toHaveAttribute("data-preview", "idle");
  await expect(video.locator("video")).not.toHaveAttribute("src", /.+/);
  expect(
    await video.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(grid).toHaveAttribute("data-animated", "false");
  await page.getByRole("button", { name: "瀑布流视图", exact: true }).click();
  const wrapper = page.locator('[data-layout-id="p0"]');
  const first = await wrapper.boundingBox();
  await page.waitForTimeout(50);
  const after = await wrapper.boundingBox();
  expect(Math.abs(first!.height - after!.height)).toBeLessThan(1);
});

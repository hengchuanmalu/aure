import { expect, test } from "../support/browser.fixture";

test("menu assets follow their trigger and stop instantly when motion preference changes", async ({
  page,
}) => {
  await page.goto("/#/library");
  const sort = page.getByRole("button", { name: "排序", exact: true });
  await sort.click();
  const menu = page.getByRole("menu");
  await expect(menu).toHaveCSS("animation-name", "enter");
  const geometry = await menu.evaluate((el) => {
    const css = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      origin: css.transformOrigin,
      scale: css.getPropertyValue("--tw-enter-scale").trim(),
      side: el.getAttribute("data-side"),
      width: rect.width,
    };
  });
  expect(geometry.scale).toBe(".96");
  expect(geometry.origin).not.toBe("0px 0px");
  expect(geometry.side).toBeTruthy();
  expect(geometry.width).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(menu).toHaveCSS("animation-name", "none");
  await expect(menu).toHaveCSS("transform", "none");
  await expect(menu).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(sort).toBeFocused();
  await expect(menu).toHaveCount(0);
});

test("settings selection works by keyboard, rapid changes remain bounded and reduced motion settles live", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const nav = page.getByRole("navigation", { name: "设置分类" });
  const advanced = nav.getByRole("button", { name: "高级设置", exact: true });
  await advanced.focus();
  await page.keyboard.press("Enter");
  await expect(advanced).toHaveAttribute("aria-current", "page");
  await expect(advanced).toHaveAttribute("data-checked", "true");
  await expect(advanced.locator(".motion-selection")).toHaveCount(1);
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeVisible();
  for (const name of ["关于", "预览库", "高级设置", "关于"]) {
    await nav
      .getByRole("button", { name, exact: true })
      .evaluate((el) => (el as HTMLButtonElement).click());
  }
  await expect(
    page.getByRole("region", { name: "关于", exact: true }),
  ).toContainText("aure");
  const exiting = page.locator('[data-panel-present="false"]');
  expect(
    await exiting.evaluateAll((elements) =>
      elements.every(
        (el) =>
          el.hasAttribute("inert") && el.getAttribute("aria-hidden") === "true",
      ),
    ),
  ).toBe(true);
  await expect(exiting).toHaveCount(0);
  await advanced.evaluate((el) => (el as HTMLButtonElement).click());
  await page.emulateMedia({ reducedMotion: "reduce" });
  const active = page.locator('[data-panel-present="true"]');
  await expect(active).toHaveCSS("opacity", "1");
  await expect(active).toHaveCSS("transform", "none");
  await expect(
    page.getByRole("switch", { name: "减少动态效果" }),
  ).toBeVisible();
  await page.screenshot({
    path: "verification/open-source-motion/settings.png",
  });
});

test("editor panel transitions preserve all drafts and exiting inputs cannot receive keyboard focus", async ({
  page,
}) => {
  await page.goto("/#/models");
  await page.getByRole("button", { name: "添加模特", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("animation-name", "enter");
  const before = await page.evaluate(() =>
    localStorage.getItem("jingji.mock.v1"),
  );
  await page.getByLabel("模特名称", { exact: true }).fill("动效草稿");
  const tabs = page.getByRole("navigation", { name: "编辑资料分区" });
  await tabs.getByRole("button", { name: "社交链接", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    tabs.getByRole("button", { name: "社交链接", exact: true }),
  ).toHaveAttribute("data-checked", "true");
  await expect(
    tabs.getByRole("button", { name: "社交链接", exact: true }),
  ).toBeFocused();
  expect(
    await page
      .locator('[data-panel-present="false"]')
      .evaluateAll((elements) =>
        elements.every((el) => el.hasAttribute("inert")),
      ),
  ).toBe(true);
  await tabs.getByRole("button", { name: "基本资料", exact: true }).click();
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(
    "动效草稿",
  );
  await tabs.getByRole("button", { name: "模特头像", exact: true }).click();
  await expect(page.locator(".avatar-editor")).toBeVisible();
  await tabs.getByRole("button", { name: "背景图片", exact: true }).click();
  await expect(page.locator(".background-editor")).toBeVisible();
  await expect(page.locator('[data-panel-present="false"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-present="true"]')).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({
    path: "verification/open-source-motion/model-editor.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tabs.getByRole("button", { name: "基本资料", exact: true }).click();
  await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(
    "动效草稿",
  );
  await expect(page.locator('[data-panel-present="false"]')).toHaveCount(0);
  await expect(dialog).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("jingji.mock.v1")),
  ).toBe(before);
});

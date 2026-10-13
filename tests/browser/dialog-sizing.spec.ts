import { test, expect } from "../support/browser.fixture";

test("editor workflows and compact dialogs share widths and responsive margins", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 680, height: 720 },
    { width: 520, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/library?create=1");
    const album = page.getByRole("dialog");
    await expect(album).toBeVisible();
    const albumBox = (await album.boundingBox())!;
    await album
      .getByRole("button", { name: "添加新模特", exact: true })
      .click();
    const model = page.getByRole("dialog", { name: "添加模特" });
    await expect(model).toBeVisible();
    expect((await model.boundingBox())!.width).toBeCloseTo(albumBox.width, 0);
    for (const label of ["模特头像", "背景图片", "基本资料"]) {
      await model
        .getByRole("navigation", { name: "编辑资料分区" })
        .getByRole("button", { name: label, exact: true })
        .click();
      expect((await model.boundingBox())!.width).toBeCloseTo(albumBox.width, 0);
    }
    await model.getByRole("button", { name: "取消", exact: true }).click();
    await album.getByRole("button", { name: "取消", exact: true }).click();
    await page.goto("/#/tags");
    await page
      .locator(".topbar")
      .getByRole("button", { name: "添加标签", exact: true })
      .click();
    const tag = page.getByRole("dialog", { name: "添加标签" });
    const compactBox = (await tag.boundingBox())!;
    await tag.getByRole("button", { name: "取消", exact: true }).click();
    await page.goto("/#/tags/manage");
    await page.getByRole("button", { name: "新建分组", exact: true }).click();
    expect((await page.getByRole("dialog").boundingBox())!.width).toBeCloseTo(
      compactBox.width,
      0,
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.goto("/#/models");
    await page
      .locator(".topbar")
      .getByRole("button", { name: "添加模特", exact: true })
      .click();
    await page.getByLabel("模特名称", { exact: true }).fill("未提交草稿");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    expect((await confirmation.boundingBox())!.width).toBeCloseTo(
      compactBox.width,
      0,
    );
    expect(compactBox.width).toBeLessThanOrEqual(viewport.width - 24);
    expect(albumBox.width).toBeLessThanOrEqual(viewport.width - 24);
    expect(albumBox.x + albumBox.width / 2).toBeCloseTo(viewport.width / 2, 0);
    expect(compactBox.x + compactBox.width / 2).toBeCloseTo(viewport.width / 2, 0);
    await confirmation
      .getByRole("button", { name: "确认", exact: true })
      .click();
  }
});

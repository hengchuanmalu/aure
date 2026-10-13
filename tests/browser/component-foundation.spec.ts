import { expect,test } from "../support/browser.fixture";

test("editor traps focus, keeps dirty drafts and restores the invoking control", async ({
  page,
}) => {
  await page.goto("/#/models/m0");
  const edit = page.getByRole("button", { name: "编辑资料", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "编辑资料" });
  const name = dialog.getByLabel("模特名称", { exact: true });
  await name.fill("键盘编辑草稿");
  await page.keyboard.press("Control+k");
  await expect(name).toBeFocused();
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "继续编辑" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  await expect(name).toHaveValue("键盘编辑草稿");
  await expect(name).toBeFocused();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(page.locator("h1")).toHaveText("林夏");
});

test("cover menu supports keyboard selection and returns focus after escape", async ({
  page,
}) => {
  await page.goto("/#/library");
  const trigger = page
    .locator(".album-card")
    .first()
    .getByRole("button", { name: "光落在肩上 更多操作", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "编辑写真集" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "编辑写真集" })).toBeFocused();
  await expect(page.getByRole("menuitem", { name: "查看详情" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/album\/a0\?edit=1$/);
});

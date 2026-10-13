import { expect, test, type Page } from "@playwright/test";
import { seedFixture } from "../support/demo.fixture";

async function desktopFixture(page: Page, failFirstPatch = false) {
  await page.addInitScript(
    ({ initial, failFirstPatch }) => {
      const db = structuredClone(initial);
      db.settings.reducedMotion = true;
      const calls: { command: string; args: any }[] = [];
      let patchCount = 0;
      (window as any).__desktopStateCalls = calls;
      (window as any).__desktopStateDatabase = db;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any = {}) => {
          calls.push({ command, args: structuredClone(args) });
          if (command === "catalog_initialize") return false;
          if (command === "catalog_patch") {
            if (++patchCount === 1) {
              await new Promise<void>((resolve) => {
                (window as any).__releaseFirstPatch = resolve;
              });
              if (failFirstPatch) throw Error("可丢弃测试的写入失败");
            }
            if (args.changes.settings)
              db.settings = structuredClone(args.changes.settings);
            return;
          }
          if (command === "catalog_view") {
            const settings = args.query.route === "settings";
            const albums = settings
              ? []
              : db.albums.filter((album) =>
                  album.modelIds.includes(args.query.id),
                );
            return structuredClone({
              db: {
                ...db,
                albums,
                models: settings ? [] : db.models,
                media: settings ? [] : db.media,
              },
              page: 0,
              limit: 96,
              total: albums.length,
              albumTotal: db.albums.length,
              modelTotal: db.models.length,
              mediaTotal: 0,
              mediaCount: db.media.length,
            });
          }
          if (command === "catalog_entity")
            return structuredClone(
              db.models.find((model) => model.id === args.id) || null,
            );
          if (command === "catalog_model_albums")
            return db.albums
              .filter((album) => album.modelIds.includes(args.id))
              .map((album) => album.id);
          if (command === "catalog_candidates") {
            const query = args.query || {};
            const candidates =
              args.kind === "albums"
                ? db.albums.filter((album) =>
                    query.ids
                      ? query.ids.includes(album.id)
                      : !query.model || album.modelIds.includes(query.model),
                  )
                : db.media.filter(
                    (item) =>
                      (!query.kind || item.kind === query.kind) &&
                      (!query.favorite || item.favorite) &&
                      (!query.album ||
                        db.albums
                          .find((album) => album.id === query.album)
                          ?.mediaIds.includes(item.id)),
                  );
            return structuredClone({
              items: candidates.slice(args.page * 48, (args.page + 1) * 48),
              total: candidates.length,
            });
          }
          throw Error(`Unexpected native call: ${command}`);
        },
      };
    },
    { initial: seedFixture(), failFirstPatch },
  );
}

for (const failFirstPatch of [false, true])
  test(`queued settings preserve ${failFirstPatch ? "the last successful state after a failed write" : "an earlier successful change"}`, async ({
    page,
  }) => {
    await desktopFixture(page, failFirstPatch);
    await page.goto("/#/settings");
    await page.getByRole("button", { name: "高级设置", exact: true }).click();
    const motion = page.getByRole("switch", {
      name: "减少动态效果",
      exact: true,
    });
    await expect(motion).toBeChecked();
    await motion.click();
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as any).__releaseFirstPatch),
      )
      .toBe("function");
    await page
      .getByRole("combobox", { name: "视频封面取帧位置", exact: true })
      .selectOption("50");
    await page.evaluate(() => (window as any).__releaseFirstPatch());
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__desktopStateDatabase.settings),
      )
      .toMatchObject({
        reducedMotion: failFirstPatch,
        videoPosterPercent: 50,
      });
    if (failFirstPatch) await expect(motion).toBeChecked();
    else await expect(motion).not.toBeChecked();
    await expect(
      page.getByRole("combobox", { name: "视频封面取帧位置", exact: true }),
    ).toHaveValue("50");
    const patches = await page.evaluate(() =>
      (window as any).__desktopStateCalls
        .filter((call: any) => call.command === "catalog_patch")
        .map((call: any) => call.args.changes),
    );
    expect(patches).toHaveLength(2);
    expect(
      patches.every(
        (patch: any) => Object.keys(patch).length === 1 && patch.settings,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as any).__desktopStateDatabase.albums.length,
      ),
    ).toBe(seedFixture().albums.length);
  });

test("avatar sources follow unsaved album associations and cancel leaves saved relationships intact", async ({
  page,
}) => {
  await desktopFixture(page);
  await page.goto("/#/models/m0");
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByRole("button", { name: "关联写真集", exact: true }).click();
  const removed = seedFixture().albums[0];
  const added = seedFixture().albums[1];
  await page
    .getByRole("checkbox", { name: removed.name, exact: true })
    .uncheck();
  await page.getByRole("checkbox", { name: added.name, exact: true }).check();
  await page.getByRole("button", { name: "模特头像", exact: true }).click();
  const sources = page.getByRole("group", {
    name: "头像图片来源",
    exact: true,
  });
  await expect(
    sources.getByRole("button", { name: added.name, exact: true }),
  ).toBeVisible();
  await expect(
    sources.getByRole("button", { name: removed.name, exact: true }),
  ).toHaveCount(0);
  await sources.getByRole("button", { name: added.name, exact: true }).click();
  await page.getByRole("button", { name: "头像 素材 1", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__desktopStateDatabase.albums
        .filter((album: any) => album.modelIds.includes("m0"))
        .map((album: any) => album.id),
    ),
  ).toEqual(["a0", "a6"]);
  expect(
    await page.evaluate(() =>
      (window as any).__desktopStateCalls.filter((call: any) =>
        ["catalog_patch", "catalog_operation"].includes(call.command),
      ),
    ),
  ).toEqual([]);
});

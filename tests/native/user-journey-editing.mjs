import { expect } from "@playwright/test";

const auditIdentifier = "local.jingji.user-journey-audit";

async function navigate(page, route) {
  // Hash navigation keeps the native bridge and the temporary write gate intact.
  await page.evaluate((route) => { location.hash = route; }, `#${route}`);
}

async function installWriteGate(page) {
  await page.evaluate(() => {
    if (window.__userJourneyEditingGate) throw Error("Editing write gate already installed");
    const originalFetch = window.fetch;
    const errorResponse = (message) => new Response(JSON.stringify(message), {
      headers: { "Content-Type": "application/json", "Tauri-Response": "error" },
    });
    const audit = {
      originalFetch,
      filter: undefined,
      armed: false,
      entries: [],
      pending: [],
      release(fail = false) {
        this.armed = false;
        const pending = this.pending.splice(0);
        for (const finish of pending) finish(fail);
      },
    };
    window.__userJourneyEditingGate = audit;
    const intercept = async (input, options) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.hostname !== "ipc.localhost") return originalFetch.call(window, input, options);
      const command = decodeURIComponent(url.pathname.slice(1));
      if (command === "user_journey_editing_gate_probe")
        return new Response(JSON.stringify({ editingWriteGate: true }), {
          headers: { "Content-Type": "application/json", "Tauri-Response": "ok" },
        });
      let args;
      try {
        const body = options?.body;
        const text = typeof body === "string" ? body
          : body instanceof Blob ? await body.text()
          : body ? new TextDecoder().decode(body)
          : input instanceof Request ? await input.clone().text() : "";
        args = JSON.parse(text);
      } catch { /* Non-JSON IPC passes through unchanged. */ }
      const filter = audit.filter;
      const matches = filter && (
        filter.kind === "model"
          ? command === "catalog_operation" && args?.op?.type === "saveModel" && args.op.model?.name === filter.name
          : command === "catalog_patch" && args?.changes?.groups?.some((group) => group.name === filter.name)
      );
      if (!matches) return originalFetch.call(window, input, options);
      const entry = { kind: filter.kind, command, args: structuredClone(args), gated: audit.armed, native: false, outcome: "pending" };
      audit.entries.push(entry);
      try {
        if (audit.armed) {
          const failed = await new Promise((resolve) => {
            audit.pending.push((fail) => resolve(Boolean(fail)));
          });
          if (failed) {
            entry.outcome = "failed";
            // Rejecting fetch triggers Tauri's postMessage fallback, which would
            // execute the real write. A protocol error response blocks it safely.
            return errorResponse("原生编辑验收：模拟首次保存失败");
          }
        }
        entry.native = true;
        const response = await originalFetch.call(window, input, options);
        entry.outcome = response.headers.get("Tauri-Response") === "error" ? "failed" : "saved";
        return response;
      } catch (error) {
        entry.outcome = "failed";
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    };
    window.fetch = intercept;
    if (window.fetch !== intercept) {
      delete window.__userJourneyEditingGate;
      throw Error("Native IPC fetch gate could not be installed");
    }
  });
}

async function armGate(page, kind, name) {
  await page.evaluate(({ kind, name }) => {
    const audit = window.__userJourneyEditingGate;
    if (audit.pending.length) throw Error("Previous editing write still pending");
    audit.filter = { kind, name };
    audit.armed = true;
  }, { kind, name });
}

const entriesFor = (page, kind) => page.evaluate((kind) =>
  window.__userJourneyEditingGate.entries.filter((entry) => entry.kind === kind), kind);

async function waitForWrite(page, kind, count) {
  await expect.poll(async () => (await entriesFor(page, kind)).length).toBe(count);
  await expect.poll(() => page.evaluate(() => window.__userJourneyEditingGate.pending.length)).toBe(1);
}

async function resistClosing(page, title) {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: title, exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__userJourneyEditingGate.pending.length)).toBe(1);
}

/** Writes only to the explicitly isolated audit application; callers run modules serially. */
export async function checkEditingJourneys(page, invoke) {
  expect(await invoke("plugin:app|identifier")).toBe(auditIdentifier);
  expect(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:app|identifier"))).toBe(auditIdentifier);
  const checks = [];
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const modelName = `编辑验收-${suffix}`;
  const groupName = `分组验收-${suffix}`;
  const categoryName = "原生分类输入验收";
  const beforeAlbum = await invoke("catalog_entity", { kind: "albums", id: "a0" });
  expect(beforeAlbum?.id).toBe("a0");

  await navigate(page, "/tags");
  await page.locator(".topbar").getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByRole("button", { name: "标签分类", exact: true }).click();
  const categoryInput = page.getByRole("textbox", { name: "搜索或创建分类", exact: true });
  await categoryInput.fill(categoryName);
  await categoryInput.dispatchEvent("compositionstart");
  await categoryInput.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true, bubbles: true });
  await expect(categoryInput).toBeVisible();
  await expect(categoryInput).toHaveValue(categoryName);
  await expect(page.getByRole("button", { name: "标签分类", exact: true })).toHaveText("选择或创建分类");
  await categoryInput.dispatchEvent("compositionend");
  await categoryInput.press("Enter");
  await expect(page.getByRole("button", { name: "标签分类", exact: true })).toHaveText(categoryName);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  checks.push("编辑：WebView2 中文分类确认保留未完成输入");

  try {
    await installWriteGate(page);
    expect(await invoke("user_journey_editing_gate_probe")).toEqual({ editingWriteGate: true });
    await navigate(page, "/models");
    await page.locator(".topbar").getByRole("button", { name: "添加模特", exact: true }).click();
    await page.getByLabel("模特名称", { exact: true }).fill(modelName);
    await page.getByRole("button", { name: "详细资料", exact: true }).click();
    await page.getByLabel("身高", { exact: true }).fill("168");
    await page.getByRole("button", { name: "社交链接", exact: true }).click();
    await page.getByRole("button", { name: "添加社交链接", exact: true }).click();
    await page.getByLabel("网址", { exact: true }).fill("x.com/aure_test");
    await page.getByRole("button", { name: "关联写真集", exact: true }).click();
    const albumChoice = page.getByRole("checkbox", { name: beforeAlbum.name, exact: true });
    await albumChoice.check();
    await armGate(page, "model", modelName);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await waitForWrite(page, "model", 1);
    await expect(albumChoice).toBeDisabled();
    await expect(page.getByRole("button", { name: "基本资料", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await resistClosing(page, "添加模特");
    await page.evaluate(() => window.__userJourneyEditingGate.release(true));
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("保存失败，草稿已保留，请重试");
    await expect(albumChoice).toBeEnabled();
    await expect(albumChoice).toBeChecked();
    const firstModelWrite = (await entriesFor(page, "model"))[0];
    expect(firstModelWrite.native).toBe(false);
    expect(await invoke("catalog_entity", { kind: "models", id: firstModelWrite.args.op.model.id })).toBeNull();
    await page.getByRole("button", { name: "详细资料", exact: true }).click();
    await expect(page.getByLabel("身高", { exact: true })).toHaveValue("168");
    await page.getByRole("button", { name: "社交链接", exact: true }).click();
    await expect(page.getByLabel("网址", { exact: true })).toHaveValue("https://x.com/aure_test");
    await page.getByRole("button", { name: "基本资料", exact: true }).click();
    await expect(page.getByLabel("模特名称", { exact: true })).toHaveValue(modelName);
    await armGate(page, "model", modelName);
    await page.getByRole("button", { name: "保存", exact: true }).evaluate((button) => { button.click(); button.click(); });
    await waitForWrite(page, "model", 2);
    await expect(page.getByLabel("模特名称", { exact: true })).toBeDisabled();
    await resistClosing(page, "添加模特");
    await page.evaluate(() => window.__userJourneyEditingGate.release());
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const modelWrites = await entriesFor(page, "model");
    expect(modelWrites).toHaveLength(2);
    expect(modelWrites.map((entry) => [entry.native, entry.outcome])).toEqual([[false, "failed"], [true, "saved"]]);
    const modelId = modelWrites[1].args.op.model.id;
    const savedModel = await invoke("catalog_entity", { kind: "models", id: modelId });
    expect(savedModel.name).toBe(modelName);
    expect(savedModel.fields).toContainEqual(expect.objectContaining({ label: "身高", value: "168 cm" }));
    expect(savedModel.links).toEqual([{ label: "Twitter", url: "https://x.com/aure_test" }]);
    expect(await invoke("catalog_model_albums", { id: modelId })).toEqual(["a0"]);
    const savedAlbum = await invoke("catalog_entity", { kind: "albums", id: "a0" });
    expect(savedAlbum.modelIds).toEqual([...beforeAlbum.modelIds, modelId]);
    expect(savedAlbum.mediaIds).toEqual(beforeAlbum.mediaIds);
    checks.push("编辑：模特保存冻结、阻止关闭、失败保留草稿并重试写入真实 SQLite");

    await navigate(page, "/settings/tags");
    await page.getByRole("button", { name: "新建分组", exact: true }).click();
    const groupInput = page.getByLabel("名称", { exact: true });
    await groupInput.fill(groupName);
    await armGate(page, "group", groupName);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await waitForWrite(page, "group", 1);
    await expect(groupInput).toBeDisabled();
    await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await resistClosing(page, "新建分组");
    await page.evaluate(() => window.__userJourneyEditingGate.release(true));
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("保存失败，请重试");
    await expect(groupInput).toBeEnabled();
    await expect(groupInput).toHaveValue(groupName);
    let tagView = await invoke("catalog_view", { query: { route: "tags", page: 0 } });
    expect(tagView.db.groups.filter((group) => group.name === groupName)).toHaveLength(0);
    await armGate(page, "group", groupName);
    await page.getByRole("button", { name: "保存", exact: true }).evaluate((button) => { button.click(); button.click(); });
    await waitForWrite(page, "group", 2);
    await expect(groupInput).toBeDisabled();
    await resistClosing(page, "新建分组");
    await page.evaluate(() => window.__userJourneyEditingGate.release());
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const groupWrites = await entriesFor(page, "group");
    expect(groupWrites).toHaveLength(2);
    expect(groupWrites.map((entry) => [entry.native, entry.outcome])).toEqual([[false, "failed"], [true, "saved"]]);
    tagView = await invoke("catalog_view", { query: { route: "tags", page: 0 } });
    expect(tagView.db.groups.filter((group) => group.name === groupName)).toHaveLength(1);
    await expect(page.getByRole("heading", { name: new RegExp(`^${groupName}`) })).toBeVisible();
    checks.push("编辑：分组保存冻结、防重复提交、失败重试后真实 SQLite 仅存一份");
    return checks;
  } finally {
    await page.evaluate(() => {
      const audit = window.__userJourneyEditingGate;
      if (!audit) return;
      audit.release(true);
      window.fetch = audit.originalFetch;
      delete window.__userJourneyEditingGate;
    });
  }
}

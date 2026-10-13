import { expect } from "@playwright/test";

export async function verifyModelEditorMotion(page) {
  const dialog = page.getByRole("dialog", { name: /编辑资料|添加模特/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  const reports = [];
  // Every column is visited in both directions, including image -> form transitions.
  for (const target of [1, 2, 3, 4, 5, 0, 5, 4, 3, 2, 1, 0]) {
    const frames = await page.evaluate(async (target) => {
      const root = document.querySelector(".model-editor-modal");
      const nav = root.querySelector(".model-editor-tabs");
      const panel = root.querySelector(".motion-panel-resizing");
      const selection = nav.querySelector(".model-editor-selection");
      const read = () => {
        const n = nav.getBoundingClientRect(),
          s = selection.getBoundingClientRect();
        const d = root.getBoundingClientRect();
        return {
          width: d.width,
          height: d.height,
          panel: panel.getBoundingClientRect().height,
          center: d.y + d.height / 2,
          selectionY: s.y - n.y,
          selectionX: s.x - n.x + nav.scrollLeft,
          selectionWidth: s.width,
          navWidth: nav.scrollWidth,
          navHeight: n.height,
        };
      };
      const frames = [read()];
      nav.querySelectorAll("button")[target].click();
      const until = performance.now() + 360;
      while (performance.now() < until) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        frames.push(read());
      }
      const selected = nav.querySelector('[data-checked="true"]');
      return {
        frames,
        x: selected.offsetLeft,
        width: selected.offsetWidth,
        reduced: document.documentElement.dataset.motion === "reduced",
      };
    }, target);
    const start = frames.frames[0],
      end = frames.frames.at(-1);
    expect(end.selectionX).toBeCloseTo(frames.x, 0);
    expect(end.selectionWidth).toBeCloseTo(frames.width, 0);
    for (const frame of frames.frames) {
      expect(frame.width).toBeCloseTo(start.width, 0);
      expect(frame.center).toBeCloseTo(start.center, 0);
      expect(frame.selectionY).toBeGreaterThanOrEqual(3);
      expect(frame.selectionY).toBeLessThanOrEqual(5);
      expect(frame.selectionX).toBeGreaterThanOrEqual(3);
      expect(frame.selectionX + frame.selectionWidth).toBeLessThanOrEqual(
        frame.navWidth + 1,
      );
    }
    const delta = Math.abs(end.panel - start.panel);
    const intermediate = frames.frames.filter(
      (frame) =>
        Math.abs(frame.panel - start.panel) > 1 &&
        Math.abs(frame.panel - end.panel) > 1,
    ).length;
    if (delta > 5 && !frames.reduced) expect(intermediate).toBeGreaterThan(1);
    if (frames.reduced) expect(intermediate).toBe(0);
    const dialogDelta = Math.abs(end.height - start.height);
    const dialogIntermediate = frames.frames.filter(
      (frame) =>
        Math.abs(frame.height - start.height) > 1 &&
        Math.abs(frame.height - end.height) > 1,
    ).length;
    if (dialogDelta > 5 && !frames.reduced)
      expect(dialogIntermediate).toBeGreaterThan(1);
    reports.push({
      target,
      heightChange: delta,
      intermediateFrames: intermediate,
      dialogHeightChange: dialogDelta,
      dialogIntermediateFrames: dialogIntermediate,
    });
    await expect(page.locator('[data-panel-present="false"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "保存", exact: true }),
    ).toBeInViewport();
  }
  expect(reports.some((report) => report.heightChange > 5)).toBe(true);
  await page.locator(".model-editor-tabs").evaluate((nav) => {
    for (const index of [2, 0, 1, 5, 3, 2, 4, 0])
      nav.querySelectorAll("button")[index].click();
  });
  await expect(page.getByLabel("模特名称", { exact: true })).toBeVisible();
  await expect(page.locator('[data-panel-present="false"]')).toHaveCount(0);
  return reports;
}

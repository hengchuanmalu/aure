import { expect, test } from "../support/browser.fixture";

for (const { route, count } of [
  { route: "library", count: 12 },
  { route: "tags", count: 12 },
  { route: "models/m0", count: 2 },
  { route: "favorites", count: 2 },
  { route: "recent", count: 1 },
]) {
  for (const initialView of ["stack", "cover"]) {
    test(`${route} first switch from ${initialView} preserves decoded covers and animates geometry`, async ({
      page,
    }) => {
      await page.goto(
        `/#/${route}${initialView === "cover" ? "?view=cover" : ""}`,
      );
      await expect(page.locator(`.album-card--${initialView}`)).toHaveCount(count);
      await expect(
        page.locator('.fan-front .photo-frame[data-photo-state="ready"]'),
      ).toHaveCount(count);
      if (initialView === "cover")
        await expect(page.locator(".fan-leaf")).toHaveCount(0);
      for (const target of initialView === "stack"
        ? ["cover", "stack"]
        : ["stack", "cover"]) {
        const frames = await page.evaluate((target) => {
          const card = document.querySelector(".album-card")!;
          const image = card.querySelector(".fan-front img")!;
          const frame = card.querySelector(".fan-front-layout")!;
          const rect = () => {
            const r = frame.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const before = rect();
          const results: {
            width: number;
            height: number;
            x: number;
            y: number;
            same: boolean;
            ready: boolean;
            transform: string;
            imageRatio: number;
            leafOpacity: number;
            leafTransform: string;
          }[] = [];
          const button = document.querySelector<HTMLButtonElement>(
            `button[aria-label="${target === "cover" ? "封面视图" : "叠放视图"}"]`,
          )!;
          button.click();
          const start = performance.now();
          return new Promise<{
            before: typeof before;
            results: typeof results;
          }>((resolve) => {
            const sample = () => {
              const imageRect = image.getBoundingClientRect();
              const leaf = card.querySelector(".fan-leaf");
              results.push({
                ...rect(),
                same: card.querySelector(".fan-front img") === image,
                imageRatio: imageRect.width / imageRect.height,
                ready:
                  card
                    .querySelector(".fan-front .photo-frame")
                    ?.getAttribute("data-photo-state") === "ready",
                transform: getComputedStyle(frame).transform,
                leafOpacity: leaf ? Number(getComputedStyle(leaf).opacity) : 0,
                leafTransform: leaf ? getComputedStyle(leaf).transform : "none",
              });
              if (performance.now() - start < 400)
                requestAnimationFrame(sample);
              else resolve({ before, results });
            };
            requestAnimationFrame(sample);
          });
        }, target);
        expect(frames.results.every((frame) => frame.same && frame.ready)).toBe(
          true,
        );
        // The changing crop frame must never squash the actual bitmap.
        for (const frame of frames.results)
          expect(frame.imageRatio).toBeCloseTo(
            frames.results.at(-1)!.imageRatio,
            1,
          );
        const last = frames.results.at(-1)!;
        expect(Math.abs(last.width - frames.before.width)).toBeGreaterThan(30);
        expect(
          frames.results.some(
            (frame) =>
              Math.abs(frame.width - frames.before.width) > 3 &&
              Math.abs(frame.width - last.width) > 3,
          ),
        ).toBe(true);
        if (target === "stack") {
          expect(
            frames.results.some(
              (frame) => frame.leafOpacity > 0 && frame.leafOpacity < 0.95,
            ),
          ).toBe(true);
          expect(
            frames.results.some(
              (frame) =>
                frame.leafTransform !== frames.results.at(-1)!.leafTransform,
            ),
          ).toBe(true);
        }
        await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
          "transform",
          "none",
        );
        await expect(page.locator(`.album-card--${target}`)).toHaveCount(count);
      }
      // Reversing mid-flight must keep the latest choice and release transforms.
      await page.evaluate(async () => {
        for (const label of ["封面视图", "叠放视图", "封面视图", "叠放视图"]) {
          document
            .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
            .click();
          await new Promise((resolve) => setTimeout(resolve, 45));
        }
      });
      await expect(page.locator(".album-card--stack")).toHaveCount(count);
      await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
        "transform",
        "none",
      );
      await expect(
        page.locator('.fan-front .photo-frame[data-photo-state="ready"]'),
      ).toHaveCount(count);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("button", { name: "封面视图", exact: true }).click();
      await expect(page.locator(".fan-front-layout").first()).toHaveCSS(
        "transform",
        "none",
      );
      await expect(page.locator(".fan-leaf").first()).toHaveCSS(
        "visibility",
        "hidden",
      );
    });
  }
}

for (const route of ["library", "tags"])
  for (const initialView of ["stack", "cover"])
    test(`${route} first pointer click from ${initialView} animates every existing card`, async ({
      page,
    }) => {
      await page.goto(
        `/#/${route}${initialView === "cover" ? "?view=cover" : ""}`,
      );
      await expect(
        page.locator('.fan-front .photo-frame[data-photo-state="ready"]'),
      ).toHaveCount(12);
      await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".album-card")];
        const traces = cards.map((card) => ({
          before: card
            .querySelector(".fan-front-layout")!
            .getBoundingClientRect().width,
          widths: [] as number[],
          opacity: [] as number[],
        }));
        (window as any).__firstSwitch = traces;
        document.querySelector(".view-switch")!.addEventListener(
          "click",
          () => {
            const start = performance.now();
            const sample = () => {
              cards.forEach((card, index) => {
                traces[index].widths.push(
                  card
                    .querySelector(".fan-front-layout")!
                    .getBoundingClientRect().width,
                );
                const leaf = card.querySelector(".fan-leaf");
                traces[index].opacity.push(
                  leaf ? Number(getComputedStyle(leaf).opacity) : 0,
                );
              });
              if (performance.now() - start < 450)
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          },
          { capture: true, once: true },
        );
      });
      await page
        .getByRole("button", {
          name: initialView === "stack" ? "封面视图" : "叠放视图",
          exact: true,
        })
        .click();
      await page.waitForTimeout(500);
      const traces = (await page.evaluate(
        () => (window as any).__firstSwitch,
      )) as { before: number; widths: number[]; opacity: number[] }[];
      for (const trace of traces) {
        expect(
          trace.widths.some(
            (width) =>
              Math.abs(width - trace.before) > 3 &&
              Math.abs(width - trace.widths.at(-1)!) > 3,
          ),
        ).toBe(true);
        if (initialView === "cover")
          expect(
            trace.opacity.some((opacity) => opacity > 0 && opacity < 0.95),
          ).toBe(true);
      }
    });

for (const route of ["library", "tags"])
  test(`${route} first stack to cover switch still animates after startup work delays its first frame`, async ({
    page,
  }) => {
    await page.goto(`/#/${route}`);
    await expect(
      page.locator('.fan-front .photo-frame[data-photo-state="ready"]'),
    ).toHaveCount(12);
    const widths = await page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>(".fan-front-layout")!;
      const widths = [frame.getBoundingClientRect().width];
      let blocked = false;
      const start = performance.now();
      document
        .querySelector<HTMLButtonElement>('button[aria-label="封面视图"]')!
        .click();
      return new Promise<number[]>((resolve) => {
        const sample = () => {
          widths.push(frame.getBoundingClientRect().width);
          if (!blocked && frame.style.transform) {
            blocked = true;
            // Model a cold WebView2 frame spending time on layout/image work.
            setTimeout(() => {
              const until = performance.now() + 300;
              while (performance.now() < until) {
                /* startup work */
              }
            }, 0);
          }
          if (performance.now() - start < 850) requestAnimationFrame(sample);
          else resolve(widths);
        };
        requestAnimationFrame(sample);
      });
    });
    expect(
      widths.filter(
        (width) =>
          Math.abs(width - widths[0]) > 3 &&
          Math.abs(width - widths.at(-1)!) > 3,
      ).length,
    ).toBeGreaterThan(2);
  });

test("a view change waits for valid geometry instead of consuming the first transition", async ({
  page,
}) => {
  await page.goto("/#/library");
  await expect(
    page.locator('.fan-front .photo-frame[data-photo-state="ready"]'),
  ).toHaveCount(12);
  const widths = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>(".album-grid")!;
    const frame = grid.querySelector<HTMLElement>(".fan-front-layout")!;
    const before = frame.getBoundingClientRect().width;
    grid.style.display = "none";
    document
      .querySelector<HTMLButtonElement>('button[aria-label="封面视图"]')!
      .click();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    grid.style.removeProperty("display");
    const widths = [before],
      start = performance.now();
    return new Promise<number[]>((resolve) => {
      const sample = () => {
        widths.push(frame.getBoundingClientRect().width);
        if (performance.now() - start < 450) requestAnimationFrame(sample);
        else resolve(widths);
      };
      requestAnimationFrame(sample);
    });
  });
  expect(
    widths.some(
      (width) =>
        Math.abs(width - widths[0]) > 3 && Math.abs(width - widths.at(-1)!) > 3,
    ),
  ).toBe(true);
});

for (const scroll of [1500, 1700])
  test(`view changes at ${scroll} in a large gallery keep the browsing anchor and bounded window`, async ({
    page,
  }) => {
    await page.goto("/#/library");
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem("jingji.mock.v1")!);
      const albums = db.albums;
      db.albums = Array.from({ length: 240 }, (_, index) => ({
        ...albums[index % albums.length],
        id: `large-${index}`,
        name: `写真 ${index}`,
        updated: 240 - index,
      }));
      localStorage.setItem("jingji.mock.v1", JSON.stringify(db));
    });
    await page.reload();
    await expect(page.locator('.album-card').first()).toBeVisible();
    await page.evaluate((scroll) => scrollTo(0, scroll), scroll);
    await page.waitForTimeout(150);
    const anchor = await page.evaluate(() => {
      const node = [
        ...document.querySelectorAll<HTMLElement>("[data-grid-id]"),
      ].find((node) => node.getBoundingClientRect().bottom > 120)!;
      (window as any).__anchorImage = node.querySelector(".fan-front img");
      return {
        id: node.dataset.gridId!,
        top: node.getBoundingClientRect().top,
      };
    });
    for (const label of ["封面视图", "叠放视图"]) {
      await page.evaluate(
        (label) =>
          document
            .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
            .click(),
        label,
      );
      await page.waitForTimeout(400);
      const current = await page
        .locator(`[data-grid-id="${anchor.id}"]`)
        .evaluate((node) => ({
          top: node.getBoundingClientRect().top,
          same:
            node.querySelector(".fan-front img") ===
            (window as any).__anchorImage,
        }));
      expect(current.same).toBe(true);
      expect(Math.abs(current.top - anchor.top)).toBeLessThanOrEqual(1);
      expect(await page.locator("[data-grid-id]").count()).toBeLessThan(80);
    }
  });

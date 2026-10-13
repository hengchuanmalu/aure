import { expect, test } from "../support/browser.fixture";
import { seedFixture } from "../support/demo.fixture";

test.use({ hasTouch: true, viewport: { width: 1440, height: 960 } });

test("a continuous touch gesture can reverse during docking and continue browsing", async ({
  page,
}) => {
  const db = seedFixture();
  const media = Array.from({ length: 80 }, (_, index) => ({
    ...db.media[0],
    id: `touch-magnet-${index}`,
  }));
  db.media.push(...media);
  db.albums[0].mediaIds = media.map((item) => item.id);
  await page.addInitScript(
    (full) => localStorage.setItem("jingji.mock.v1", JSON.stringify(full)),
    db,
  );
  await page.goto("/#/album/a0");
  const browse = page.locator(".album-browse");
  await expect(browse).toHaveAttribute("data-docked", "false");
  await expect(page.locator(".album-hero-cover")).toHaveAttribute(
    "data-photo-state",
    "ready",
  );
  const button = await browse.elementHandle();
  const session = await page.context().newCDPSession(page);
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd",
    y: number,
  ) => {
    await session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [{ x: 1000, y, radiusX: 1, radiusY: 1, id: 1 }],
    });
  };
  try {
    await touch("touchStart", 900);
    for (const y of [850, 650, 500, 480, 470, 466, 462, 458]) {
      await touch("touchMove", y);
      await page.waitForTimeout(12);
      if ((await browse.getAttribute("data-docked")) === "true") break;
    }
    await expect(browse).toHaveAttribute("data-docked", "true");
    const contactScroll = await page.evaluate(() => scrollY);
    // Reverse without lifting the finger: no second touchstart cancels the snap.
    await touch("touchMove", 700);
    await expect(browse).toHaveAttribute("data-docked", "false");
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeLessThan(contactScroll - 100);
    const reversedScroll = await page.evaluate(() => scrollY);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(reversedScroll);
    await touch("touchEnd", 700);

    const forwardStart = await page.evaluate(() => scrollY);
    await touch("touchStart", 900);
    for (const y of [850, 650, 450, 250]) {
      await touch("touchMove", y);
      await page.waitForTimeout(20);
    }
    // Stop before lifting, so the next reduced-motion check has no native fling.
    await page.waitForTimeout(300);
    await touch("touchEnd", 250);
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(forwardStart + 300);
    await expect(browse).toHaveAttribute("data-docked", "true");
    expect(
      await browse.evaluate(
        (element, original) => element === original,
        button,
      ),
    ).toBe(true);
    const alignment = () =>
      browse.evaluate((element) => {
        const current = element.getBoundingClientRect();
        const target = document
          .querySelector(".album-browse-target")!
          .getBoundingClientRect();
        return (
          Math.abs(current.left - target.left) +
          Math.abs(current.top - target.top)
        );
      });
    await expect.poll(alignment).toBeLessThan(1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    await page.evaluate(() => scrollTo(0, 0));
    await expect(browse).toHaveAttribute("data-docked", "false");
    await page.evaluate(() => {
      const origin = document
        .querySelector(".album-browse-origin")!
        .getBoundingClientRect();
      const edit = document
        .querySelector(".topbar-action-group > button")!
        .getBoundingClientRect();
      const header = document.querySelector(".topbar")!.getBoundingClientRect();
      scrollTo(0, origin.top + scrollY - (edit.bottom - header.top + 6));
    });
    await expect(browse).toHaveAttribute("data-docked", "true");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const content = document
            .querySelector(".album-content-toolbar")!
            .getBoundingClientRect();
          const header = document
            .querySelector(".topbar")!
            .getBoundingClientRect();
          return Math.abs(content.top - header.bottom);
        }),
      )
      .toBeLessThan(1);
  } finally {
    await touch("touchEnd", 0).catch(() => {});
    await session.detach();
  }
});

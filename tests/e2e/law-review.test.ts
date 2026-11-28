import { expect, test } from "bun:test"
import { chromium } from "playwright-core"

const chrome = process.env.REELS_CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome")

test("law warnings cover titles, unillustrated subtitles and thoughts instead of only page inserts", async () => {
  const bundle = await Bun.build({ entrypoints: ["tests/e2e/law-review-fixture.ts"], target: "browser" })
  const output = bundle.outputs[0]
  if (!bundle.success || output === undefined) throw new Error("Could not build the law review fixture")
  const script = await output.text()
  const browser = await chromium.launch({ executablePath: chrome, headless: true })
  try {
    const page = await browser.newPage()
    await page.route("http://studio.test/**", (route) => route.fulfill({
      contentType: route.request().url().endsWith(".js") ? "text/javascript" : "text/html",
      body: route.request().url().endsWith(".js") ? script : '<script type="module" src="/fixture.js"></script>'
    }))
    await page.goto("http://studio.test/")
    await page.waitForSelector(".hint--warn")
    expect(await page.locator(".hint--warn").allTextContents()).toEqual([
      "В этом тексте закона нет статьи 900. Проверьте номер.",
      "В этом тексте закона нет статьи 901. Проверьте номер.",
      "В этом тексте закона нет статьи 902. Проверьте номер.",
      "В этом тексте закона нет статьи 903. Проверьте номер.",
      "В этом тексте закона нет статьи 904. Проверьте номер."
    ])
    await page.getByRole("button", { name: "901", exact: true }).click()
    const field = page.getByRole("textbox", { name: "Исправить слово «901»" })
    await field.fill("620")
    await field.press("Enter")
    expect(await page.locator(".hint--warn").allTextContents()).not.toContain("В этом тексте закона нет статьи 901. Проверьте номер.")
    await page.locator("#without-law").click()
    expect(await page.locator(".hint--warn").count()).toBe(0)
  } finally { await browser.close() }
}, 30000)

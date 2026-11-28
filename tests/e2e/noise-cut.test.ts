import { expect, test } from "bun:test"
import { chromium } from "playwright-core"

test("a noise source switch during a cut does not restart the outgoing voice under the incoming one", async () => {
  const bundle = await Bun.build({ entrypoints: ["tests/e2e/noise-cut-fixture.ts"], target: "browser" })
  const output = bundle.outputs[0]
  if (!bundle.success || output === undefined) throw new Error("Could not build the noise cut fixture")
  const script = await output.text()
  const command = process.env.REELS_CHROME ?? "google-chrome"
  const browser = await chromium.launch({ executablePath: Bun.which(command) ?? command, headless: true })
  try {
    const page = await browser.newPage()
    await page.route("http://studio.test/**", (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script })
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<script type="module" src="/fixture.js"></script>' })
      return route.fulfill({ status: 404 })
    })
    await page.goto("http://studio.test/")
    expect(await page.locator("body").textContent()).toBe(JSON.stringify({
      beforeCut: ["first.mp4"], duringCut: [], afterCut: ["second.mp4"]
    }))
  } finally {
    await browser.close()
  }
}, 30000)

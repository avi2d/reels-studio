import { PASSING } from "../unit/reel-check-fixtures.ts"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser, type Locator, type Page } from "playwright-core"
import type { ReelView } from "../../src/shared/reel.ts"

let browser: Browser
let server: ReturnType<typeof Bun.serve>

const file = { made: "2026-01-01T00:00:00.000Z", seconds: 7, apps: [{ app: "Instagram", size: 1000 }], fresh: true, face: "off" } satisfies NonNullable<ReelView["file"]>
const unbuilt = { job: { state: "idle" }, cut: 7, face: "off", checks: PASSING } satisfies ReelView
const ready = { ...unbuilt, file: { ...file, checks: PASSING } } satisfies ReelView
const offline = "Нет связи со студией. Проверьте Wi-Fi."

beforeAll(async () => {
  const executablePath = Bun.which("google-chrome")
  if (executablePath === null) throw new Error("google-chrome is required for the done-step browser regressions")
  const bundle = await Bun.build({ entrypoints: ["src/web/studio/done.ts"], target: "browser" })
  if (!bundle.success) throw new AggregateError(bundle.logs, "Cannot bundle the done step")
  const script = await new Response(bundle.outputs[0]).text()
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => new URL(request.url).pathname === "/done.js"
      ? new Response(script, { headers: { "content-type": "text/javascript" } })
      : new Response('<!doctype html><body><script type="module">import { doneStep } from "/done.js"; document.body.append(doneStep("review").body)</script></body>', { headers: { "content-type": "text/html" } })
  })
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] })
}, 15_000)

afterAll(async () => {
  await browser.close()
  await server.stop(true)
})

const withPage = async (run: (page: Page) => Promise<void>): Promise<void> => {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  try {
    await run(page)
  } finally {
    await page.close()
  }
}

const open = async (page: Page): Promise<unknown> => {
  await page.route("**/api/projects/review/posts", (route) => route.fulfill({ json: { posts: [] } }))
  return page.goto(server.url.href)
}

const stepAlert = (page: Page): Locator => page.locator(".body--done > [role=alert]")

test("a 3:10 edit blocks rebuild but does not hide the checked 2:50 download", () => withPage(async (page) => {
  const checked = { ...PASSING, length: { id: "length", seconds: 170 } } as const
  const view = {
    ...ready, cut: 190, checks: { ...checked, length: { id: "length", seconds: 190 } },
    file: { ...file, fresh: false, seconds: 170, checks: checked }
  } satisfies ReelView
  await page.route("**/api/projects/review/reel", (route) => route.fulfill({ json: view }))
  await open(page)
  await page.getByRole("link", { name: "Скачать", exact: true }).waitFor()
  const rebuild = page.getByRole("button", { name: "Собрать заново", exact: true })
  expect(await rebuild.isDisabled()).toBe(true)
  const list = page.getByRole("region", { name: "Проверка перед скачиванием" })
  expect(await list.getByText("Ролик идёт 2:50.", { exact: true }).count()).toBe(1)
  expect(await page.getByText(/Ролик идёт 3:10/).count()).toBe(1)
}))

test("a valid cut leaves the unchecked 3:30 file playable but does not offer its download", () => withPage(async (page) => {
  const view = {
    ...ready, cut: 170, checks: { ...PASSING, length: { id: "length", seconds: 170 } },
    file: { ...file, seconds: 210, fresh: false }
  } satisfies ReelView
  await page.route("**/api/projects/review/reel", (route) => route.fulfill({ json: view }))
  await open(page)
  const rebuild = page.getByRole("button", { name: "Собрать заново", exact: true })
  await rebuild.waitFor()
  expect(await rebuild.isEnabled()).toBe(true)
  expect(await page.locator("video").isVisible()).toBe(true)
  expect(await page.getByRole("link", { name: "Скачать", exact: true }).count()).toBe(0)
}))

test("a fresh file built before build checks asks for a rebuild instead of showing the current cut's passing checks", () => withPage(async (page) => {
  const view = { ...ready, file } satisfies ReelView
  await page.route("**/api/projects/review/reel", (route) => route.fulfill({ json: view }))
  await open(page)
  await page.getByText("Для скачивания соберите ролик заново.", { exact: true }).waitFor()
  expect(await page.locator("video").isVisible()).toBe(true)
  expect(await page.getByRole("link", { name: "Скачать", exact: true }).count()).toBe(0)
  expect(await page.getByRole("button", { name: "Собрать заново", exact: true }).isEnabled()).toBe(true)
  expect(await page.getByRole("region", { name: "Проверка перед скачиванием" }).isVisible()).toBe(false)
  expect(await page.getByText("Скачать ролик можно, когда пройдены все проверки выше.", { exact: true }).count()).toBe(0)
}))

test("an offline idle poll does not leave an alert after the built reel reconnects", () => withPage(async (page) => {
  let polls = 0
  await page.route("**/api/projects/review/reel", async (route) => {
    polls += 1
    if (polls === 2) await route.abort("internetdisconnected")
    else await route.fulfill({ json: polls < 3 ? ready : { ...ready, file: { ...ready.file, fresh: false } } })
  })
  await open(page)
  await page.getByRole("heading", { name: "Ролики готовы", exact: true }).waitFor()
  await page.getByRole("heading", { name: "Ролики устарели", exact: true }).waitFor({ timeout: 10_000 })
  expect(polls).toBeGreaterThanOrEqual(3)
  expect(await stepAlert(page).textContent()).toBe("")
}), 15_000)

for (const kept of [false, true]) {
  test(`a failed ${kept ? "rebuild" : "first build"} keeps its action error after a successful idle refresh instead of hiding it`, () => withPage(async (page) => {
    const view = kept ? ready : unbuilt
    let refreshes = 0
    await page.route("**/api/projects/review/reel", async (route) => {
      if (route.request().method() === "POST") await route.abort("internetdisconnected")
      else {
        refreshes += 1
        await route.fulfill({ json: view })
      }
    })
    await open(page)
    const build = page.getByRole("button", { name: kept ? "Собрать заново" : "Собрать ролик", exact: true })
    await build.waitFor()
    const refreshed = page.waitForResponse((response) => response.request().method() === "GET" && response.url().endsWith("/reel"))
    await build.click()
    await refreshed
    await stepAlert(page).filter({ hasText: offline }).waitFor()
    expect(refreshes).toBeGreaterThanOrEqual(2)
    expect(await stepAlert(page).textContent()).toBe(offline)
  }))

  for (const noFace of ["short-cut", "unseen"] as const) {
    test(`a ${noFace} failure ${kept ? "with" : "without"} an earlier file names «Как есть», not a missing face option`, () => withPage(async (page) => {
      const view: ReelView = { ...(kept ? ready : unbuilt), job: { state: "failed", noFace } }
      await page.route("**/api/projects/review/reel", (route) => route.fulfill({ json: view }))
      await open(page)
      const alert = stepAlert(page)
      await alert.filter({ hasText: "Ролик не собрался" }).waitFor()
      const message = await alert.textContent()
      expect(message).toContain("выберите для лица «Как есть»")
      expect(message).not.toContain("Не трогать")
    }))
  }

  test(`a general failure ${kept ? "with" : "without"} an earlier file does not name the wrong build button`, () => withPage(async (page) => {
    const view: ReelView = { ...(kept ? ready : unbuilt), job: { state: "failed" } }
    await page.route("**/api/projects/review/reel", (route) => route.fulfill({ json: view }))
    await open(page)
    const alert = stepAlert(page)
    await alert.filter({ hasText: "Ролик не собрался" }).waitFor()
    await page.getByRole("button", { name: kept ? "Собрать заново" : "Собрать ролик", exact: true }).waitFor()
    expect(await alert.textContent()).toBe("Ролик не собрался. Подробности в журнале студии. Попробуйте собрать ролик ещё раз.")
  }))
}

test("a failed cancel keeps its action error after an idle refresh instead of hiding it", () => withPage(async (page) => {
  let cancelled = false
  await page.route("**/api/projects/review/reel", (route) => route.fulfill({
    json: cancelled ? ready : { ...ready, job: { state: "running", done: 0.5 } }
  }))
  await page.route("**/api/projects/review/reel/build", async (route) => {
    cancelled = true
    await route.abort("internetdisconnected")
  })
  await open(page)
  const cancel = page.getByRole("button", { name: "Остановить", exact: true })
  await cancel.waitFor()
  await cancel.click()
  await page.getByRole("heading", { name: "Ролики готовы", exact: true }).waitFor()
  expect(await stepAlert(page).textContent()).toBe(offline)
}))

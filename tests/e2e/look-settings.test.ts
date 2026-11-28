import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { chromium, type Browser, type Page, type Route } from "playwright-core"
import { Schema } from "effect"
import { NewLooks, type ExampleLook, type LooksView } from "../../src/shared/looks.ts"
import { NO_EDITS, type TimelinePage } from "../../src/shared/timeline.ts"

let browser: Browser
let server: ReturnType<typeof Bun.serve>
let directory: string
const cleanups: Array<() => Promise<unknown>> = []

const example: ExampleLook = {
  took: ["Заголовок по центру"],
  subtitles: { font: "sans", colour: "#ffffff", outline: null, box: "#e63b5b", capitals: true },
  title: "middle"
}
const initial: LooksView = { subtitles: { style: "brand", size: "normal" }, plate: { shown: false, text: "Мария" }, example }
const decodeChange = Schema.decodeUnknownSync(NewLooks)
const rejected = "Сначала приложите пример ролика к заданию или в чате."
const timeline: TimelinePage = {
  looks: [], faces: [], pictures: [], sources: [], inserts: { state: "none" }, zooms: { state: "none" }, doubts: { state: "none" },
  texts: { state: "ready", planned: [{ id: "title", video: "a.mp4", from: 0, to: 0, lines: [{ text: "Аванс", accent: true }] }] },
  timeline: { state: "ready", dropped: 0, edits: NO_EDITS, rest: 0.2, zoom: "off", blocks: [
    { id: "first", title: "Начало", takes: [{ video: "a.mp4", from: 0, to: 0, reason: "" }] },
    { id: "second", title: "Конец", takes: [{ video: "a.mp4", from: 1, to: 1, reason: "" }] }
  ] },
  gathering: false, gatherFailed: false
}

beforeAll(async () => {
  const executablePath = Bun.which("google-chrome")
  if (executablePath === null) throw new Error("google-chrome is required for look-settings browser regressions")
  if (Bun.which("ffmpeg") === null) throw new Error("ffmpeg is required for look-settings playback")
  await mkdir("node_modules/.cache", { recursive: true })
  directory = await mkdtemp("node_modules/.cache/look-settings-")
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const media = Bun.spawn(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x284:r=30:d=8",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", `${directory}/a.mp4`], { stderr: "inherit" })
  if (await media.exited !== 0) throw new Error("Cannot generate look-settings playback")
  const bundle = await Bun.build({ entrypoints: ["src/web/studio/look.ts"], target: "browser" })
  if (!bundle.success) throw new AggregateError(bundle.logs, "Cannot bundle the look step")
  const script = await new Response(bundle.outputs[0]).text()
  const css = await Promise.all(["src/web/frame.css", "src/web/studio/look.css"].map((path) => Bun.file(path).text()))
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === "/look.js") return new Response(script, { headers: { "content-type": "text/javascript" } })
      if (path.endsWith("/timeline")) return Response.json(timeline)
      if (path.endsWith("/videos")) return Response.json({ videos: [{ name: "a.mp4", state: "ready", transcript: {
        duration: 8, words: [{ text: "Аванс", start: 0, end: 4 }, { text: "Конец", start: 4, end: 8 }]
      } }] })
      if (path.endsWith("/preview")) return new Response(Bun.file(`${directory}/a.mp4`))
      if (path.endsWith("/retouch")) return Response.json({ job: { state: "idle" }, cut: 8, face: "off" })
      if (path.endsWith("/sound")) return Response.json({ job: { state: "idle" } })
      return new Response(`<!doctype html><style>${css.join("\n")}</style><body><script type="module">
        import { lookStep } from "/look.js";
        const step = lookStep("review");
        document.body.append(step.body);
        window.addEventListener("pagehide", step.dispose);
      </script></body>`, { headers: { "content-type": "text/html" } })
    }
  })
  cleanups.push(() => server.stop(true))
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] })
  cleanups.push(() => browser.close())
}, 20_000)

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
})

const withPage = async (saved: LooksView, save: (route: Route, change: NewLooks) => Promise<void>, run: (page: Page) => Promise<void>): Promise<void> => {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  await page.route("**/api/projects/review/looks", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: saved })
    : save(route, decodeChange(route.request().postDataJSON())))
  try {
    await page.goto(server.url.href)
    await page.getByRole("radio", { name: /Ваш стиль$/u }).waitFor()
    await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]') !== null)
    await run(page)
  } finally {
    await page.close()
  }
}

test("a trim of the same recording does not reload its cleaned preview, but a manual noise switch does", async () => {
  const page = await browser.newPage()
  try {
    const ready = timeline.timeline
    if (ready.state !== "ready") throw new Error("The fixture needs a ready cut")
    let trimmed = false
    await page.route("**/api/projects/review/timeline", (route) => route.fulfill({ json: trimmed
      ? { ...timeline, timeline: { ...ready, edits: { ...ready.edits, deleted: ["second"] } } }
      : { ...timeline, gathering: true } }))
    await page.route("**/api/projects/review/noise", (route) =>
      route.fulfill({ json: { job: { state: "idle" }, noise: "strong", cleaned: { made: "fixture" } } }))
    await page.route("**/api/projects/review/noise/choice", (route) =>
      route.fulfill({ json: { job: { state: "idle" }, noise: "light", cleaned: { made: "fixture" } } }))
    await page.route("**/noise/*/a.mp4?made=*", (route) =>
      route.fulfill({ contentType: "video/mp4", path: `${directory}/a.mp4` }))
    await page.goto(server.url.href)
    const video = page.locator('video[src*="/noise/strong/"]')
    await video.waitFor({ state: "attached" })
    await video.evaluate((node) => {
      const count = () => {
        node.dataset.sourceChanges = String(Number(node.dataset.sourceChanges) + 1)
      }
      node.dataset.sourceChanges = "0"
      new MutationObserver((records) => records.forEach(count)).observe(node, { attributeFilter: ["src"] })
    })
    trimmed = true
    await page.getByText("0:00 / 0:04", { exact: true }).waitFor()
    expect(await video.getAttribute("data-source-changes", { timeout: 2000 })).toBe("0")
    await page.getByRole("button", { name: "Убрать слегка", exact: true }).click()
    const light = page.locator('video[src*="/noise/light/"]')
    await light.waitFor({ state: "attached" })
    expect(await light.getAttribute("data-source-changes")).toBe("1")
  } finally {
    await page.close()
  }
}, 15_000)

for (const control of ["style", "size", "plate"] as const) {
  test(`a rejected ${control} save restores confirmed controls and preview instead of showing an unsaved choice`, () =>
    withPage(initial, (route) => route.fulfill({ status: 400, json: { error: rejected } }), async (page) => {
      if (control === "style") await page.getByRole("radio", { name: /Как в примере$/u }).click()
      if (control === "size") await page.getByRole("button", { name: "Крупные", exact: true }).click()
      if (control === "plate") await page.getByRole("switch").click()
      await page.getByRole("alert").filter({ hasText: rejected }).waitFor()
      expect(await page.getByRole("radio", { name: /Ваш стиль$/u }).getAttribute("aria-checked")).toBe("true")
      expect(await page.getByRole("button", { name: "Обычные", exact: true }).getAttribute("aria-pressed")).toBe("true")
      expect(await page.getByRole("switch").isChecked()).toBe(false)
      expect(await page.locator(".look-subtitle").getAttribute("data-font")).toBe("serif")
      expect(await page.locator(".plate-preview").isVisible()).toBe(false)
    }))
}

test("a rejected name edit restores the preview but keeps the focused draft instead of showing unsaved text on the reel", () =>
  withPage({ ...initial, plate: { shown: true, text: "Мария" } }, (route) => route.fulfill({ status: 400, json: { error: rejected } }), async (page) => {
    const input = page.getByRole("textbox", { name: "Текст плашки" })
    await input.fill("Анна")
    await page.getByRole("alert").filter({ hasText: rejected }).waitFor()
    expect(await input.inputValue()).toBe("Анна")
    expect(await page.locator(".plate-preview").textContent()).toBe("Мария")
  }))

test("a failed name save on blur keeps the typed text and sends it again instead of reverting the input", () => {
  const sent: Array<NewLooks> = []
  return withPage({ ...initial, plate: { shown: true, text: "Мария" } }, async (route, change) => {
    sent.push(change)
    await route.fulfill({ status: 400, json: { error: rejected } })
  }, async (page) => {
    const input = page.getByRole("textbox", { name: "Текст плашки" })
    await input.fill("Анна")
    const failed = page.waitForResponse((response) => response.request().method() === "PUT")
    await input.evaluate((node) => { node.blur() })
    await failed
    await page.getByRole("alert").filter({ hasText: rejected }).waitFor()
    expect(await input.inputValue()).toBe("Анна")
    expect(await page.locator(".plate-preview").textContent()).toBe("Мария")
    const again = page.waitForResponse((response) => response.request().method() === "PUT")
    await page.getByRole("switch").click()
    await again
    expect(sent.at(-1)?.plate?.text).toBe("Анна")
  })
})

test("a late success of an older save becomes the confirmed view after a newer save fails instead of being dropped", () => {
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  return withPage(initial, async (route, change) => {
    calls += 1
    if (calls === 1) {
      await held
      await route.fulfill({ json: { ...initial, ...change } })
    } else await route.fulfill({ status: 400, json: { error: rejected } })
  }, async (page) => {
    const firstRequest = page.waitForRequest((request) => request.method() === "PUT")
    await page.getByRole("button", { name: "Крупные", exact: true }).click()
    await firstRequest
    await page.getByRole("radio", { name: /Жёлтая плашка$/u }).click()
    await page.getByRole("alert").filter({ hasText: rejected }).waitFor()
    release?.()
    await page.locator('button[aria-pressed="true"]', { hasText: "Крупные" }).waitFor()
    expect(await page.getByRole("radio", { name: /Ваш стиль$/u }).getAttribute("aria-checked")).toBe("true")
    expect(await page.getByRole("alert").filter({ hasText: rejected }).textContent()).toBe(rejected)
  })
})

test("an earlier plate reply does not replace a newer debounced name in the preview", () => {
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  return withPage({ ...initial, plate: { shown: true, text: "Мария" } }, async (route, change) => {
    calls += 1
    if (calls === 1) await held
    await route.fulfill({ json: { ...initial, plate: change.plate } })
  }, async (page) => {
    const input = page.getByRole("textbox", { name: "Текст плашки" })
    const firstRequest = page.waitForRequest((request) => request.method() === "PUT")
    await input.fill("Анна")
    await firstRequest
    await page.clock.install()
    await input.fill("Анна Белова")
    const firstReply = page.waitForResponse((response) => response.request().method() === "PUT")
    release?.()
    await firstReply
    await page.clock.runFor(50)
    expect(await page.locator(".plate-preview").textContent()).toBe("Анна Белова")
    expect(await input.inputValue()).toBe("Анна Белова")
    const secondReply = page.waitForResponse((response) => response.request().method() === "PUT")
    await page.clock.runFor(600)
    await secondReply
    expect(calls).toBe(2)
    expect(await page.locator(".plate-preview").textContent()).toBe("Анна Белова")
  })
})

test("the example title centres in the app clear zone and returns to the top for other looks instead of staying fixed", () =>
  withPage(initial, (route, change) => route.fulfill({ json: { ...initial, ...change } }), async (page) => {
    await page.getByRole("button", { name: "Смотреть ролик", exact: true }).click()
    await page.locator(".thought-preview .accent").waitFor()
    await page.getByRole("radio", { name: /Как в примере$/u }).click()
    await page.waitForFunction(() => document.querySelector(".look-subtitle")?.getAttribute("data-font") === "sans")
    const centre = await page.locator(".thought-preview").evaluate((node) => {
      const frame = node.parentElement?.getBoundingClientRect()
      const title = node.getBoundingClientRect()
      if (frame === undefined) throw new Error("Missing frame")
      return (title.y + title.height / 2 - frame.y) / frame.height * 1920
    })
    expect(centre).toBeCloseTo(855, 0)
    await page.getByRole("radio", { name: /Ваш стиль$/u }).click()
    await page.waitForFunction(() => document.querySelector(".look-subtitle")?.getAttribute("data-font") === "serif")
    const top = await page.locator(".thought-preview").evaluate((node) => {
      const frame = node.parentElement?.getBoundingClientRect()
      if (frame === undefined) throw new Error("Missing frame")
      return (node.getBoundingClientRect().y - frame.y) / frame.height * 1920
    })
    expect(top).toBeCloseTo(208, 0)
  }))

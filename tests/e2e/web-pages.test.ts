import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, Schema } from "effect"
import { Attachments } from "../../src/server/attachments.ts"
import { Projects } from "../../src/server/projects.ts"
import { Settings } from "../../src/server/settings.ts"
import { AT_HOME, NOT_OPENED, WebPageAddress } from "../../src/server/web-page-access.ts"
import { WebPages } from "../../src/server/web-pages.ts"
import { WebPagesFile } from "../../src/shared/web-pages.ts"
import { projectAt } from "../unit/server-fixtures.ts"

const chrome = process.env.REELS_CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome")
const actualAddress = Effect.runSync(WebPageAddress)
const unavailable = () => Effect.die("unexpected attachment call")

const saved = (dir: string, address: string) => Effect.runPromise(Effect.gen(function*() {
  return yield* Effect.result((yield* WebPages).save("project", address))
}).pipe(Effect.provide(WebPages.layer.pipe(Layer.provide(Layer.mergeAll(
  BunServices.layer,
  Layer.succeed(Projects, projectAt(dir)),
  Layer.succeed(Attachments, Attachments.of({
    describe: () => Effect.succeed("saved page"), show: unavailable, examine: unavailable, allSeen: unavailable,
    listed: unavailable, cover: unavailable, clip: unavailable, page: unavailable
  })),
  Layer.succeed(Settings, Settings.of({
    host: "127.0.0.1", port: 8765, projectsDir: dir, pi: "pi", models: [],
    root: process.cwd(), heavy: [], encoder: "libx264", chrome
  })),
  Layer.succeed(WebPageAddress, (host) => host === "outside.test" || host === "localhost" ? Effect.succeed({ address: "127.0.0.1", family: 4 }) : actualAddress(host))
))))))

test("an outside page keeps its PDF and licence from one load, not a second unguarded browser", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/web-page-")
  let loads = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname
      const page = new URL("/page", request.url).href
      if (path === "/redirect") return Response.redirect(page)
      if (path === "/js-redirect") return new Response(`<script>location.href=${JSON.stringify(page)}</script>`, { headers: { "content-type": "text/html" } })
      if (path === "/page") loads++
      return new Response('<h1>Статья 620</h1><a rel="license" href="/terms">CC BY 4.0</a>', { headers: { "content-type": "text/html" } })
    }
  })
  try {
    for (const path of ["/page", "/redirect", "/js-redirect"]) {
      const folder = `${dir}${path}`
      await mkdir(folder)
      const before = loads
      const result = await saved(folder, `http://outside.test:${server.port}${path}`)
      expect(result._tag).toBe("Success")
      if (result._tag !== "Success") throw result.failure
      expect(result.success.licence).toBe("CC BY 4.0")
      expect((await readFile(`${folder}/attached/${result.success.file}`)).subarray(0, 5).toString()).toBe("%PDF-")
      const record = Schema.decodeUnknownSync(Schema.fromJsonString(WebPagesFile))(await readFile(`${folder}/web-pages.json`, "utf8"))
      expect(record.pages).toHaveLength(1)
      expect(record.pages[0]?.address).toBe(`http://outside.test:${server.port}${path}`)
      expect(loads - before).toBe(1)
    }
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)

test("home requests and unfilterable workers leave no PDF or source record", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  let privateHits = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname
      const privateUrl = `http://127.0.0.1:${server.port}/private`
      if (path === "/private") { privateHits++; return new Response("private") }
      if (path === "/redirect") return Response.redirect(privateUrl)
      const pages: Readonly<Record<string, string>> = {
        "/frame": `<iframe src="${privateUrl}"></iframe>`,
        "/image": `<img src="${privateUrl}">`,
        "/script": `<script src="${privateUrl}"></script>`,
        "/js-redirect": `<script>location.href=${JSON.stringify(privateUrl)}</script>`,
        "/fetch": `<script>fetch(${JSON.stringify(privateUrl)})</script>`,
        "/xhr": `<script>const x=new XMLHttpRequest();x.open("GET",${JSON.stringify(privateUrl)});x.send()</script>`,
        "/socket": `<script>new WebSocket(${JSON.stringify(privateUrl.replace("http:", "ws:"))})</script>`,
        "/worker": `<script>new Worker("/worker.js")</script>`,
        "/worker.js": `fetch(${JSON.stringify(privateUrl)})`,
        "/service-worker": '<script>navigator.serviceWorker.register("/worker.js")</script>'
      }
      return new Response(pages[path] ?? "", { headers: { "content-type": path.endsWith(".js") ? "text/javascript" : "text/html" } })
    }
  })
  try {
    for (const path of ["/redirect", "/frame", "/image", "/script", "/js-redirect", "/fetch", "/xhr", "/socket", "/worker", "/service-worker"]) {
      const dir = await mkdtemp("node_modules/.cache/web-page-")
      try {
        const host = path === "/service-worker" ? "localhost" : "outside.test"
        const result = await saved(dir, `http://${host}:${server.port}${path}`)
        expect(result._tag).toBe("Failure")
        if (result._tag !== "Failure") throw new Error("A home-network request was saved")
        expect(result.failure.message).toBe(path.endsWith("worker") ? NOT_OPENED : AT_HOME)
        expect(await readdir(`${dir}/attached`).catch(() => [])).toEqual([])
        expect(await Bun.file(`${dir}/web-pages.json`).exists()).toBe(false)
        expect(privateHits).toBe(0)
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
  } finally { await server.stop(true) }
}, 60000)

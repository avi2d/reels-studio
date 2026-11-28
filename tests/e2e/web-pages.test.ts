import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer, Result, Schema } from "effect"
import { Attachments } from "../../src/server/attachments.ts"
import { Projects } from "../../src/server/projects.ts"
import { Settings } from "../../src/server/settings.ts"
import { AT_HOME, WebPageAddress } from "../../src/server/web-page-access.ts"
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
  Layer.succeed(WebPageAddress, (host) => host === "outside.test" || host === "localhost" ? Effect.succeed({ address: "127.0.0.1", family: 4 }) : actualAddress(host === "sink.test" ? "0.0.0.0" : host))
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
      expect(Result.isSuccess(result)).toBe(true)
      if (!Result.isSuccess(result)) throw result.failure
      expect(result.success.licence).toBe("CC BY 4.0")
      expect((await readFile(`${folder}/attached/${result.success.file}`)).subarray(0, 5).toString()).toBe("%PDF-")
      const record = Schema.decodeSync(Schema.fromJsonString(WebPagesFile))(await readFile(`${folder}/web-pages.json`, "utf8"))
      expect(record.pages).toHaveLength(1)
      expect(record.pages[0]?.address).toBe(`http://outside.test:${server.port}${path}`)
      expect(loads - before).toBe(1)
    }
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)

test("an outside page keeps its PDF when a cross-site iframe on it loads, not fails on freezing the frame", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/web-frame-")
  const paths = new Set<string>()
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname
      paths.add(path)
      const pages: Readonly<Record<string, string>> = {
        "/page": `<h1>Статья 620</h1><a rel="license">CC BY 4.0</a><iframe src="http://localhost:${server.port}/frame"></iframe>`,
        "/frame": "<p>embedded</p>"
      }
      return new Response(pages[path] ?? "", { headers: { "content-type": "text/html" } })
    }
  })
  try {
    const result = await saved(dir, `http://outside.test:${server.port}/page`)
    expect(Result.isSuccess(result)).toBe(true)
    if (!Result.isSuccess(result)) throw result.failure
    expect(result.success.licence).toBe("CC BY 4.0")
    expect((await readFile(`${dir}/attached/${result.success.file}`)).subarray(0, 5).toString()).toBe("%PDF-")
    expect(paths.has("/frame")).toBe(true)
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)

test("home requests leave no PDF or source record", async () => {
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
        "/socket": `<script>new WebSocket(${JSON.stringify(privateUrl.replace("http:", "ws:"))})</script>`
      }
      return new Response(pages[path] ?? "", { headers: { "content-type": "text/html" } })
    }
  })
  try {
    for (const path of ["/redirect", "/frame", "/image", "/script", "/js-redirect", "/fetch", "/xhr", "/socket"]) {
      const dir = await mkdtemp("node_modules/.cache/web-page-")
      try {
        const result = await saved(dir, `http://outside.test:${server.port}${path}`)
        expect(Result.isFailure(result)).toBe(true)
        if (!Result.isFailure(result)) throw new Error("A home-network request was saved")
        expect(result.failure.message).toBe(AT_HOME)
        expect(await readdir(`${dir}/attached`).catch(() => [])).toEqual([])
        expect(await Bun.file(`${dir}/web-pages.json`).exists()).toBe(false)
        expect(privateHits).toBe(0)
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
  } finally { await server.stop(true) }
}, 60000)

test("unreachable, cancelled, sink, worker and socket resources do not discard a public page", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/web-resources-")
  const started = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()
  const paths = new Set<string>()
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      paths.add(url.pathname)
      if (url.pathname === "/cancelled") {
        started.resolve()
        await aborted.promise
        return new Response("late response")
      }
      if (url.pathname === "/abort-ready") {
        await started.promise
        return new Response("ready")
      }
      if (url.pathname === "/abort-ack") aborted.resolve()
      if (url.pathname === "/large") return new Response(new Uint8Array(17 * 1024 * 1024))
      if (url.pathname === "/long") return new Response("long address works")
      if (url.pathname === "/poll") {
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("pending")) } }))
      }
      if (url.pathname === "/worker.js") return new Response(`fetch("http://127.0.0.1:${server.port}/private")`, { headers: { "content-type": "text/javascript" } })
      if (url.pathname !== "/page") return new Response("")
      return new Response(`<h1>Статья 620</h1><a rel="license">waiting</a><script>
        const failures = [
          fetch("http://unreachable.invalid/").then(() => false, () => true),
          fetch("http://sink.test:${server.port}/sink").then(() => false, () => true),
          fetch("/large").then(() => false, () => true)
        ];
        const controller = new AbortController();
        const cancelled = fetch("/cancelled", {signal: controller.signal}).then(() => false, e => e.name === "AbortError");
        fetch("/abort-ready").then(() => { controller.abort(); return fetch("/abort-ack") });
        failures.push(cancelled);
        failures.push(new Promise(resolve => {
          const socket = new WebSocket("ws://outside.test:${server.port}/socket");
          socket.onerror = () => resolve(true);
          socket.onopen = () => resolve(false);
        }));
        new Worker("/worker.js");
        fetch("/poll");
        const long = fetch("/long?q=" + "x".repeat(2100)).then(r => r.text());
        Promise.all([Promise.all(failures), long]).then(([failed, text]) => {
          document.querySelector('[rel="license"]').textContent =
            failed.every(Boolean) && text === "long address works" ? "CC BY 4.0" : "unexpected resource result";
        });
      </script>`, { headers: { "content-type": "text/html" } })
    }
  })
  try {
    const result = await saved(dir, `http://outside.test:${server.port}/page`)
    expect(Result.isSuccess(result)).toBe(true)
    if (!Result.isSuccess(result)) throw result.failure
    expect(result.success.licence).toBe("CC BY 4.0")
    expect((await readFile(`${dir}/attached/${result.success.file}`)).subarray(0, 5).toString()).toBe("%PDF-")
    const record = Schema.decodeSync(Schema.fromJsonString(WebPagesFile))(await readFile(`${dir}/web-pages.json`, "utf8"))
    expect(record.pages).toHaveLength(1)
    expect(paths.has("/cancelled")).toBe(true)
    expect(paths.has("/abort-ack")).toBe(true)
    expect(paths.has("/long")).toBe(true)
    expect(paths.has("/poll")).toBe(true)
    expect(paths.has("/sink")).toBe(false)
    expect(paths.has("/socket")).toBe(false)
    expect(paths.has("/private")).toBe(false)
  } finally {
    aborted.resolve()
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)

test("dedicated, shared and service workers are blocked without discarding their page", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  let privateHits = 0
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname
      if (path === "/private") privateHits++
      if (path === "/worker.js") return new Response(`fetch("http://127.0.0.1:${server.port}/private")`, { headers: { "content-type": "text/javascript" } })
      const scripts: Readonly<Record<string, string>> = {
        "/dedicated": 'new Worker("/worker.js")',
        "/shared": 'new SharedWorker("/worker.js")',
        "/service": 'navigator.serviceWorker.register("/worker.js")'
      }
      return new Response(`<h1>Статья 620</h1><a rel="license">CC BY 4.0</a><script>${scripts[path] ?? ""}</script>`, { headers: { "content-type": "text/html" } })
    }
  })
  try {
    for (const path of ["/dedicated", "/shared", "/service"]) {
      const dir = await mkdtemp("node_modules/.cache/web-worker-")
      try {
        const result = await saved(dir, `http://localhost:${server.port}${path}`)
        expect(Result.isSuccess(result)).toBe(true)
        if (!Result.isSuccess(result)) throw result.failure
        expect(result.success.licence).toBe("CC BY 4.0")
        expect((await readFile(`${dir}/attached/${result.success.file}`)).subarray(0, 5).toString()).toBe("%PDF-")
        expect(privateHits).toBe(0)
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
  } finally { await server.stop(true) }
}, 30000)

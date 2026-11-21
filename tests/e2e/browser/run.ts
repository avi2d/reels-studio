import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { Schema } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import config from "../../../checks.config.ts"
import { CHAT_PICTURE, SOURCE_VIDEO } from "./scenario.ts"

const BROWSER_DEADLINE_MS = 8 * 60_000
const FFMPEG_DEADLINE_MS = 2 * 60_000
const KILL_GRACE_MS = 5_000
const site = config.browser?.site

const pickPort = async (): Promise<string> => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") })
  const port = probe.port
  await probe.stop(true)
  return String(port)
}

const studioReady = async (server: Bun.Subprocess, studioUrl: string): Promise<void> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await fetch(`${studioUrl}/api/projects`, { signal: AbortSignal.timeout(1000) }).catch(() => undefined)
    const code = server.exitCode
    if (code !== null) throw new Error(`Studio did not start (exit code: ${code})`)
    if (response?.ok === true) return
    await Bun.sleep(100)
  }
  const code = server.exitCode
  if (code !== null) throw new Error(`Studio did not start (exit code: ${code})`)
  throw new Error("Studio did not start (still running)")
}

const snapshotHome = async (directory: string, studioUrl: string): Promise<void> => {
  const paths = ["/", "/app.css", "/app.js", "/api/projects",
    "/fonts/onest-cyrillic.woff2", "/fonts/onest-latin.woff2",
    "/fonts/unbounded-cyrillic.woff2", "/fonts/unbounded-latin.woff2"]
  await Promise.all(paths.map(async (path) => {
    const response = await fetch(new URL(path, studioUrl))
    assert(response.ok, `Cannot copy ${path} from the studio: ${response.status}`)
    await Bun.write(join(directory, path === "/" ? "index.html" : path.slice(1)), response)
  }))
}

const killAndWait = async (child: Bun.Subprocess): Promise<void> => {
  if (child.exitCode !== null) return
  child.kill()
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(KILL_GRACE_MS).then(() => false)])
  if (!exited) child.kill("SIGKILL")
  await child.exited
}

const awaitExit = async (command: Bun.Subprocess, label: string, deadlineMs: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const stalled = await Promise.race([
      command.exited.then(() => false),
      new Promise<true>((resolve) => { timer = setTimeout(() => resolve(true), deadlineMs) })
    ])
    if (!stalled) return
    command.kill()
    await command.exited
    throw new Error(`${label} stalled`)
  } finally {
    clearTimeout(timer)
  }
}

const ffmpeg = async (args: readonly string[]): Promise<void> => {
  const command = Bun.spawn(["ffmpeg", "-nostdin", "-v", "error", "-y", ...args], { stderr: "inherit" })
  await awaitExit(command, "ffmpeg", FFMPEG_DEADLINE_MS)
  assert.equal(command.exitCode, 0, "ffmpeg could not make the browser fixture")
}

const makeMedia = (directory: string) => Promise.all([
  ffmpeg(["-f", "lavfi", "-i", "color=blue:s=160x284:r=30:d=7", "-f", "lavfi", "-i", "sine=frequency=440:duration=7",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(directory, SOURCE_VIDEO)]),
  ffmpeg(["-f", "lavfi", "-i", "color=blue:s=64x48", "-frames:v", "1", "-threads", "1", join(directory, CHAT_PICTURE)])
])

const CHAT_EOF_MS = 10_000

const Models = Schema.Struct({ models: Schema.Array(Schema.String) })
const Created = Schema.Struct({ project: Schema.Struct({ id: Schema.String }) })

const probeChatEof = async (studioUrl: string): Promise<void> => {
  const models = Schema.decodeUnknownSync(Models)(await (await fetch(`${studioUrl}/api/models`)).json()).models
  const model = models[0]
  assert(model !== undefined, "The studio lists no chat models")
  const created = Schema.decodeUnknownSync(Created)(await (await fetch(`${studioUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Chat EOF probe" }) })).json())
  const started = Date.now()
  const response = await fetch(`${studioUrl}/api/projects/${created.project.id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Собери блоки из всех видео.", files: [], model, effort: "medium" }) })
  assert(response.ok, `The chat probe was refused: ${response.status}`)
  assert(response.body !== null, "The chat probe got no body")
  const reader = response.body.getReader()
  let bytes = 0
  for (;;) {
    const next = await Promise.race([
      reader.read(),
      Bun.sleep(CHAT_EOF_MS).then(() => {
        throw new Error(`The chat response body stayed open after ${CHAT_EOF_MS} ms and ${bytes} bytes; the browser would hang on it`)
      })
    ])
    if (next.done) break
    bytes += next.value.byteLength
  }
  console.log(`browser: the chat body reached EOF after ${Date.now() - started} ms and ${bytes} bytes`)
}

const printChrome = async (): Promise<void> => {
  try {
    const { chromium } = await import("playwright-core")
    const path = process.env.CHROME_PATH
    console.log(`browser: launching ${path === undefined || path === "" ? "channel chrome" : path}`)
    const launched = await chromium.launch(path === undefined || path === "" ? { channel: "chrome" } : { executablePath: path })
    console.log(`browser: ${launched.version()}`)
    await launched.close()
  } catch (error) {
    console.log(`browser: could not read the Chrome version: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const runBrowserChecks = async (directory: string, staticSite: string, port: string): Promise<number> => {
  const studioUrl = `http://127.0.0.1:${port}`
  await makeMedia(directory)
  const standIn = join(import.meta.dir, "tool.ts")
  const server = Bun.spawn([process.execPath, "src/index.ts"], {
    env: {
      ...process.env,
      REELS_HOST: "127.0.0.1",
      REELS_PORT: port,
      REELS_PROJECTS_DIR: join(directory, "projects"),
      REELS_HEAVY: standIn,
      REELS_PI: standIn
    },
    stdout: "inherit",
    stderr: "inherit"
  })
  try {
    await studioReady(server, studioUrl)
    // The kit serves only static files; its hooks visit the live studio.
    await snapshotHome(staticSite, studioUrl)
    await probeChatEof(studioUrl)
    await printChrome()
    const browser = Bun.spawn([process.execPath, "x", "--no-install", "checks-browser", "--pr"], {
      env: { ...process.env, REELS_BROWSER_URL: studioUrl, REELS_BROWSER_DIR: directory },
      stdout: "pipe",
      stderr: "pipe"
    })
    let recent = ""
    const forward = async (stream: ReadableStream<Uint8Array> | null, write: (chunk: Uint8Array) => void): Promise<void> => {
      if (stream === null) return
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          write(next.value)
          recent += decoder.decode(next.value, { stream: true })
          if (recent.length > 8000) recent = recent.slice(-8000)
        }
      } finally {
        reader.releaseLock()
      }
    }
    const forwarding = Promise.all([
      forward(browser.stdout, (chunk) => process.stdout.write(chunk)),
      forward(browser.stderr, (chunk) => process.stderr.write(chunk))
    ])
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const stalled = await Promise.race([
        browser.exited.then(() => false),
        new Promise<true>((resolve) => { timer = setTimeout(() => resolve(true), BROWSER_DEADLINE_MS) })
      ])
      if (!stalled) {
        await forwarding
        return browser.exitCode ?? 1
      }
      throw new Error(`The browser checks stalled. Last output:\n${recent === "" ? "(no output)" : recent}`)
    } finally {
      clearTimeout(timer)
      await killAndWait(browser)
      await forwarding
    }
  } finally {
    await killAndWait(server)
  }
}

assert(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true", "Run the browser checks in GitHub Actions.")
assert(site !== undefined, "checks.config.ts must declare a browser site")

const port = await pickPort()
const directory = await mkdtemp(join(tmpdir(), "reels-browser-"))
try {
  process.exitCode = await runBrowserChecks(directory, site, port)
} finally {
  await Promise.all([rm(directory, { recursive: true, force: true }), rm(site, { recursive: true, force: true })])
}

import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import config from "../../../checks.config.ts"
import { CHAT_PICTURE, SOURCE_VIDEO } from "./scenario.ts"

const PORT = "18765"
const studioUrl = `http://127.0.0.1:${PORT}`
const site = config.browser?.site

const studioReady = async (server: Bun.Subprocess): Promise<void> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && server.exitCode === null) {
    const response = await fetch(`${studioUrl}/api/projects`, { signal: AbortSignal.timeout(1000) }).catch(() => undefined)
    if (response?.ok === true) return
    await Bun.sleep(100)
  }
  throw new Error(`Studio did not start (exit code: ${server.exitCode ?? "still running"})`)
}

const snapshotHome = async (directory: string): Promise<void> => {
  const paths = ["/", "/app.css", "/app.js", "/api/projects",
    "/fonts/onest-cyrillic.woff2", "/fonts/onest-latin.woff2",
    "/fonts/unbounded-cyrillic.woff2", "/fonts/unbounded-latin.woff2"]
  await Promise.all(paths.map(async (path) => {
    const response = await fetch(new URL(path, studioUrl))
    assert(response.ok, `Cannot copy ${path} from the studio: ${response.status}`)
    await Bun.write(join(directory, path === "/" ? "index.html" : path.slice(1)), response)
  }))
}

const ffmpeg = async (args: readonly string[]): Promise<void> => {
  const command = Bun.spawn(["ffmpeg", "-nostdin", "-v", "error", "-y", ...args], { stderr: "inherit" })
  assert.equal(await command.exited, 0, "ffmpeg could not make the browser fixture")
}

const makeMedia = (directory: string) => Promise.all([
  ffmpeg(["-f", "lavfi", "-i", "color=blue:s=160x284:r=30:d=7", "-f", "lavfi", "-i", "sine=frequency=440:duration=7",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(directory, SOURCE_VIDEO)]),
  ffmpeg(["-f", "lavfi", "-i", "color=blue:s=64x48", "-frames:v", "1", "-threads", "1", join(directory, CHAT_PICTURE)])
])

const runBrowserChecks = async (directory: string, staticSite: string): Promise<number> => {
  await makeMedia(directory)
  const standIn = join(import.meta.dir, "tool.ts")
  const server = Bun.spawn([process.execPath, "src/index.ts"], {
    env: {
      ...process.env,
      REELS_HOST: "127.0.0.1",
      REELS_PORT: PORT,
      REELS_PROJECTS_DIR: join(directory, "projects"),
      REELS_HEAVY: standIn,
      REELS_PI: standIn
    },
    stdout: "inherit",
    stderr: "inherit"
  })
  try {
    await studioReady(server)
    // The kit serves only static files; its hooks visit the live studio.
    await snapshotHome(staticSite)
    return await Bun.spawn([process.execPath, "x", "--no-install", "checks-browser", "--pr"], {
      env: { ...process.env, REELS_BROWSER_URL: studioUrl, REELS_BROWSER_DIR: directory },
      stdout: "inherit",
      stderr: "inherit"
    }).exited
  } finally {
    server.kill()
    await server.exited
  }
}

assert(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true", "Run the browser checks in GitHub Actions.")
assert(site !== undefined, "checks.config.ts must declare a browser site")

const directory = await mkdtemp(join(tmpdir(), "reels-browser-"))
try {
  process.exitCode = await runBrowserChecks(directory, site)
} finally {
  await Promise.all([rm(directory, { recursive: true, force: true }), rm(site, { recursive: true, force: true })])
}

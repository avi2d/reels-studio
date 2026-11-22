import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { checkSound, readSoundCheck } from "../../src/server/sound-check.ts"
import { Settings } from "../../src/server/settings.ts"
import type { Cut } from "../../src/server/timeline-files.ts"

const ffmpeg = async (args: ReadonlyArray<string>): Promise<void> => {
  const process = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "ignore", stderr: "pipe" })
  const error = await new Response(process.stderr).text()
  if (await process.exited !== 0) throw new Error(error)
}

test("a heard clip changes the measured soundtrack instead of checking the voice alone", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/heard-clip-")
  try {
    await mkdir(`${dir}/source`)
    await mkdir(`${dir}/attached`)
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=4:sample_rate=48000", "-af", "volume=0.05", `${dir}/source/voice.wav`])
    await ffmpeg([
      "-f", "lavfi", "-i", "color=white:size=32x32:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=880:duration=2:sample_rate=48000",
      "-c:v", "libx264", "-c:a", "aac", "-shortest", `${dir}/attached/clip.mp4`
    ])
    const settings = {
      host: "127.0.0.1", port: 8765, projectsDir: dir, pi: "pi", models: [],
      root: process.cwd(), heavy: [], encoder: "libx264"
    }
    const hear = async (sound: boolean) => {
      const cut = {
        clips: [{ block: "voice", video: "voice.wav", start: 0, end: 4 }],
        inserts: [{ id: "clip", start: 1, end: 4, visual: { kind: "clip", file: "clip.mp4", start: 0, sound } }]
      } satisfies Cut
      return await Effect.runPromise(Effect.gen(function*() {
        yield* checkSound(dir, cut, () => Effect.void)
        return yield* readSoundCheck(dir, cut, { state: "idle" })
      }).pipe(Effect.provideService(Settings, settings), Effect.provide(BunServices.layer)))
    }
    const silent = (await hear(false)).heard
    const heard = (await hear(true)).heard
    expect(silent).toBeDefined()
    expect(heard).toBeDefined()
    expect(heard?.fresh).toBe(true)
    expect(heard?.levelling.before ?? -100).toBeGreaterThan((silent?.levelling.before ?? 0) + 10)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)

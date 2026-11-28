import { expect, test } from "bun:test"
import { noiseFilters } from "../../src/server/media-commands.ts"

const RATE = 48000
const TONE_ONSET = RATE / 2
const TOLERANCE = RATE / 1000

const firstLoudSample = async (filters: ReadonlyArray<string>): Promise<number> => {
  const tone = `aevalsrc='if(gte(n,${String(TONE_ONSET)}),0.5*sin(2*PI*1000*t),0)':s=${String(RATE)}:d=1`
  const process = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", tone,
    ...(filters.length === 0 ? [] : ["-af", filters.join(",")]),
    "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"
  ], { stdout: "pipe", stderr: "pipe" })
  const [bytes, error] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text()])
  if (await process.exited !== 0) throw new Error(error)
  return new Float32Array(bytes).findIndex((sample) => Math.abs(sample) > 0.1)
}

test("cleaned sound starts with the picture instead of lagging it by the FFT delay", async () => {
  expect(Math.abs(await firstLoudSample([]) - TONE_ONSET)).toBeLessThanOrEqual(TOLERANCE)
  for (const strength of ["light", "strong"] as const) {
    expect(Math.abs(await firstLoudSample(noiseFilters(strength)) - TONE_ONSET)).toBeLessThanOrEqual(TOLERANCE)
  }
}, 30000)

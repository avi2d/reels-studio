import { Data, Effect, FileSystem, Option, Path, Schema } from "effect"
import { Approval, planView } from "../shared/brief.ts"
import { assOf, hasCaptions, NO_CAPTIONS, shownTexts, TextsFile, type CaptionPart, type Captions } from "../shared/captions.ts"
import type { Transcript } from "../shared/plan.ts"
import { subtitleWords } from "../shared/subtitles.ts"
import type { Clip } from "../shared/timeline.ts"
import { fitsArea, textAreaOf } from "../shared/zones.ts"
import { REEL_RATE } from "./media-commands.ts"
import { run } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const decodeApproval = Schema.decodeUnknownOption(Schema.fromJsonString(Approval))
const decodeTexts = Schema.decodeUnknownOption(Schema.fromJsonString(TextsFile))

const readText = Effect.fnUntraced(function*(file: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(file))) return undefined
  return yield* fs.readFileString(file)
})

const planApproved = Effect.fnUntraced(function*(dir: string) {
  const text = yield* readText(`${dir}/plan.md`)
  const saved = yield* readText(`${dir}/approval.json`)
  const approval = saved === undefined ? undefined : Option.getOrUndefined(decodeApproval(saved))
  return planView(text, approval).state === "approved"
})

const readTexts = Effect.fnUntraced(function*(dir: string) {
  const file = `${dir}/texts.json`
  const written = yield* readText(file)
  if (written === undefined) return []
  const decoded = Option.getOrUndefined(decodeTexts(written))
  if (decoded === undefined) yield* Effect.logError("the on-screen texts are unreadable", file)
  return decoded?.texts ?? []
})

// The words on the screen wait for the person's yes to the plan, which quotes every key thought.
export const readCaptions = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>) {
  if (!(yield* planApproved(dir))) return NO_CAPTIONS
  return { words: subtitleWords(clips, transcripts), texts: shownTexts(yield* readTexts(dir), clips, transcripts) } satisfies Captions
})

// Two levels: the option value inside the filter, then the filter inside the graph.
export const filterPath = (file: string): string =>
  file.replace(/[\\':]/gu, "\\$&").replace(/[\\'[\],;]/gu, "\\$&")

const captionFilter = (ass: string, fonts: string): string => `ass=filename=${filterPath(ass)}:fontsdir=${filterPath(fonts)}`

const inkArgs = (ass: string, fonts: string, seconds: number): ReadonlyArray<string> => [
  "-hide_banner", "-nostats", "-loglevel", "info", "-f", "lavfi", "-i", `color=c=black:s=1080x1920:r=${REEL_RATE}:d=${seconds.toFixed(3)}`,
  "-vf", `${captionFilter(ass, fonts)},bbox=min_val=16`, "-f", "null", "-"
]

interface Ink {
  readonly at: number
  readonly rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
}

export const inkOf = (stderr: string): ReadonlyArray<Ink> =>
  [...stderr.matchAll(/pts_time:([\d.]+)\s+x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)/gu)].map((match) => ({
    at: Number(match[1]),
    rect: { left: Number(match[2]), right: Number(match[3]) + 1, top: Number(match[4]), bottom: Number(match[5]) + 1 }
  }))

class TextOutside extends Data.TaggedError("TextOutside")<{ readonly part: CaptionPart; readonly ink: Ink }> {}

const fontsDir = Effect.fnUntraced(function*() {
  const settings = yield* Settings
  const path = yield* Path.Path
  return path.join(settings.root, "brands", "azalia", "fonts")
})

// Words and key thoughts are measured apart, because the box around both at once can reach the button column neither touches.
export const placeCaptions = Effect.fnUntraced(function*(work: string, captions: Captions, seconds: number) {
  if (!hasCaptions(captions)) return undefined
  const fs = yield* FileSystem.FileSystem
  const fonts = yield* fontsDir()
  const area = textAreaOf("Instagram")
  for (const part of ["words", "texts"] as const) {
    const file = `${work}/ink-${part}.ass`
    yield* fs.writeFileString(file, assOf(captions, [part]))
    const { stderr } = yield* run("ffmpeg", inkArgs(file, fonts, seconds), [])
    const outside = inkOf(stderr).find((ink) => !fitsArea(ink.rect, area))
    if (outside !== undefined) return yield* new TextOutside({ part, ink: outside })
  }
  const file = `${work}/captions.ass`
  yield* fs.writeFileString(file, assOf(captions))
  return captionFilter(file, fonts)
})

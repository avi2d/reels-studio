import { Data, Effect, FileSystem, Option, Path, Schema } from "effect"
import { assOf, fitWord, hasCaptions, NO_CAPTIONS, shownTexts, TextsFile, type CaptionPart, type Captions } from "../shared/captions.ts"
import type { Transcript } from "../shared/plan.ts"
import { correctedWord, subtitleWords } from "../shared/subtitles.ts"
import { NO_EDITS, type Block, type Clip, type Edits } from "../shared/timeline.ts"
import { fitsArea, textAreaOf } from "../shared/zones.ts"
import { REEL_RATE } from "./media-commands.ts"
import { run } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import { readApproval } from "./approval.ts"

const decodeTexts = Schema.decodeUnknownOption(Schema.fromJsonString(TextsFile))

const readTexts = Effect.fnUntraced(function*(written: string | undefined, file: string) {
  if (written === undefined) return []
  const decoded = Option.getOrUndefined(decodeTexts(written))
  if (decoded === undefined) yield* Effect.logError("the on-screen texts are unreadable", file)
  return decoded?.texts ?? []
})

export const readCaptions = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>, blocks: ReadonlyArray<Block> = [], edits: Edits = NO_EDITS) {
  const { plan, texts } = yield* readApproval(dir)
  if (plan.state !== "approved") return NO_CAPTIONS
  return { words: subtitleWords(clips, transcripts, (clip, index) => correctedWord(blocks, transcripts, edits.subtitles ?? [], clip.block, clip.video, index)), texts: shownTexts(yield* readTexts(texts, `${dir}/texts.json`), clips, transcripts) } satisfies Captions
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
  const { heavy } = yield* Settings
  let placed = captions
  for (const part of ["words", "texts"] as const) {
    const file = `${work}/ink-${part}.ass`
    for (;;) {
      yield* fs.writeFileString(file, assOf(placed, [part]))
      const { stderr } = yield* run("ffmpeg", inkArgs(file, fonts, seconds), heavy)
      const outside = inkOf(stderr).filter((ink) => !fitsArea(ink.rect, area))
      const first = outside[0]
      if (first === undefined) break
      if (part === "texts") return yield* new TextOutside({ part, ink: first })
      const words = placed.words.map((word) => {
        const ink = outside.find((one) => one.at >= Math.round(word.start * 100) / 100 && one.at < Math.round(word.end * 100) / 100)
        return ink === undefined ? word : fitWord(word, ink.rect)
      })
      if (words.every((word, index) => word.size === placed.words[index]?.size)) return yield* new TextOutside({ part, ink: first })
      placed = { ...placed, words }
    }
  }
  const file = `${work}/captions.ass`
  yield* fs.writeFileString(file, assOf(placed))
  return captionFilter(file, fonts)
})

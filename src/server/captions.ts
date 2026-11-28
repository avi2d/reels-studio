import { Data, Effect, FileSystem, Option, Path, Schema } from "effect"
import { assOf, fitPlate, fitWord, hasCaptions, NO_CAPTIONS, plateOf, shownTexts, wordLookOf, type CaptionPart, type Captions } from "../shared/captions.ts"
import type { Transcript } from "../shared/plan.ts"
import { correctedWord, subtitleWords } from "../shared/subtitles.ts"
import { TextsFile, type PlannedTexts } from "../shared/texts.ts"
import type { Block, Clip, Edits } from "../shared/timeline.ts"
import { fitsArea, textAreaOf } from "../shared/zones.ts"
import { REEL_RATE } from "./media-commands.ts"
import { run } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import { readApproval, readText } from "./approval.ts"
import { readExample, readLooks } from "./looks.ts"
import { reportUnreadable } from "./unreadable.ts"

const decodeTexts = Schema.decodeUnknownOption(Schema.fromJsonString(TextsFile))
const textsOf = Effect.fnUntraced(function*(texts: string | undefined, dir: string) {
  const decoded = texts === undefined ? undefined : Option.getOrUndefined(decodeTexts(texts))
  yield* reportUnreadable(`${dir}/texts.json`, decoded === undefined ? texts : undefined, "the on-screen texts are unreadable")
  if (texts === undefined) return { state: "none" } satisfies PlannedTexts
  if (decoded !== undefined) return { state: "ready", planned: decoded.texts } satisfies PlannedTexts
  return { state: "unreadable" } satisfies PlannedTexts
})

export const readTexts = Effect.fnUntraced(function*(dir: string) {
  return yield* textsOf(yield* readText(`${dir}/texts.json`), dir)
})

export const readCaptions = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>, blocks: ReadonlyArray<Block>, edits: Edits) {
  const looks = yield* readLooks(dir)
  const example = looks.subtitles.style === "example" ? yield* readExample(dir) : undefined
  const styled = {
    look: wordLookOf(looks.subtitles, example?.subtitles),
    title: example?.title ?? "top",
    plate: plateOf(looks.plate, clips)
  } satisfies Partial<Captions>
  const approval = yield* readApproval(dir)
  if (approval.plan.state !== "approved") return { ...NO_CAPTIONS, ...styled }
  const texts = yield* textsOf(approval.texts, dir)
  return {
    ...styled,
    words: subtitleWords(clips, transcripts, (clip, index) => correctedWord(blocks, transcripts, edits.subtitles ?? [], clip.block, clip.video, index)),
    texts: texts.state === "ready" ? shownTexts(texts.planned, clips, transcripts, edits.texts ?? []) : []
  } satisfies Captions
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

class TextOutside extends Data.TaggedError("TextOutside")<{ readonly part: CaptionPart; readonly ink: Ink }> {
  override get message(): string {
    const { left, right, top, bottom } = this.ink.rect
    return `the ${this.part} at ${this.ink.at} s inked x ${left}-${right}, y ${top}-${bottom}, outside the clear zone`
  }
}

const fontsDir = Effect.fnUntraced(function*() {
  const settings = yield* Settings
  const path = yield* Path.Path
  return path.join(settings.root, "brands", "azalia", "fonts")
})

// The next try after the ink of a part left the area, or undefined when shrinking cannot help.
const refit = (part: CaptionPart, placed: Captions, outside: ReadonlyArray<Ink>): Captions | undefined => {
  const first = outside[0]
  if (first === undefined || part === "texts") return undefined
  if (part === "plate") {
    const plate = placed.plate === undefined ? undefined : fitPlate(placed.plate, first.rect)
    return plate === undefined || plate.size === placed.plate?.size ? undefined : { ...placed, plate }
  }
  const words = placed.words.map((word) => {
    const ink = outside.find((one) => one.at >= Math.round(word.start * 100) / 100 && one.at < Math.round(word.end * 100) / 100)
    return ink === undefined ? word : fitWord(word, ink.rect, placed.look.size)
  })
  return words.every((word, index) => word.size === placed.words[index]?.size) ? undefined : { ...placed, words }
}

const present = (captions: Captions): Readonly<Record<CaptionPart, boolean>> =>
  ({ words: captions.words.length > 0, texts: captions.texts.length > 0, plate: captions.plate !== undefined })

// Each part is measured apart, because the box around two at once can reach the button column neither touches.
export const placeCaptions = Effect.fnUntraced(function*(work: string, captions: Captions, seconds: number) {
  if (!hasCaptions(captions)) return undefined
  const fs = yield* FileSystem.FileSystem
  const fonts = yield* fontsDir()
  const area = textAreaOf("Instagram")
  const { heavy } = yield* Settings
  const parts = present(captions)
  let placed = captions
  for (const part of ["words", "texts", "plate"] as const) {
    if (!parts[part]) continue
    const file = `${work}/ink-${part}.ass`
    for (;;) {
      yield* fs.writeFileString(file, assOf(placed, [part]))
      const { stderr } = yield* run("ffmpeg", inkArgs(file, fonts, seconds), heavy)
      const outside = inkOf(stderr).filter((ink) => !fitsArea(ink.rect, area))
      const first = outside[0]
      if (first === undefined) break
      const next = refit(part, placed, outside)
      if (next === undefined) return yield* new TextOutside({ part, ink: first })
      placed = next
    }
  }
  const file = `${work}/captions.ass`
  yield* fs.writeFileString(file, assOf(placed))
  return captionFilter(file, fonts)
})

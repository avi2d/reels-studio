import { Effect, FileSystem } from "effect"
import { LOUDNESS_TARGET, SERIES_STEP, type Levelling } from "../shared/reel.ts"
import { curveOf, gainsOf, levelArgs, partGainsOf, type PartLevel } from "./level-curve.ts"
import { joinList, passagesOf, secondsOf, type Part, type Span } from "./media-commands.ts"
import { clipSoundArgs, type InsertLayer } from "./insert-commands.ts"
import { sampledAt } from "./loudness-meter.ts"
import { joinArgs, type Streams } from "./sound-commands.ts"
import { measureLoudness, measurePart, shortTermLoudness, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const measurePassages = Effect.fnUntraced(function*(work: string, levelled: string, spans: ReadonlyArray<Span>) {
  return yield* Effect.forEach(spans, (span) => Effect.gen(function*() {
    const segment = { start: span.from, seconds: span.to - span.from }
    const before = yield* measureLoudness(`${work}/joined.mp4`, segment)
    const after = yield* measureLoudness(levelled, segment)
    return { ...span, before: before.lufs, after: after.lufs }
  }))
})

const levelReel = Effect.fnUntraced(function*(work: string, parts: ReadonlyArray<PartLevel>, offset: number, output: string, streams: Streams) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const curve = `${work}/curve.txt`
  const gains = gainsOf(parts, offset)
  yield* fs.writeFileString(curve, curveOf(gains))
  yield* tool("ffmpeg", levelArgs(`${work}/joined.mp4`, curve, output, streams), settings.heavy)
  return { sound: yield* measureLoudness(output), gains }
})

export const concatParts = Effect.fnUntraced(function*(work: string, names: ReadonlyArray<string>, output: string, streams: Streams) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  yield* fs.writeFileString(`${work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${work}/parts.txt`, output, streams), settings.heavy)
})

export type Rendered = Part & PartLevel & { readonly name: string }

export const partFileOf = (index: number, extension: "mov" | "wav"): string => `part-${String(index + 1).padStart(3, "0")}.${extension}`

export const renderedOf = Effect.fnUntraced(function*(work: string, parts: ReadonlyArray<Part>, index: number, part: Part, name: string) {
  const [from, to] = [secondsOf(parts.slice(0, index)), secondsOf(parts.slice(0, index + 1))]
  const lufs = (yield* measurePart(`${work}/${name}`, to - from)).lufs
  return { ...part, name, from, to, lufs } satisfies Rendered
})

export const SOUND_STEPS = 5

const joinSound = Effect.fnUntraced(function*(work: string, rendered: ReadonlyArray<Rendered>, layers: ReadonlyArray<InsertLayer>, streams: Streams) {
  const joined = `${work}/joined.mp4`
  const mix = clipSoundArgs(`${work}/voice.mp4`, layers, joined, streams)
  yield* concatParts(work, rendered.map((part) => part.name), mix === undefined ? joined : `${work}/voice.mp4`, streams)
  if (mix !== undefined) yield* tool("ffmpeg", mix, (yield* Settings).heavy)
})

export const levelSound = Effect.fnUntraced(function*(
  work: string, rendered: ReadonlyArray<Rendered>, levelledFile: string, streams: Streams, soundDone: (step: number) => Effect.Effect<void>,
  layers: ReadonlyArray<InsertLayer>
) {
  const total = secondsOf(rendered)
  yield* joinSound(work, rendered, layers, streams)
  const heard = yield* measureLoudness(`${work}/joined.mp4`)
  const moments = yield* shortTermLoudness(`${work}/joined.mp4`, `${work}/moments.txt`)
  yield* soundDone(1)
  const trial = yield* levelReel(work, rendered, 0, `${work}/trial.mp4`, streams)
  yield* soundDone(2)
  const { sound: changed, gains } = yield* levelReel(work, rendered, LOUDNESS_TARGET - trial.sound.lufs, levelledFile, streams)
  yield* soundDone(3)
  const changedMoments = yield* shortTermLoudness(levelledFile, `${work}/moments-after.txt`)
  yield* soundDone(4)
  const passages = yield* measurePassages(work, levelledFile, passagesOf(rendered, rendered.map((part) => part.lufs)))
  yield* soundDone(5)
  const levelling = {
    before: heard.lufs,
    after: changed,
    series: { before: sampledAt(moments, SERIES_STEP, total), after: sampledAt(changedMoments, SERIES_STEP, total) },
    passages
  } satisfies Levelling
  return { levelling, parts: partGainsOf(gains, rendered) }
})

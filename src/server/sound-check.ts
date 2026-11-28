import { Effect, FileSystem, Option, Schema } from "effect"
import { Levelling, PartGains, type ReelJob, type SoundCheck } from "../shared/reel.ts"
import { partsOf, secondsOf, type Part } from "./media-commands.ts"
import type { Noise } from "../shared/noise.ts"
import { readNoise } from "./face.ts"
import { soundPartArgs } from "./sound-commands.ts"
import { places, tool } from "./media-jobs.ts"
import { levelSound, partFileOf, PartRecord, renderedOf, SOUND_STEPS, type Rendered } from "./reel.ts"
import { Settings } from "./settings.ts"
import type { Cut } from "./timeline-files.ts"
import type { Shown } from "../shared/inserts.ts"
import { insertLayerOf } from "./insert-layers.ts"

const Heard = Schema.Struct({ key: Schema.String, parts: Schema.Array(PartRecord), levelling: Levelling, gains: Schema.Array(PartGains) })
const HeardFile = Schema.fromJsonString(Heard)
const decodeHeard = Schema.decodeUnknownOption(HeardFile)
const encodeHeard = Schema.encodeEffect(HeardFile)

const PARTS_SHARE = 0.4

export const soundKeyOf = (parts: ReadonlyArray<Part>, inserts: ReadonlyArray<Shown>, noise: Noise): string =>
  JSON.stringify({
    noise,
    parts: parts.map(({ video, start, frames }) => ({ video, start, frames })),
    inserts: inserts.flatMap(({ visual, start, end }) => visual.kind === "clip" && visual.sound
      ? [{ file: visual.file, from: visual.start, start, end }]
      : [])
  })

const soundPlaces = (dir: string): { readonly record: string; readonly work: string } => ({
  record: `${dir}/reel/sound.json`,
  work: `${dir}/reel/sound-work`
})

// The parts carry the sound the build cuts from the originals, and levelSound is the build's own levelling, so the verdict is the built file's.
const hearCut = Effect.fnUntraced(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const { record, work } = soundPlaces(dir)
  const parts = partsOf(cut.clips)
  const noise = yield* readNoise(dir)
  yield* fs.remove(work, { recursive: true, force: true })
  yield* fs.makeDirectory(work, { recursive: true })
  const rendered: Array<Rendered> = []
  for (const [index, part] of parts.entries()) {
    const name = partFileOf(index, "wav")
    yield* tool("ffmpeg", soundPartArgs(places({ dir, name: part.video }).source, part, noise, `${work}/${name}`), settings.heavy)
    rendered.push(yield* renderedOf(work, parts, index, part, name))
    yield* onDone(PARTS_SHARE * (index + 1) / parts.length)
  }
  const layers = yield* Effect.forEach(cut.inserts.filter(({ visual }) => visual.kind === "clip" && visual.sound), (insert) => insertLayerOf(dir, insert))
  const heard = yield* levelSound(work, rendered, `${work}/levelled.mp4`, "sound", (step) => onDone(PARTS_SHARE + (1 - PARTS_SHARE) * step / SOUND_STEPS), layers)
  yield* fs.writeFileString(`${work}/sound.json`, yield* encodeHeard({ key: soundKeyOf(parts, cut.inserts, noise), parts, levelling: heard.levelling, gains: heard.parts }))
  yield* fs.rename(`${work}/sound.json`, record)
})

export const checkSound = Effect.fn("Sound.check")(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  if (cut.clips.length === 0) return
  const fs = yield* FileSystem.FileSystem
  const cleanup = fs.remove(soundPlaces(dir).work, { recursive: true, force: true }).pipe(
    Effect.catch((error) => Effect.logError("the sound check files were not removed", error))
  )
  yield* hearCut(dir, cut, onDone).pipe(Effect.ensuring(cleanup))
})

export const readSoundCheck = Effect.fnUntraced(function*(dir: string, cut: Cut, job: ReelJob) {
  if (cut.clips.length === 0) return { job: { state: "idle" } } satisfies SoundCheck
  const fs = yield* FileSystem.FileSystem
  const { record } = soundPlaces(dir)
  const heard = (yield* fs.exists(record)) ? Option.getOrUndefined(decodeHeard(yield* fs.readFileString(record))) : undefined
  if (heard === undefined) return { job } satisfies SoundCheck
  return {
    job,
    heard: { fresh: heard.key === soundKeyOf(partsOf(cut.clips), cut.inserts, yield* readNoise(dir)), seconds: secondsOf(heard.parts), levelling: heard.levelling, parts: heard.gains }
  } satisfies SoundCheck
})

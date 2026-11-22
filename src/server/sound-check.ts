import { Effect, FileSystem, Option, Schema } from "effect"
import { Levelling, PartGains, type ReelJob, type SoundCheck } from "../shared/reel.ts"
import { partsOf, sameParts, secondsOf } from "./media-commands.ts"
import { soundPartArgs } from "./sound-commands.ts"
import { measureLoudness, places, tool } from "./media-jobs.ts"
import { levelSound, PartRecord, SOUND_STEPS, type Rendered } from "./reel.ts"
import { Settings } from "./settings.ts"
import type { Cut } from "./timeline-files.ts"

const Heard = Schema.Struct({ parts: Schema.Array(PartRecord), levelling: Levelling, gains: Schema.Array(PartGains) })
const HeardFile = Schema.fromJsonString(Heard)
const decodeHeard = Schema.decodeUnknownOption(HeardFile)
const encodeHeard = Schema.encodeEffect(HeardFile)

const PARTS_SHARE = 0.4

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
  yield* fs.remove(work, { recursive: true, force: true })
  yield* fs.makeDirectory(work, { recursive: true })
  const rendered: Array<Rendered> = []
  for (const [index, part] of parts.entries()) {
    const name = `part-${String(index + 1).padStart(3, "0")}.wav`
    yield* tool("ffmpeg", soundPartArgs(places({ dir, name: part.video }).source, part, `${work}/${name}`), settings.heavy)
    const lufs = (yield* measureLoudness(`${work}/${name}`)).lufs
    rendered.push({ ...part, name, from: secondsOf(parts.slice(0, index)), to: secondsOf(parts.slice(0, index + 1)), lufs })
    yield* onDone(PARTS_SHARE * (index + 1) / parts.length)
  }
  const heard = yield* levelSound(work, rendered, `${work}/levelled.mp4`, "sound", (step) => onDone(PARTS_SHARE + (1 - PARTS_SHARE) * step / SOUND_STEPS))
  yield* fs.writeFileString(`${work}/sound.json`, yield* encodeHeard({ parts, levelling: heard.levelling, gains: heard.parts }))
  yield* fs.rename(`${work}/sound.json`, record)
})

export const checkSound = Effect.fn("Sound.check")(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const cleanup = fs.remove(soundPlaces(dir).work, { recursive: true, force: true }).pipe(
    Effect.catch((error) => Effect.logError("the sound check files were not removed", error))
  )
  yield* hearCut(dir, cut, onDone).pipe(Effect.ensuring(cleanup))
})

export const readSoundCheck = Effect.fnUntraced(function*(dir: string, cut: Cut, job: ReelJob) {
  const fs = yield* FileSystem.FileSystem
  const { record } = soundPlaces(dir)
  const heard = (yield* fs.exists(record)) ? Option.getOrUndefined(decodeHeard(yield* fs.readFileString(record))) : undefined
  if (heard === undefined) return { job } satisfies SoundCheck
  return {
    job,
    heard: { fresh: sameParts(heard.parts, partsOf(cut.clips)), seconds: secondsOf(heard.parts), levelling: heard.levelling, parts: heard.gains }
  } satisfies SoundCheck
})

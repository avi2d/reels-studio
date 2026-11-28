import { Effect, FileSystem, Option, Schema } from "effect"
import { CLEANED, LEVEL_STEP, QUIETEST_DB, pauseNoise, type Cleaned, type NoiseView, type Windows } from "../shared/noise.ts"
import type { ReelJob } from "../shared/reel.ts"
import type { Clip } from "../shared/timeline.ts"
import { readNoise } from "./face.ts"
import { cleanPreviewArgs, noiseFilters, partsOf, secondsOf } from "./media-commands.ts"
import { places, tool } from "./media-jobs.ts"
import { windowLevelArgs, windowLevelsOf } from "./loudness-meter.ts"
import { Settings } from "./settings.ts"

const Levels = Schema.Array(Schema.Finite)

const CleanedFile = Schema.fromJsonString(Schema.Struct({
  key: Schema.String,
  windows: Schema.Struct({ off: Levels, light: Levels, strong: Levels })
}))
const decodeCleaned = Schema.decodeUnknownOption(CleanedFile)
const encodeCleaned = Schema.encodeEffect(CleanedFile)

const cleanedPlaces = (dir: string, video: string) => ({
  record: `${dir}/noise/${video}.json`,
  work: `${dir}/noise/work`,
  preview: (noise: Cleaned) => `${dir}/noise/${noise}/${video}.mp4`
})

const videosOf = (clips: ReadonlyArray<Clip>): ReadonlyArray<string> => [...new Set(clips.map((clip) => clip.video))]

const filterKey = String(Bun.hash(JSON.stringify(CLEANED.map(noiseFilters))))

const cleaningKey = Effect.fnUntraced(function*(dir: string, video: string) {
  const info = yield* (yield* FileSystem.FileSystem).stat(places({ dir, name: video }).source)
  return `${filterKey}:${String(info.size)}:${Option.match(info.mtime, { onNone: () => "", onSome: (time) => String(time.getTime()) })}`
})

const freshRecord = Effect.fnUntraced(function*(dir: string, video: string) {
  const fs = yield* FileSystem.FileSystem
  const place = cleanedPlaces(dir, video)
  if (!(yield* fs.exists(place.record))) return undefined
  const record = Option.getOrUndefined(decodeCleaned(yield* fs.readFileString(place.record)))
  return record?.key === (yield* cleaningKey(dir, video)) ? record : undefined
})

const windowsOf = Effect.fnUntraced(function*(sound: string, metadata: string) {
  yield* tool("ffmpeg", windowLevelArgs(sound, metadata, LEVEL_STEP), (yield* Settings).heavy)
  return windowLevelsOf(yield* (yield* FileSystem.FileSystem).readFileString(metadata), QUIETEST_DB)
})

const cleanVideo = Effect.fnUntraced(function*(dir: string, video: string, onCleaned: () => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = cleanedPlaces(dir, video)
  const files = places({ dir, name: video })
  const key = yield* cleaningKey(dir, video)
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  const made = (noise: Cleaned): string => `${place.work}/${noise}.mp4`
  for (const noise of CLEANED) {
    yield* tool("ffmpeg", cleanPreviewArgs(files, noise, made(noise)), settings.heavy)
    yield* onCleaned()
  }
  const windows = {
    off: yield* windowsOf(files.source, `${place.work}/off.txt`),
    light: yield* windowsOf(made("light"), `${place.work}/light.txt`),
    strong: yield* windowsOf(made("strong"), `${place.work}/strong.txt`)
  }
  yield* fs.remove(place.record, { force: true })
  yield* Effect.forEach(CLEANED, (noise) => Effect.gen(function*() {
    yield* fs.makeDirectory(`${dir}/noise/${noise}`, { recursive: true })
    yield* fs.rename(made(noise), place.preview(noise))
  }), { discard: true })
  yield* fs.writeFileString(`${place.work}/record.json`, yield* encodeCleaned({ key, windows }))
  yield* fs.rename(`${place.work}/record.json`, place.record)
})

const staleVideos = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>) {
  const videos = videosOf(clips)
  const fresh = yield* Effect.forEach(videos, (video) => freshRecord(dir, video))
  return videos.filter((_, index) => fresh[index] === undefined)
})

export const needsCleaning = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>) {
  return (yield* staleVideos(dir, clips)).length > 0
})

export const runCleaning = Effect.fn("Noise.clean")(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const stale = yield* staleVideos(dir, clips)
  const steps = stale.length * CLEANED.length
  const done = { steps: 0 }
  const onCleaned = (): Effect.Effect<void> => {
    done.steps += 1
    return onDone(done.steps / steps)
  }
  const cleanup = fs.remove(`${dir}/noise/work`, { recursive: true, force: true }).pipe(
    Effect.catch((error) => Effect.logError("the half-cleaned sound was not removed", error))
  )
  yield* Effect.forEach(stale, (video) => cleanVideo(dir, video, onCleaned), { discard: true }).pipe(Effect.ensuring(cleanup))
})

const joined = (records: ReadonlyArray<{ readonly windows: Windows }>): Windows => ({
  off: records.flatMap((record) => record.windows.off),
  light: records.flatMap((record) => record.windows.light),
  strong: records.flatMap((record) => record.windows.strong)
})

export const readCleaning = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, job: ReelJob) {
  const cut = secondsOf(partsOf(clips))
  const noise = yield* readNoise(dir)
  const videos = videosOf(clips)
  const records = yield* Effect.forEach(videos, (video) => freshRecord(dir, video))
  const fresh = records.filter((record) => record !== undefined)
  if (videos.length === 0 || fresh.length < videos.length) return { job, cut, noise } satisfies NoiseView
  const made = fresh.map((record) => record.key).join(",")
  const pauses = pauseNoise(joined(fresh))
  return { job, cut, noise, cleaned: { made, ...(pauses === undefined ? {} : { pauses }) } } satisfies NoiseView
})

export const cleanedPreview = Effect.fnUntraced(function*(dir: string, noise: Cleaned, video: string) {
  const fs = yield* FileSystem.FileSystem
  if ((yield* freshRecord(dir, video)) === undefined) return undefined
  const target = cleanedPlaces(dir, video).preview(noise)
  return (yield* fs.exists(target)) ? target : undefined
})

import { DateTime, Effect, FileSystem, Option, Schema } from "effect"
import type { Clip } from "../shared/timeline.ts"
import type { ReelView } from "../shared/reel.ts"
import { joinArgs, joinList, partArgs, partsOf, progressSeconds, sameParts, secondsOf } from "./media-commands.ts"
import { isHdrVideo, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int }))
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

export const publishedReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  if (!(yield* fs.exists(place.record))) return undefined
  const record = Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
  if (record === undefined) return undefined
  const target = place.video(record.video)
  if (!(yield* fs.exists(target))) return undefined
  return { target, record } as const
})

const encodeReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(clips)
  const total = secondsOf(parts)
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  const hdr = new Map<string, boolean>()
  const names: Array<string> = []
  for (const part of parts) {
    const source = places({ dir, name: part.video }).source
    const tone = hdr.get(part.video) ?? (yield* isHdrVideo(source))
    hdr.set(part.video, tone)
    const before = secondsOf(parts.slice(0, names.length))
    const name = `part-${String(names.length + 1).padStart(3, "0")}.mov`
    yield* tool("ffmpeg", partArgs(source, part, tone, settings.encoder, `${place.work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    names.push(name)
  }
  yield* fs.writeFileString(`${place.work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${place.work}/parts.txt`, `${place.work}/reel.mp4`), settings.heavy)
  const made = DateTime.formatIso(yield* DateTime.now)
  const video = `reel-${made.replace(/:/g, "-")}.mp4`
  const previous = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))?.video
    : undefined
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord({ made, video, parts }))
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record)).pipe(
    Effect.tapError(() => fs.remove(place.video(video), { force: true }).pipe(
      Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
    ))
  )
  if (previous !== undefined && previous !== video) {
    yield* fs.remove(place.video(previous), { force: true }).pipe(
      Effect.catch((error) => Effect.logError("the previous reel video was not removed", error))
    )
  }
})

export const buildReel = Effect.fn("Reel.build")(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  yield* encodeReel(dir, clips, onDone).pipe(Effect.ensuring(fs.remove(reelPlaces(dir).work, { recursive: true, force: true }).pipe(
    Effect.catch((error) => Effect.logError("the half-built reel parts were not removed", error))
  )))
})

export const readReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(clips)
  const cut = secondsOf(parts)
  const published = yield* publishedReel(dir)
  if (published === undefined) return { job, cut } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const file = { made: published.record.made, seconds: secondsOf(published.record.parts), size, fresh: sameParts(published.record.parts, parts) }
  return { job, cut, file } satisfies ReelView
})

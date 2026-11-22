import { Data, DateTime, Effect, FileSystem, Option, Schema } from "effect"
import { shapeOf, type Shown } from "../shared/inserts.ts"
import type { ReelView } from "../shared/reel.ts"
import { fileProbeArgs } from "./attachment-notes.ts"
import {
  insertArgs, joinArgs, joinList, partArgs, partsOf, progressSeconds, sameParts, secondsOf, type InsertPicture
} from "./media-commands.ts"
import { isHdrVideo, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import type { Cut } from "./timeline-files.ts"

const ShownInsert = Schema.Struct({ picture: Schema.String, start: Schema.Finite, end: Schema.Finite })
type ShownInsert = typeof ShownInsert.Type

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int })),
  inserts: Schema.Array(ShownInsert).pipe(Schema.withDecodingDefaultKey(Effect.succeed([])))
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

const PictureProbe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({ width: Schema.optionalKey(Schema.Finite), height: Schema.optionalKey(Schema.Finite) }))
}))
const decodePictureProbe = Schema.decodeUnknownEffect(PictureProbe)

const recorded = (inserts: ReadonlyArray<Shown>): ReadonlyArray<ShownInsert> =>
  inserts.map((one) => ({ picture: one.picture, start: Number(one.start.toFixed(4)), end: Number(one.end.toFixed(4)) }))

const sameInserts = (left: ReadonlyArray<ShownInsert>, right: ReadonlyArray<ShownInsert>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

class PictureUnreadable extends Data.TaggedError("PictureUnreadable")<{ readonly picture: string }> {}

const pictureOf = Effect.fnUntraced(function*(dir: string, insert: Shown) {
  const file = `${dir}/attached/${insert.picture}`
  const stream = (yield* decodePictureProbe(yield* tool("ffprobe", fileProbeArgs(file), []))).streams.find((one) => one.width !== undefined)
  if (stream?.width === undefined || stream.height === undefined) return yield* new PictureUnreadable({ picture: insert.picture })
  return { file, shape: shapeOf(stream.width, stream.height), width: stream.width, height: stream.height, start: insert.start, end: insert.end } satisfies InsertPicture
})

const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

export const videoOf = (made: string): string => `reel-${made.replace(/:/g, "-")}.mp4`

const publishedReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  if (!(yield* fs.exists(place.record))) return undefined
  const record = Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
  if (record === undefined) return undefined
  const target = place.video(record.video)
  if (!(yield* fs.exists(target))) return undefined
  return { target, record } as const
})

export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string) {
  const fs = yield* FileSystem.FileSystem
  const target = reelPlaces(dir).video(videoOf(made))
  if (!(yield* fs.exists(target))) return undefined
  return target
})

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const kept = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))?.video
    : undefined
  if (!(yield* fs.exists(`${dir}/reel`))) return
  yield* Effect.forEach(yield* fs.readDirectory(`${dir}/reel`), (name) =>
    name.startsWith("reel-") && name.endsWith(".mp4") && name !== kept
      ? fs.remove(`${dir}/reel/${name}`, { force: true }).pipe(
        Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
      )
      : Effect.void, { discard: true })
})

const PARTS_SHARE = 0.75

const encodeReel = Effect.fnUntraced(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(cut.clips)
  const total = secondsOf(parts)
  const pictures = yield* Effect.forEach(cut.inserts, (insert) => pictureOf(dir, insert))
  const partsShare = pictures.length === 0 ? 1 : PARTS_SHARE
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  yield* sweepReel(dir)
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
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total) * partsShare)
    })
    names.push(name)
  }
  yield* fs.writeFileString(`${place.work}/parts.txt`, joinList(names))
  const joined = pictures.length === 0 ? `${place.work}/reel.mp4` : `${place.work}/joined.mp4`
  yield* tool("ffmpeg", joinArgs(`${place.work}/parts.txt`, joined), settings.heavy)
  if (pictures.length > 0) {
    yield* tool("ffmpeg", insertArgs(joined, pictures, settings.encoder, `${place.work}/reel.mp4`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(PARTS_SHARE + (1 - PARTS_SHARE) * Math.min(1, seconds / total))
    })
  }
  const made = DateTime.formatIso(yield* DateTime.now)
  const video = videoOf(made)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord({ made, video, parts, inserts: recorded(cut.inserts) }))
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
})

export const buildReel = Effect.fn("Reel.build")(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const cleanup = Effect.andThen(
    fs.remove(reelPlaces(dir).work, { recursive: true, force: true }).pipe(
      Effect.catch((error) => Effect.logError("the half-built reel parts were not removed", error))
    ),
    sweepReel(dir).pipe(
      Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
    )
  )
  yield* encodeReel(dir, cut, onDone).pipe(Effect.ensuring(cleanup))
})

export const readReel = Effect.fnUntraced(function*(dir: string, made: Cut, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(made.clips)
  const cut = secondsOf(parts)
  const published = yield* publishedReel(dir)
  if (published === undefined) return { job, cut } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const file = { made: published.record.made, seconds: secondsOf(published.record.parts), size, fresh: sameParts(published.record.parts, parts) && sameInserts(published.record.inserts, recorded(made.inserts)) }
  return { job, cut, file } satisfies ReelView
})

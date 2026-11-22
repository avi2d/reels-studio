import { Data, DateTime, Effect, FileSystem, Option, Schema } from "effect"
import { shapeOf, type Shown } from "../shared/inserts.ts"
import { Frame } from "../shared/timeline.ts"
import { LOUDNESS_TARGET, Loudness, Passage, Series, SERIES_STEP, Sound, type ReelView } from "../shared/reel.ts"
import { pictureProbeArgs } from "./attachment-notes.ts"
import {
  curveOf, gainMomentsOf, insertArgs, joinArgs, joinList, joinsOf, levelArgs, partArgs, partsOf, passagesOf, progressSeconds, sameParts, sampledAt, secondsOf, type InsertPicture, type Moment, type Span
} from "./media-commands.ts"
import { isHdrVideo, measureLoudness, momentaryLoudness, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import type { Cut } from "./timeline-files.ts"

const ShownInsert = Schema.Struct({ picture: Schema.String, start: Schema.Finite, end: Schema.Finite })
type ShownInsert = typeof ShownInsert.Type

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  before: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int, frame: Schema.optionalKey(Frame) })),
  inserts: Schema.Array(ShownInsert).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  loudness: Loudness,
  sound: Sound,
  series: Series,
  passages: Schema.Array(Passage)
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export type ReelVersion = "after" | "before"

const PictureProbe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({ width: Schema.optionalKey(Schema.Finite), height: Schema.optionalKey(Schema.Finite) })),
  frames: Schema.optionalKey(Schema.Array(Schema.Struct({
    side_data_list: Schema.optionalKey(Schema.Array(Schema.Struct({ rotation: Schema.optionalKey(Schema.Finite) })))
  })))
}))
const decodePictureProbe = Schema.decodeUnknownEffect(PictureProbe)

const recorded = (inserts: ReadonlyArray<Shown>): ReadonlyArray<ShownInsert> =>
  inserts.map((one) => ({ picture: one.picture, start: Number(one.start.toFixed(4)), end: Number(one.end.toFixed(4)) }))

const sameInserts = (left: ReadonlyArray<ShownInsert>, right: ReadonlyArray<ShownInsert>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

class PictureUnreadable extends Data.TaggedError("PictureUnreadable")<{ readonly picture: string }> {}

const pictureOf = Effect.fnUntraced(function*(dir: string, insert: Shown) {
  const file = `${dir}/attached/${insert.picture}`
  const probe = yield* decodePictureProbe(yield* tool("ffprobe", pictureProbeArgs(file), []))
  const stream = probe.streams.find((one) => one.width !== undefined)
  if (stream?.width === undefined || stream.height === undefined) return yield* new PictureUnreadable({ picture: insert.picture })
  const rotation = probe.frames?.[0]?.side_data_list?.find((one) => one.rotation !== undefined)?.rotation
  const upright = rotation !== undefined && Math.abs(rotation % 180) === 90
  const width = upright ? stream.height : stream.width
  const height = upright ? stream.width : stream.height
  return { file, shape: shapeOf(width, height), width, height, start: insert.start, end: insert.end } satisfies InsertPicture
})

const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

const stamped = (made: string): string => made.replace(/:/g, "-")
export const videoOf = (made: string): string => `reel-${stamped(made)}.mp4`
const beforeOf = (made: string): string => `before-${stamped(made)}.mp4`

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

export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string, version: ReelVersion) {
  const fs = yield* FileSystem.FileSystem
  const target = reelPlaces(dir).video(version === "before" ? beforeOf(made) : videoOf(made))
  if (!(yield* fs.exists(target))) return undefined
  return target
})

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const record = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
    : undefined
  const kept = new Set<string | undefined>([record?.video, record?.before])
  if (!(yield* fs.exists(`${dir}/reel`))) return
  yield* Effect.forEach(yield* fs.readDirectory(`${dir}/reel`), (name) =>
    name.endsWith(".mp4") && !kept.has(name)
      ? fs.remove(`${dir}/reel/${name}`, { force: true }).pipe(
        Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
      )
      : Effect.void, { discard: true })
})

const measurePassages = Effect.fnUntraced(function*(work: string, spans: ReadonlyArray<Span>) {
  return yield* Effect.forEach(spans, (span) => Effect.gen(function*() {
    const segment = { start: span.from, seconds: span.to - span.from }
    const before = yield* measureLoudness(`${work}/joined.mp4`, segment)
    const after = yield* measureLoudness(`${work}/reel.mp4`, segment)
    return { ...span, before: before.lufs, after: after.lufs }
  }))
})

// One gain curve over the whole reel, not per part, so quiet and loud passages share one target.
const levelReel = Effect.fnUntraced(function*(work: string, moments: ReadonlyArray<Moment>, offset: number, output: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const curve = `${work}/curve.txt`
  yield* fs.writeFileString(curve, curveOf(moments, offset))
  yield* tool("ffmpeg", levelArgs(`${work}/joined.mp4`, curve, output), settings.heavy)
  return yield* measureLoudness(output)
})

const concatParts = Effect.fnUntraced(function*(work: string, names: ReadonlyArray<string>, output: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  yield* fs.writeFileString(`${work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${work}/parts.txt`, output), settings.heavy)
})

// Written last: the record names only files that are already whole.
const publish = Effect.fnUntraced(function*(dir: string, record: typeof Record.Type) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord(record))
  yield* fs.rename(`${place.work}/joined.mp4`, place.video(record.before))
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(record.video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
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
  const rendered: Array<{ readonly name: string; readonly lufs: number }> = []
  for (const part of parts) {
    const source = places({ dir, name: part.video }).source
    const tone = hdr.get(part.video) ?? (yield* isHdrVideo(source))
    hdr.set(part.video, tone)
    const before = secondsOf(parts.slice(0, rendered.length))
    const name = `part-${String(rendered.length + 1).padStart(3, "0")}.mov`
    yield* tool("ffmpeg", partArgs(source, part, tone, settings.encoder, `${place.work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total) * partsShare)
    })
    rendered.push({ name, lufs: (yield* measureLoudness(`${place.work}/${name}`)).lufs })
  }
  yield* concatParts(place.work, rendered.map((part) => part.name), `${place.work}/joined.mp4`)
  const heard = yield* measureLoudness(`${place.work}/joined.mp4`)
  const moments = yield* momentaryLoudness(`${place.work}/joined.mp4`, `${place.work}/moments.txt`)
  const levelled = gainMomentsOf(moments, joinsOf(parts))
  const levelledFile = pictures.length === 0 ? `${place.work}/reel.mp4` : `${place.work}/levelled.mp4`
  const trial = yield* levelReel(place.work, levelled, 0, `${place.work}/trial.mp4`)
  const changed = yield* levelReel(place.work, levelled, LOUDNESS_TARGET - trial.lufs, levelledFile)
  if (pictures.length > 0) {
    yield* tool("ffmpeg", insertArgs(levelledFile, pictures, settings.encoder, `${place.work}/reel.mp4`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(PARTS_SHARE + (1 - PARTS_SHARE) * Math.min(1, seconds / total))
    })
  }
  const finalChanged = pictures.length === 0 ? changed : yield* measureLoudness(`${place.work}/reel.mp4`)
  const changedMoments = yield* momentaryLoudness(`${place.work}/reel.mp4`, `${place.work}/moments-after.txt`)
  const passages = yield* measurePassages(place.work, passagesOf(parts, rendered.map((part) => part.lufs)))
  const made = DateTime.formatIso(yield* DateTime.now)
  const record = {
    made,
    video: videoOf(made),
    before: beforeOf(made),
    parts,
    inserts: recorded(cut.inserts),
    loudness: { before: heard.lufs, after: finalChanged.lufs },
    sound: { lufs: finalChanged.lufs, lra: finalChanged.lra, truePeak: finalChanged.truePeak },
    series: { before: sampledAt(moments, SERIES_STEP, total), after: sampledAt(changedMoments, SERIES_STEP, total) },
    passages
  }
  yield* publish(dir, record)
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
  const { record } = published
  const file = {
    made: record.made,
    seconds: secondsOf(record.parts),
    size,
    fresh: sameParts(record.parts, parts) && sameInserts(record.inserts, recorded(made.inserts)),
    loudness: record.loudness,
    sound: record.sound,
    series: record.series,
    passages: record.passages
  }
  return { job, cut, file } satisfies ReelView
})
